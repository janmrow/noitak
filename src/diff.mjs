import { cardinality, domainOf } from './domain.mjs';
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
  const {configuration, proven, enums} = context;
  const domain = domainOf(old).total * (field === 'ensures' ? BigInt(cardinality(old.output)) : 1n);
  const symbolic = configuration.method === symbolicConfig.method;
  const evidence = { method: symbolic ? 'symbolic' : 'enumerate', comparisonDomain: String(domain),
    parameters: old.params.map(([name]) => name) };
  const unresolved = reason => ({ ...evidence, status: 'undetermined', reason });
  if (!proven) return unresolved('missing-function-proof');
  if (!['params', 'output', 'reads'].every(k => equal(old[k], next[k])))
    return unresolved('incompatible-interface');
  if (symbolic) {
    if (!enums) return unresolved('incompatible-enums');
    return { ...evidence, ...solveRelation(old, next, enums, field) };
  }
  const limit = configuration.maxCasesPerFunction;
  if (domain > BigInt(limit)) return unresolved('comparison-budget');
  const outcome = field === 'body' ? compareBodies(old, next) : refinement(old, next, field, limit);
  return { ...evidence, ...outcome };
}

export function compare(oldUnit, newUnit, before, after) {
  const changes = [];
  const record = (subject, field, status, oldValue, newValue) =>
    changes.push({ subject, field, status, before: oldValue, after: newValue });
  if (oldUnit.name !== newUnit.name)
    record('module', 'identity', 'policy-violation', oldUnit.name, newUnit.name);
  const oldTypes = new Map(oldUnit.enums.map(e => [e.name, e]));
  const newTypes = new Map(newUnit.enums.map(e => [e.name, e]));
  for (const name of new Set([...oldTypes.keys(), ...newTypes.keys()])) {
    const old = oldTypes.get(name), next = newTypes.get(name);
    if (!equal(old, next)) record(name, 'enum', old ? 'risky' : 'compatible', old ?? null, next ?? null);
  }
  // A shared solver sort is sound only when a name denotes the same variants in both revisions.
  const enumConflict = oldUnit.enums.some(e => newTypes.has(e.name) && !equal(e, newTypes.get(e.name)));
  const enums = enumConflict ? null : [...new Map([...oldTypes, ...newTypes]).values()];
  const newer = new Map(newUnit.functions.map(f => [f.name, f]));
  const coverage = report => new Map(report.checks.map(c => [c.function, { property: c.property, status: c.status, domain: c.domain }]));
  const previous = coverage(before), current = coverage(after);
  for (const old of oldUnit.functions) {
    const next = newer.get(old.name);
    if (!next) {
      record(old.name, 'export', 'risky', 'present', null);
      continue;
    }
    newer.delete(old.name);
    for (const field of ['params', 'output', 'requires', 'ensures', 'body', 'reads']) {
      if (equal(old[field], next[field])) continue;
      if (['requires', 'ensures', 'body'].includes(field)) {
        const proven = previous.get(old.name).status === 'proven' && current.get(old.name).status === 'proven';
        const finding = compareField(old, next, field, {configuration: after.configuration, proven, enums});
        if (finding.witness) finding.witnessKind = {
          requires: 'lost-admission', ensures: 'hypothetical-result', body: 'observed-returns'
        }[field];
        changes.push({ subject: old.name, field, before: old[field], after: next[field], ...finding });
      } else {
        let status = 'risky';
        if (field === 'reads')
          status = next.reads.some(k => !old.reads.includes(k)) ? 'policy-violation' : 'compatible';
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
        reason: c.reason ?? c.status, proofDomain: c.domain, proofStatus: c.status, counterexample: c.counterexample });
  }
  return { schema: 3, toolVersion: after.toolVersion, configuration: after.configuration,
    before, after,
    changes, passed: changes.every(c => c.status === 'compatible') };
}
