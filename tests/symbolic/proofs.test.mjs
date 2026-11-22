import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '../../src/frontend.mjs';
import { verify } from '../../src/verify.mjs';
import { invoke } from '../../src/runtime.mjs';

function differential(source, expected, limit = 65536) {
  const unit = compile(source);
  const reference = verify(unit, source, limit);
  const symbolic = verify(unit, source, limit, 'symbolic');
  const verdict = symbolic.checks[0];
  assert.equal(reference.checks[0].status, expected);
  assert.equal(verdict.status, expected, JSON.stringify(verdict));
  assert.ok(verdict.solverVersion);
  if (verdict.counterexample) {
    const {args, flags, outcome} = verdict.counterexample;
    assert.deepEqual(invoke(unit.functions[0],flags,args),outcome);
    assert.equal(outcome.ok,false);
  }
}
for (const [file, expected, limit] of [
  ['quota','proven',65536], ['broken','violated',65536], ['delivery','proven',65792],
  ['maintenance','proven',131072]
]) test('cross-check ' + file, () => differential(readFileSync('examples/'+file+'.noi','utf8'),expected,limit));

for (const [label, pre, body, post, expected] of [
  ['unsigned ordering', '(< 127 x)', '(- x 1)', '(< result x)', 'proven'],
  ['let initializer is strict','true','(let y (+ x 1) x)','true','violated'],
  ['underflow in admission','(= (- x 1) 0)','x','true','violated'],
  ['overflow in guarantee','true','x','(<= 0 (+ result 1))','violated'],
  ['empty admission','(< x 0)','x','true','violated'],
  ['lazy operands','(or true (= (- 0 1) x))','(if false (- 0 1) x)','(not (and false (= (+ 255 1) result)))','proven']
]) test(label,()=>differential(`(module m 1.0.0 (fn f ((x byte)) byte (reads)
  (requires ${pre}) (ensures ${post}) ${body}))`,expected));
test('tagged bool payload and lazy match branch yield a replayable model', () =>
  differential(`(module m 1.0.0 (enum bit (absent) (set bool))
    (fn f ((x bit)) bit (reads gate) (requires (flag gate))
       (ensures (= result x))
       (match x (absent x) (set b (tag bit set (not b))))))`, 'violated'));
test('proof covers a domain beyond the maximum enumeration budget', () => {
  const s = readFileSync('examples/reserve.noi','utf8');
  const unit = compile(s);
  assert.equal(verify(unit,s,1000000).checks[0].status,'unverified');
  const proof = verify(unit,s,1,'symbolic').checks[0];
  assert.equal(proof.domain,'16777216');
  assert.equal(proof.status,'proven');
});
test('symbolic diff retains the finite comparison limit', async () => {
  const { compare } = await import('../../src/diff.mjs');
  const source = readFileSync('examples/reserve.noi','utf8');
  const revised = source.replace('(if (< remaining reserve) stock remaining)',
    '(if (<= reserve remaining) remaining stock)');
  const a = compile(source), b = compile(revised);
  const r = compare(a,b,verify(a,source,1,'symbolic'),verify(b,revised,1,'symbolic'));
  assert.ok(r.before.passed && r.after.passed);
  assert.equal(r.passed,false);
  assert.ok(r.changes.some(c=>c.field==='body' && c.status==='undetermined'));
});
