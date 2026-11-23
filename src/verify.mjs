import { createHash } from 'node:crypto';
import { domainOf, sizeLabel, exceeds } from './domain.mjs';
import { execute } from './runtime.mjs';
import { solve, symbolicConfig, usesSymbolic } from './symbolic.mjs';
import { checkIndependence } from './independence.mjs';
import { crosscheck, CROSSCHECK_LIMIT } from './crosscheck.mjs';

export const VERSION = '0.8.0';
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

export function verify(unit, source, limit, engine = 'enumerate') {
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
  const checks = unit.functions.flatMap(f => {
    const domain = domainOf(f).total;
    const symbolic = usesSymbolic(configuration, domain);
    const audit = (answer, enumerate) => crosscheck(answer, domain, limit, enumerate, 'unverified');
    const identity = { function: f.name, visibility: f.kind === 'helper' ? 'private' : f.kind === 'imported' ? 'imported' : 'public',
      loc: f.loc, method: symbolic ? 'symbolic' : 'enumerate', domain: sizeLabel(domain) };
    const finiteSafety = () => obligation(f, limit);
    const safety = symbolic ? audit(solve(f, types), finiteSafety) : finiteSafety();
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
  });
  return { schema: 7, toolVersion: VERSION, module: unit.name, version: unit.version,
    sourceSha256: hash(source), dependencies: unit.dependencies ?? {}, configuration,
    calls: Object.fromEntries(unit.functions.map(f => [f.name, f.calls])),
    permissions: Object.fromEntries(unit.functions.map(f => [f.name, f.reads])),
    policy: 'require-all-declared-obligations',
    enforced: [
      {property: 'types-and-declared-reads', method: 'static'},
      {property: 'typed-inputs-and-own-grants', method: 'runtime'},
      {property: 'admission-and-postconditions', method: 'runtime'}
    ],
    checks, outsideProof: ['host-authorization', 'timing-and-resource-use'].map(property => ({ property, status: 'unsupported' })),
    passed: checks.every(c => c.status === 'proven') };
}
