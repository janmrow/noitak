// Package a GitHub release asset and exercise the installed command in a fresh host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  copyFileSync(join(pilot,'service.mts'),join(host,'meter/service.mts'));
  run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--strict','--module','nodenext','meter/service.mts'],host);
  const {MeterStore} = await import(pathToFileURL(join(host,'meter/service.mjs')));
  const meter = '00112233-4455-6677-8899-aabbccddeeff';
  const account = {meter, limit:1000000, used:0, serial:100000, status:{tag:'ready'}};
  const accounts = new Map([[meter,account]]);
  const store = new MeterStore(accounts);
  const readings = Array.from({length:1000},(_,i)=>({meter,serial:100001+i,units:1000}));
  assert.deepEqual(store.submit(meter,[...readings,{meter,serial:101001,units:1}]),
    {status:'rejected',reason:'quota_exceeded'});
  assert.equal(accounts.get(meter),account);
  assert.deepEqual(store.submit(meter,readings),{status:'committed',serial:101000,used:1000000});
  assert.equal(store.submit(meter,[{...readings[0],units:NaN}]).status,'invalid-input');
  console.log('Installed reducer update, strict TS consumer and all-or-nothing host update passed.');
  writeFileSync(join(output,'SHA256SUMS'),digest+'  '+basename(archive)+'\n');
  console.log('Installed CLI, packaged solver, gated bundle and host call passed.');
  console.log(digest, basename(archive));
} finally { rmSync(host,{recursive:true,force:true}); }
