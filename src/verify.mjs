import { createHash } from 'node:crypto';
import { execute } from './runtime.mjs';

export const VERSION = '0.1.0';
export const DEFAULT_LIMIT = 65536;
export const hash = data => createHash('sha256').update(data).digest('hex');

function obligation(f, limit) {
  const types = [...f.params.map(([, t]) => t), ...f.reads.map(() => 'bool')];
  const sizes = types.map(t => t === 'byte' ? 256 : 2);
  const total = sizes.reduce((n, s) => n * BigInt(s), 1n);
  const result = { function: f.name, loc: f.loc, property: 'admissible-and-safe',
    domain: total.toString(), examined: 0, admitted: 0 };
  if (total > BigInt(limit)) return { ...result, status: 'unverified', reason: 'case-budget' };
  for (let i = 0; i < Number(total); i++) {
    let index = i;
    const values = sizes.map((s, j) => {
      const digit = index % s;
      index = Math.floor(index / s);
      return types[j] === 'bool' ? Boolean(digit) : digit;
    });
    const args = values.slice(0, f.params.length);
    const flags = new Map(f.reads.map((key, j) => [key, values[f.params.length + j]]));
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

export function verify(unit, source, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000000)
    throw new Error('Case limit must be an integer from 1 to 1000000');
  const checks = unit.functions.map(f => obligation(f, limit));
  return { schema: 1, toolVersion: VERSION, module: unit.name, version: unit.version,
    sourceSha256: hash(source), configuration: { method: 'finite-enumeration-v1', maxCasesPerFunction: limit },
    permissions: Object.fromEntries(unit.functions.map(f => [f.name, f.reads])),
    checks, outsideProof: [{ property: 'host-authorization', status: 'unsupported' }],
    passed: checks.every(c => c.status === 'proven') };
}
