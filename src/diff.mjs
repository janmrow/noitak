import { domainOf } from './domain.mjs';
import { execute } from './runtime.mjs';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function compareBodies(old, next) {
  const { total, cases } = domainOf(old);
  for (const { args, flags } of cases()) {
    const before = execute(old, args, flags);
    const after = execute(next, args, flags);
    if (!equal(before, after)) return { status: 'risky',
      witness: { args, flags: Object.fromEntries(flags), before, after } };
  }
  return { status: 'compatible', equalOutcomes: total.toString() };
}

export function compare(oldUnit, newUnit, before, after) {
  const changes = [];
  const record = (subject, field, status, oldValue, newValue) =>
    changes.push({ subject, field, status, before: oldValue, after: newValue });
  if (oldUnit.name !== newUnit.name)
    record('module', 'identity', 'policy-violation', oldUnit.name, newUnit.name);
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
      let status = 'undetermined';
      if (['params', 'output'].includes(field)) status = 'risky';
      if (field === 'reads') {
        status = next.reads.some(k => !old.reads.includes(k)) ? 'policy-violation' : 'compatible';
      }
      // Compare complete outcomes only when both proofs cover the same API and contracts.
      if (field === 'body' && ['params','output','reads','requires','ensures'].every(k => equal(old[k],next[k])) &&
          previous.get(old.name).status === 'proven' && current.get(old.name).status === 'proven') {
        const evidence = compareBodies(old, next);
        changes.push({ subject: old.name, field, ...evidence, before: old.body, after: next.body });
      } else record(old.name, field, status, old[field], next[field]);
    }
    if (!equal(previous.get(old.name), current.get(old.name)))
      record(old.name, 'proof-coverage', 'undetermined', previous.get(old.name), current.get(old.name));
  }
  for (const [name, f] of newer) {
    record(name, 'export', 'compatible', null, 'present');
    if (f.reads.length) record(name, 'reads', 'policy-violation', [], f.reads);
  }
  for (const c of after.checks) if (c.status !== 'proven')
    record(c.function, 'required-proof', 'policy-violation', previous.get(c.function) ?? null, c.status);
  return { schema: 1, toolVersion: after.toolVersion, configuration: after.configuration,
    before: { module: before.module, version: before.version, sourceSha256: before.sourceSha256 },
    after: { module: after.module, version: after.version, sourceSha256: after.sourceSha256 },
    changes, passed: changes.every(c => c.status === 'compatible') };
}
