import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../src/symbolic.mjs';
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

test('relational solver requires a matching query and a replayable typed witness', async () => {
  const {solveRelation} = await import('../src/symbolic.mjs');
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
