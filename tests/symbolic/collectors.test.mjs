import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {compile} from '../../src/frontend.mjs';
import {load} from '../../src/loader.mjs';
import {invoke} from '../../src/runtime.mjs';
import {hash, verify} from '../../src/verify.mjs';

const light = await readFile(new URL('../../pilot/collect/lightweight.noi',import.meta.url),'utf8');
const collector = unit => unit.localFunctions.find(f=>f.collector);

function cli(args,status) {
  const run = spawnSync(process.execPath,['noitak.mjs',...args,'--engine','symbolic','--json'],{encoding:'utf8'});
  assert.equal(run.status,status,run.error?.message ?? run.stdout+run.stderr);
  return JSON.parse(run.stdout);
}

test('symbolic collector proof cross-checks the row and keeps open row obligations blocking', () => {
  const checked = compile(light);
  const report = verify(checked,light,4096,'symbolic');
  assert.ok(report.passed);
  const row = report.checks.find(c=>c.function==='select_job');
  assert.equal(row.safety,'unsat');
  assert.equal(row.admission,'sat');
  assert.deepEqual(row.crosscheck,{method:'enumerate',status:'proven',examined:4,equalOutcomes:undefined});
  const open = verify(checked,light,1);
  assert.equal(open.passed,false);
  assert.ok(open.checks.filter(c=>c.method==='induction-on-length').every(c=>c.status==='unverified'));

  const edited = light.replace('(tag selection emit item)','(tag selection emit (tag row skip_me))');
  const unit = compile(edited);
  const failed = verify(unit,edited,4096,'symbolic');
  const proof = failed.checks.find(c=>c.function==='select_job');
  assert.equal(proof.status,'violated');
  assert.equal(proof.crosscheck.status,'violated');
  const failure = failed.checks.find(c=>c.function==='queued_jobs' && c.counterexample).counterexample;
  assert.deepEqual(invoke(collector(unit),failure.flags,failure.args),failure.outcome);
  assert.equal(failure.outcome.code,'POSTCONDITION');
});

test('gate follows pinned selectors, detects guarantee weakening, and compares positional row bindings', async t => {
  const dir = await mkdtemp(join(tmpdir(),'noitak-collect-pin-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const library = light.replace('module lightweight','module lib').replace('(helper select_job','(fn select_job')
    .split('\n  (collect')[0]+')';
  async function revision(name,body) {
    const base = join(dir,name);
    await mkdir(base);
    await writeFile(join(base,'lib.noi'),body);
    const source = join(base,'root.noi');
    await writeFile(source,`(module root 1.0.0 (import lib ${hash(body)})
      (collect run lib.rows lib.jobs (reads include) (using lib.select_job)))`);
    return source;
  }
  const baseline = await revision('before',library);
  // Imported ordinary functions retain their current interface policy. Test a
  // row binding rename on a local helper, where its name is private.
  const local = join(dir,'local.noi'), renamed = join(dir,'renamed.noi');
  await writeFile(local,light);
  await writeFile(renamed,light.replaceAll(/\bitem\b/g,'row_value'));
  const equivalent = cli(['gate',local,renamed,join(dir,'equal')],0);
  assert.ok(equivalent.changes.some(c=>c.field==='selector-contribution' && c.status==='compatible'));
  assert.ok(equivalent.changes.some(c=>c.field==='selector-guarantee' && c.status==='compatible'));

  const weaker = await revision('weaker',library.replace('(ensures (match result (skip true) (emit job (= job item))))','(ensures true)'));
  const refused = cli(['gate',baseline,weaker,join(dir,'weak-bundle')],1);
  assert.ok(refused.changes.some(c=>c.subject==='run' && c.field==='selector-guarantee' &&
    c.status==='risky' && c.witnessKind==='hypothetical-selector-result'));
  assert.equal(existsSync(join(dir,'weak-bundle')),false);

  const after = await revision('after',library.replace('(or (flag include) (= item (tag row emit_me)))','(flag include)'));
  const destination = join(dir,'changed');
  const report = cli(['gate',baseline,after,destination],1);
  assert.equal(existsSync(destination),false);
  assert.ok(report.changes.some(c=>c.subject==='lib' && c.field==='dependency-pin'));
  const finding = report.changes.find(c=>c.subject==='run' && c.field==='selector-contribution');
  assert.equal(finding.status,'risky');
  assert.equal(finding.witnessKind,'observed-one-row-batch');
  const {args,flags,before,after:result} = finding.witness;
  assert.deepEqual(args,[[{tag:'emit_me'}]]);
  assert.deepEqual(invoke(collector((await load(baseline)).unit),flags,args),before);
  assert.deepEqual(invoke(collector((await load(after)).unit),flags,args),result);
  assert.deepEqual(before,{ok:true,value:[{tag:'emit_me'}]});
  assert.deepEqual(result,{ok:true,value:[]});
});
