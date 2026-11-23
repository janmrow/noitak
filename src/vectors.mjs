import { invoke } from './runtime.mjs';
import { isDeepStrictEqual } from 'node:util';

export function testVectors(unit, cases) {
  if (!Array.isArray(cases) || !cases.length) throw new Error('Expected a nonempty vector array');
  const checks = cases.map(({fn, flags, args, expected}, index) => {
    const f = unit.functions.find(f => f.name === fn && f.kind === 'fn');
    if (!f || !Array.isArray(args) || !expected) throw new Error('Malformed test vector ' + index);
    const actual = invoke(f, flags, args);
    return { index, function: fn, expected, actual,
      status: isDeepStrictEqual(actual, expected) ? 'tested' : 'violated' };
  });
  return { checks, passed: checks.every(c => c.status === 'tested') };
}
