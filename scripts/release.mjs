// Package a GitHub release asset and exercise the installed command in a fresh host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VERSION } from '../src/verify.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const output = resolve(process.argv[2] ?? 'build/distribution');
const pkg = JSON.parse(readFileSync(join(root,'package.json')));
assert.equal(pkg.version,VERSION);
assert.equal(JSON.parse(readFileSync(join(root,'package-lock.json'))).packages[''].version,VERSION);
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, 'v'+VERSION);
mkdirSync(dirname(output),{recursive:true});
mkdirSync(output);
const host = mkdtempSync(join(tmpdir(),'noitak-install-'));
const run = (cmd,args,cwd) => execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
try {
  const [pack] = JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',output],root));
  const archive = join(output,pack.filename);
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(join(host,'package.json'),JSON.stringify({name:'consumer',private:true,type:'module'}));
  run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',archive],host);
  const cli = join(host,'node_modules/.bin/noitak');
  assert.equal(run(cli,['--version'],host).trim(),VERSION);
  const source = join(host,'node_modules/noitak/pilot/support/batch.noi');
  const out = join(host,'verified');
  const report = JSON.parse(run(cli,['gate',source,source,out,'--engine','symbolic','--json'],host));
  assert.ok(report.passed && report.after.dependencies.support);
  const {api} = await import(pathToFileURL(join(out,'module.mjs')));
  const prior = {stage:{tag:'open'},revision:254};
  const result = api.apply_batch({},prior,[{tag:'agent_reply'},{tag:'resolve'}],{covered:false,escalated:true});
  assert.deepEqual(result,{ok:true,value:{tag:'rejected',value:1}});
  writeFileSync(join(output,'SHA256SUMS'),digest+'  '+basename(archive)+'\n');
  console.log('Installed CLI, packaged solver, gated bundle and host call passed.');
  console.log(digest, basename(archive));
} finally { rmSync(host,{recursive:true,force:true}); }
