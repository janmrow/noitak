import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/frontend.mjs';
import { invoke } from '../src/runtime.mjs';
import { verify } from '../src/verify.mjs';
import { testVectors } from '../src/vectors.mjs';

function source(body = 'x', { params = '(x byte)', reads = '', pre = 'true', post = 'true', type = 'byte' } = {}) {
  return `(module sample 1.0.0\n (fn compute (${params}) ${type} (reads ${reads}) (requires ${pre}) (ensures ${post}) ${body}))`;
}
const check = (body, options, limit = 65536) => {
  const s = source(body, options);
  return verify(compile(s), s, limit).checks[0];
};
const fn = (body, options) => compile(source(body, options)).functions[0];

for (const [label, s, code] of [
  ['unclosed list', source().slice(0,-1), 'E_PARSE'],
  ['unexpected close', source() + ')', 'E_PARSE'],
  ['extra root', source() + ' z', 'E_PARSE'],
  ['unknown name', source('missing'), 'E_NAME'],
  ['unknown type', source('x', {type:'int'}), 'E_TYPE'],
  ['bad arity', source('(+ x)'), 'E_FORM'],
  ['out of range', source('256'), 'E_RANGE'],
  ['implicit conversion', source('(+ x true)'), 'E_TYPE'],
  ['heterogeneous arms', source('(if true x false)'), 'E_TYPE'],
  ['unbound result', source('result'), 'E_NAME'],
  ['duplicate parameter', source('x', {params:'(x byte) (x bool)'}), 'E_DUPLICATE'],
  ['local shadow', source('(let x 0 x)'), 'E_DUPLICATE'],
  ['forward local', source('(let y y y)'), 'E_NAME'],
  ['wrong contract type', source('x', {post:'result'}), 'E_TYPE'],
  ['undeclared read in contract', source('x', {pre:'(flag admin)'}), 'E_EFFECT'],
  ['duplicate grant', source('x', {reads:'admin admin'}), 'E_DUPLICATE'],
  ['depth limit', '('.repeat(129), 'E_LIMIT'],
  ['reserved name', source('0', {params:'(true bool)'}), 'E_NAME'],
  ['unknown form', source('(constructor x)'), 'E_FORM']
]) test('rejects ' + label, () => assert.throws(() => compile(s), e =>
  e.detail?.code === code && e.detail.line >= 1 && e.detail.column >= 1));

test('comments, immutable locals and lazy branches', () => {
  const f = fn('(let y ; local\n x (if (= y 255) 0 (+ y 1)))');
  assert.equal(invoke(f, {}, [255]).value, 0);
  assert.equal(invoke(f, {}, [2]).value, 3);
});
test('requires filters input and proof counts it', () => {
  const c = check('(+ x 1)', {pre:'(< x 255)', post:'(< x result)'});
  assert.deepEqual([c.status,c.examined,c.admitted], ['proven',256,255]);
  assert.equal(invoke(fn('(+ x 1)', {pre:'(< x 255)'}), {}, [255]).code, 'PRECONDITION');
});
for (const [phase, body, opts] of [
  ['requires','x',{pre:'(= (+ x 1) 0)'}],
  ['body','(+ x 1)',{}],
  ['ensures','x',{post:'(<= 0 (+ result 1))'}]
]) test('arithmetic fault in ' + phase, () => {
  const c = check(body, opts);
  assert.equal(c.status, 'violated');
  assert.deepEqual(c.counterexample, {args:[255], flags:{}, outcome:{ok:false,code:'ARITHMETIC',phase}});
});
test('lazy booleans skip partial operands', () => {
  const c = check('x', {pre:'(or true (= (- 0 1) 0))',post:'(not (and false (= (+ 255 1) 0)))'});
  assert.equal(c.status,'proven');
});
test('unsatisfiable assumption fails', () => assert.equal(check('x',{pre:'false'}).reason,'empty-admission-domain'));
test('budget boundary includes flag dimensions', () => {
  const opts = {reads:'lock',post:'(or (flag lock) (= result x))'};
  assert.equal(check('x',opts,511).status,'unverified');
  assert.equal(check('x',opts,512).examined,512);
  const c = check('x',{reads:'lock',post:'(not (flag lock))'});
  assert.deepEqual(c.counterexample.flags,{lock:true});
});
test('boundary requires own boolean data grants and canonical bytes', () => {
  const f = fn('(if (flag admin) x 0)',{reads:'admin'});
  for (const flags of [{}, null, Object.create({admin:true}), {admin:1}, {get admin(){throw Error()}}])
    assert.equal(invoke(f,flags,[3]).code,'CAPABILITY');
  for (const xs of [[false],[1.1],[NaN],[-1],[256],[],[1,2]])
    assert.equal(invoke(f,{admin:true},xs).code,'ARGUMENT');
  assert.deepEqual(invoke(f,{admin:true},[-0]),{ok:true,value:0});
});
test('vector evidence distinguishes tested and violated', () => {
  const cases = [2,0].map(value => ({fn:'compute',args:[2],flags:{},expected:{ok:true,value}}));
  const r = testVectors(compile(source()),cases);
  assert.equal(r.passed,false);
  assert.deepEqual(r.checks.map(c=>c.status),['tested','violated']);
});
test('nullary function has one tuple', () => assert.equal(check('true',{params:'',type:'bool'}).examined,1));
