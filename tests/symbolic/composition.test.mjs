import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '../../src/frontend.mjs';
import { verify } from '../../src/verify.mjs';
import { compare } from '../../src/diff.mjs';

function proofs(source, limit = 65536) {
  const unit = compile(source);
  return ['enumerate','symbolic'].map(engine => verify(unit, source, limit, engine));
}

for (const [label, pre, body, independent] of [
  ['unreachable private branch','true','(if visible visible (and visible secret))',true],
  ['control-dependent disclosure','true','(if secret visible false)',false],
  ['admission-only disclosure','(or visible secret)','visible',false],
  ['secret computations with equal observed values','visible','(if secret visible true)',true]
]) test(label, () => {
  const src = `(module m 1.0.0 (record context (secret bool))
    (helper choose ((visible bool) (secret bool)) bool (reads) (requires true) (ensures true) ${body})
    (fn f ((visible bool) (private context)) bool (reads) (independent private)
      (requires (let secret (get private secret) ${pre})) (ensures true)
      (call choose visible (get private secret))))`;
  for (const report of proofs(src)) {
    const check = report.checks.at(-1);
    assert.equal(check.status, independent ? 'proven' : 'violated', JSON.stringify(check));
    if (!independent) {
      const w = check.counterexample;
      assert.equal(w.args[0], w.referenceArgs[0]);
      assert.notEqual(w.args[1].secret, w.referenceArgs[1].secret);
      assert.notDeepEqual(w.outcome, w.referenceOutcome);
    }
  }
});

test('jointly hidden structured arguments vary together while public grants stay fixed', () => {
  const src = `(module m 1.0.0 (enum e (off) (on byte)) (record pair (v e) (bit bool))
    (fn f ((x pair) (y e)) bool (reads enabled) (independent x y)
      (requires true) (ensures true)
      (and (flag enabled) (and (get x bit) (match y (off false) (on n (= n 255)))))))`;
  // Symbolic proof can use the entire record × enum domain. Enumeration explicitly refuses here.
  const [finite, symbolic] = proofs(src,1000);
  assert.equal(finite.checks.at(-1).status,'unverified');
  const w = symbolic.checks.at(-1).counterexample;
  assert.deepEqual(w.flags, {enabled:true});
  assert.equal(w.args[0].bit,true);
  assert.deepEqual(w.args[1],{tag:'on',value:255});
});

test('both engines distinguish a rejected helper call from an excluded caller input', () => {
  const src = `(module m 1.0.0
    (helper dec ((x byte)) byte (reads permit) (requires (and (flag permit) (< 0 x))) (ensures true) (- x 1))
    (fn f ((x byte)) byte (reads permit) (requires (flag permit)) (ensures true) (call dec x)))`;
  for (const r of proofs(src)) {
    const c = r.checks.at(-1);
    assert.deepEqual(c.counterexample, { args:[0], flags:{permit:true}, outcome:{ok:false, code:'CALL_PRECONDITION', phase:'body'} });
  }
});

test('semantic comparison detects helper-only behavior and hypothetical record guarantees', () => {
  const src = `(module m 1.0.0 (record pair (a bool) (b bool))
    (helper choose ((p pair)) pair (reads) (requires true) (ensures true) p)
    (fn f ((p pair)) pair (reads) (requires true) (ensures (= result p)) (call choose p)))`;
  const changed = src.replace('(ensures true) p)', '(ensures true) (make pair (a (get p a)) (b true)))')
    .replace('(ensures (= result p))', '(ensures (= (get result a) (get p a)))');
  for (const engine of ['enumerate','symbolic']) {
    const a = compile(src), b = compile(changed);
    const report = compare(a,b,verify(a,src,16,engine),verify(b,changed,16,engine));
    assert.ok(report.before.passed && report.after.passed);
    const [guarantee, body] = report.changes;
    assert.equal(guarantee.witnessKind,'hypothetical-result');
    assert.equal(guarantee.witness.result.a,guarantee.witness.args[0].a);
    assert.notEqual(guarantee.witness.result.b,guarantee.witness.args[0].b);
    assert.equal(body.witnessKind,'observed-returns');
    assert.equal(body.witness.before.value.b,false);
    assert.equal(body.witness.after.value.b,true);
  }
});

test('independent integer oracle detects a false proof from a signed-order translator mutant', t => {
  const dir = mkdtempSync(join(tmpdir(),'noitak-mutant-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const worker = readFileSync(new URL('../../src/symbolic_worker.py', import.meta.url), 'utf8');
  const mutant = worker.replace('z3.ULT(a, b)', '(a < b)');
  assert.notEqual(mutant, worker);
  cpSync(new URL('../../src/',import.meta.url), join(dir,'src'), {recursive:true});
  cpSync(new URL('../../noitak.mjs',import.meta.url), join(dir,'noitak.mjs'));
  writeFileSync(join(dir,'src/symbolic_worker.py'), mutant);
  const claim = `(module m 1.0.0 (fn f ((x byte)) bool (reads) (requires true)
    (ensures result) (or (< x 0) (not (< x 255)))))`;
  // Signed: x < 0 or x >= -1 is a tautology. Unsigned: fails for 0..254.
  const badInputs = Array.from({length:256},(_,x)=>x).filter(x => !(x < 0 || x >= 255));
  assert.equal(badInputs.length,255);
  for (const r of proofs(claim)) assert.ok(badInputs.includes(r.checks[0].counterexample.args[0]));
  function rejected(args) {
    const p = spawnSync(process.execPath,['noitak.mjs',...args,'--engine','symbolic','--json'],{cwd:dir, encoding:'utf8'});
    assert.equal(p.status,1,p.stdout + p.stderr);
    assert.equal(existsSync(join(dir,'artifact')),false);
    return JSON.parse(p.stdout);
  }
  writeFileSync(join(dir,'bad.noi'), claim);
  const check = rejected(['build','bad.noi','artifact']).checks[0];
  assert.equal(check.status,'unverified');
  // The worker may choose a failing admitted input. Replay can now veto its
  // spurious proof even before the independent enumeration audit.
  if (check.reason === 'admission-replay-disagreement') {
    assert.equal(check.crosscheck.reason,'primary-unresolved');
  } else {
    assert.equal(check.reason,'engine-disagreement');
    assert.equal(check.symbolicEvidence.status,'proven');
    assert.equal(check.crosscheck.counterexample.args[0],0);
  }

  // The same mutation can also "prove" two individually safe bodies equal.
  const candidate = claim.replace('(ensures result)', '(ensures true)');
  writeFileSync(join(dir,'next.noi'),candidate);
  writeFileSync(join(dir,'old.noi'),candidate.replace('(or (< x 0) (not (< x 255)))','true'));
  const review = rejected(['gate','old.noi','next.noi','artifact']);
  assert.ok(review.before.passed && review.after.passed);
  const finding = review.changes[0];
  assert.equal(finding.status,'undetermined');
  assert.equal(finding.reason,'engine-disagreement');
  assert.equal(finding.symbolicEvidence.solverAnswer,'unsat');
  assert.equal(finding.crosscheck.witness.args[0],0);
});
