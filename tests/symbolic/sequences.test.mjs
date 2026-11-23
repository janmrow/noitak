import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/frontend.mjs';
import { verify } from '../../src/verify.mjs';
import { compare } from '../../src/diff.mjs';

const src = `(module q 1.0.0 (sequence bits bool 3) (outcome answer byte)
  (helper step ((n byte) (bit bool)) byte (reads) (requires bit) (ensures true) (+ n 0))
  (fn f ((xs bits) (secret bool)) answer (reads) (independent secret)
    (requires true) (ensures (match result (committed n (= n 0)) (rejected i (< i (length xs)))))
    (fold xs (tag answer committed 0) (acc bit i)
      (match acc (committed n (attempt answer i step n bit)) (rejected pos acc)))))`;
for (const [label,a,b,property,status] of [
  ['empty and inactive slots','(+ n 0)','(+ n 0)','admissible-and-safe','proven'],
  ['wrong failure index','(attempt answer i','(attempt answer 7','admissible-and-safe','violated'],
  ['failure index carries a protected bit','(attempt answer i','(attempt answer (if secret 0 i)','observable-independence','violated'],
  ['hidden admission','(requires true) (ensures (match','(requires (or secret (= xs (items bits)))) (ensures (match','observable-independence','violated']
]) test(label, () => {
  const s=src.replace(a,b), unit=compile(s);
  for (const engine of ['enumerate','symbolic']) {
    const report=verify(unit,s,1024,engine);
    const check=report.checks.find(c=>c.function==='f' && c.property===property);
    assert.equal(check.status,status,JSON.stringify(check));
    if (status==='violated') assert.ok(Array.isArray(check.counterexample.args[0]));
  }
});
test('symbolic refinement quantifies over hypothetical sequences and replays an ordered witness', () => {
  const a='(module m 1.0.0 (sequence bits bool 2) (fn f ((xs bits)) bits (reads) (requires true) (ensures (= result xs)) xs))';
  const b=a.replace('(= result xs)','(= (length result) (length xs))');
  const old=compile(a), next=compile(b);
  const review=compare(old,next,verify(old,a,1,'symbolic'),verify(next,b,1,'symbolic'));
  const finding=review.changes[0];
  assert.equal(finding.witnessKind,'hypothetical-result');
  assert.notDeepEqual(finding.witness.result,finding.witness.args[0]);
  assert.equal(finding.witness.result.length,finding.witness.args[0].length);
});

test('membership matches all 1023 sequences of up to nine bits across both encodings', () => {
  for (const capacity of [3,9]) {
    const source = `(module m 1.0.0 (sequence xs bool ${capacity})
      (fn f ((s xs)) bool (reads) (requires true)
        (ensures (= result (fold s false (seen bit i) (or seen bit))))
        (member s true)))`;
    const unit = compile(source), check = verify(unit,source,4096,'symbolic').checks[0];
    assert.equal(check.status,'proven',JSON.stringify(check));
    assert.equal(check.crosscheck.examined,2**(capacity+1)-1);
  }
});

test('native sequence model decodes nested membership witnesses and enforces each nominal capacity', () => {
  const source = `(module m 1.0.0 (record row (label text)) (sequence rows row 255)
    (fn f ((s rows)) bool (reads) (requires (member s (make row (label "λ")))) (ensures result)
      (not (member s (make row (label "λ"))))))`;
  const check = verify(compile(source),source,1,'symbolic').checks[0];
  assert.equal(check.status,'violated',JSON.stringify(check));
  assert.ok(check.counterexample.args[0].some(r=>r.label==='λ'));
  assert.equal(check.counterexample.outcome.code,'POSTCONDITION');
  const two = `(module m 1.0.0 (sequence short bool 9) (sequence long bool 255)
    (fn f ((a short) (b long)) byte (reads) (requires true)
      (ensures (<= (length a) 9)) (length b)))`;
  const a=compile(two), after=two.replace('bool 9','bool 10').replace('(length a) 9','(length a) 10');
  const b=compile(after), pa=verify(a,two,1,'symbolic'), pb=verify(b,after,1,'symbolic');
  assert.ok(pa.passed && pb.passed);
  const diff=compare(a,b,pa,pb);
  assert.ok(diff.changes.some(c=>c.field==='sequence' && c.status==='policy-violation'));
});
