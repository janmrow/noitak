import { cardinality, domainOf } from './domain.mjs';
import { crosscheck } from './crosscheck.mjs';
import { execute } from './runtime.mjs';
import { refinement } from './refinement.mjs';
import { solveRelation, symbolicConfig } from './symbolic.mjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function compareBodies(old, next) {
  const { cases } = domainOf(old);
  let compared = 0;
  for (const { args, flags } of cases()) {
    const before = execute(old, args, flags);
    const after = execute(next, args, flags);
    if (before.code === 'PRECONDITION' || after.code === 'PRECONDITION') continue;
    compared++;
    if (!equal(before, after)) return { status: 'risky',
      witness: { args, flags: Object.fromEntries(flags), before, after } };
  }
  return { status: 'compatible', equalOutcomes: String(compared) };
}

function compareField(old, next, field, context) {
  const {configuration, proven, types} = context;
  const domain = domainOf(old).total * (field === 'ensures' ? cardinality(old.output) : 1n);
  const symbolic = configuration.method === symbolicConfig.method;
  const evidence = { method: symbolic ? 'symbolic' : 'enumerate', comparisonDomain: String(domain),
    parameters: old.params.map(([name]) => name) };
  const unresolved = reason => ({ ...evidence, status: 'undetermined', reason });
  if (!proven) return unresolved('missing-function-proof');
  if (!['params', 'output', 'reads'].every(k => equal(old[k], next[k])))
    return unresolved('incompatible-interface');
  const limit = configuration.maxCasesPerFunction;
  const enumerate = () => field === 'body' ? compareBodies(old, next) : refinement(old, next, field, limit);
  if (symbolic) {
    if (!types) return unresolved('incompatible-type-definitions');
    const result = solveRelation(old, next, types, field);
    return { ...evidence, ...crosscheck(result, domain, limit, enumerate, 'undetermined') };
  }
  if (domain > BigInt(limit)) return unresolved('comparison-budget');
  return { ...evidence, ...enumerate() };
}

export function compare(oldUnit, newUnit, before, after) {
  const changes = [];
  const record = (subject, field, status, oldValue, newValue) =>
    changes.push({ subject, field, status, before: oldValue, after: newValue });
  if (oldUnit.name !== newUnit.name)
    record('module', 'identity', 'policy-violation', oldUnit.name, newUnit.name);
  for (const key of new Set([...Object.keys(before.dependencies), ...Object.keys(after.dependencies)])) {
    const a = before.dependencies[key], b = after.dependencies[key];
    if (a !== b) record(key, 'dependency-pin', 'compatible', a ?? null, b ?? null);
  }
  const oldTypes = new Map(oldUnit.types.map(e => [e.name, e]));
  const newTypes = new Map(newUnit.types.map(e => [e.name, e]));
  for (const name of new Set([...oldTypes.keys(), ...newTypes.keys()])) {
    const old = oldTypes.get(name), next = newTypes.get(name);
    if (!equal(old, next)) record(name, (old ?? next).element ? 'sequence' : (old ?? next).fields ? 'record' : 'enum', old ? 'risky' : 'compatible', old ?? null, next ?? null);
  }
  // A shared solver sort is sound only when a name denotes the same type in both revisions.
  const typeConflict = [...oldTypes.values()].some(e => newTypes.has(e.name) && !equal(e, newTypes.get(e.name)));
  const types = typeConflict ? null : [...new Map([...oldTypes, ...newTypes]).values()];
  const oldHelpers = new Map(oldUnit.functions.filter(f => f.kind === 'helper').map(f => [f.name, f]));
  for (const helper of newUnit.functions.filter(f => f.kind === 'helper')) {
    const prior = oldHelpers.get(helper.name);
    const reads = prior?.reads ?? [];
    if (!equal(reads, helper.reads))
      record(helper.name, 'helper-reads', helper.reads.some(k => !reads.includes(k)) ? 'policy-violation' : 'compatible', reads, helper.reads);
    if (prior && !equal(prior.independent, helper.independent))
      record(helper.name, 'independent', prior.independent.some(k => !helper.independent.includes(k)) ?
        'policy-violation' : 'compatible', prior.independent, helper.independent);
  }
  const newer = new Map(newUnit.functions.filter(f => f.kind !== 'helper').map(f => [f.name, f]));
  const coverage = report => new Map(report.checks.filter(c => c.property === 'admissible-and-safe').map(c => [c.function, { property: c.property, status: c.status, domain: c.domain }]));
  const previous = coverage(before), current = coverage(after);
  for (const old of oldUnit.functions.filter(f => f.kind !== 'helper')) {
    const next = newer.get(old.name);
    if (!next) {
      record(old.name, 'export', 'risky', 'present', null);
      continue;
    }
    newer.delete(old.name);
    for (const field of ['params', 'output', 'requires', 'ensures', 'body', 'reads', 'independent']) {
      if (equal(old[field], next[field]) && (field !== 'body' || equal(old.graph, next.graph))) continue;
      if (['requires', 'ensures', 'body'].includes(field)) {
        const proven = previous.get(old.name).status === 'proven' && current.get(old.name).status === 'proven';
        const finding = compareField(old, next, field, {configuration: after.configuration, proven, types});
        if (finding.witness) finding.witnessKind = {
          requires: 'lost-admission', ensures: 'hypothetical-result', body: 'observed-returns'
        }[field];
        changes.push({ subject: old.name, field, before: old[field], after: next[field], ...finding });
      } else {
        let status = 'risky';
        if (field === 'reads')
          status = next.reads.some(k => !old.reads.includes(k)) ? 'policy-violation' : 'compatible';
        if (field === 'independent')
          status = old.independent.some(k => !next.independent.includes(k)) ? 'policy-violation' : 'compatible';
        record(old.name, field, status, old[field], next[field]);
      }
    }
    if (!equal(previous.get(old.name), current.get(old.name)))
      record(old.name, 'proof-coverage', 'undetermined', previous.get(old.name), current.get(old.name));
  }
  for (const [name, f] of newer) {
    record(name, 'export', 'compatible', null, 'present');
    if (f.reads.length) record(name, 'reads', 'policy-violation', [], f.reads);
  }
  for (const [report, field] of [[before, 'baseline-proof'], [after, 'required-proof']]) {
    for (const c of report.checks) if (c.status !== 'proven')
      changes.push({ subject: c.function, field, status: 'policy-violation',
        property: c.property, reason: c.reason ?? c.status, proofDomain: c.domain, proofStatus: c.status, counterexample: c.counterexample });
  }
  return { schema: 5, toolVersion: after.toolVersion, configuration: after.configuration,
    before, after,
    changes, passed: before.passed && after.passed && changes.every(c => c.status === 'compatible') };
}
