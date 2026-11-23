// Package a GitHub release asset and exercise the installed command in a fresh host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publishDirectory } from '../src/backend.mjs';
import { VERSION } from '../src/verify.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const output = resolve(process.argv[2] ?? 'build/distribution');
const pkg = JSON.parse(readFileSync(join(root,'package.json')));
assert.equal(pkg.version,VERSION);
assert.equal(JSON.parse(readFileSync(join(root,'package-lock.json'))).packages[''].version,VERSION);
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, 'v'+VERSION);
mkdirSync(dirname(output),{recursive:true});
if (existsSync(output)) throw new Error('Release destination already exists: ' + output);
const scratch = mkdtempSync(join(tmpdir(),'noitak-install-'));
const host = join(scratch,'consumer');
const deployment = join(scratch,'deployment');
let staged;
const run = (cmd,args,cwd) => execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
try {
  mkdirSync(host);
  mkdirSync(deployment);
  staged = mkdtempSync(join(dirname(output),'.noitak-distribution-'));
  const [pack] = JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',staged],root));
  const archive = join(staged,pack.filename);
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
  // Update a metering component from the installed baseline and compile an
  // ordinary strict TS caller against the approved candidate's declarations.
  const pilot = join(host,'node_modules/noitak/pilot/metering');
  const baseline = join(pilot,'metering.noi');
  const sourceText = readFileSync(baseline,'utf8');
  const rewrite = sourceText.replace('(+ (get s used) (get r units)) (get s used)',
    '(+ (get r units) (get s used)) (get s used)');
  assert.notEqual(rewrite,sourceText);
  writeFileSync(join(host,'next.noi'),rewrite);
  const accepted = JSON.parse(run(cli,['gate',baseline,'next.noi','meter/verified','--engine','auto','--json'],host));
  assert.ok(accepted.passed && accepted.changes.some(c=>c.scope==='one-transition' && c.status==='compatible'));
  const manifest = JSON.parse(readFileSync(join(host,'meter/verified/report.json')));
  assert.equal(manifest.backend,'checked-js-v1');
  assert.equal(manifest.artifactValidation.status,'tested');
  assert.deepEqual(manifest.artifactValidation,accepted.artifactValidation);
  for (const [file,expected] of Object.entries(manifest.artifacts)) {
    const actual = createHash('sha256').update(readFileSync(join(host,'meter/verified',file))).digest('hex');
    assert.equal(actual,expected,file);
  }
  copyFileSync(join(pilot,'service.mts'),join(host,'meter/service.mts'));
  run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--strict','--module','nodenext','meter/service.mts'],host);
  mkdirSync(join(deployment,'verified'));
  copyFileSync(join(host,'meter/service.mjs'),join(deployment,'service.mjs'));
  copyFileSync(join(host,'meter/verified/module.mjs'),join(deployment,'verified/module.mjs'));
  copyFileSync(join(pilot,'demo.mjs'),join(deployment,'demo.mjs'));
  const smoke = execFileSync(process.execPath,['--disallow-code-generation-from-strings','demo.mjs'],
    {cwd:deployment,encoding:'utf8',env:{PATH:''}});
  console.log('Standalone metering consumer passed.',smoke.trim());
  writeFileSync(join(staged,'SHA256SUMS'),digest+'  '+basename(archive)+'\n');
  await publishDirectory(staged,output);
  console.log('Installed CLI, packaged solver, gated bundle and host call passed.');
  console.log(digest, basename(archive));
} finally {
  if (staged) rmSync(staged,{recursive:true,force:true});
  rmSync(scratch,{recursive:true,force:true});
}
