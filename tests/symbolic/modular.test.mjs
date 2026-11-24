import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../../src/frontend.mjs';
import {verify} from '../../src/verify.mjs';

const source = `(module m 1.0.0
  (helper keep ((x byte)) byte (reads) (requires (< 0 x)) (ensures (= result x)) x)
  (fn twice ((x byte)) byte (reads) (requires (< 0 x)) (ensures (= result x))
    (call keep (call keep x))))`;
const prove = src => verify(compile(src),src,8,'auto');

test('caller uses a discharged contract, replays admission and agrees with exhaustive execution', () => {
  const report = prove(source);
  assert.ok(report.passed, JSON.stringify(report.checks));
  assert.equal(report.checks[1].method,'callee-contracts');
  assert.deepEqual(report.checks[1].premises,['keep']);
  assert.equal(report.checks[1].admission,'sat');
  assert.ok(verify(compile(source),source,256,'enumerate').passed);
});

test('weak contracts fall back to exact implementation and genuine precondition errors replay', () => {
  const weak = prove(source.replace('(ensures (= result x)) x)', '(ensures true) x)'));
  assert.ok(weak.passed);
  assert.equal(weak.checks[1].abstraction,'insufficient-callee-contracts');
  const bad = prove(source.replace('byte (reads) (requires (< 0 x)) (ensures (= result x))\n','byte (reads) (requires true) (ensures (= result x))\n'));
  assert.equal(bad.checks[1].status,'violated');
  assert.deepEqual(bad.checks[1].counterexample.args,[0]);
  const liar = prove(source.replace('(ensures (= result x)) x)', '(ensures (= result x)) 0)'));
  assert.equal(liar.passed,false);
  assert.equal(liar.checks[0].status,'violated');
  assert.equal(liar.checks[1].status,'violated');
});

test('inactive branch summary assumptions do not erase input cases', () => {
  const src = `(module m 1.0.0
    (helper pred ((x byte)) byte (reads) (requires (< 0 x)) (ensures (< result x)) (- x 1))
    (fn f ((x byte)) byte (reads) (requires true) (ensures (< result x))
      (if (= x 0) 0 (call pred x))))`;
  const result = prove(src).checks[1];
  assert.equal(result.status,'violated');
  assert.deepEqual(result.counterexample.args,[0]);
});
