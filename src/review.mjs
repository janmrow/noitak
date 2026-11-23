const claims = {
  requires: 'Previously admitted calls remain admitted.',
  ensures: 'On jointly admitted calls, every permitted candidate result meets the baseline guarantee.',
  body: 'Both implementations return the same value on jointly admitted calls.'
};

export function formatReview(report) {
  const lines = [report.passed ? 'ACCEPT under the Noitak change policy' : 'REVIEW REQUIRED'];
  for (const [label, r] of [['Baseline', report.before], ['Candidate', report.after]])
    lines.push(`${label} ${r.module} ${r.version} · SHA-256 ${r.sourceSha256}`);
  lines.push('Verification: ' + report.configuration.method);
  for (const c of report.changes) {
    lines.push('', `${c.subject} · ${c.field} · ${c.status}`);
    if (claims[c.field]) {
      lines.push('Review claim: ' + claims[c.field]);
      lines.push(`Method: ${c.method}. Potential cases: ${c.comparisonDomain}`);
      if (c.field === 'body') {
        const calls = new Set([...(report.before.calls?.[c.subject] ?? []), ...(report.after.calls?.[c.subject] ?? [])]);
        if (calls.size) lines.push('Direct helper calls: ' + [...calls].join(', '));
      }
      if (c.solverAnswer) lines.push(`Counterexample query: ${c.solverAnswer} (Z3 ${c.solverVersion})`);
      if (c.examined !== undefined) lines.push('Predicate comparisons: ' + c.examined);
      if (c.equalOutcomes) lines.push('Equal returned values: ' + c.equalOutcomes);
      if (c.witness) {
        const w = c.witness;
        const args = Object.fromEntries(c.parameters.map((name, i) => [name, w.args[i]]));
        lines.push('Arguments ' + JSON.stringify(args) + ', flags ' + JSON.stringify(w.flags));
        if (c.field === 'ensures') lines.push('Hypothetical return value: ' + JSON.stringify(w.result));
        if (c.field === 'body') lines.push('Observed calls on this input:');
        lines.push('Baseline ' + JSON.stringify(w.before) + ', candidate ' + JSON.stringify(w.after));
      }
    } else if (c.proofStatus) {
      lines.push('Required proof: ' + c.property + ' · ' + c.proofStatus);
      if (c.reason === 'case-budget') lines.push(
        `The domain contains ${c.proofDomain} cases. The configured limit is ${report.configuration.maxCasesPerFunction}.`);
      if (c.counterexample) lines.push('Counterexample: ' + JSON.stringify(c.counterexample));
    } else {
      lines.push('Baseline ' + JSON.stringify(c.before) + ', candidate ' + JSON.stringify(c.after));
      if (c.field === 'reads' && c.status === 'policy-violation')
        lines.push('Review the additional authority required from the host.');
    }
    if (c.crosscheck) lines.push('Enumeration cross-check: ' + c.crosscheck.status +
      (c.crosscheck.reason ? ' (' + c.crosscheck.reason + ')' : ''));
    if (c.reason) lines.push('Reason: ' + c.reason);
  }
  if (!report.changes.length) lines.push('No findings under the change policy.');
  if (report.artifact) lines.push('', 'Published verified artifact: ' + report.artifact);
  return lines.join('\n');
}
