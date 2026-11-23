import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkArtifact } from '../src/artifact-check.mjs';
import { emitModule } from '../src/emitter.mjs';
import { compile } from '../src/frontend.mjs';

const source = `(module m 1.0.0
  (fn flip ((x bool)) bool (reads) (requires true) (ensures true) (not x)))`;
const unit = compile(source);

test('artifact evidence counts admitted executions separately from boundary and admission rejections',async ()=>{
  const module = compile(`(module m 1.0.0
    (fn rare ((x u32)) bool (reads) (requires (= x 7u32)) (ensures true) true)
    (reducer run ((s bool) (x bool)) bool (reads enable) (capacity 2)
      (invariant (flag enable)) (ensures true) x))`);
  const report = await checkArtifact(module,await emitModule(module));
  assert.equal(report.status,'incomplete');
  assert.deepEqual(report.checks.map(c => [c.function,c.status,c.cases,c.returned,c.admittedBodies]), [
    ['rare','incomplete',65,0,0], ['run','tested',14,6,5]
  ]);
  const witnesses = new Map([['rare',{flags:{},args:[7]}]]);
  const checked = await checkArtifact(module,await emitModule(module),30000,witnesses);
  assert.equal(checked.status,'tested');
  assert.equal(checked.checks[0].admittedBodies,1);
  const wrong = (await emitModule(module)).replace('body: (args, flags) => true','body: (args, flags) => false');
  await assert.rejects(checkArtifact(module,wrong,30000,witnesses), e =>
    e.detail?.function === 'rare' && e.detail.args[0] === 7);
});

test('extra module exports, worker failure and timeout all refuse artifact validation',async ()=>{
  const js = await emitModule(unit);
  await assert.rejects(checkArtifact(unit,js+'\nexport const unexpected = 1;'),/public surface/);
  await assert.rejects(checkArtifact(unit,'throw Error("initialization failed");'),/initialization failed/);
  await assert.rejects(checkArtifact(unit,'await new Promise(r=>setTimeout(r,1000));\n'+js,100),/timed out/);
});

test('a lowering mutation leaves source proofs intact and blocks both build and gate with a replayable witness',async t=>{
  const dir = await mkdtemp(join(tmpdir(),'noitak-emitter-mutant-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await cp(new URL('../src/',import.meta.url),join(dir,'src'),{recursive:true});
  await cp(new URL('../noitak.mjs',import.meta.url),join(dir,'noitak.mjs'));
  await writeFile(join(dir,'input.noi'),source);
  const emitter = join(dir,'src/emitter.mjs');
  const original = await readFile(emitter,'utf8');
  const changed = original.replace("return '(!' + run(a) + ')'","return run(a)");
  assert.notEqual(changed,original);
  await writeFile(emitter,changed);
  function cli(args,status) {
    const p = spawnSync(process.execPath,['noitak.mjs',...args,'--json'],{cwd:dir,encoding:'utf8'});
    assert.equal(p.status,status,p.stdout+p.stderr);
    return JSON.parse(p.stdout);
  }
  assert.equal(cli(['verify','input.noi'],0).passed,true);
  assert.equal(cli(['diff','input.noi','input.noi'],0).passed,true);
  for (const cmd of [['build','input.noi','out'],['gate','input.noi','input.noi','out']]) {
    const {diagnostic:d} = cli(cmd,2);
    assert.equal(d.code,'E_ARTIFACT_MISMATCH');
    assert.equal(d.function,'flip');
    assert.deepEqual(d.args,[false]);
    assert.deepEqual(d.expected,{ok:true,value:true});
    assert.deepEqual(d.actual,{ok:true,value:false});
    assert.deepEqual((await readdir(dir)).sort(),['input.noi','noitak.mjs','src']);
  }
});
