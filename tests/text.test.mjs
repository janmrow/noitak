import assert from 'node:assert/strict';
import test from 'node:test';
import {compile} from '../src/frontend.mjs';
import {emitModule} from '../src/emitter.mjs';
import {invoke} from '../src/runtime.mjs';
import {verify} from '../src/verify.mjs';
import {checkArtifact} from '../src/artifact-check.mjs';

const source = `(module ops 1.0.0
  (record observation (prefix bool) (suffix bool) (found bool) (units u32) (rest text))
  (fn scan ((s text) (q text)) observation (reads) (requires true) (ensures true)
    (make observation (prefix (starts-with s q)) (suffix (ends-with s q)) (found (contains s q))
      (units (text-length s)) (rest (strip-prefix s q)))))`;
const unit = compile(source);
const moduleFor = async u => import('data:text/javascript;base64,' + Buffer.from(await emitModule(u)).toString('base64'));

test('UTF-16 scans and removal agree with an independent code-unit loop through both entry points',async () => {
  const {api} = await moduleFor(unit);
  const corpus = ['', 'a', 'A', 'aa', 'aba', 'a/b', 'ababa', '😀', '\ud83d', '\ude00',
    'e\u0301','é', '\u0000', 'x'.repeat(1024)];
  function match(s,q,offset) {
    if (offset < 0 || offset+q.length > s.length) return false;
    for (let i=0; i<q.length; i++) if (s.charCodeAt(offset+i) !== q.charCodeAt(i)) return false;
    return true;
  }
  for (const s of corpus) for (const q of corpus) {
    const prefix = match(s,q,0);
    const suffix = match(s,q,s.length-q.length);
    let found = false, rest = '';
    for (let i=0; i<=s.length; i++) if (match(s,q,i)) found = true;
    for (let i=prefix ? q.length : 0; i<s.length; i++) rest += s[i];
    const want = {ok:true,value:{prefix,suffix,found,units:s.length,rest}};
    assert.deepEqual(api.scan({},s,q),want);
    assert.deepEqual(invoke(unit.functions[0],{},[s,q]),want);
  }
  for (const s of [null, new String('x'), 'x'.repeat(1025), {toString(){throw Error();}}])
    assert.deepEqual(api.scan({},s,''),{ok:false,code:'ARGUMENT',phase:'boundary'});
  const check = verify(unit,source,1000000,'enumerate').checks[0];
  assert.deepEqual([check.domain,check.status,check.examined],['symbolic-text','unverified',0]);
});

test('quoted punctuation and escapes are data, with located diagnostics for malformed or oversized literals', async () => {
  const value = ');\n"\\; \ud800';
  const literal = expr => `(module m 1.0.0\n (fn f () text (reads) (requires true) (ensures true) ${expr}))`;
  const {api} = await moduleFor(compile(literal(JSON.stringify(value))));
  assert.deepEqual(api.f({}),{ok:true,value});
  for (const [expr,code] of [['"unclosed','E_PARSE'],['"\\q"','E_PARSE'],[JSON.stringify('x'.repeat(1025)),'E_LIMIT'],
    ['(strip-prefix "x" true)','E_TYPE'],['(strip-prefix "x")','E_FORM'],['(uuid "x")','E_FORM']])
    assert.throws(()=>compile(literal(expr)), e => e.detail?.code === code && e.detail.line === 2);
});

test('forward nested sums, products and sequences materialize fresh trees and reject invalid nested values',async () => {
  const src = `(module m 1.0.0 (record pair (left option) (right option))
    (enum option (some rows) (none)) (sequence rows row 2) (record row (label text))
    (fn id ((p pair)) pair (reads) (requires true) (ensures (= result p)) p))`;
  const {api} = await moduleFor(compile(src));
  const shared = {label:'x'}, value = {tag:'some',value:[shared,shared]};
  const input = {left:value,right:value};
  const r = api.id({},input);
  assert.deepEqual(r,{ok:true,value:input});
  r.value.left.value[0].label = 'changed';
  assert.equal(input.left.value[0].label,'x');
  assert.equal(r.value.right.value[0].label,'x');
  assert.equal(r.value.left.value[1].label,'x');
  let reads = 0;
  for (const bad of [Object.create(shared), {get label(){reads++;return 'x';}}, {label:'x'.repeat(1025)}]) {
    const invalid = {left:value,right:{tag:'some',value:[bad]}};
    assert.equal(api.id({},invalid).code,'ARGUMENT');
  }
  assert.equal(reads,0);
  for (const defs of ['(record r (s s)) (enum s (loop r))','(sequence r r 2)'])
    assert.throws(()=>compile(`(module m 1.0.0 ${defs})`), e=>e.detail?.code==='E_TYPE');
  const defs = Array.from({length:24},(_,i) => `(record r${i} (a ${i?'r'+(i-1):'bool'}) (b ${i?'r'+(i-1):'bool'}))`);
  assert.throws(()=>compile(`(module m 1.0.0 ${defs.join(' ')})`), e=>e.detail?.code==='E_LIMIT');
});

test('application expectations veto common-mode agreement and unknown exports',async () => {
  const src = await emitModule(unit);
  const wrong = [{fn:'scan',flags:{},args:['abc','c'],expected:{ok:true,value:false}}];
  await assert.rejects(checkArtifact(unit,src,30000,new Map(),wrong),
    e=>e.detail?.origin==='application-vector' && e.detail.actual.ok && e.detail.reference.ok);
  await assert.rejects(checkArtifact(unit,src,30000,new Map(),[{...wrong[0],fn:'absent'}]),/Malformed application vector/);
});
