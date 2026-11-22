import { createHash } from 'node:crypto';
import { domainOf } from './domain.mjs';
import { execute } from './runtime.mjs';

import { solve, symbolicConfig } from './symbolic.mjs';

export const VERSION = '0.2.0';
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
  const checks = unit.functions.map(f => symbolic ? {
    function: f.name, loc: f.loc, property: 'admissible-and-safe', domain: String(domainOf(f).total),
    ...solve(f, unit.enums)
  } : obligation(f, limit));
  return { schema: 2, toolVersion: VERSION, module: unit.name, version: unit.version,
    sourceSha256: hash(source), configuration: { ...(symbolic ? symbolicConfig : { method: 'finite-enumeration-v1' }), maxCasesPerFunction: limit },
    permissions: Object.fromEntries(unit.functions.map(f => [f.name, f.reads])),
    checks, outsideProof: [{ property: 'host-authorization', status: 'unsupported' }],
    passed: checks.every(c => c.status === 'proven') };
}
