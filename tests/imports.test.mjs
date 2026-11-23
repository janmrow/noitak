import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from '../src/loader.mjs';
import { hash, verify } from '../src/verify.mjs';
import { compare } from '../src/diff.mjs';
import { invoke } from '../src/runtime.mjs';

test('pins bind the full graph, preserve type identity and propagate private edits to the root', async t => {
  const dir = await mkdtemp(join(tmpdir(),'noitak-import-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const lib = '(module lib 1.0.0 (enum bit (a) (b)) (helper h ((x bit)) bit (reads) (requires true) (ensures true) x) (fn step ((x bit)) bit (reads) (requires true) (ensures true) (call h x)))';
  const root = pin => `(module root 1.0.0 (import lib ${pin}) (fn entry ((x lib.bit)) lib.bit (reads) (requires true) (ensures true) (call lib.step x)))`;
  const path = join(dir,'app.noi');
  async function save(src, app = root(hash(src))) {
    await writeFile(join(dir,'lib.noi'),src);
    await writeFile(path,app);
    return load(path);
  }
  const a = await save(lib);
  assert.deepEqual(a.unit.dependencies,{lib:hash(lib)});
  const entry = a.unit.functions.at(-1);
  assert.deepEqual(Object.keys(entry.graph),['lib.h','lib.step']);
  assert.deepEqual(entry.body,['apply','lib.step',['x']]);
  assert.deepEqual(invoke(entry,{},[{tag:'a'}]).value,{tag:'a'});
  const b = await save(lib.replace('true) x) (fn','true) (tag bit b)) (fn'));
  const prove = x => verify(x.unit,x.bytes,64);
  const review = compare(a.unit,b.unit,prove(a),prove(b));
  assert.deepEqual(review.changes.filter(c=>c.witnessKind).map(c=>c.subject),['lib.step','entry']);
  await assert.rejects(save(lib,root('0'.repeat(64))), e=>e.detail?.code==='E_IMPORT');
  await assert.rejects(save(lib,root(hash(lib)).replace('lib.step','lib.h')),e=>e.detail?.code==='E_CALL');
  await assert.rejects(save(lib,root(hash(lib)).replace('import lib','import ../lib')),e=>e.detail?.code==='E_NAME');
  await symlink(join(dir,'lib.noi'),join(dir,'alias.noi'));
  await assert.rejects(loadAfterAlias(),e=>e.code==='ELOOP' || e.detail?.code==='E_IMPORT');
  async function loadAfterAlias() {
    await writeFile(path,root(hash(lib)).replace('import lib','import alias'));
    return load(path);
  }
});

test('diamond imports share nominal definitions, detect conflicting pins and reject root cycles', async t => {
  const dir = await mkdtemp(join(tmpdir(),'noitak-diamond-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const source = '(module common 1.0.0 (record bit (v bool)) (fn id ((b bit)) bit (reads) (requires true) (ensures true) b))';
  const middle = (name,pin) => `(module ${name} 1.0.0 (import common ${pin}) (fn f ((b common.bit)) common.bit (reads) (requires true) (ensures true) (call common.id b)))`;
  const left = middle('left',hash(source));
  const file = join(dir,'root.noi');
  await writeFile(join(dir,'common.noi'),source);
  await writeFile(join(dir,'left.noi'),left);
  async function root(right) {
    await writeFile(join(dir,'right.noi'),right);
    await writeFile(file,`(module app 1.0.0 (import left ${hash(left)}) (import right ${hash(right)}) (import common ${hash(source)})
      (fn entry ((b common.bit)) common.bit (reads) (requires true) (ensures (= result b)) (call left.f (call right.f b))))`);
    return load(file);
  }
  const ok = await root(middle('right',hash(source)));
  assert.ok(verify(ok.unit,ok.bytes,2).passed);
  assert.equal(ok.unit.functions.filter(f=>f.name==='common.id').length,1);
  await assert.rejects(root(middle('right','0'.repeat(64))),e=>e.detail?.code==='E_IMPORT');
  await assert.rejects(root(`(module right 1.0.0 (import app ${'0'.repeat(64)}))`),e=>e.detail?.code==='E_IMPORT');
});

test('CLI loader refuses oversized input before parsing it', async t => {
  const dir = await mkdtemp(join(tmpdir(),'noitak-source-limit-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const file = join(dir,'large.noi');
  await writeFile(file,Buffer.alloc(1048577,32));
  await assert.rejects(load(file),e=>e.detail?.code==='E_LIMIT' && e.detail.file===file);
});

test('imported reducers retain their public resource contract and cannot be invoked as ordinary steps', async t => {
  const dir = await mkdtemp(join(tmpdir(),'noitak-reducer-import-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  async function snapshot(capacity, body) {
    const lib = `(module lib 1.0.0 (reducer run ((s bool) (x bool)) bool (reads)
      (capacity ${capacity}) (invariant true) (ensures true) x))`;
    const root = `(module app 1.0.0 (import lib ${hash(lib)})
      (fn f () bool (reads) (requires true) (ensures true) ${body}))`;
    await writeFile(join(dir,'lib.noi'),lib);
    const file = join(dir,'root.noi');
    await writeFile(file,root);
    return load(file);
  }
  const old = await snapshot(4,'true'), next = await snapshot(5,'true');
  const prove = x=>verify(x.unit,x.bytes,4);
  const review = compare(old.unit,next.unit,prove(old),prove(next));
  assert.equal(review.passed,false);
  assert.ok(review.changes.some(c=>c.subject==='lib.run' && c.field==='reducer-capacity' && c.status==='policy-violation'));
  await assert.rejects(snapshot(4,'(call lib.run true false)'),e=>e.detail?.code==='E_CALL');
});
