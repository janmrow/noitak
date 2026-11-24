import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { compile } from '../../src/frontend.mjs';
import { compare } from '../../src/diff.mjs';
import { verify } from '../../src/verify.mjs';

function check(source, name) {
  return verify(compile(source),source,4096,'symbolic').checks.find(c =>
    c.function === name && c.property === 'admissible-and-safe');
}

test('ordered append model handles both sequence encodings and replays full-capacity faults', () => {
  for (const cap of [3,9]) {
    const source = `(module m 1.0.0 (sequence bits bool ${cap})
      (fn add ((xs bits) (x bool)) bits (reads) (requires (< (length xs) ${cap}))
        (ensures (and (= (length result) (+ (length xs) 1)) (member result x))) (append xs x)))`;
    const proof = check(source, 'add');
    assert.equal(proof.status,'proven',JSON.stringify(proof));
    const broken = check(source.replace('(< (length xs) '+cap+')','true'), 'add');
    assert.equal(broken.status,'violated',JSON.stringify(broken));
    assert.equal(broken.counterexample.outcome.code,'CAPACITY');
  }
});

test('signed comparison and checked arithmetic produce signed counterexamples', () => {
  const source = `(module m 1.0.0 (fn neg ((x i32)) i32 (reads)
    (requires (< -2147483648i32 x)) (ensures (or (<= 0i32 x) (< 0i32 result))) (- 0i32 x)))`;
  assert.equal(check(source,'neg').status,'proven');
  const overflow = check(source.replace('(< -2147483648i32 x)','true'),'neg');
  assert.equal(overflow.counterexample.args[0],-2147483648);
  assert.equal(overflow.counterexample.outcome.code,'ARITHMETIC');
});

test('a wide length never wraps at 256 in a proof', () => {
  const source = `(module m 1.0.0 (sequence xs bool 300 u32)
    (fn size ((s xs)) u32 (reads) (requires true) (ensures (<= result 300u32)) (length s)))`;
  assert.equal(check(source,'size').status,'proven');
  // A literal provides a deterministic >255 witness without forcing the solver
  // to synthesize a long array model under a short timeout.
  const long = '(items xs ' + Array(256).fill('true').join(' ') + ')';
  const bad = source.replace('((s xs))','()').replace('300u32','255u32').replace('(length s)','(length '+long+')');
  assert.equal(check(bad,'size').status,'violated');
});

test('public build validates a length-only artifact at the maximum i32 sequence capacity', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'noitak-wide-build-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const input = join(dir, 'input.noi'), out = join(dir, 'artifact');
  await writeFile(input, `(module m 1.0.0 (sequence xs i32 16383 u32)
    (fn size ((s xs)) u32 (reads) (requires true) (ensures true) (length s)))`);
  const run = spawnSync(process.execPath, ['noitak.mjs', 'build', input, out, '--engine', 'auto', '--json'],
    {encoding:'utf8'});
  assert.equal(run.status, 0, run.error?.message ?? run.stderr + run.stdout.slice(-1000));
  const [evidence] = JSON.parse(run.stdout).artifactValidation.checks;
  assert.equal(evidence.domainPositions, 0);
  assert.equal(evidence.typedSamples, 16);
  assert.equal(evidence.admissionWitness, true);
  const {api} = await import(pathToFileURL(join(out, 'module.mjs')));
  for (const length of [0, 1, 255, 256, 16382, 16383]) {
    const rows = Array.from({length}, (_, i) => i % 2 ? 2147483647 : -2147483648);
    assert.deepEqual(api.size({}, rows), {ok:true, value:length});
  }
  assert.deepEqual(api.size({}, Array(16384).fill(0)), {ok:false, code:'ARGUMENT', phase:'boundary'});
});

test('composed shipment proves its guarantees at 32 and builds at 64 rows', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'noitak-shipment-induction-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const input = join(dir, 'shipment.noi'), out = join(dir, 'artifact');
  const source = await readFile('pilot/coldchain/shipment.noi', 'utf8');
  await copyFile('pilot/coldchain/limits.noi', join(dir, 'limits.noi'));
  for (const [capacity, engine, command] of [[32,'symbolic','verify'], [64,'auto','build']]) {
    await writeFile(input, source.replace('(sequence samples sample 3)', `(sequence samples sample ${capacity})`)
      .replace('(sequence temperatures i32 3)', `(sequence temperatures i32 ${capacity})`));
    const args = command === 'build' ? [input,out] : [input];
    const run = spawnSync(process.execPath, ['noitak.mjs', command, ...args, '--engine', engine, '--json'], {encoding:'utf8'});
    assert.equal(run.status, 0, run.error?.message ?? run.stderr + run.stdout);
    const report = JSON.parse(run.stdout);
    const selector = report.checks.find(c => c.function === 'select');
    const assessment = report.checks.filter(c => c.function === 'assess');
    assert.ok(report.passed && report.checks.every(c => c.status === 'proven'));
    assert.equal(selector.method, 'sequence-length-induction');
    assert.deepEqual(selector.induction, {initialization:'unsat',preservation:'unsat',exit:'unsat'});
    assert.equal(assessment[0].method, 'callee-contracts');
    assert.deepEqual(assessment[0].premises, ['select']);
    assert.equal(assessment[1].method, 'parameter-nonoccurrence');
    if (command === 'build') assert.equal(report.artifactValidation.status, 'tested');
  }
  const {api} = await import(pathToFileURL(join(out, 'module.mjs')));
  const readings = [2,9,-137,8,-2147483648,9];
  const rows = Array.from({length:65}, (_, i) => ({celsius:readings[i % readings.length],calibrated:i % 5 !== 0}));
  for (const length of [0,1,17,32,63,64]) {
    const input = rows.slice(0,length);
    const excursions = input.filter(row => row.calibrated && (row.celsius < 2 || row.celsius > 8)).map(row => row.celsius);
    for (const note of [false,true])
      assert.deepEqual(api.assess({},input,note), {ok:true,value:{excursions,quarantine:excursions.length >= 2}});
  }
  assert.deepEqual(api.assess({},rows,false), {ok:false,code:'ARGUMENT',phase:'boundary'});
});

test('fold induction rejects failed premises and body comparison still checks sequence contents', () => {
  const source = `(module m 1.0.0 (sequence xs bool 9)
    (fn pick ((rows xs)) xs (reads) (requires true) (ensures (<= (length result) (length rows)))
      (fold rows (items xs) (out x i) (if x (append out x) out))))`;
  const good = check(source, 'pick');
  assert.equal(good.method, 'sequence-length-induction');
  for (const bad of [
    source.replace('(items xs)', '(items xs false)'),
    source.replace('(if x (append out x) out)', '(if (= i 0) (append (append out x) x) out)'),
    source.replace('(<= (length result)', '(= (length result)')
  ]) {
    const failed = check(bad, 'pick');
    assert.equal(failed.status, 'violated', JSON.stringify(failed));
    assert.equal(failed.counterexample.outcome.code, 'POSTCONDITION');
  }
  const edited = source.replace('(append out x)', '(append out false)');
  const old = compile(source), next = compile(edited);
  const report = compare(old, next, verify(old,source,4096,'symbolic'), verify(next,edited,4096,'symbolic'));
  const [body] = report.changes;
  assert.equal(report.passed, false);
  assert.equal(body.field, 'body');
  assert.equal(body.status, 'risky');
  assert.ok(body.witness.before.value.includes(true));
  assert.ok(body.witness.after.value.every(value => value === false));
});

test('named reduction checks its invariant even on the empty sequence', () => {
  const source = `(module m 1.0.0 (sequence bits bool 3)
    (reducer keep ((s bool) (x bool)) bool (reads) (capacity 3)
      (invariant s) (ensures result) s)
    (fn all ((s bool) (xs bits)) bool (reads) (requires s) (ensures result) (reduce keep s xs)))`;
  assert.equal(check(source,'all').status,'proven');
  const bad = check(source.replace('(requires s)','(requires (= xs (items bits)))'),'all');
  assert.deepEqual(bad.counterexample.args,[false,[]]);
  assert.equal(bad.counterexample.outcome.code,'CALL_PRECONDITION');
});
