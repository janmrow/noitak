// Keep solver evidence, including uncertainty. Enumeration can veto a
// definitive answer on affordable domains but cannot promote an unknown.
export const CROSSCHECK_LIMIT = 4096;

export function crosscheck(primary, domain, limit, enumerate, unresolved) {
  const budget = Math.min(limit, CROSSCHECK_LIMIT);
  if (primary.status === unresolved)
    return { ...primary, crosscheck: { status: 'skipped', reason: 'primary-unresolved' } };
  if (domain > BigInt(budget))
    return { ...primary, crosscheck: { status: 'skipped', reason: 'case-budget', limit: budget } };
  const reference = enumerate();
  const empty = outcome => outcome.reason === 'empty-admission-domain';
  if (primary.status !== reference.status || empty(primary) !== empty(reference))
    return { status: unresolved, reason: 'engine-disagreement', solverVersion: primary.solverVersion,
      symbolicEvidence: primary, crosscheck: { method: 'enumerate', ...reference } };
  return { ...primary, crosscheck: { method: 'enumerate', status: reference.status,
    examined: reference.examined, equalOutcomes: reference.equalOutcomes } };
}
