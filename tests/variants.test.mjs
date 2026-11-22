import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/frontend.mjs';
import { invoke } from '../src/runtime.mjs';
import { verify } from '../src/verify.mjs';
import { compare } from '../src/diff.mjs';
import { readFileSync } from 'node:fs';
const src = readFileSync('examples/delivery.noi','utf8');
const unit = compile(src), f = unit.functions[0];
test('payloads count toward the domain and both branches execute', () => {
  assert.equal(verify(unit,src,65792).checks[0].admitted,65792);
  assert.deepEqual(invoke(f,{},[{tag:'pending'},8]).value,{tag:'received',value:8});
  assert.deepEqual(invoke(f,{},[{tag:'received',value:0},8]).value,{tag:'received',value:0});
});
test('untrusted tagged inputs are copied and validated', () => {
  for (const input of [{tag:'unknown'},{tag:'received',value:256},Object.create({tag:'pending'}),
    {get tag(){throw Error()}},null,{tag:'received',value:false}])
    assert.equal(invoke(f,{},[input,0]).code,'ARGUMENT');
  const input = {tag:'received',value:2};
  assert.notEqual(invoke(f,{},[input,0]).value,input);
});
for (const [pattern, replacement, code] of [
  ['(pending false)','', 'E_MATCH'],
  ['(pending false)','(pending false) (pending true)','E_VARIANT'],
  ['(pending false)','(pending 0)','E_TYPE'],
  ['(tag receipt received sequence)','(tag receipt received true)','E_TYPE'],
  ['(tag receipt received sequence)','(tag receipt pending sequence)','E_FORM']
]) test('rejects variant error ' + replacement, () =>
  assert.throws(()=>compile(src.replace(pattern,replacement)),e=>e.detail?.code===code));
test('different nominal types cannot mix even with identical members', () => {
  const program = '(module m 1.0.0 (enum a (x)) (enum b (x)) (fn f () a (reads) (requires true) (ensures true) (tag b x)))';
  assert.throws(()=>compile(program),e=>e.detail?.code==='E_TYPE');
});
test('same-cardinality change of public tags requires review', () => {
  const newer = src.replaceAll('pending','waiting');
  const next = compile(newer);
  const r = compare(unit,next,verify(unit,src,65792),verify(next,newer,65792));
  assert.ok(r.changes.some(c=>c.field==='enum' && c.status==='risky'));
});
