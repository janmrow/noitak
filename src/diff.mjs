import { cardinality, domainOf, productSize, sizeLabel, exceeds } from './domain.mjs';
import { crosscheck } from './crosscheck.mjs';
import { execute, invoke } from './runtime.mjs';
import { hash } from './verify.mjs';
import { refinement } from './refinement.mjs';
import { solveRelation, usesSymbolic } from './symbolic.mjs';

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
  const {configuration, proven, types, collector, positional} = context;
  const domain = productSize(domainOf(old).total, field === 'ensures' ? cardinality(old.output) : 1n);
  const symbolic = usesSymbolic(configuration, domain);
  const evidence = { method: symbolic ? 'symbolic' : 'enumerate', comparisonDomain: sizeLabel(domain),
    parameters: old.params.map(([name]) => name) };
  if (old.capacity && next.capacity) evidence.scope = 'one-transition';
  const unresolved = reason => ({ ...evidence, status: 'undetermined', reason });
  if (!proven) return unresolved('missing-function-proof');
  if (Boolean(old.capacity) !== Boolean(next.capacity)) return unresolved('incompatible-entry-convention');
  const paramTypes = f => f.params.map(([,type]) => type);
  if (!((collector || positional) ? equal(paramTypes(old), paramTypes(next)) : equal(old.params, next.params)) ||
      !['output', 'reads'].every(k => equal(old[k], next[k])))
    return unresolved('incompatible-interface');
  const limit = configuration.maxCasesPerFunction;
  const enumerate = () => field === 'body' ? compareBodies(old, next) : refinement(old, next, field, limit);
  if (symbolic) {
    if (!types) return unresolved('incompatible-type-definitions');
    const result = solveRelation(old, next, types, field, undefined,
      {searchShortSequences: Boolean(collector && field === 'body' && domain === null)});
    return { ...evidence, ...crosscheck(result, domain, limit, enumerate, 'undetermined') };
  }
  if (exceeds(domain, limit)) return unresolved('comparison-budget');
  return { ...evidence, ...enumerate() };
}

function compareCollectors(old, next, oldFunctions, newFunctions, context) {
  const a = {...oldFunctions.get(old.collector), reads: old.reads};
  const b = {...newFunctions.get(next.collector), reads: next.reads};
  const findings = [];
  for (const [field, label] of [['ensures', 'selector-guarantee'], ['body', 'selector-contribution']]) {
    if (equal(a[field], b[field]) && equal(a.params, b.params) && equal(a.output, b.output) &&
        equal(a.reads, b.reads) && (field !== 'body' || equal(a.graph, b.graph))) continue;
    const finding = compareField(a, b, field, {...context, collector: true});
    if (field === 'body' && finding.witness) {
      const row = finding.witness;
      const args = [row.args];
      const before = invoke(old, row.flags, args), after = invoke(next, row.flags, args);
      if (before.ok && after.ok && !equal(before.value, after.value)) {
        finding.witness = {args, flags: row.flags, before, after};
        finding.witnessKind = 'observed-one-row-batch';
        finding.parameters = ['items'];
      } else {
        delete finding.witness;
        Object.assign(finding, {status: 'undetermined', reason: 'batch-replay-disagreement'});
      }
    } else if (finding.witness) finding.witnessKind = 'hypothetical-selector-result';
    findings.push({subject: old.name, field: label, scope: 'one-row',
      before: a[field], after: b[field], ...finding});
  }
  return findings;
}

export function compare(oldUnit, newUnit, before, after) {
  const changes = [];
  const record = (subject, field, status, oldValue, newValue) =>
    changes.push({ subject, field, status, before: oldValue, after: newValue });
  const priorServices = new Map(oldUnit.lookups?.map(s => [s.name, s]));
  const nextServices = new Map(newUnit.lookups?.map(s => [s.name, s]));
  for (const name of new Set([...priorServices.keys(), ...nextServices.keys()])) {
    const old = priorServices.get(name), next = nextServices.get(name);
    if (!equal(old, next)) {
      record(name, 'lookup', 'policy-violation', old ?? null, next ?? null);
    } else {
      // A previously authorized return-value change must never authorize a new
      // externally observable key or admit a new request to the resource.
      const request = (unit, service) => {
        const {params, requires, body, ensures, graph} = unit.functions.find(f => f.name === service.planner);
        return {params, requires, body, ensures, graph};
      };
      const a = request(oldUnit, old), b = request(newUnit, next);
      if (!equal(a,b)) record(name, 'lookup-key', 'policy-violation', a, b);
    }
  }
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
    if (equal(old, next)) continue;
    const layout = old ?? next;
    const field = layout.element ? 'sequence' : layout.fields ? 'record' : 'enum';
    const expansion = old?.element && next?.element && next.capacity > old.capacity;
    const status = expansion ? 'policy-violation' : old ? 'risky' : 'compatible';
    record(name, field, status, old ?? null, next ?? null);
  }
  // A shared solver sort is sound only when a name denotes the same type in both revisions.
  const typeConflict = [...oldTypes.values()].some(e => newTypes.has(e.name) && !equal(e, newTypes.get(e.name)));
  const types = typeConflict ? null : [...new Map([...oldTypes, ...newTypes]).values()];
  const oldHelpers = new Map(oldUnit.functions.filter(f => f.kind === 'helper').map(f => [f.name, f]));
  const provenFunctions = report => new Set(report.checks
    .filter(c => c.property === 'admissible-and-safe' && c.status === 'proven').map(c => c.function));
  const provenOld = provenFunctions(before), provenNew = provenFunctions(after);
  for (const helper of newUnit.functions.filter(f => f.kind === 'helper')) {
    const prior = oldHelpers.get(helper.name);
    oldHelpers.delete(helper.name);
    const reads = prior?.reads ?? [];
    if (prior) for (const field of ['requires', 'ensures']) {
      if (equal(prior[field], helper[field]) && equal(prior.params, helper.params)) continue;
      if (prior[field] === true && helper[field] === true) continue;
      const finding = compareField(prior, helper, field, {configuration: after.configuration,
        proven: provenOld.has(helper.name) && provenNew.has(helper.name), types, positional:true});
      changes.push({subject: helper.name, field, before:prior[field], after:helper[field], ...finding,
        ...(finding.witness && {witnessKind:field === 'ensures' ? 'hypothetical-result' : 'lost-admission'})});
    }
    if (!equal(reads, helper.reads))
      record(helper.name, 'helper-reads', helper.reads.some(k => !reads.includes(k)) ? 'policy-violation' : 'compatible', reads, helper.reads);
    if (prior && !equal(prior.independent, helper.independent))
      record(helper.name, 'independent', prior.independent.some(k => !helper.independent.includes(k)) ?
        'policy-violation' : 'compatible', prior.independent, helper.independent);
  }
  for (const helper of oldHelpers.values()) {
    if (helper.independent.length || helper.ensures !== true || helper.requires !== true)
      record(helper.name, 'helper-contract-removed', 'policy-violation',
        {requires:helper.requires, ensures:helper.ensures, independent:helper.independent}, null);
  }
  const newer = new Map(newUnit.functions.filter(f => f.kind !== 'helper').map(f => [f.name, f]));
  const oldFunctions = new Map(oldUnit.functions.map(f => [f.name, f]));
  const newFunctions = new Map(newUnit.functions.map(f => [f.name, f]));
  const coverage = report => new Map(report.checks.filter(c => c.property === 'admissible-and-safe').map(c => [c.function, { property: c.property, status: c.status, domain: c.domain }]));
  const previous = coverage(before), current = coverage(after);
  for (const old of oldUnit.functions.filter(f => f.kind !== 'helper')) {
    const next = newer.get(old.name);
    if (!next) {
      record(old.name, 'export', 'risky', 'present', null);
      continue;
    }
    newer.delete(old.name);
    const entryKind = f => f.collector ? 'collector' : f.capacity ? 'reducer' : 'function';
    if (entryKind(old) !== entryKind(next))
      record(old.name, 'entry-kind', 'risky', entryKind(old), entryKind(next));
    if (old.collector && next.collector) {
      if (old.collector !== next.collector) record(old.name, 'selector', 'compatible', old.collector, next.collector);
      const capacities = f => [f.params[0][1].capacity, f.output.capacity];
      const a = capacities(old), b = capacities(next);
      if (!equal(a, b))
        record(old.name, 'collector-capacities', b.some((n, i) => n > a[i]) ? 'policy-violation' : 'risky', a, b);
      const proven = previous.get(old.name).status === 'proven' && current.get(old.name).status === 'proven';
      changes.push(...compareCollectors(old, next, oldFunctions, newFunctions,
        {configuration: after.configuration, proven, types}));
    }
    if (old.capacity !== next.capacity) {
      const expanded = old.capacity && next.capacity && next.capacity > old.capacity;
      record(old.name, 'reducer-capacity', expanded ? 'policy-violation' : 'risky',
        old.capacity ?? null, next.capacity ?? null);
    }
    for (const field of ['params', 'output', 'requires', 'ensures', 'body', 'reads', 'independent']) {
      if (equal(old[field], next[field]) && (field !== 'body' || equal(old.graph, next.graph))) continue;
      if (['requires', 'ensures', 'body'].includes(field)) {
        if (old.collector || next.collector) continue;
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
  const resourceChanges = [];
  for (const [name, bound] of Object.entries(before.resourceEstimates ?? {})) {
    const next = after.resourceEstimates?.[name];
    if (next && !equal(next,bound)) resourceChanges.push({function:name, before:bound, after:next});
  }
  const identity = report => [report.module, report.sourceSha256, report.dependencies];
  const authorizationScopeSha256 = hash(JSON.stringify(['witnessed-body-change-v1', after.toolVersion,
    after.configuration, identity(before), identity(after)]));
  const compatible = before.passed && after.passed && changes.every(c => c.status === 'compatible');
  return { schema: 9, resourceChanges, authorizationScopeSha256, decision: compatible ? 'compatible' : 'blocked', toolVersion: after.toolVersion, configuration: after.configuration,
    before, after,
    changes, passed: compatible };
}
