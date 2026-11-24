import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compile} from '../src/frontend.mjs';
import {verifyPair} from '../src/verify.mjs';

const revision = bytes => ({unit: compile(bytes), bytes});
const source = `(module ledger 1.0.0
  (helper choose ((b bool)) bool (reads) (requires true) (ensures true) b)
  (fn project ((x bool)) bool (reads) (requires true) (ensures true) (call choose x))
  (fn audit ((x bool)) bool (reads) (requires true) (ensures (= result x)) x))`;

test('comparison reuses checked obligations and invalidates transitive implementation changes', () => {
  const [base, next] = verifyPair(revision(source), revision('\n' + source.replace('true) b)', 'true) (not b))')), 8);
  assert.ok(base.passed && next.passed);
  assert.equal(next.verificationSession.reusedFunctions, 1);
  assert.equal(next.verificationSession.checkedFunctions, 2);
  for (const [i, c] of next.checks.entries()) {
    assert.equal(c.obligationId, base.checks[i].obligationId);
    assert.equal(c.definitionSha256 === base.checks[i].definitionSha256, c.function === 'audit');
    assert.equal(c.loc.line, base.checks[i].loc.line + 1);
  }
  assert.deepEqual(next.checks[1].dependsOn,[next.checks[0].definitionSha256]);
  const pinned = revision(source);
  pinned.unit.dependencies = {ledgerlib:'a'.repeat(64)};
  assert.equal(verifyPair(revision(source), pinned, 8)[1].verificationSession.reusedFunctions, 0);
  assert.notEqual(verifyPair(revision(source),revision(source),7)[0].checks[0].definitionSha256, base.checks[0].definitionSha256);
  const broken = source.replace('ensures (= result x)', 'ensures false');
  const [, failed] = verifyPair(revision(broken),revision(broken),8);
  assert.equal(failed.verificationSession.reusedFunctions,2);
  assert.equal(failed.checks.at(-1).status,'violated');
});

test('external gate authorization binds the pair and discloses whole-function approval', t => {
  const dir = mkdtempSync(join(tmpdir(),'noitak-evolution-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const base = join(dir,'old.noi'), next = join(dir,'new.noi'), out = join(dir,'bundle'), policy = join(dir,'policy.json');
  writeFileSync(base,source);
  const changed = source.replace('true) b)', 'true) (not b))');
  writeFileSync(next, changed);
  function cli(args, expected) {
    const p = spawnSync(process.execPath,['noitak.mjs',...args,'--json'],{encoding:'utf8'});
    assert.equal(p.status, expected, p.stderr + p.stdout);
    return JSON.parse(p.stdout);
  }
  const gate = ['gate',base,next,out,'--authorization',policy];
  function authorize(names) {
    const diff = cli(['diff',base,next],1);
    writeFileSync(policy,JSON.stringify({schema:1,scopeSha256:diff.authorizationScopeSha256, allowBehavior:names}));
  }
  authorize(['audit']);
  assert.equal(cli(gate,1).decision,'blocked');
  authorize(['project']);
  assert.equal(cli(['gate',base,next,out],1).decision,'blocked'); // sibling policy is never auto-loaded
  assert.equal(existsSync(out),false);
  const receipt = spawnSync(process.execPath,['noitak.mjs',...gate],{encoding:'utf8'});
  assert.equal(receipt.status,0,receipt.error?.message ?? receipt.stderr + receipt.stdout);
  assert.match(receipt.stdout,/covers all return-value differences on jointly admitted inputs in this exact revision for: project\./);
  assert.match(receipt.stdout,/Each witness shows one differing input\. Other return differences may exist\./);
  const review = JSON.parse(readFileSync(join(out,'review.json')));
  assert.equal(review.decision,'authorized-evolution');
  assert.equal(review.changes[0].status,'risky');
  assert.deepEqual(review.authorization.allowBehavior,['project']);
  writeFileSync(next,changed+'; edited');
  assert.match(cli(gate,2).diagnostic.message,/stale/);
  for (const defect of [
    changed.replace('ensures (= result x)','ensures true'),
    changed.replace('project ((x bool)) bool (reads)','project ((x bool)) bool (reads billing)'),
    changed.replace('ensures (= result x)','ensures false')
  ]) {
    writeFileSync(next, defect);
    authorize(['project']);
    assert.equal(cli(gate,1).decision,'blocked');
  }
});
