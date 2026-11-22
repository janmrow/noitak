import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, solveRelation } from '../src/symbolic.mjs';
import { compile } from '../src/frontend.mjs';

const f = compile('(module m 1.0.0 (fn f () bool (reads) (requires true) (ensures true) true))').functions[0];
for (const [label, response] of [
  ['unavailable',{error:{code:'ENOENT'}}], ['hard timeout',{error:{code:'ETIMEDOUT'}}],
  ['crashed',{status:1}], ['truncated',{status:0,stdout:'{'}],
  ['unknown',{status:0,stdout:'{"status":"unverified","reason":"timeout"}'}],
  ['partial proof',{status:0,stdout:'{"status":"proven","safety":"unsat","solverVersion":"fixture"}'}],
  ['nonfailing model',{status:0,stdout:'{"status":"violated","solverVersion":"fixture","input":{"args":[],"flags":{}}}'}]
]) test('worker fails closed when '+label, () => {
  assert.equal(solve(f,[],()=>response).status,'unverified');
});

function workerReply(fields) {
  return () => ({ status: 0, stdout: JSON.stringify({solverVersion: 'fixture', ...fields}) });
}

test('a mixed reply cannot establish equal returns for different bodies', () => {
  const candidate = {...f, body: false};
  const reply = {relation: 'body', answer: 'unsat'};
  for (const extra of [{status: 'violated'}, {input: {args: [], flags: {}}}]) {
    const result = solveRelation(f, candidate, [], 'body', workerReply({...reply, ...extra}));
    assert.equal(result.status, 'undetermined');
    assert.equal(result.reason, 'invalid-worker-response');
  }
});

test('a proof requires consistent safety and admission evidence', () => {
  for (const reply of [
    {status: 'violated', reason: 'empty-admission-domain', safety: 'unsat', admission: 'sat'},
    {status: 'proven', safety: 'unsat', admission: 'sat', input: {args: [], flags: {}}}
  ]) {
    const result = solve(f, [], workerReply(reply));
    assert.equal(result.status, 'unverified');
    assert.equal(result.reason, 'invalid-worker-response');
  }
});

test('relational solver requires a matching query and a replayable typed witness', () => {
  const answers = [
    {relation:'ensures',answer:'sat',input:{args:[],flags:{},result:23}},
    {relation:'ensures',answer:'sat',input:{args:[],flags:{},result:true}},
    {relation:'body',answer:'unsat'}, {status:'unverified',reason:'timeout'}
  ];
  for (const answer of answers) {
    const r = solveRelation(f,f,[],'ensures',()=>({status:0,stdout:JSON.stringify({...answer,solverVersion:'fixture'})}));
    assert.equal(r.status,'undetermined');
  }
});
test('relational replay treats host extra fields like the compiled boundary', () => {
  const old = compile(`(module m 1.0.0 (enum e (absent))
    (fn f ((x e)) bool (reads) (requires true) (ensures (= x (tag e absent))) true))`).functions[0];
  const fake = {relation:'ensures',answer:'sat',solverVersion:'fixture',
    input:{args:[{tag:'absent',value:5}],flags:{},result:false}};
  const next = {...old, ensures:true};
  const r = solveRelation(old,next,[],'ensures',()=>({status:0,stdout:JSON.stringify(fake)}));
  assert.equal(r.reason,'model-replay-disagreement');
});
