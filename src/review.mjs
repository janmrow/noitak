const claims = {
  requires: 'Previously admitted calls remain admitted.',
  ensures: 'On jointly admitted calls, every permitted candidate result meets the baseline guarantee.',
  body: 'Both implementations return the same value on jointly admitted calls.',
  'selector-guarantee': 'Every permitted candidate selector result meets the baseline row guarantee.',
  'selector-contribution': 'Both selectors make the same contribution for each typed row.'
};

export function formatReview(report) {
  const lines = [report.passed ? 'ACCEPT under the Noitak change policy' : 'REVIEW REQUIRED'];
  if (report.decision === 'authorized-evolution')
    lines.push('Intentional behavior change authorized by policy SHA-256 ' + report.authorization.sha256);
  for (const [label, r] of [['Baseline', report.before], ['Candidate', report.after]])
    lines.push(`${label} ${r.module} ${r.version} · SHA-256 ${r.sourceSha256}`);
  lines.push('Verification: ' + report.configuration.method);
  for (const c of report.changes) {
    lines.push('', `${c.subject} · ${c.field} · ${c.status}`);
    if (claims[c.field]) {
      lines.push('Review claim: ' + claims[c.field]);
      lines.push(`Method: ${c.method}. Potential cases: ${c.comparisonDomain}`);
      if (c.scope === 'one-transition') lines.push('Reducer comparison uses one item and an admitted starting state.');
      if (c.scope === 'one-row') lines.push('Collector comparison uses the checked selector under fixed grants.');
      if (['body', 'selector-contribution'].includes(c.field)) {
        const calls = new Set([...(report.before.calls?.[c.subject] ?? []), ...(report.after.calls?.[c.subject] ?? [])]);
        if (calls.size) lines.push('Direct calls: ' + [...calls].join(', '));
      }
      if (c.solverAnswer) lines.push(`Counterexample query: ${c.solverAnswer} (Z3 ${c.solverVersion})`);
      if (c.examined !== undefined) lines.push('Predicate comparisons: ' + c.examined);
      if (c.equalOutcomes) lines.push('Equal returned values: ' + c.equalOutcomes);
      if (c.witness) {
        const w = c.witness;
        const args = Object.fromEntries(c.parameters.map((name, i) => [name, w.args[i]]));
        lines.push('Arguments ' + JSON.stringify(args) + ', flags ' + JSON.stringify(w.flags));
        if (w.result !== undefined) lines.push('Hypothetical return value: ' + JSON.stringify(w.result));
        if (c.field === 'body' || c.witnessKind === 'observed-one-row-batch') lines.push('Observed calls on this input:');
        lines.push('Baseline ' + JSON.stringify(w.before) + ', candidate ' + JSON.stringify(w.after));
      }
    } else if (c.proofStatus) {
      lines.push('Required proof: ' + c.property + ' · ' + c.proofStatus);
      if (c.reason === 'case-budget') lines.push(
        `The domain contains ${c.proofDomain} cases. The configured limit is ${report.configuration.maxCasesPerFunction}.`);
      if (c.counterexample) lines.push('Counterexample: ' + JSON.stringify(c.counterexample));
    } else {
      const {before, after} = c.protectedPositions ?? c;
      lines.push('Baseline ' + JSON.stringify(before) + ', candidate ' + JSON.stringify(after));
      if (c.field === 'reads' && c.status === 'policy-violation')
        lines.push('Review the additional authority required from the host.');
    }
    if (c.crosscheck) lines.push('Enumeration cross-check: ' + c.crosscheck.status +
      (c.crosscheck.reason ? ' (' + c.crosscheck.reason + ')' : ''));
    if (c.reason) lines.push('Reason: ' + c.reason);
  }
  for (const c of report.resourceChanges ?? [])
    lines.push(c.function + ' static work estimate ' + c.before.work + ' → ' + c.after.work +
      ', expression depth ' + c.before.depth + ' → ' + c.after.depth);
  if (!report.changes.length) lines.push('No findings under the change policy.');
  if (report.artifactValidation) {
    const calls = report.artifactValidation.checks.reduce((sum,c)=>sum+c.cases,0);
    lines.push('Emitted module matched the reference on ' + calls + ' tested host calls.');
  }
  if (report.artifact) lines.push('', 'Published verified artifact: ' + report.artifact);
  return lines.join('\n');
}
