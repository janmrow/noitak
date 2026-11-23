import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/frontend.mjs';
import { verify } from '../src/verify.mjs';
import { invoke } from '../src/runtime.mjs';
import { cardinality, valueAt } from '../src/domain.mjs';

const source = `(module m 1.0.0 (sequence commands bool 3) (outcome outcome byte)
  (helper bump ((n byte) (inc bool)) byte (reads) (requires (or (not inc) (< n 255)))
    (ensures (<= n result)) (if inc (+ n 1) n))
  (fn apply ((start byte) (xs commands)) outcome (reads)
    (requires true) (ensures (match result (committed n (<= start n)) (rejected i (< i (length xs)))))
    (fold xs (tag outcome committed start) (acc v i)
      (match acc (committed n (attempt outcome i bump n v)) (rejected pos acc)))))`;
const unit = compile(source);
const f = unit.functions.at(-1);

test('independent bit-string model covers all lengths and exact first-rejection index', () => {
  const t = f.params[1][1];
  const all = new Set(Array.from({length:Number(cardinality(t))},(_,i)=>JSON.stringify(valueAt(t,i))));
  assert.equal(all.size,15);
  for (let len = 0; len <= 3; len++) for (let mask = 0; mask < 2 ** len; mask++) {
    const xs = Array.from({length:len},(_,i)=>Boolean(mask & (1 << i)));
    assert.ok(all.has(JSON.stringify(xs)));
    for (let start = 0; start <= 255; start++) {
      let sum = start;
      const index = xs.findIndex(bit => (sum += Number(bit)) > 255);
      const value = index < 0 ? {tag:'committed',value:sum} : {tag:'rejected',value:index};
      assert.deepEqual(invoke(f,{},[start,xs]), {ok:true,value});
    }
  }
  const proof = verify(unit,source,3840);
  assert.ok(proof.passed);
  assert.equal(verify(unit,source,3839).checks.at(-1).reason,'case-budget');
});

test('sequence boundary snapshots own dense elements and rejects oversized arrays before indexing', () => {
  let touched = false;
  const accessor = Object.defineProperty([true],0,{get(){ touched=true; return true; }});
  const long = new Proxy(Array(4),{getOwnPropertyDescriptor(target,k){
    if (k !== 'length') touched=true;
    return Reflect.getOwnPropertyDescriptor(target,k);
  }});
  for (const xs of [accessor, long, Array(1), {length:0}, [0],new Uint8Array(2)])
    assert.deepEqual(invoke(f,{},[0,xs]),{ok:false,code:'ARGUMENT',phase:'boundary'});
  assert.equal(touched,false);
});

test('invalid capacity, fold binding, wrong accumulator type and overlong literals are diagnosed', () => {
  for (const [from,to,code] of [
    ['bool 3','bool 0','E_LIMIT'], ['bool 3','bool 9','E_LIMIT'],
    ['(acc v i)','(start v i)','E_DUPLICATE'], ['(acc v i)','(acc v)','E_FORM'],
    ['(fold xs','(fold (items commands false true false true)','E_LIMIT'],
    ['(rejected pos acc)','(rejected pos false)','E_TYPE']
  ]) assert.throws(()=>compile(source.replace(from,to)),e=>e.detail?.code===code);
});

test('attempt handles only false admission, preserving arithmetic and false-guarantee faults', () => {
  for (const [from,to,code] of [
    ['(or (not inc) (< n 255))','(= (+ n 1) 1)','ARITHMETIC'],
    ['(<= n result)','false','CALL_POSTCONDITION']
  ]) {
    const fn = compile(source.replace(from,to)).functions.at(-1);
    assert.equal(invoke(fn,{},[255,[false]]).code,code);
  }
});

test('bounded work includes nested iterations even when sequence literals are empty', () => {
  let body = '0';
  for (let i = 0; i < 6; i++) body = `(fold (items xs) 0 (a${i} e${i} i${i}) ${body})`;
  assert.throws(()=>compile(`(module m 1.0.0 (sequence xs byte 8) (fn f () byte (reads) (requires true) (ensures true) ${body}))`),e=>e.detail?.code==='E_LIMIT');
});
