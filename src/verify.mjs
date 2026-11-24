import { createHash } from 'node:crypto';
import { domainOf, sizeLabel, exceeds } from './domain.mjs';
import { execute, invoke } from './runtime.mjs';
import { solve, symbolicConfig, usesSymbolic } from './symbolic.mjs';
import { checkIndependence } from './independence.mjs';
import { crosscheck, CROSSCHECK_LIMIT } from './crosscheck.mjs';

export const VERSION = '0.10.0';
export const DEFAULT_LIMIT = 65536;
export const hash = data => createHash('sha256').update(data).digest('hex');

function obligation(f, limit) {
  const { total, cases } = domainOf(f);
  const result = { function: f.name, loc: f.loc, property: 'admissible-and-safe',
    domain: sizeLabel(total), examined: 0, admitted: 0 };
  if (exceeds(total, limit)) return { ...result, status: 'unverified', reason: total === null ? 'symbolic-text-domain' : 'case-budget' };
  for (const { args, flags } of cases()) {
    const outcome = execute(f, args, flags);
    result.examined++;
    if (outcome.code === 'PRECONDITION') continue;
    if (outcome.phase !== 'requires') result.admitted++;
    if (outcome.ok) result.admissionWitness ??= {args, flags:Object.fromEntries(flags)};
    if (!outcome.ok) return { ...result, status: 'violated',
      counterexample: { args, flags: Object.fromEntries(flags), outcome } };
  }
  return result.admitted ? { ...result, status: 'proven' } :
    { ...result, status: 'violated', reason: 'empty-admission-domain' };
}

function collectorObligations(f, selectorSafety) {
  const identity = {function: f.name, visibility: f.kind === 'imported' ? 'imported' : 'public', loc: f.loc};
  const admitted = {...identity, property: 'collector-row-admission', method: 'literal-true-admission',
    selector: f.collector, status: 'proven'};
  const proven = selectorSafety.status === 'proven';
  const row = proven ? selectorSafety.admissionWitness : selectorSafety.counterexample;
  const batch = row && {args: [row.args],
    flags: Object.fromEntries(f.reads.map(key => [key, Object.hasOwn(row.flags, key) ? row.flags[key] : false]))};
  const derived = (property, premises) => ({...identity, property, method: 'induction-on-length',
    selector: f.collector, premises: [
      {function: f.collector, property: 'admissible-and-safe'},
      {function: f.name, property: admitted.property},
      ...premises
    ], status: proven ? 'proven' : 'unverified',
    ...(!proven && {reason: 'missing-selector-proof'})});
  return [
    admitted,
    {...derived('admissible-and-safe', [{method: 'static', property: 'declared-transitive-reads'}]),
      scope: 'ordered-collection', domain: selectorSafety.domain,
      ...(proven && {admissionWitness: batch}),
      ...(!proven && batch && {counterexample: {...batch, outcome: invoke(f, batch.flags, batch.args)}})},
    derived('ordered-emissions', [{method: 'static', property: 'typed-skip-or-emit'}]),
    derived('emitted-element-guarantee', [{method: 'static', property: 'typed-skip-or-emit'}]),
    {...derived('output-bound', [{method: 'static', property: 'output-capacity-covers-input'}]),
      inputCapacity: f.params[0][1].capacity, outputCapacity: f.output.capacity}
  ];
}

export function verify(unit, source, limit, engine = 'enumerate') {
  return verifyRevision(unit, source, limit, engine);
}

// Entries live for exactly one trusted comparison. Neither the CLI nor the API
// can import proof objects into this table. A failed obligation is never reused.
export function verifyPair(baseline, candidate, limit, engine = 'enumerate') {
  const table = new Map();
  return [baseline, candidate].map(({unit, bytes}) =>
    verifyRevision(unit, bytes, limit, engine, table));
}

function verifyRevision(unit, source, limit, engine, table) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000000)
    throw new Error('Case limit must be an integer from 1 to 1000000');
  if (!['enumerate', 'symbolic', 'auto'].includes(engine)) throw new Error('Unknown verification engine');
  const configuration = {engine, maxCasesPerFunction: limit, method: 'finite-enumeration-v3'};
  if (engine !== 'enumerate') Object.assign(configuration, symbolicConfig, {
    crosscheckMaxCases: Math.min(limit, CROSSCHECK_LIMIT)
  });
  if (engine === 'auto') {
    configuration.symbolicMethod = symbolicConfig.method;
    configuration.method = 'domain-directed-v1';
  }
  const types = unit.types;
  const safetyByName = new Map();
  const byName = new Map(unit.functions.map(f => [f.name, f]));
  const keys = new Map();
  const dependencies = unit.dependencies ?? {};
  const assumptionsSha256 = hash(JSON.stringify([VERSION, unit.name, types, dependencies, configuration]));
  let reusedFunctions = 0;
  const checks = unit.functions.flatMap(f => {
    const {loc, ...definition} = f;
    const dependsOn = f.calls.map(name => {
      if (!keys.has(name)) throw new Error('Missing checked dependency: ' + name);
      return keys.get(name);
    });
    const key = hash(JSON.stringify([assumptionsSha256, definition, dependsOn]));
    keys.set(f.name, key);
    let results = table?.get(key);
    if (results) {
      reusedFunctions++;
      results = structuredClone(results);
    } else {
      results = prove(f);
      if (table && results.every(c => c.status === 'proven')) table.set(key, results);
    }
    safetyByName.set(f.name, results.find(c => c.property === 'admissible-and-safe'));
    return results.map(check => ({...check, loc, obligationId: unit.name + '/' + f.name + '/' + check.property,
      definitionSha256: key, dependsOn}));
  });
  function prove(f) {
    if (f.collector) return collectorObligations(f, safetyByName.get(f.collector));
    const domain = domainOf(f).total;
    const symbolic = usesSymbolic(configuration, domain);
    const audit = (answer, enumerate) => crosscheck(answer, domain, limit, enumerate, 'unverified');
    const identity = { function: f.name, visibility: f.kind === 'helper' ? 'private' : f.kind === 'imported' ? 'imported' : 'public',
      loc: f.loc, method: symbolic ? 'symbolic' : 'enumerate', domain: sizeLabel(domain) };
    const finiteSafety = () => obligation(f, limit);
    // Use summaries on finite numeric or structural domains. Abstracting a
    // call over text can introduce quantified bounds on new sequence terms,
    // even where the implementation has a decidable concrete reduction.
    let contracts;
    if (symbolic && engine === 'auto' && domain !== null && f.calls.length &&
        f.calls.every(name => safetyByName.get(name)?.status === 'proven')) {
      contracts = Object.fromEntries(f.calls.map(name => {
        const {params, output, requires, ensures} = byName.get(name);
        return [name, {params, output, requires, ensures}];
      }));
    }
    const safety = symbolic ? audit(solve(f, types, undefined, contracts), finiteSafety) : finiteSafety();
    const results = [{ ...identity, property: 'admissible-and-safe', ...safety }];
    if (f.capacity) {
      results[0].scope = 'one-transition';
      // Base case checks the initial invariant even on empty input. The compiled
      // guarantee conjoins the same invariant on the next state with ensures.
      results.push({function: f.name, visibility: identity.visibility, loc: f.loc,
        property: 'prefix-invariant', method: 'induction-on-length', capacity: f.capacity,
        premise: 'admissible-and-safe', status: safety.status === 'proven' ? 'proven' : 'unverified',
        ...(safety.status !== 'proven' && {reason: 'missing-transition-proof'})});
    }
    if (f.independent.length) {
      let flow = { status: 'unverified', reason: 'missing-function-proof' };
      if (safety.status === 'proven') {
        const finiteFlow = () => checkIndependence(f, types, limit, false);
        if (symbolic && f.independent.every(key => !f.referencedParams.includes(key))) {
          // Checked calls have closed frames. A parameter absent from all three
          // expressions cannot affect a callee except via an explicit argument.
          flow = audit({status:'proven', method:'parameter-nonoccurrence'}, finiteFlow);
        } else flow = symbolic ? audit(checkIndependence(f, types, limit, true), finiteFlow) : finiteFlow();
      }
      results.push({ ...identity, property: 'observable-independence', parameters: f.independent, ...flow });
    }
    return results;
  }
  return { schema: 8, toolVersion: VERSION, module: unit.name, version: unit.version,
    sourceSha256: hash(source), dependencies: unit.dependencies ?? {}, configuration,
    calls: Object.fromEntries(unit.functions.map(f => [f.name, f.calls])),
    resourceEstimates: Object.fromEntries(unit.functions.map(f => [f.name, f.budget])),
    permissions: Object.fromEntries(unit.functions.map(f => [f.name, f.reads])),
    verificationSession: {assumptionsSha256, reusedFunctions, checkedFunctions: keys.size - reusedFunctions},
    ...(unit.lookups?.length && {lookups:unit.lookups, effectAssumptions:['trusted-host-handler', 'runtime-validated-response'],
      effectObservations:['resource', 'bounded-text-key', 'request-occurrence'], serviceIndependence:'unverified'}),
    policy: 'require-all-declared-obligations',
    enforced: [
      {property: 'types-and-declared-reads', method: 'static'},
      {property: 'typed-inputs-and-own-grants', method: 'runtime'},
      {property: 'admission-and-postconditions', method: 'runtime'}
    ],
    checks, outsideProof: ['host-authorization', 'timing-and-resource-use'].map(property => ({ property, status: 'unsupported' })),
    passed: checks.every(c => c.status === 'proven') };
}
