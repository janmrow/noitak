import assert from 'node:assert/strict';
import test from 'node:test';
import {compile} from '../../src/frontend.mjs';
import {verify} from '../../src/verify.mjs';
import {compare} from '../../src/diff.mjs';
import {build} from '../../src/backend.mjs';
import {invoke} from '../../src/runtime.mjs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function proof(source,engine='auto') {
  const unit = compile(source);
  return {unit,report:verify(unit,source,64,engine)};
}
function revision(requires,ensures,body,extra='') {
  return `(module m 1.0.0 (fn f ((x text) (trace text)) text (reads ops) ${extra}
    (requires ${requires}) (ensures ${ensures}) ${body}))`;
}
test('solver reconstructs rare admission, including a lone UTF-16 surrogate, for the deployable artifact',async t => {
  const x = '𐐀\ud800;()', pre = `(and (flag ops) (= x ${JSON.stringify(x)}))`;
  const {unit,report} = proof(revision(pre,'(= result x)','x','(independent trace)'));
  assert.ok(report.passed,JSON.stringify(report.checks));
  assert.equal(report.checks[1].method,'parameter-nonoccurrence');
  assert.equal(report.checks[0].admissionWitness.args[0],x);
  const dir = await mkdtemp(join(tmpdir(),'noitak-text-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const manifest = await build(unit,report,join(dir,'out'));
  const [coverage] = manifest.artifactValidation.checks;
  assert.equal(coverage.admissionWitness,true);
  assert.equal(coverage.admittedBodies,1);
});

test('symbolic unit sequences agree with independent concrete enumeration over a finite selector', () => {
  const src = `(module m 1.0.0 (fn f ((pair bool)) bool (reads) (requires true) (ensures result)
    (let s (if pair "😀" "a;b")
      (if pair (and (= (text-length s) 2u32)
        (and (starts-with s "\\ud83d") (and (ends-with s "\\ude00")
          (= (strip-prefix s "\\ud83d") "\\ude00"))))
        (and (contains s ";") (= (strip-prefix s "b") "a;b"))))))`;
  const {report} = proof(src,'symbolic');
  assert.ok(report.passed,JSON.stringify(report.checks));
  assert.equal(report.checks[0].crosscheck.examined,2);
  const bad = proof(src.replace('(text-length s) 2u32','(text-length s) 1u32'),'symbolic');
  assert.equal(bad.report.checks[0].counterexample.args[0],true);
});

test('text lengths constrain active nested fields, including hypothetical result values', () => {
  const prefix = '(module m 1.0.0 (record item (v text)) (sequence items item 2) (enum opt (none) (some items))';
  const bounded = '(match VAL (none true) (some xs (fold xs true (ok it i) (and ok (<= (text-length (get it v)) 1024u32)))))';
  const src = prefix+' (fn f ((x opt)) opt (reads) (requires true) (ensures '+bounded.replace('VAL','result')+') x))';
  const a = proof(src), b = proof(src.replace(bounded.replace('VAL','result'),'true'));
  assert.ok(a.report.passed && b.report.passed,JSON.stringify(a.report.checks));
  const diff = compare(a.unit,b.unit,a.report,b.report);
  assert.ok(diff.passed,JSON.stringify(diff.changes));
  assert.equal(diff.changes[0].solverAnswer,'unsat');
});

test('a live protected reference falls back to relational reasoning and a text change can lose admission or weaken a promise', () => {
  const leaking = proof(revision('true','true','trace','(independent trace)'));
  const flow = leaking.report.checks[1];
  assert.equal(flow.status,'violated',JSON.stringify(flow));
  assert.notDeepEqual(flow.counterexample.outcome, flow.counterexample.referenceOutcome);
  const a = proof(revision('(starts-with x "job/")','(= result x)','x'));
  const b = proof(revision('(starts-with x "job/a")','true','x'));
  const diff = compare(a.unit,b.unit,a.report,b.report);
  assert.equal(diff.passed,false);
  for (const c of diff.changes) assert.equal(c.status,'risky');
  assert.deepEqual(diff.changes.map(c=>c.witnessKind),['lost-admission','hypothetical-result']);
  const w = diff.changes[0].witness;
  assert.ok(invoke(a.unit.functions[0],w.flags,w.args).ok);
  assert.equal(invoke(b.unit.functions[0],w.flags,w.args).code,'PRECONDITION');
});

test('changing an imported text transform is observable through an enclosing record', async t => {
  const {writeFile} = await import('node:fs/promises');
  const {load} = await import('../../src/loader.mjs');
  const {hash} = await import('../../src/verify.mjs');
  const dir = await mkdtemp(join(tmpdir(),'noitak-text-import-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const dep = '(module names 1.0.0 (record row (name text)) (fn clean ((r row)) text (reads) (requires true) (ensures true) (strip-prefix (get r name) "usr/")))';
  async function snapshot(source) {
    await writeFile(join(dir,'names.noi'),source);
    const root = `(module app 1.0.0 (import names ${hash(source)})
      (record input (user names.row))
      (fn route ((r input)) text (reads) (requires true) (ensures true) (call names.clean (get r user))))`;
    const path = join(dir,'app.noi');
    await writeFile(path,root);
    const {unit,bytes} = await load(path);
    return {unit,report:verify(unit,bytes,1,'auto')};
  }
  const before=await snapshot(dep), after=await snapshot(dep.replace('usr/','user/'));
  const diff=compare(before.unit,after.unit,before.report,after.report);
  assert.ok(before.report.passed && after.report.passed);
  assert.deepEqual(diff.changes.filter(c=>c.witnessKind==='observed-returns').map(c=>c.subject),['names.clean','route']);
});
