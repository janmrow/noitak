// Exercise public CLI exit codes, then compile and run the host against the gated artifact.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReview } from '../../src/review.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = dirname(fileURLToPath(import.meta.url));
const baseline = join(root, 'examples/delivery.noi');
const cases = JSON.parse(readFileSync(join(here, 'cases.json')));
const output = resolve(process.argv[2] ?? 'build/pilot');
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function run(args, status = 0) {
  const p = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: root });
  assert.equal(p.status, status, p.error?.message ?? (p.stdout + p.stderr));
  return p.stdout;
}

mkdirSync(dirname(output), {recursive: true});
mkdirSync(output);
const worksheet = ['# Delivery pilot review', '',
  'Record your decision before consulting the answer key in the repository.', '',
  '| Case | Decision and reason | Report sufficient? | Opened source? | Missing evidence |',
  '| --- | --- | --- | --- | --- |'];
for (const c of cases) {
  const dir = join(output, c.id);
  mkdirSync(dir);
  const artifact = join(dir, 'artifact');
  const candidate = join(here, c.candidate);
  const args = ['noitak.mjs', 'gate', baseline, candidate, artifact, '--json', '--engine', c.engine];
  if (c.limit) args.push('--limit', String(c.limit));
  const accept = c.decision === 'accept';
  const review = JSON.parse(run(args, accept ? 0 : 1));
  writeFileSync(join(dir, 'review.json'), JSON.stringify(review, null, 2) + '\n');
  writeFileSync(join(dir, 'review.txt'), formatReview(review) + '\n');
  assert.equal(review.passed, accept);
  assert.equal(review.before.sourceSha256, digest(baseline));
  assert.equal(review.after.sourceSha256, digest(candidate));
  for (const [field, status] of Object.entries(c.findings))
    assert.ok(review.changes.some(change => change.field === field && change.status === status), c.id + ': ' + field);
  assert.equal(existsSync(artifact), accept);
  if (accept) {
    const manifest = JSON.parse(readFileSync(join(artifact, 'report.json')));
    assert.equal(manifest.sourceSha256, review.after.sourceSha256);
    for (const file of ['module.mjs','module.d.mts','review.json'])
      assert.equal(digest(join(artifact,file)), manifest.artifacts[file]);
    const {artifact: published, ...compared} = review;
    assert.equal(published, artifact);
    assert.deepEqual(JSON.parse(readFileSync(join(artifact,'review.json'))), compared);
    copyFileSync(join(here,'host.mts'), join(dir,'host.mts'));
    run(['node_modules/typescript/bin/tsc','--strict','--module','nodenext',join(dir,'host.mts')]);
    console.log(run([join(dir,'host.mjs')]).trim());
  }
  console.log(c.id, c.decision, join(dir, 'review.txt'));
  worksheet.push(`| ${c.id} | | | | |`);
}
writeFileSync(join(output, 'worksheet.md'), worksheet.join('\n') + '\n');
