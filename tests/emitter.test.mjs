import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { emitModule } from '../src/emitter.mjs';
import { compile } from '../src/frontend.mjs';
import { invoke } from '../src/runtime.mjs';

// Exercise even failing contracts through the internal emitter. Public build
// and gate require proofs and cannot publish these negative fixtures.
async function engines(t, source) {
  const unit = compile(source);
  const dir = await mkdtemp(join(tmpdir(),'noitak-lowering-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file = join(dir,'artifact.mjs');
  await writeFile(file,await emitModule(unit));
  const {api} = await import(pathToFileURL(file));
  return (name, flags, ...args) => {
    const entry = unit.functions.find(f=>f.name===name);
    const actual = api[name](flags,...args);
    assert.deepEqual(actual,invoke(entry,flags,args),name);
    return actual;
  };
}

test('direct JS matches the reference for strict faults, admission and lazy branches', async t=>{
  const expressions = [
    ['requires','(= (+ n 1) 0)','true','n','ARITHMETIC','requires'],
    ['body','true','true','(+ n 1)','ARITHMETIC','body'],
    ['ensures','true','(= (+ result 1) 0)','n','ARITHMETIC','ensures'],
    ['badpost','true','false','n','POSTCONDITION','ensures'],
    ['denied','false','false','(+ n 1)','PRECONDITION','requires'],
    ['unused','true','true','(let unused (+ n 1) 0)','ARITHMETIC','body'],
    ['callee','true','true','(call partial n)','CALL_PRECONDITION','body'],
    ['guarantee','true','true','(call broken n)','CALL_POSTCONDITION','body'],
    ['indexfirst','true','true','(attempt out (+ n 1) partial (call broken n))','ARITHMETIC','body'],
    ['actualfirst','true','true','(attempt out 0 partial (call broken n))','CALL_POSTCONDITION','body']
  ];
  const decls = expressions.map(([name,pre,post,body])=>
    `(fn ${name} ((n byte)) ${body.startsWith('(attempt')?'out':'byte'}
      (reads) (requires ${pre}) (ensures ${post}) ${body})`);
  const compare = await engines(t,`(module faults 1.0.0 (outcome out byte)
    (helper partial ((n byte)) byte (reads) (requires (< n 255)) (ensures true) (+ n 1))
    (helper broken ((n byte)) byte (reads) (requires true) (ensures false) n)
    ${decls.join('\n')}
    (fn lazy ((n byte)) byte (reads)
      (requires (or true (= (+ n 1) 0))) (ensures (not (and false (= (+ n 1) 0))))
      (if true n (call broken n)))
    (fn attempt_call ((n byte)) out (reads) (requires true) (ensures true) (attempt out 7 partial n)))`);
  for (const [name,,,,code,phase] of expressions)
    assert.deepEqual(compare(name,{},255),{ok:false,code,phase});
  assert.equal(compare('lazy',{},255).value,255);
  assert.deepEqual(compare('attempt_call',{},255).value,{tag:'rejected',value:7});
  assert.deepEqual(compare('attempt_call',{},1).value,{tag:'committed',value:2});
});

test('JS keywords and builtin property names are data across folds, projections and match scopes',async t=>{
  const compare = await engines(t,`(module module 1.0.0
    (enum variant (case byte) (throw))
    (record class (constructor variant))
    (sequence switch class 3)
    (fn constructor ((await byte) (yield switch)) switch (reads constructor)
      (requires true) (ensures true)
      (let arguments
        (fold yield await (acc eval index)
          (match (get eval constructor) (case const (+ acc const)) (throw index)))
        (items switch (make class (constructor (tag variant case
          (if (flag constructor) arguments (length yield)))))))))`);
  for (const enabled of [false,true]) for (const initial of [0,254,255])
    for (const xs of [[],[{constructor:{tag:'case',value:2}}],[{constructor:{tag:'throw'}},{constructor:{tag:'case',value:3}}]])
      compare('constructor',{constructor:enabled},initial,xs);
});

test('reducer checks empty admission and attributes invariant and step faults to the corresponding phase',async t=>{
  const compare = await engines(t,`(module stream 1.0.0
    (reducer run ((s byte) (x byte)) byte (reads) (capacity 8)
      (invariant (< (+ s 1) 200)) (ensures true) (+ s x)))`);
  for (const [state,rows,expected] of [
    [255,[],{ok:false,code:'ARITHMETIC',phase:'requires'}],
    [200,[],{ok:false,code:'PRECONDITION',phase:'requires'}],
    [0,[200],{ok:false,code:'POSTCONDITION',phase:'ensures'}],
    [0,[255],{ok:false,code:'ARITHMETIC',phase:'ensures'}],
    [1,[255],{ok:false,code:'ARITHMETIC',phase:'body'}],
    [2,[9,1],{ok:true,value:12}]
  ]) assert.deepEqual(compare('run',{},state,rows),expected);
});

test('seeded composed u32 expressions preserve intermediate overflow, scoping and branch selection',async t=>{
  let seed = 71237;
  function draw(n) {
    seed = (Math.imul(seed,1664525)+1013904223)>>>0;
    return Math.floor(seed * n / 2**32);
  }
  function expr(depth) {
    if (!depth) return ['x','y','0u32','4294967295u32','(widen z)'][draw(5)];
    const a = expr(depth-1), b = expr(depth-1);
    switch (draw(4)) {
      case 0: return `(+ ${a} ${b})`;
      case 1: return `(- ${a} ${b})`;
      case 2: return `(if (<= x y) ${a} ${b})`;
      default: return `(let t${depth} ${a} (if (= t${depth} x) ${b} t${depth}))`;
    }
  }
  const decls = Array.from({length:32},(_,i)=>
    `(fn f${i} ((x u32) (y u32) (z byte)) u32 (reads) (requires true) (ensures true) ${expr(3)})`);
  const compare = await engines(t,'(module generated 1.0.0 '+decls.join('\n')+')');
  for (let i=0; i<decls.length; i++)
    for (const x of [0,1,0x80000000,0xffffffff])
      for (const y of [0,127,0xfffffffe,0xffffffff]) compare('f'+i,{},x,y,255);
});

test('record readers check own data fields in order, stop at the first failure and copy equal subvalues separately',async t=>{
  const compare = await engines(t,`(module m 1.0.0 (enum cell (filled byte))
    (record pair (constructor cell) (second cell))
    (fn copy ((x pair)) pair (reads grant) (requires true)
      (ensures (= result x)) (make pair (constructor (get x constructor)) (second (get x second)))))`);
  const filled = {tag:'filled',value:4};
  const input = {constructor:filled,second:filled};
  const output = compare('copy',{grant:true},input).value;
  assert.equal(Object.getPrototypeOf(output),Object.prototype);
  assert.notEqual(output.constructor,input.constructor);
  assert.notEqual(output.constructor,output.second);
  let examined = [];
  const bad = new Proxy(input,{getOwnPropertyDescriptor(target,key) {
    examined.push(key);
    if (key === 'constructor') return {configurable:true,get(){throw Error('accessor called')}};
    return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  assert.equal(compare('copy',{},bad).code,'ARGUMENT');
  assert.deepEqual(examined,['constructor','constructor']);
  assert.equal(compare('copy',{grant:true},Object.create(input)).code,'ARGUMENT');
});
