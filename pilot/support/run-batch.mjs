import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here,'../..');
const output = resolve(process.argv[2] ?? 'build/batch');
mkdirSync(dirname(output),{recursive:true});
mkdirSync(output);
const baseline = join(here,'batch.noi');
const original = readFileSync(baseline,'utf8');
const library = readFileSync(join(here,'support.noi'),'utf8');
const sha = data => createHash('sha256').update(data).digest('hex');
function run(args, status = 0) {
  const p = spawnSync(process.execPath,args,{cwd:root, encoding:'utf8', maxBuffer:8*1024*1024});
  assert.equal(p.status,status,p.error?.message ?? p.stdout + p.stderr);
  return p.stdout;
}
function edit(text, before, after) {
  assert.equal(text.split(before).length,2,'Expected unique edit: ' + before);
  return text.replace(before,after);
}
function gate(label, app, dep, accept = false) {
  const dir = join(output,label);
  mkdirSync(dir);
  writeFileSync(join(dir,'support.noi'),dep);
  writeFileSync(join(dir,'batch.noi'),edit(app,sha(library),sha(dep)));
  const dest = accept ? join(output,'approved') : join(dir,'artifact');
  const review = JSON.parse(run(['noitak.mjs','gate',baseline,join(dir,'batch.noi'),dest,'--engine','symbolic','--json'],accept ? 0 : 1));
  assert.equal(review.passed,accept);
  assert.equal(existsSync(dest),accept);
  assert.equal(review.after.dependencies.support,sha(dep));
  writeFileSync(join(dir,'review.json'),JSON.stringify(review,null,2)+'\n');
  console.log(label, accept ? 'accepted' : 'refused');
  return review;
}

const rewrite = edit(library,'(+ revision 1)','(+ 1 revision)');
const approved = gate('imported-rewrite',original,rewrite,true);
for (const subject of ['support.transition','apply_batch'])
  assert.ok(approved.changes.some(c => c.subject === subject && c.field === 'body' && c.solverAnswer === 'unsat'));
assert.deepEqual(approved.after.calls.apply_batch,['support.transition']);
const manifest = JSON.parse(readFileSync(join(output,'approved/report.json')));
for (const [file,digest] of Object.entries(manifest.artifacts))
  assert.equal(sha(readFileSync(join(output,'approved',file))),digest);

const attempt = '(attempt decision index support.transition ticket action)';
const reorder = edit(original,attempt,`(attempt decision index support.transition ticket
  (fold events action (picked other j) (if (= j (- (- (length events) 1) index)) other picked)))`);
const partial = edit(original,attempt,`(match ${attempt}
  (committed next (tag decision committed next)) (rejected failed (tag decision committed ticket)))`);
for (const [label,app] of [['reverse-events',reorder],['partial-commit',partial]]) {
  const r = gate(label,app,library);
  assert.ok(r.after.checks.some(c => c.function === 'apply_batch' && c.counterexample?.outcome.code === 'POSTCONDITION'));
}

const relaxed = original.slice(0,original.indexOf('    (ensures')) + '    (ensures true)\n' +
  original.slice(original.indexOf('    (fold events (tag decision committed prior) (acc action index)'));
const leak = gate('private-index',edit(relaxed,attempt,'(attempt decision (if (get staff escalated) 0 index) support.transition ticket action)'),library);
assert.ok(leak.after.checks.some(c => c.function==='apply_batch' && c.property==='observable-independence' && c.counterexample));
const loss = gate('remove-independence',edit(original,' (independent staff)',''),library);
assert.ok(loss.changes.some(c => c.field==='independent' && c.status==='policy-violation'));
const delegated = edit(edit(library,'(helper bump ((revision byte)) byte (reads)','(helper bump ((revision byte)) byte (reads audit)'),
  '(action event)) ticket (reads)','(action event)) ticket (reads audit)');
const authority = gate('delegate-audit',edit(original,'(reads) (independent','(reads audit) (independent'),delegated);
assert.ok(authority.changes.some(c => c.subject==='support.bump' && c.field==='helper-reads' && c.status==='policy-violation'));

const finite = JSON.parse(run(['noitak.mjs','verify',baseline,'--limit','261120','--json']));
for (const c of finite.checks.filter(c => c.function==='apply_batch')) assert.equal(c.examined,261120);
writeFileSync(join(output,'enumeration.json'),JSON.stringify(finite,null,2)+'\n');
const limited = JSON.parse(run(['noitak.mjs','build',baseline,join(output,'limited'),'--limit','4096','--json'],1));
assert.equal(limited.checks.find(c=>c.function==='apply_batch').reason,'case-budget');
assert.equal(existsSync(join(output,'limited')),false);

copyFileSync(join(here,'batch-service.mts'),join(output,'batch-service.mts'));
run(['node_modules/typescript/bin/tsc','--strict','--module','nodenext',join(output,'batch-service.mts')]);
const host = JSON.parse(run([join(output,'batch-service.mjs')]));
assert.deepEqual(host,{denied:{status:'rejected',index:2},afterRejection:{stage:{tag:'waiting'},revision:253},
  accepted:{status:'updated',revision:255},tooLong:{status:'invalid'},final:{stage:{tag:'closed'},revision:255}});

// Independent sequential specification against the gated ESM.
const {api} = await import(pathToFileURL(join(output,'approved/module.mjs')));
const stages = {customer_reply:'open',agent_reply:'waiting',resolve:'closed',staff_note:null};
let batches = [[]];
for (let n=1;n<=3;n++)
  batches.push(...batches.filter(xs=>xs.length===n-1).flatMap(xs=>Object.keys(stages).map(tag=>[...xs,{tag}])));
let checked = 0;
for (const tag of ['open','waiting','closed']) for (let revision=0; revision<=255; revision++) {
  const prior = {stage:{tag},revision};
  for (const events of batches) {
    let ticket = prior, failure = -1;
    for (const [i,event] of events.entries()) {
      const stage = stages[event.tag];
      if (!stage) continue;
      if (ticket.revision===255) { failure=i; break; }
      ticket = {stage:{tag:stage},revision:ticket.revision+1};
    }
    const value = failure<0 ? {tag:'committed',value:ticket} : {tag:'rejected',value:failure};
    for (const covered of [false,true]) for (const escalated of [false,true]) {
      assert.deepEqual(api.apply_batch({},prior,events,{covered,escalated}),{ok:true,value});
      checked++;
    }
  }
}
assert.equal(checked,261120);
console.log(checked,'emitted batch outcomes match the independent specification');
