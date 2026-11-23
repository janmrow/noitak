// Generate narrowly edited candidate revisions and retain their source and evidence.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const output = resolve(process.argv[2] ?? 'build/support');
mkdirSync(dirname(output), { recursive: true });
mkdirSync(output);
const baseline = join(here, 'tickets.noi');
const original = readFileSync(baseline, 'utf8');
function run(args, expected = 0) {
  const proc = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: root });
  assert.equal(proc.status, expected, proc.error?.message ?? (proc.stdout + proc.stderr));
  return proc.stdout;
}
function gate(label, before, after, accept) {
  assert.equal(original.split(before).length, 2, 'Expected a unique edit');
  const candidate = join(output, label + '.noi');
  const dest = join(output, label);
  writeFileSync(candidate, original.replace(before, after));
  const report = JSON.parse(run(['noitak.mjs', 'gate', baseline, candidate, dest, '--engine', 'symbolic', '--json'], accept ? 0 : 1));
  writeFileSync(join(output, label + '.json'), JSON.stringify(report, null, 2) + '\n');
  assert.equal(report.passed, accept);
  assert.equal(existsSync(dest), accept);
  return report;
}

const accepted = gate('approved', '(+ revision 1)', '(+ 1 revision)', true);
assert.deepEqual(accepted.after.calls.transition, ['bump','next_stage']);
assert.ok(accepted.changes.some(c => c.subject === 'transition' && c.field === 'body' && c.solverAnswer === 'unsat'));
const overflow = gate('note-bumps-revision', '(get prior revision) (call bump', '(call bump (get prior revision)) (call bump', false);
assert.ok(overflow.after.checks.some(c => c.function === 'transition' && c.status === 'violated'));
const leak = gate('staff-leak', '(waiting_on_customer (= (get prior stage) (tag stage waiting)))',
  '(waiting_on_customer (or (get internal escalated) (= (get prior stage) (tag stage waiting))))', false);
assert.equal(leak.after.checks.find(c => c.property === 'observable-independence').status, 'violated');
assert.ok(leak.after.checks.filter(c => c.property === 'admissible-and-safe').every(c => c.status === 'proven'));
copyFileSync(join(here, 'service.mts'), join(output, 'service.mts'));
run(['node_modules/typescript/bin/tsc', '--strict', '--module', 'nodenext', join(output, 'service.mts')]);
const scenario = JSON.parse(run([join(output, 'service.mjs')]));
assert.deepEqual(scenario, {
  dispatch: ['T42'], ticket: {stage:{tag:'closed'}, revision:255},
  replies: [false,true,true].map(closed => ({kind:'updated', summary:{closed, waiting_on_customer:false}}))
    .concat({kind:'revision-limit'})
});
console.log('Support workflow passed: one compatible helper edit, two refused candidates, four host events.');
