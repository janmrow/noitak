// Run separately in each toolchain. Compile a shared diamond-shaped call graph
// once, measure median warm enumeration, and measure the standalone ESM.
import assert from 'node:assert/strict';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const checkout = resolve(process.argv[2] ?? '.');
const moduleAt = name => import(pathToFileURL(join(checkout,'src',name+'.mjs')));
const {compile} = await moduleAt('frontend');
const {verify,VERSION} = await moduleAt('verify');
const {build} = await moduleAt('backend');
const {compare} = await moduleAt('diff');
let source = '(module shared 1.0.0 (helper h0 ((b bool)) bool (reads) (requires true) (ensures true) b)';
for (let i=1;i<=8;i++)
  source += `(helper h${i} ((b bool)) bool (reads) (requires true) (ensures true)
    (and (call h${i-1} b) (call h${i-1} b)))`;
source += '(fn public ((b bool)) bool (reads) (requires true) (ensures (= result b)) (call h8 b)))';
const unit = compile(source);
let proof;
const times = [];
for (let i=0;i<10;i++) {
  const start = performance.now();
  proof=verify(unit,source,2);
  if (i>=3) times.push(performance.now()-start);
  assert.ok(proof.passed);
}
const revised=source.replace('(ensures true) b)', '(ensures true) (not (not b)))');
const candidate=compile(revised), candidateProof=verify(candidate,revised,2);
const comparisons=[];
for (let i=0;i<10;i++) {
  const start=performance.now();
  const review=compare(unit,candidate,proof,candidateProof);
  if (i>=3) comparisons.push(performance.now()-start);
  assert.ok(review.passed && review.changes.some(c=>c.subject==='public' && c.equalOutcomes==='2'));
}
const median = values => Number(values.sort((a,b)=>a-b)[3].toFixed(3));
const temp=await mkdtemp(join(tmpdir(),'noitak-bench-'));
try {
  await build(unit,proof,join(temp,'dist'));
  const bytes=(await stat(join(temp,'dist/module.mjs'))).size;
  console.log(JSON.stringify({version:VERSION, functions:unit.functions.length, esmBytes:bytes,
    medianEnumerationMs:median(times), medianComparisonMs:median(comparisons)}));
} finally { await rm(temp,{recursive:true,force:true}); }
