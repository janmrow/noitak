import { createHash } from 'node:crypto';
import { domainOf } from './domain.mjs';
import { execute } from './runtime.mjs';
import { solve, symbolicConfig } from './symbolic.mjs';
import { checkIndependence } from './independence.mjs';
import { crosscheck, CROSSCHECK_LIMIT } from './crosscheck.mjs';

export const VERSION = '0.4.0';
export const DEFAULT_LIMIT = 65536;
export const hash = data => createHash('sha256').update(data).digest('hex');

function obligation(f, limit) {
  const { total, cases } = domainOf(f);
  const result = { function: f.name, loc: f.loc, property: 'admissible-and-safe',
    domain: total.toString(), examined: 0, admitted: 0 };
  if (total > BigInt(limit)) return { ...result, status: 'unverified', reason: 'case-budget' };
  for (const { args, flags } of cases()) {
    const outcome = execute(f, args, flags);
    result.examined++;
    if (outcome.code === 'PRECONDITION') continue;
    if (outcome.phase !== 'requires') result.admitted++;
    if (!outcome.ok) return { ...result, status: 'violated',
      counterexample: { args, flags: Object.fromEntries(flags), outcome } };
  }
  return result.admitted ? { ...result, status: 'proven' } :
    { ...result, status: 'violated', reason: 'empty-admission-domain' };
}

export function verify(unit, source, limit, engine = 'enumerate') {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000000)
    throw new Error('Case limit must be an integer from 1 to 1000000');
  if (!['enumerate', 'symbolic'].includes(engine)) throw new Error('Unknown verification engine');
  const symbolic = engine === 'symbolic';
  const types = [...unit.enums, ...unit.records];
  const checks = unit.functions.flatMap(f => {
    const domain = domainOf(f).total;
    const audit = (answer, enumerate) => crosscheck(answer, domain, limit, enumerate, 'unverified');
    const identity = { function: f.name, visibility: f.kind === 'helper' ? 'private' : f.kind === 'imported' ? 'imported' : 'public',
      loc: f.loc, domain: String(domain) };
    const finiteSafety = () => obligation(f, limit);
    const safety = symbolic ? audit(solve(f, types), finiteSafety) : finiteSafety();
    const results = [{ ...identity, property: 'admissible-and-safe', ...safety }];
    if (f.independent.length) {
      let flow = { status: 'unverified', reason: 'missing-function-proof' };
      if (safety.status === 'proven') {
        const finiteFlow = () => checkIndependence(f, types, limit, false);
        flow = symbolic ? audit(checkIndependence(f, types, limit, true), finiteFlow) : finiteFlow();
      }
      results.push({ ...identity, property: 'observable-independence', parameters: f.independent, ...flow });
    }
    return results;
  });
  const configuration = symbolic ?
    { ...symbolicConfig, crosscheckMaxCases: Math.min(limit, CROSSCHECK_LIMIT) } :
    { method: 'finite-enumeration-v2' };
  return { schema: 3, toolVersion: VERSION, module: unit.name, version: unit.version,
    sourceSha256: hash(source), dependencies: unit.dependencies ?? {}, configuration: { ...configuration, maxCasesPerFunction: limit },
    calls: Object.fromEntries(unit.functions.map(f => [f.name, f.calls])),
    permissions: Object.fromEntries(unit.functions.map(f => [f.name, f.reads])),
    checks, outsideProof: ['host-authorization', 'timing-and-resource-use'].map(property => ({ property, status: 'unsupported' })),
    passed: checks.every(c => c.status === 'proven') };
}
