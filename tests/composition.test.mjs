import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from '../src/frontend.mjs';
import { verify } from '../src/verify.mjs';
import { build } from '../src/backend.mjs';
import { invoke } from '../src/runtime.mjs';
import { compare } from '../src/diff.mjs';

const helper = '(helper minus ((n byte)) byte (reads) (requires (< 0 n)) (ensures (< result n)) (- n 1))';
const base = `(module m 1.0.0 ${helper}
  (fn f ((n byte)) byte (reads) (requires true) (ensures true) (if (= n 0) 0 (call minus n))))`;
const check = source => verify(compile(source), source, 65536);
const diff = (a, b) => compare(compile(a), compile(b), check(a), check(b));

for (const [label, source, code] of [
  ['call-site argument type', base.replace('(call minus n)', '(call minus true)'), 'E_TYPE'],
  ['call-site arity', base.replace('(call minus n)', '(call minus)'), 'E_FORM'],
  ['self call', base.replace('(- n 1)', '(call minus n)'), 'E_CALL'],
  ['caller cannot supply undeclared authority', base.replace('(reads)', '(reads audit)'), 'E_EFFECT'],
  ['contract cannot trust helper implementation', base.replace('(ensures true)', '(ensures (= result (call minus n)))'), 'E_CALL'],
  ['forward call', base.replace(helper, '').replace(/\)$/, helper + ')'), 'E_CALL'],
  ['invalid protected parameter', base.replace('(fn f ((n byte)) byte (reads)', '(fn f ((n byte)) byte (reads) (independent missing)'), 'E_NAME'],
  ['record declaration collision', '(module m 1.0.0 (enum r (v)) (record r (v bool)))', 'E_DUPLICATE'],
  ['recursive record', '(module m 1.0.0 (record r (v r)))', 'E_TYPE'],
  ['duplicate field', '(module m 1.0.0 (record r (v bool) (v byte)))', 'E_DUPLICATE'],
  ['unknown field', '(module m 1.0.0 (record r (v bool)) (fn f ((x r)) bool (reads) (requires true) (ensures true) (get x missing)))', 'E_FIELD'],
  ['missing initializer', '(module m 1.0.0 (record r (v bool)) (fn f () r (reads) (requires true) (ensures true) (make r)))', 'E_FORM'],
  ['reordered initializer', '(module m 1.0.0 (record r (a bool) (b bool)) (fn f () r (reads) (requires true) (ensures true) (make r (b true) (a false))))', 'E_FIELD'],
  ['record nominality', '(module m 1.0.0 (record r (v bool)) (record s (v bool)) (fn f ((x s)) r (reads) (requires true) (ensures true) x))', 'E_TYPE']
]) test('diagnoses ' + label, () => assert.throws(() => compile(source), e => e.detail?.code === code));

test('strict helper frames isolate names, check contracts and preserve caller phase', () => {
  const leaking = base.replace('(if (= n 0) 0 (call minus n))', '(call minus n)');
  const fault = check(leaking).checks.at(-1);
  assert.deepEqual(fault.counterexample, { args:[0], flags:{}, outcome:{ok:false, code:'CALL_PRECONDITION', phase:'body'} });
  const badPost = base.replace('(< result n)', 'false');
  assert.equal(check(badPost).checks.at(-1).counterexample.outcome.code, 'CALL_POSTCONDITION');
  const strict = '(module m 1.0.0 (helper ignore ((x byte)) byte (reads) (requires true) (ensures true) 7) (fn f () byte (reads) (requires true) (ensures true) (call ignore (- 0 1))))';
  assert.equal(check(strict).checks.at(-1).counterexample.outcome.code, 'ARITHMETIC');
  assert.ok(check(base).passed);
});

test('call graph bounds reject exponential work during checking', () => {
  let src = '(module m 1.0.0 (helper h0 () bool (reads) (requires true) (ensures true) true)';
  for (let i = 1; i < 40; i++) src += `(helper h${i} () bool (reads) (requires true) (ensures true) (and (call h${i-1}) (call h${i-1})))`;
  assert.throws(() => compile(src + '(fn f () bool (reads) (requires true) (ensures true) (call h39)))'), e => e.detail?.code === 'E_LIMIT');
});

test('exact large product domains refuse enumeration before iteration', () => {
  const fields = Array.from({length:18}, (_, i) => '(x' + i + ' byte)').join(' ');
  const src = `(module m 1.0.0 (record r ${fields}) (fn f ((x r)) r (reads) (requires true) (ensures true) x))`;
  const c = check(src).checks[0];
  assert.deepEqual([c.status, c.domain, c.examined], ['unverified', (256n ** 18n).toString(), 0]);
});

test('nested helper change reaches public review; unused private helper may be removed', () => {
  const src = base.replace('(fn f', '(helper nested ((n byte)) byte (reads) (requires (< 0 n)) (ensures true) (call minus n)) (fn f')
    .replace('(if (= n 0) 0 (call minus n))', '(if (= n 0) 0 (call nested n))');
  const changed = src.replace('(- n 1)', '0');
  const report = diff(src, changed);
  assert.equal(report.passed, false);
  assert.deepEqual(report.changes.map(c => [c.subject,c.field,c.witness.args]), [['f','body',[2]]]);
  assert.ok(diff(src.replace('(fn f', '(helper unused () bool (reads) (requires true) (ensures true) true) (fn f'), src).passed);
});

test('gate protects independence promises even for identical implementations', () => {
  const raw = '(module m 1.0.0 (fn f ((s bool) (t bool)) bool (reads) (requires true) (ensures true) true))';
  const protectedFn = raw.replace('(reads)', '(reads) (independent s t)');
  assert.ok(diff(raw, protectedFn).passed);
  assert.equal(diff(protectedFn, protectedFn.replace('independent s t','independent t')).changes[0].status, 'policy-violation');
});

test('record boundary copies own typed fields and discards accessors, aliases and extra data', () => {
  const src = '(module m 1.0.0 (enum bit (set bool)) (record pair (x bit) (y bit)) (fn f ((p pair)) pair (reads) (requires true) (ensures true) p))';
  const f = compile(src).functions[0];
  const shared = {tag:'set',value:true};
  const p = {x:shared,y:shared,internal:'private'};
  const {value} = invoke(f,{},[p]);
  assert.deepEqual(value,{x:shared,y:shared});
  assert.notEqual(value.x, value.y);
  assert.notEqual(value.x, shared);
  let accessed = false;
  for (const input of [Object.create(p), {x:shared}, {get x(){ accessed = true; return shared; }, y:shared}, {x:{tag:'set',value:1},y:shared}])
    assert.equal(invoke(f,{},[input]).code,'ARGUMENT');
  assert.equal(accessed,false);
});

test('materialized public result has no observable alias dependent on private input', () => {
  const src = `(module m 1.0.0 (enum e (a)) (record pair (x e) (y e))
    (fn f ((secret bool)) pair (reads) (independent secret) (requires true) (ensures true)
      (let x (tag e a) (make pair (x x) (y (if secret x (tag e a)))))))`;
  assert.ok(check(src).passed);
  for (const flag of [false,true]) {
    const {value} = invoke(compile(src).functions[0],{},[flag]);
    assert.notEqual(value.x, value.y);
  }
});

test('independent transition table checks all emitted transitions, views and routes', async t => {
  const src = await readFile('pilot/support/tickets.noi','utf8');
  const root = await mkdtemp(join(tmpdir(), 'noitak-oracle-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const unit = compile(src);
  const proof = verify(unit,src,3072);
  assert.ok(proof.passed);
  await build(unit,proof,join(root,'module'));
  const artifact = await import(pathToFileURL(join(root,'module/module.mjs')));
  assert.deepEqual(Object.keys(artifact),['api']);
  const {api} = artifact;
  assert.equal(Object.getPrototypeOf(api),null);
  assert.deepEqual(Object.keys(api).sort(), ['public_view','route','transition']);
  const transitions = {customer_reply:'open', agent_reply:'waiting', resolve:'closed', staff_note:null};
  for (const tag of ['open','closed','waiting']) for (let revision = 0; revision < 256; revision++) {
    const prior = {stage:{tag}, revision};
    for (const [action, target] of Object.entries(transitions)) {
      const expected = target === null ? {ok:true, value:prior} :
        revision === 255 ? {ok:false, code:'PRECONDITION', phase:'requires'} :
          {ok:true, value:{stage:{tag:target}, revision:revision + 1}};
      assert.deepEqual(api.transition({},prior,{tag:action}), expected);
    }
    for (const escalated of [true,false]) for (const covered of [true,false]) {
      const staff = {escalated, covered};
      assert.deepEqual(api.public_view({},prior,staff), {ok:true, value:{closed:tag === 'closed', waiting_on_customer:tag === 'waiting'}});
      const onCall = tag === 'open' && covered && escalated;
      assert.deepEqual(api.route({},prior,staff), {ok:true, value:{tag:onCall ? 'on_call' : 'standard'}});
    }
  }
});

test('delegating an existing host grant to a private helper requires review', () => {
  const src = base.replace('(fn f ((n byte)) byte (reads)', '(fn f ((n byte)) byte (reads ops)');
  const report = diff(src, src.replace('(helper minus ((n byte)) byte (reads)', '(helper minus ((n byte)) byte (reads ops)'));
  assert.equal(report.passed,false);
  assert.deepEqual(report.changes.map(c => [c.subject,c.field,c.status]), [['minus','helper-reads','policy-violation']]);
});
