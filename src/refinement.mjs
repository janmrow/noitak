import { domainOf, cardinality, valueAt } from './domain.mjs';
import { predicate } from './runtime.mjs';

// Old callers retain admission. Every result allowed by the candidate on a
// shared admitted input must satisfy the original guarantee.
export function refinement(old, next, field, limit) {
  const domain = domainOf(old);
  const results = field === 'ensures' ? cardinality(old.output) : 1n;
  const cost = domain.total * results;
  if (cost > BigInt(limit))
    return { status: 'undetermined', reason: 'comparison-budget', comparisonDomain: String(cost) };
  let examined = 0;
  for (const {args, flags} of domain.cases()) {
    const admitted = predicate(old, 'requires', args, flags);
    const candidate = predicate(next, 'requires', args, flags);
    const input = { args, flags: Object.fromEntries(flags) };
    if (field === 'requires') {
      examined++;
      if (admitted === true && candidate !== true)
        return { status: 'risky', examined, witness: { ...input, before: admitted, after: candidate } };
    } else if (admitted === true && candidate === true) {
      for (let i = 0; i < results; i++) {
        examined++;
        const result = valueAt(old.output, i);
        const after = predicate(next, field, args, flags, result);
        if (after !== true) continue;
        const before = predicate(old, field, args, flags, result);
        if (before !== true)
          return { status: 'risky', examined, witness: { ...input, result, before, after } };
      }
    }
  }
  return { status: 'compatible', examined, comparisonDomain: String(cost) };
}
