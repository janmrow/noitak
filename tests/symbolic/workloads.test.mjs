import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from '../../src/frontend.mjs';
import { verify } from '../../src/verify.mjs';
import { build } from '../../src/backend.mjs';
import { compare } from '../../src/diff.mjs';

const meter = await readFile(new URL('../../pilot/metering/metering.noi', import.meta.url), 'utf8');
const access = await readFile(new URL('../../pilot/access/access.noi', import.meta.url), 'utf8');
const a = '00112233-4455-6677-8899-aabbccddeeff';
const b = '00112233-4455-6677-8899-aabbccddeefe';

function proof(source) {
  const unit = compile(source);
  return {unit, report: verify(unit,source,65536,'symbolic')};
}

async function artifact(t, source) {
  const {unit,report} = proof(source);
  assert.ok(report.passed, JSON.stringify(report.checks));
  const dir = await mkdtemp(join(tmpdir(),'noitak-component-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await build(unit,report,join(dir,'out'));
  return (await import(pathToFileURL(join(dir,'out/module.mjs')))).api;
}

test('metering artifact agrees with independent BigInt reconciliation for 8192 readings and fault positions', async t => {
  const api = await artifact(t,meter);
  const dir = await mkdtemp(join(tmpdir(),'noitak-reference-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const reference = fileURLToPath(new URL('../../pilot/metering/reference.mts',import.meta.url));
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--strict','--module','nodenext','--outDir',dir,reference]);
  const {reconcile} = await import(pathToFileURL(join(dir,'reference.mjs')));
  const account = {meter:a, used:1000000, limit:0xffffffff, serial:90000, status:{tag:'ready'}};
  const rows = Array.from({length:8192},(_,i)=>({meter:a,serial:90001+i,units:3000+i}));
  for (const length of [0,1,8,256,8192]) {
    const chunk = rows.slice(0,length);
    assert.deepEqual(api.reconcile({},account,chunk),{ok:true,value:reconcile(account,chunk)});
  }
  for (let pos=0;pos<32;pos++) for (const change of [{meter:b},{serial:90000},{units:0xffffffff}]) {
    const chunk = rows.slice(0,32);
    chunk[pos] = {...chunk[pos], ...change};
    assert.deepEqual(api.reconcile({},account,chunk),{ok:true,value:reconcile(account,chunk)});
  }
  const edge = {...account, serial:0xfffffffe, used:0xfffffffe};
  const last = {meter:a, serial:0xffffffff, units:1};
  assert.deepEqual(api.reconcile({},edge,[last]),{ok:true,value:reconcile(edge,[last])});
  assert.deepEqual(api.reconcile({},edge,[last,last]),{ok:true,value:reconcile(edge,[last,last])});
  assert.equal(api.reconcile({}, {...account,limit:5}, []).code,'PRECONDITION');
  // Even a malformed row after a business rejection invalidates the whole host input.
  assert.equal(api.reconcile({},account,[{...last,meter:b}, {...last,units:-1}]).code,'ARGUMENT');
});

test('authorization artifact covers equality, role, grant and expiry partitions against an independent decision table', async t => {
  const api = await artifact(t,access);
  const bits = [false,true];
  for (const suspended of bits) for (const sameTenant of bits) for (const owner of bits)
    for (const reader of bits) for (const has_reader of bits) for (const delegation of bits)
      for (const now of [3999999999,4000000000,4000000001]) for (const trace of [a,b]) {
        const p = {tenant:a,user:b,suspended};
        const r = {tenant:sameTenant?a:b, owner:owner?b:a, reader:reader?b:a, has_reader, expires:4000000000};
        let tag = 'no_grant';
        if (delegation && has_reader && reader && now < r.expires) tag = 'delegated';
        if (owner) tag = 'owner';
        if (!sameTenant) tag = 'tenant_mismatch';
        if (suspended) tag = 'revoked';
        assert.deepEqual(api.authorize({delegation},p,r,now,trace),{ok:true,value:{tag}});
      }
});

test('a bypassed tenant check produces a replayed counterexample; coherent policy rewrite still needs review', () => {
  const changed = access.replace('(if (= (get p tenant) (get r tenant))','(if true');
  const unsafe = proof(changed);
  const failure = unsafe.report.checks[0];
  assert.equal(failure.status,'violated');
  const [principal, resource] = failure.counterexample.args;
  assert.notEqual(principal.tenant, resource.tenant);
  assert.equal(failure.counterexample.outcome.code,'POSTCONDITION');
  const relaxed = changed.replace('(if (not (= (get p tenant) (get r tenant)))','(if false');
  const old = proof(access), next = proof(relaxed);
  const review = compare(old.unit,next.unit,old.report,next.report);
  assert.ok(old.report.passed && next.report.passed);
  assert.equal(review.passed,false);
  assert.deepEqual(review.changes.map(c=>[c.witnessKind,c.status]), [
    ['hypothetical-result','risky'], ['observed-returns','risky']
  ]);
});

test('a safe reducer rewrite is equivalent by one-step comparison; a changed rejection code is distinguishable', () => {
  const old = proof(meter);
  for (const [from,to,expected] of [
    ['(+ (get s used) (get r units)) (get s used)', '(+ (get r units) (get s used)) (get s used)', 'compatible'],
    ['(tag status foreign_meter)\n', '(tag status out_of_order)\n', 'risky']
  ]) {
    const changed = meter.replace(from,to);
    assert.notEqual(changed,meter);
    const next = proof(changed);
    assert.ok(next.report.passed);
    const result = compare(old.unit,next.unit,old.report,next.report);
    const body = result.changes.find(c=>c.subject==='reconcile' && c.field==='body');
    assert.equal(body.status,expected);
    assert.equal(body.scope,'one-transition');
    assert.equal(result.passed,expected==='compatible');
    if (body.witness) assert.notDeepEqual(body.witness.before, body.witness.after);
  }
});

test('Z3 bit widths, extension and UUID constants are exhaustively cross-checked in small source domains', () => {
  const src = `(module small 1.0.0 (fn check ((n byte)) bool (reads) (requires true)
    (ensures result) (and (= (- (+ 4294967040u32 (widen n)) (widen n)) 4294967040u32)
      (and (< (widen n) 2147483648u32) (not (= (uuid ${a}) (uuid ${b})))))))`;
  const c = proof(src).report.checks[0];
  assert.equal(c.status,'proven');
  assert.equal(c.crosscheck.examined,256);
  const overflow = proof(src.replaceAll('4294967040u32','4294967041u32')).report.checks[0];
  assert.equal(overflow.counterexample.args[0],255);
  assert.equal(overflow.crosscheck.status,'violated');
});

test('failed induction never promotes a step violation, even with a valid empty batch', () => {
  const source = `(module m 1.0.0 (reducer cap ((s u32) (delta u32)) u32
    (reads) (capacity 1024) (invariant (<= s 4000000000u32)) (ensures true) delta))`;
  const [step,induction] = proof(source).report.checks;
  assert.equal(step.status,'violated');
  assert.ok(step.counterexample.args[1] > 4000000000);
  assert.equal(induction.status,'unverified');
});

test('auto selects each proof and refinement engine using its own quantified domain', () => {
  const src = `(module mixed 1.0.0
    (fn small ((x bool)) u32 (reads) (requires true) (ensures (= result 1u32)) 1u32)
    (fn wide ((x u32)) u32 (reads) (requires true) (ensures (= result x)) x))`;
  const next = src.replace('(= result 1u32)','(<= result 1u32)');
  const oldUnit = compile(src), nextUnit = compile(next);
  const before = verify(oldUnit,src,2,'auto'), after = verify(nextUnit,next,2,'auto');
  assert.deepEqual(before.checks.map(c=>c.method),['enumerate','symbolic']);
  const diff = compare(oldUnit,nextUnit,before,after);
  assert.equal(diff.passed,false);
  assert.equal(diff.changes[0].method,'symbolic');
  assert.equal(diff.changes[0].witness.result,0);
});
