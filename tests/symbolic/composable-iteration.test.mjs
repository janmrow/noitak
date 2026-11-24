import assert from 'node:assert/strict';
import test from 'node:test';
import { compile } from '../../src/frontend.mjs';
import { verify } from '../../src/verify.mjs';

function check(source, name) {
  return verify(compile(source),source,4096,'symbolic').checks.find(c =>
    c.function === name && c.property === 'admissible-and-safe');
}

test('ordered append model handles both sequence encodings and replays full-capacity faults', () => {
  for (const cap of [3,9]) {
    const source = `(module m 1.0.0 (sequence bits bool ${cap})
      (fn add ((xs bits) (x bool)) bits (reads) (requires (< (length xs) ${cap}))
        (ensures (and (= (length result) (+ (length xs) 1)) (member result x))) (append xs x)))`;
    const proof = check(source, 'add');
    assert.equal(proof.status,'proven',JSON.stringify(proof));
    const broken = check(source.replace('(< (length xs) '+cap+')','true'), 'add');
    assert.equal(broken.status,'violated',JSON.stringify(broken));
    assert.equal(broken.counterexample.outcome.code,'CAPACITY');
  }
});

test('signed comparison and checked arithmetic produce signed counterexamples', () => {
  const source = `(module m 1.0.0 (fn neg ((x i32)) i32 (reads)
    (requires (< -2147483648i32 x)) (ensures (or (<= 0i32 x) (< 0i32 result))) (- 0i32 x)))`;
  assert.equal(check(source,'neg').status,'proven');
  const overflow = check(source.replace('(< -2147483648i32 x)','true'),'neg');
  assert.equal(overflow.counterexample.args[0],-2147483648);
  assert.equal(overflow.counterexample.outcome.code,'ARITHMETIC');
});

test('a wide length never wraps at 256 in a proof', () => {
  const source = `(module m 1.0.0 (sequence xs bool 300 u32)
    (fn size ((s xs)) u32 (reads) (requires true) (ensures (<= result 300u32)) (length s)))`;
  assert.equal(check(source,'size').status,'proven');
  // A literal provides a deterministic >255 witness without forcing the solver
  // to synthesize a long array model under a short timeout.
  const long = '(items xs ' + Array(256).fill('true').join(' ') + ')';
  const bad = source.replace('((s xs))','()').replace('300u32','255u32').replace('(length s)','(length '+long+')');
  assert.equal(check(bad,'size').status,'violated');
});

test('named reduction checks its invariant even on the empty sequence', () => {
  const source = `(module m 1.0.0 (sequence bits bool 3)
    (reducer keep ((s bool) (x bool)) bool (reads) (capacity 3)
      (invariant s) (ensures result) s)
    (fn all ((s bool) (xs bits)) bool (reads) (requires s) (ensures result) (reduce keep s xs)))`;
  assert.equal(check(source,'all').status,'proven');
  const bad = check(source.replace('(requires s)','(requires (= xs (items bits)))'),'all');
  assert.deepEqual(bad.counterexample.args,[false,[]]);
  assert.equal(bad.counterexample.outcome.code,'CALL_PRECONDITION');
});
