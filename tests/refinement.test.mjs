import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/diff.mjs';
import { verify } from '../src/verify.mjs';
import { compile } from '../src/frontend.mjs';

function diff(pre, post, newPre, newPost, limit = 65536) {
  function revision(p, q) {
    const source = `(module m 1.0.0 (fn f ((x byte)) byte (reads) (requires ${p}) (ensures ${q}) x))`;
    const unit = compile(source);
    return {unit, proof: verify(unit, source, limit)};
  }
  const a = revision(pre, post), b = revision(newPre, newPost);
  return compare(a.unit, b.unit, a.proof, b.proof);
}
test('refinement allows weaker admission and stronger guarantee', () => {
  const r = diff('(< x 5)', 'true', '(< x 6)', '(= result x)');
  assert.ok(r.passed);
  assert.equal(r.changes.find(c=>c.field==='ensures').examined,5*256);
});
test('admission witness identifies former caller', () => {
  const r = diff('true','true','(< x 255)','true');
  assert.deepEqual(r.changes[0].witness.args,[255]);
});
test('postcondition witness includes a hypothetical return even for unchanged body', () => {
  const r = diff('true','(= result x)','true','true');
  assert.deepEqual(r.changes[0].witness,{args:[0],flags:{},result:1,before:false,after:true});
});
test('off-body arithmetic fault does not satisfy an old guarantee', () => {
  const r = diff('(< x 255)','(<= 0 (+ result 1))','(< x 255)','true');
  assert.equal(r.changes[0].witness.before,'arithmetic-fault');
});
test('comparison budget covers possible outputs too', () => {
  const r = diff('true','true','true','(= result x)',256);
  assert.equal(r.changes[0].reason,'comparison-budget');
  assert.equal(r.passed,false);
});
