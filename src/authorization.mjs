// The protected caller supplies bytes from its own policy store. Policy
// discovery in a module tree would give the candidate authority over itself.
export function authorize(report, policy, digest) {
  const valid = policy && Object.keys(policy).sort().join(',') === 'allowBehavior,schema,scopeSha256' &&
    policy.schema === 1 && policy.scopeSha256 === report.authorizationScopeSha256 &&
    Array.isArray(policy.allowBehavior) && policy.allowBehavior.length > 0 &&
    policy.allowBehavior.every(name => typeof name === 'string');
  if (!valid) throw new Error('Invalid or stale change authorization');
  const names = new Set(policy.allowBehavior);
  const findings = report.changes.filter(c => c.status !== 'compatible');
  const witnessed = findings.filter(c => c.field === 'body' && c.status === 'risky' &&
    c.witnessKind === 'observed-returns' && c.witness && names.has(c.subject));
  const allowed = report.before.passed && report.after.passed && names.size === policy.allowBehavior.length &&
    findings.length === witnessed.length && new Set(witnessed.map(c => c.subject)).size === names.size;
  return {...report, passed: allowed, decision: allowed ? 'authorized-evolution' : 'blocked',
    authorization: {sha256: digest, ...policy}};
}
