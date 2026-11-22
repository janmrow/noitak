import { domainOf } from './domain.mjs';
import { execute } from './runtime.mjs';
import { refinement } from './refinement.mjs';
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
      const comparable = ['params', 'output', 'reads'].every(k => equal(old[k], next[k])) &&
        previous.get(old.name).status === 'proven' && current.get(old.name).status === 'proven';
      const limit = after.configuration.maxCasesPerFunction;
      if (comparable && ['requires', 'ensures'].includes(field)) {
        changes.push({ subject: old.name, field, before: old[field], after: next[field],
          ...refinement(old, next, field, limit) });
      } else if (comparable && field === 'body' && equal(old.requires, next.requires) &&
          equal(old.ensures, next.ensures) && domainOf(old).total <= BigInt(limit)) {
        changes.push({ subject: old.name, field, before: old.body, after: next.body,
          ...compareBodies(old, next) });
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
