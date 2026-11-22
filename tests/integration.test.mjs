import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const good = 'examples/quota.noi', bad = 'examples/broken.noi', changed = 'examples/maintenance.noi';
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function run(args, status = 0) {
  const p = spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(p.status,status,p.error?.message ?? (p.stderr + p.stdout));
  return p.stdout;
}
const cli = (args, status) => JSON.parse(run(['noitak.mjs',...args,'--json'],status));
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(),'noitak-test-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  return dir;
}

test('check, vectors, stable proof and reproducible witness', () => {
  assert.ok(cli(['check',good]).passed);
  assert.ok(cli(['test',good,'examples/vectors.json']).passed);
  const r = cli(['verify',good]);
  assert.equal(r.sourceSha256,sha(good));
  assert.equal(r.checks[0].admitted,65536);
  assert.deepEqual(r,cli(['verify',good]));
  const c = cli(['verify',bad],1).checks[0].counterexample;
  assert.deepEqual(c.args,[1,2]);
  assert.equal(c.outcome.code,'POSTCONDITION');
});
test('failed proof and budget refusal publish no artifacts', t => {
  const target = join(temporary(t),'output');
  for (const path of [bad,changed]) {
    assert.equal(cli(['build',path,target],1).passed,false);
    assert.equal(existsSync(target),false);
  }
});
test('emitted module agrees with independent saturating-subtraction oracle on all pairs', async t => {
  const dir = join(temporary(t),'dist');
  const report = cli(['build',good,dir]);
  assert.deepEqual(report,JSON.parse(readFileSync(join(dir,'report.json'))));
  for (const file of Object.keys(report.artifacts)) assert.equal(report.artifacts[file],sha(join(dir,file)));
  const {api} = await import(pathToFileURL(join(dir,'module.mjs')));
  for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++)
    assert.deepEqual(api.remaining({},a,b),{ok:true,value:Math.max(0,a-b)});
  assert.equal(cli(['build',good,dir],2).diagnostic.code,'E_TOOL');
});
test('new flag enforced in built artifact and diff policy', async t => {
  const opts = ['--limit','131072'];
  const r = cli(['diff',good,changed,...opts],1);
  assert.ok(r.changes.some(c=>c.field==='reads' && c.status==='policy-violation'));
  assert.ok(r.changes.some(c=>c.field==='ensures' && c.status==='undetermined'));
  const dir = join(temporary(t),'dist');
  const report = cli(['build',changed,dir,...opts]);
  assert.equal(report.checks[0].admitted,131072);
  const {api} = await import(pathToFileURL(join(dir,'module.mjs')));
  assert.equal(api.remaining({},8,3).code,'CAPABILITY');
  assert.equal(api.remaining({paused:true},8,3).value,8);
});
test('structural diff ignores whitespace and flags changed parameter type', t => {
  const file = join(temporary(t),'module.noi');
  const src = '(module m 1.0.0 (fn f ((x byte)) bool (reads) (requires true) (ensures true) true))';
  writeFileSync(file,src);
  const next = file + '.next';
  writeFileSync(next,src + '; comment');
  assert.deepEqual(cli(['diff',file,next]).changes,[]);
  writeFileSync(next,src.replace('x byte','x bool'));
  assert.ok(cli(['diff',file,next],1).changes.some(c=>c.field==='params' && c.status==='risky'));
  writeFileSync(next,src.slice(0,-1)+' (fn g () bool (reads) (requires true) (ensures true) true))');
  assert.equal(cli(['diff',file,next]).changes[0].status,'compatible');
});
test('CLI distinguishes source diagnostics and invocation errors', t => {
  const f = join(temporary(t),'invalid.noi');
  writeFileSync(f,'\n )');
  const d = cli(['check',f],1).diagnostic;
  assert.deepEqual([d.code,d.file,d.line,d.column],['E_PARSE',f,2,2]);
  assert.equal(cli(['verify',good,'--limit','0'],2).diagnostic.code,'E_TOOL');
});
test('strict TypeScript application imports declarations and runs generated module', () => {
  assert.match(run(['examples/demo.mjs']),/TypeScript host returned 5/);
});
test('body-only comparison proves equal outcomes or gives observable witness', t => {
  const dir = temporary(t);
  const a = join(dir,'old.noi'), b = join(dir,'new.noi');
  const source = body => '(module q 1.0.0 (fn f ((x byte)) byte (reads) (requires true) (ensures true) ' + body + '))';
  writeFileSync(a,source('x'));
  writeFileSync(b,source('(+ x 0)'));
  assert.deepEqual(cli(['diff',a,b]).changes.map(c=>[c.status,c.equalOutcomes]),[['compatible','256']]);
  writeFileSync(b,source('0'));
  const change = cli(['diff',a,b],1).changes[0];
  assert.equal(change.status,'risky');
  assert.deepEqual(change.witness.args,[1]);
});
test('TypeScript rejects a missing capability and a boolean byte argument', t => {
  const dir = temporary(t);
  cli(['build',changed,join(dir,'quota'),'--limit','131072']);
  const host = join(dir,'host.mts');
  writeFileSync(host, `import { api } from './quota/module.mjs';
// @ts-expect-error paused is required
api.remaining({}, 2, 3);
// @ts-expect-error requested must be numeric
api.remaining({paused: false}, 2, false);
`);
  run(['node_modules/typescript/bin/tsc','--strict','--module','nodenext','--noEmit',host]);
});
test('generated tagged union narrows in TypeScript and preserves an existing receipt', t => {
  const dir = temporary(t);
  cli(['build','examples/delivery.noi',join(dir,'delivery'),'--limit','65792']);
  const host = join(dir,'host.mts');
  writeFileSync(host, `import { api, type Enum_receipt } from './delivery/module.mjs';
const prior: Enum_receipt = {tag:'received',value:17};
const receipt = api.acknowledge({},prior,23);
if (!receipt.ok || receipt.value.tag !== 'received') throw Error('missing receipt');
console.log(receipt.value.value);
// @ts-expect-error payload required
api.acknowledge({}, {tag:'received'}, 23);`);
  run(['node_modules/typescript/bin/tsc','--strict','--module','nodenext',host]);
  assert.equal(run([join(dir,'host.mjs')]).trim(),'17');
});
test('missing solver process blocks symbolic build and preserves legacy CLI alias', t => {
  const dir = temporary(t);
  const output = join(dir,'artifact');
  const p = spawnSync(process.execPath,['noi.mjs','build',good,output,'--engine','symbolic','--json'],
    {encoding:'utf8',env:{...process.env,PATH:dir}});
  assert.equal(p.status,1);
  assert.equal(JSON.parse(p.stdout).checks[0].reason,'ENOENT');
  assert.equal(existsSync(output),false);
});
test('gate builds from the compared revision and keeps an earlier bundle intact on refusal', t => {
  const dir = temporary(t), out = join(dir,'approved');
  const source = join(dir,'candidate.noi');
  const baseline = 'examples/refinement/original.noi';
  writeFileSync(source,readFileSync(baseline));
  const approved = cli(['gate',baseline,source,out]);
  const manifest = JSON.parse(readFileSync(join(out,'report.json')));
  assert.equal(approved.after.sourceSha256,manifest.sourceSha256);
  assert.equal(manifest.artifacts['review.json'],sha(join(out,'review.json')));
  const earlier = sha(join(out,'module.mjs'));
  writeFileSync(source,readFileSync('examples/refinement/weakened.noi'));
  const denied = cli(['gate',baseline,source,out],1);
  assert.equal(denied.changes[0].witnessKind,'hypothetical-result');
  assert.equal(denied.artifact,undefined);
  assert.equal(sha(join(out,'module.mjs')),earlier);
});
