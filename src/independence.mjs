// At fixed public inputs and flags, equality to one fixed reference run implies
// pairwise equality. Function safety must already hold on the entire domain.
import { isDeepStrictEqual } from 'node:util';
import { domainOf, valueAt } from './domain.mjs';
import { execute } from './runtime.mjs';
import { solve } from './symbolic.mjs';

function initialExpression(t) {
  if (t === 'byte') return 0;
  if (t === 'bool') return false;
  if (t.element) return ['items', t.name, []];
  if (t.fields) return ['make', t.name, t.fields.map(([k, field]) => [k, initialExpression(field)])];
  const {tag, payload} = t.variants[0];
  return ['tag', t.name, tag, ...(payload ? [initialExpression(payload)] : [])];
}

export function checkIndependence(f, types, limit, symbolic) {
  const hidden = new Set(f.independent);
  const witness = (args, flags) => {
    const referenceArgs = f.params.map(([name, t], i) => hidden.has(name) ? valueAt(t, 0) : args[i]);
    const outcome = execute(f, args, flags);
    const referenceOutcome = execute(f, referenceArgs, flags);
    if (!isDeepStrictEqual(outcome, referenceOutcome))
      return { args, flags: Object.fromEntries(flags), outcome, referenceArgs, referenceOutcome };
  };
  if (!symbolic) {
    const domain = domainOf(f);
    if (domain.total > BigInt(limit)) return { status: 'unverified', reason: 'case-budget' };
    let examined = 0;
    for (const {args, flags} of domain.cases()) {
      examined++;
      const counterexample = witness(args, flags);
      if (counterexample) return { status: 'violated', examined, counterexample };
    }
    return { status: 'proven', examined };
  }

  const names = f.params.map(([k]) => k);
  const referenceArgs = f.params.map(([k, t]) => hidden.has(k) ? initialExpression(t) : k);
  const reference = expr => ['call', '$reference', names, referenceArgs, true, expr, true];
  const sameAdmission = ['=', f.requires, reference(f.requires)];
  const sameValue = ['=', f.body, reference(f.body)];
  const query = { ...f, output: 'bool', requires: true, body: true,
    ensures: ['and', sameAdmission, ['or', ['not', f.requires], sameValue]] };
  const answer = solve(query, types);
  if (answer.status !== 'violated') return answer;
  if (answer.counterexample) {
    const {args, flags} = answer.counterexample;
    // Re-enter the actual function twice, independently of the query reduction.
    const counterexample = witness(args, new Map(Object.entries(flags)));
    if (counterexample) return { ...answer, counterexample };
  }
  return { status: 'unverified', reason: 'model-replay-disagreement' };
}
