import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/frontend.mjs';
import { invoke } from '../src/runtime.mjs';
import { verify } from '../src/verify.mjs';
import { cardinality, valueAt } from '../src/domain.mjs';
import { compare } from '../src/diff.mjs';

const toggle = `(module m 1.0.0 (reducer parity ((s bool) (row bool)) bool
  (reads) (capacity 8192) (invariant true) (ensures true) (if row (not s) s)))`;
const check = src => verify(compile(src), src, 4);

test('induction needs four transitions at capacity 8192, including empty and long batches', () => {
  const unit = compile(toggle), f = unit.functions[0];
  assert.deepEqual(check(toggle).checks.map(c => [c.property, c.status, c.examined]), [
    ['admissible-and-safe', 'proven', 4], ['prefix-invariant', 'proven', undefined]
  ]);
  const refused = verify(unit, toggle, 3);
  assert.deepEqual(refused.checks.map(c => c.reason), ['case-budget', 'missing-transition-proof']);
  for (const length of [0, 1, 8, 17, 8192]) {
    const rows = Array.from({length}, (_,i) => i % 3 === 0);
    assert.deepEqual(invoke(f, {}, [true, rows]), {ok:true, value: rows.filter(Boolean).length % 2 === 0});
  }
  let inspected = false;
  const long = new Proxy(Array(8193), {getOwnPropertyDescriptor(target,key) {
    if (key !== 'length') inspected = true;
    return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  for (const rows of [long, Array(2), [true, 1], new Uint8Array(1)])
    assert.equal(invoke(f,{},[true, rows]).code, 'ARGUMENT');
  assert.equal(inspected, false);
});

test('empty input checks state admission, snapshots grants and returns a fresh state', () => {
  const src = `(module m 1.0.0 (record pair (v bool))
    (reducer run ((s pair) (x bool)) pair (reads enable) (capacity 8)
       (invariant (and (flag enable) (get s v))) (ensures true) s))`;
  const f = compile(src).functions[0], s = {v:true};
  assert.equal(invoke(f, {enable:true}, [{v:false}, []]).code,'PRECONDITION');
  assert.equal(invoke(f, {}, [s, []]).code,'CAPABILITY');
  assert.notEqual(invoke(f, {enable:true}, [s, []]).value, s);
  let reads = 0;
  const flags = new Proxy({enable:true}, {getOwnPropertyDescriptor(target,key) {
    reads++; return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  assert.deepEqual(invoke(f,flags,[s,[true,false,true]]),{ok:true,value:s});
  assert.equal(reads,1);
});

test('state invariant is required on the next state and cannot depend on the current row', () => {
  const unsafe = toggle.replace('(invariant true)', '(invariant (not s))');
  const answer = check(unsafe);
  assert.deepEqual(answer.checks.map(c => c.status), ['violated','unverified']);
  assert.deepEqual(answer.checks[0].counterexample.args, [false,true]);
  for (const [a,b,code] of [
    ['(invariant true)','(invariant row)','E_NAME'],
    ['(invariant true)','(invariant result)','E_NAME'],
    ['(capacity 8192)','(capacity 65536)','E_LIMIT'],
    ['(capacity 8192)','(capacity 0)','E_LIMIT'],
    ['(row bool)) bool','(row bool)) byte','E_TYPE'],
    ['(s bool) (row bool)','(s bool)','E_FORM']
  ]) assert.throws(()=>compile(toggle.replace(a,b)), e=>e.detail?.code===code);
});

test('capacity and entry convention participate in change review even with identical step semantics', () => {
  for (const [src,status] of [
    [toggle.replace('8192','8193'),'policy-violation'],
    [toggle.replace('8192','8191'),'risky'],
    [toggle.replace('reducer','fn').replace('(capacity 8192) (invariant true)','(requires true)'), 'risky']
  ]) {
    const diff = compare(compile(toggle),compile(src),check(toggle),check(src));
    assert.equal(diff.passed,false);
    assert.equal(diff.changes.find(c=>c.field==='reducer-capacity').status,status);
  }
});

const identity = t => compile(`(module m 1.0.0 (fn id ((x ${t})) ${t} (reads)
  (requires true) (ensures true) x))`).functions[0];

test('wide scalars accept only canonical primitive values and have exact finite models', () => {
  const u = identity('u32'), id = identity('uuid');
  assert.equal(cardinality('u32'), 2n ** 32n);
  assert.equal(cardinality('uuid'), 2n ** 128n);
  const last = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  assert.equal(valueAt('uuid', 2n ** 128n - 1n), last);
  for (const v of [1.5, -1, 2**32, NaN, Infinity, '4', 1n, new Number(1)])
    assert.equal(invoke(u,{},[v]).code, 'ARGUMENT');
  assert.deepEqual(invoke(u,{},[-0]), {ok:true,value:0});
  assert.deepEqual(invoke(id,{},[last]), {ok:true,value:last});
  for (const v of [last.toUpperCase(), last+'\n', last.slice(1), last.replace('-','_'), new String(last), null])
    assert.equal(invoke(id,{},[v]).code, 'ARGUMENT');
});

test('u32 add, subtract and ordering agree with arbitrary precision integer arithmetic', () => {
  const binary = (op,t) => compile(`(module m 1.0.0 (fn calc ((a u32) (b u32)) ${t}
    (reads) (requires true) (ensures true) (${op} a b)))`).functions[0];
  const add = binary('+','u32'), sub = binary('-','u32'), cmp = binary('<','bool');
  let seed = 7351;
  const next = () => (seed = (Math.imul(seed,1664525) + 1013904223) >>> 0);
  const endpoints = [0,1,255,256,0x7fffffff,0x80000000,0xfffffffe,0xffffffff];
  const pairs = endpoints.flatMap(a=>endpoints.map(b=>[a,b]));
  for (let i=0; i<2048; i++) pairs.push([next(),next()]);
  for (const [a,b] of pairs) {
    for (const [f,n] of [[add,BigInt(a)+BigInt(b)], [sub,BigInt(a)-BigInt(b)]]) {
      const expected = n < 0n || n >= 2n**32n ? {ok:false,code:'ARITHMETIC',phase:'body'} : {ok:true,value:Number(n)};
      assert.deepEqual(invoke(f,{},[a,b]),expected);
    }
    assert.equal(invoke(cmp,{},[a,b]).value, BigInt(a)<BigInt(b));
  }
  for (const [t,expr] of [['u32','(+ 1u32 1)'],['u32','4294967296u32'],['bool','(< (uuid bad) 0)'],
    ['u32','(widen 0u32)'], ['bool','(< true true)']]) {
    assert.throws(()=>compile(`(module m 1.0.0 (fn f () ${t} (reads) (requires true) (ensures true) ${expr}))`));
  }
});

test('declared capacity bounds both copied data and repeated expression work', () => {
  const fields = Array.from({length:16}, (_,i)=>'(f'+i+' bool)').join(' ');
  const large = `(module m 1.0.0 (record row ${fields})
    (reducer count ((s bool) (x row)) bool (reads) (capacity 65535) (invariant true) (ensures true) s))`;
  assert.throws(()=>compile(large),e=>e.detail?.code==='E_LIMIT' && /snapshot/.test(e.message));
  const work = '(not '.repeat(64) + 's' + ')'.repeat(64);
  assert.throws(()=>compile(toggle.replace('8192','65535').replace('(if row (not s) s)',work)),
    e=>e.detail?.code==='E_LIMIT' && /step work/.test(e.message));
});
