import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../src/frontend.mjs';
import { verify } from '../../src/verify.mjs';
import { compare } from '../../src/diff.mjs';

function revision(pre, post, body = 'x') {
  return `(module m 1.0.0 (fn f ((x bool)) bool (reads) (requires ${pre}) (ensures ${post}) ${body}))`;
}
const base = revision('true','(= result x)');
for (const [label, a, b, fields] of [
  ['narrower admission',base,revision('x','(= result x)'),{requires:'risky'}],
  ['broader admission',revision('x','true'),base,{requires:'compatible',ensures:'compatible'}],
  ['lost promise',base,revision('true','true'),{ensures:'risky'}],
  ['changed actual and hypothetical results',base,revision('true','true','(not x)'),{body:'risky',ensures:'risky'}],
  ['new admissions alone do not change old callers',revision('x','true'),revision('true','true','true'),{requires:'compatible',body:'compatible'}]
]) test(label, () => {
  for (const engine of ['enumerate','symbolic']) {
    const old = compile(a), next = compile(b);
    const report = compare(old,next,verify(old,a,4,engine),verify(next,b,4,engine));
    assert.deepEqual(Object.fromEntries(report.changes.map(c=>[c.field,c.status])),fields);
    for (const c of report.changes) {
      if (c.status === 'risky') assert.ok(c.witness);
      if (c.field === 'ensures' && c.witness) assert.ok(Object.hasOwn(c.witness,'result'));
    }
  }
});
