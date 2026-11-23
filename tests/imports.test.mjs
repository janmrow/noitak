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
