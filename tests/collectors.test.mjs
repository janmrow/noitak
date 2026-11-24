import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from '../src/backend.mjs';
import {checkArtifact} from '../src/artifact-check.mjs';
import {emitModule} from '../src/emitter.mjs';
import {compile} from '../src/frontend.mjs';
import {invoke} from '../src/runtime.mjs';
import {hash, verify} from '../src/verify.mjs';
import {load} from '../src/loader.mjs';

const source = `(module small 1.0.0
  (enum row (one) (two) (three))
  (record item (key row))
  (sequence rows row 4)
  (sequence items item 4)
  (enum selection (skip) (emit item))
  (helper use ((x row)) bool (reads include)
    (requires true) (ensures true) (or (flag include) (= x (tag row two))))
  (helper select ((x row)) selection (reads include)
    (requires true)
    (ensures (match result (skip true) (emit v (= (get v key) x))))
    (if (call use x) (tag selection emit (make item (key x))) (tag selection skip)))
  (collect run rows items (reads include) (using select)))`;
const ok = value => ({ok:true,value});
const fault = (code, phase = 'boundary') => ({ok:false,code,phase});
const tags = ['one','two','three'];
const entry = unit => unit.functions.find(f => f.name === 'run');
const artifact = source => import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

function* batches(length) {
  if (!length) yield [];
  else for (const tail of batches(length-1)) for (const tag of tags) yield [{tag},...tail];
}

test('ordered collection agrees with an independent exhaustive array oracle for all lengths and grants', async () => {
  const unit = compile(source), f = entry(unit);
  const vectors = [];
  const js = await emitModule(unit);
  const {api} = await artifact(js);
  for (let n = 0; n <= 4; n++) for (const rows of batches(n)) {
    for (const include of [false,true]) {
      const flags = {include};
      const expected = ok(rows.filter(r=>include || r.tag === 'two').map(r=>({key:r})));
      assert.deepEqual(invoke(f,flags,[rows]),expected);
      assert.deepEqual(api.run(flags,rows),expected);
      vectors.push({fn:'run',flags,args:[rows],expected});
    }
  }
  assert.equal(vectors.length,242);
  const report = await checkArtifact(unit,js,30000,new Map(),vectors);
  assert.equal(report.checks[0].applicationCases,242);
  const proof = verify(unit,source,4096);
  assert.ok(proof.passed);
  assert.equal(proof.checks.find(c=>c.function==='select').examined,6);
  assert.deepEqual(proof.checks.filter(c=>c.function==='run' && c.method==='induction-on-length')
    .map(c=>c.property),['admissible-and-safe','ordered-emissions','emitted-element-guarantee','output-bound']);
  const extraRead = source.replace('(reads include) (using select)','(reads include constructor) (using select)');
  const extraUnit = compile(extraRead);
  const witness = verify(extraUnit,extraRead,4096).checks.find(c=>c.scope==='ordered-collection').admissionWitness;
  assert.equal(Object.hasOwn(witness.flags,'constructor'),true);
  assert.equal(witness.flags.constructor,false);
  assert.ok(invoke(entry(extraUnit),witness.flags,witness.args).ok);
});

test('collector inputs are decoded before rows run, grants are snapshotted once and returned trees are fresh', async () => {
  const unit = compile(source);
  const {api} = await artifact(await emitModule(unit));
  const row = {tag:'two'};
  for (const call of [(flags,rows)=>invoke(entry(unit),flags,[rows]), api.run]) {
    let reads = 0;
    const flags = new Proxy({include:true},{getOwnPropertyDescriptor(target,key) {
      reads++;
      return Object.getOwnPropertyDescriptor(target,key);
    }});
    const result = call(flags,[row,row,row,row]);
    assert.deepEqual(result,ok(Array.from({length:4},()=>({key:row}))));
    assert.equal(reads,1);
    result.value[0].key.tag = 'three';
    assert.deepEqual(row,{tag:'two'});
    assert.deepEqual(result.value[1],{key:{tag:'two'}});
    assert.notEqual(call(flags,[]).value,call(flags,[]).value);
    const trapped = Object.defineProperty({},'tag',{get() {throw new Error('Unexpected accessor');}});
    for (const rows of [[row,{}],[row,Object.create(row)],[row,trapped],[row,,row],[row,row,row,row,row]]) {
      assert.deepEqual(call(flags,rows),fault('ARGUMENT'));
    }
    assert.deepEqual(call(Object.create({include:true}),[row]),fault('CAPABILITY'));
  }
});

test('collector frontend enforces nominal element types, literal admission, transitive reads, and resource limits', () => {
  for (const [edited,code,message] of [
    [source.replace('items item 4','items item 3'),'E_LIMIT','capacity'],
    [source.replace('(emit item)','(emit row)').replace('(make item (key x))','x').replace('(get v key)','v'),'E_TYPE','skip or emit'],
    [source.replace('(skip) (emit item)','(skip) (emit item) (other)')
      .replace('(match result (skip true)','(match result (other true) (skip true)'),'E_TYPE','skip or emit'],
    [source.replace('(collect run rows items (reads include)','(collect run rows items (reads)'),'E_EFFECT','selector read'],
    [source.replace('(requires true)\n    (ensures (match','(requires (not (= x (tag row one))))\n    (ensures (match'),'E_FORM','requires true'],
    [source.replace('items item 4','items item 255').replace('rows row 4','rows row 255')
      .replace('(call use x)','(and (call use x) '+('(and true '.repeat(100))+'true'+')'.repeat(100)+')'),'E_LIMIT','work']
  ]) {
    assert.throws(()=>compile(edited), error=>error.detail.code===code && error.message.includes(message));
  }
  const narrowed = source.replace('(helper select','(fn select').replace(/\n  \(collect run.*\)\)$/s,')')
    .replace('(requires true)\n    (ensures (match','(requires (not (= x (tag row one))))\n    (ensures (match');
  const rowEntry = compile(narrowed).functions.find(f=>f.name==='select');
  assert.deepEqual(invoke(rowEntry,{include:false},[{tag:'one'}]),fault('PRECONDITION','requires'));
});

test('reached selector faults reject the whole batch and keep derived obligations open', async t => {
  const dir = await mkdtemp(join(tmpdir(),'noitak-collect-fault-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  for (const [kind, edited, expected] of [
    ['arithmetic', source.replace('(if (call use x)', '(if (if (= x (tag row one)) (= (- 0 1) 1) (call use x))'),
      fault('ARITHMETIC','body')],
    ['projection', source.replace('(make item (key x))','(make item (key (tag row three)))'),
      fault('POSTCONDITION','ensures')]
  ]) {
    const unit = compile(edited), f = entry(unit);
    const report = verify(unit,edited,4096);
    const row = report.checks.find(c=>c.function==='select');
    const batch = report.checks.find(c=>c.function==='run' && c.property==='admissible-and-safe');
    assert.equal(row.status,'violated');
    assert.equal(batch.status,'unverified');
    const {args,flags,outcome} = batch.counterexample;
    assert.deepEqual(outcome,expected);
    const failAfterEmit = [[{tag:'three'},...args[0]]];
    assert.deepEqual(invoke(f,flags,args),expected);
    const {api} = await artifact(await emitModule(unit));
    assert.deepEqual(api.run({include:true},...failAfterEmit),expected);
    assert.deepEqual(invoke(f,{include:true},failAfterEmit),expected);
    assert.deepEqual(api.run({include:true},[...failAfterEmit[0],{}]),fault('ARGUMENT'));
    assert.deepEqual(invoke(f,{include:true},[[...failAfterEmit[0],{}]]),fault('ARGUMENT'));
    const dest = join(dir,kind);
    await assert.rejects(build(unit,report,dest),/Required proof failed/);
    assert.equal(existsSync(dest),false);
  }
});

test('a directly imported selector can be used but an imported collector cannot be called', async t => {
  const dir = await mkdtemp(join(tmpdir(),'noitak-collect-import-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const library = source.replace('module small','module library').replace('(helper select','(fn select')
    .split('\n  (collect')[0]+')';
  await writeFile(join(dir,'library.noi'),library);
  const pin = hash(library);
  const root = `(module root 1.0.0 (import library ${pin})
    (collect run library.rows library.items (reads include) (using library.select)))`;
  await writeFile(join(dir,'root.noi'),root);
  const {unit} = await load(join(dir,'root.noi'));
  assert.deepEqual(invoke(entry(unit),{include:true},[[{tag:'one'}]]),ok([{key:{tag:'one'}}]));
  const downstream = `(module downstream 1.0.0 (import root ${hash(root)})
    (fn misuse ((x bool)) bool (reads include)
      (requires true) (ensures true) (call root.run x)))`;
  await writeFile(join(dir,'downstream.noi'),downstream);
  await assert.rejects(load(join(dir,'downstream.noi')),error=>error.detail.code==='E_CALL');
});

test('coverage counts completed nonempty calls, measured selector executions, and emissions separately', async () => {
  const unit = compile(source.replace('(call use x)','false'));
  const js = await emitModule(unit);
  const empty = {fn:'run',flags:{include:false},args:[[]],expected:ok([])};
  const {checks:[row]} = await checkArtifact(unit,js,30000,new Map(),[empty]);
  assert.ok(row.selectorExecutions > row.nonemptyCalls && row.nonemptyCalls < row.returned);
  assert.equal(row.emittedValues,0);
  const bypass = js.replace('const contribution = selectRow0(row, snapshot);','const contribution = {ok:true,value:{tag:"skip"}};');
  assert.notEqual(bypass,js);
  await assert.rejects(checkArtifact(unit,bypass,30000,new Map(),[empty]),/Unexpected selector execution count/);
});
