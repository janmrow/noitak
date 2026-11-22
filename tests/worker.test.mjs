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
