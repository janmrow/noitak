// Run the same CLI and TypeScript import a host project would use.
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'noi-demo-'));
function run(args, expected = 0) {
  const p = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  if (p.error || p.status !== expected) throw new Error(p.error?.message ?? (p.stdout + p.stderr));
  return p.stdout.trim();
}
const cli = (args, expected) => JSON.parse(run(['noi.mjs', ...args, '--json'], expected));
try {
  const built = cli(['build', 'examples/quota.noi', join(dir, 'quota')]);
  console.log('Verified input tuples:', built.checks[0].examined);
  copyFileSync(join(root, 'examples/host.mts'), join(dir, 'host.mts'));
  run(['node_modules/typescript/bin/tsc', '--strict', '--module', 'nodenext', join(dir, 'host.mts')]);
  const result = run([join(dir, 'host.mjs')]);
  if (result !== '5') throw new Error('Unexpected host result: ' + result);
  console.log('TypeScript host returned', result);
  const failed = cli(['verify', 'examples/broken.noi'], 1);
  console.log('Counterexample:', failed.checks[0].counterexample);
  const diff = cli(['diff', 'examples/quota.noi', 'examples/maintenance.noi', '--limit', '131072'], 1);
  console.log('Change review:', diff.changes.map(c => [c.field, c.status]));
  console.log('Default budget:', cli(['verify', 'examples/maintenance.noi'], 1).checks[0].status);
} finally { rmSync(dir, { recursive: true, force: true }); }
