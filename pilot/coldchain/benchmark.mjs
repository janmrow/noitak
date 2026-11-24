// Acceptance inputs, expected results and change descriptions belong to the reviewer.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const out = resolve(process.argv[2] ?? 'build/coldchain');
mkdirSync(resolve(out, '..'), {recursive:true});
mkdirSync(out);
const pilot = 'pilot/coldchain';
const read = path => readFileSync(path, 'utf8');
const source = read(join(pilot,'shipment.noi'));
const reference = read(join(pilot,'reference.mts'));
const vectors = JSON.parse(read(join(pilot,'vectors.json')));
const baseline = join(pilot,'shipment.noi');
const threshold = '(<= 2 (length warnings))';
const tsThreshold = 'excursions.length >= 2';
function edit(input, from, to) {
  assert.equal(input.split(from).length, 2, from);
  return input.replace(from,to);
}
function writeRevision(dir, contents) {
  mkdirSync(dir);
  const path = join(dir,'shipment.noi');
  writeFileSync(path,contents);
  copyFileSync(join(pilot,'limits.noi'),join(dir,'limits.noi'));
  return path;
}
function run(args) {
  const start = performance.now();
  const result = spawnSync(process.execPath,args,{encoding:'utf8',timeout:120000});
  if (result.error || result.signal) throw result.error ?? Error(result.signal);
  return {exit:result.status, stdout:result.stdout, stderr:result.stderr, ms:Math.round(performance.now()-start)};
}
function cli(args) {
  const r = run(['noitak.mjs', ...args, '--engine', 'auto','--json']);
  return {report:JSON.parse(r.stdout), ms:r.ms, exit:r.exit};
}
const verification = cli(['verify',baseline]);
assert.equal(verification.exit,0,JSON.stringify(verification.report));
const control = cli(['build',baseline,join(out,'verified'),'--vectors',join(pilot,'vectors.json')]);
assert.equal(control.exit,0,JSON.stringify(control.report));
const first = {name:'quarantine-on-first', valid:true, authorization:true, tsExpected:true,
  noi:[threshold,'(< 0 (length warnings))'], ts:[tsThreshold,'excursions.length > 0']};
const rare = {name:'omit-rare-reading', tsExpected:true,
  noi:['(get row calibrated)','(and (get row calibrated) (not (= t -137i32)))'],
  ts:['if (calibrated &&','if (calibrated && celsius !== -137 &&']};
const changes = [
  {name:'equivalent-threshold', valid:true, tsExpected:true,
    noi:[threshold,'(< 1 (length warnings))'], ts:[tsThreshold,'excursions.length > 1']},
  first,
  {name:'off-by-one', tsExpected:false, noi:[threshold,'(< 2 (length warnings))'], ts:[tsThreshold,'excursions.length > 2']},
  {name:'ignore-calibration', tsExpected:false, noi:['(get row calibrated)','true'],ts:['if (calibrated &&','if (true &&']},
  {name:'private-note-disclosure', tsExpected:false, noi:[threshold,'(or '+threshold+' (and private_note (< 0 (length warnings))))'],
    ts:[tsThreshold,tsThreshold+' || (privateNote && excursions.length > 0)']},
  rare,
  {...first, name:'quarantine-on-first-and-omit-rare-reading', valid:false, additional:rare},
  {name:'weaken-postcondition',noi:['(<= (length (get result excursions)) (length rows))','true']},
  {name:'require-new-authority',noi:['(reads) (independent','(reads calibration_admin) (independent']},
  {name:'stale-dependency-pin',noi:[source.match(/\(import limits (\w+)\)/)[1],'0'.repeat(64)]}
];
function candidateSource(input, task, language) {
  const changed = edit(input,...task[language]);
  return task.additional ? edit(changed,...task.additional[language]) : changed;
}
// The reviewer-owned reference keeps the baseline selector and derives the
// new flag solely from whether that selector emitted at least one excursion.
const approvalReference = writeRevision(join(out,'approved-reference'),edit(source,...first.noi));
const holdout = [{celsius:-137,calibrated:true}];
const missedHoldout = {ok:true,value:{excursions:[],quarantine:false}};
const malformed = {ok:false,code:'ARGUMENT',phase:'boundary'};
const acceptanceCases = firstExcursion => vectors.flatMap(row => [false,true].map(note => {
  const expected = structuredClone(row.expected);
  if (firstExcursion) expected.value.quarantine = expected.value.excursions.length > 0;
  return {...row,args:[row.args[0],note],expected};
}));
const approvedVectors = join(out,'approved-vectors.json');
writeFileSync(approvedVectors,JSON.stringify(acceptanceCases(true),null,2)+'\n');
function acceptance(assess, firstExcursion) {
  for (const {flags,args,expected} of acceptanceCases(firstExcursion))
    assert.deepEqual(assess(flags,...args),expected);
  for (const bad of [new Array(1), Array(4).fill({celsius:3,calibrated:true}),
    [{celsius:2147483648,calibrated:true}], [Object.create({celsius:4,calibrated:true})],
    [Object.defineProperty({calibrated:true},'celsius',{get(){throw Error('getter');}})]])
    assert.deepEqual(assess({},bad,false),malformed);
}
function passesAcceptance(assess, firstExcursion) {
  try { acceptance(assess, firstExcursion); return true; }
  catch (e) { if (e.code !== 'ERR_ASSERTION') throw e; return false; }
}
const tsFiles = [];
for (const task of [{name:'control'}, ...changes.filter(t=>t.ts)]) {
  const path = join(out,task.name+'.mts');
  writeFileSync(path,task.ts ? candidateSource(reference,task,'ts') : reference);
  tsFiles.push(path);
}
copyFileSync(join(pilot,'service.mts'),join(out,'service.mts'));
const strict = run(['node_modules/typescript/bin/tsc','--strict','--module','nodenext',join(out,'service.mts'),...tsFiles]);
assert.equal(strict.exit,0,strict.stdout+strict.stderr);
const load = path => import(pathToFileURL(path));
const {assess} = await load(join(out,'control.mjs'));
const {receiveShipment} = await load(join(out,'service.mjs'));
acceptance(assess,false);
acceptance((flags,rows,note)=>receiveShipment(rows,note),false);
const metrics = {node:process.version, verifyMs:verification.ms, buildMs:control.ms, artifact:control.report.artifactValidation,
  strictCompileMs:strict.ms, tasks:[]};
for (const task of changes) {
  const dir = join(out,task.name);
  const path = writeRevision(dir,candidateSource(source,task,'noi'));
  const destination = join(dir,'verified');
  let args = ['gate',baseline,path,destination];
  let approvalReferenceDecision, wholeFunctionAuthorization, scopeDemonstrationAccepted;
  if (task.authorization) {
    const {report,exit} = cli(['diff',baseline,path]);
    assert.equal(exit,1);
    assert.equal(report.decision,'blocked');
    const againstReference = cli(['diff',approvalReference,path]);
    approvalReferenceDecision = againstReference.report.decision;
    writeFileSync(join(dir,'approval-reference.json'),JSON.stringify(againstReference.report,null,2)+'\n');
    assert.equal(againstReference.exit,task.additional ? 1 : 0,JSON.stringify(againstReference.report));
    const file = join(dir,task.additional ? 'experimental-approval.json' : 'reviewer-approval.json');
    writeFileSync(file, JSON.stringify({schema:1,scopeSha256:report.authorizationScopeSha256,allowBehavior:['assess']}));
    const approval = ['--authorization',file];
    if (task.additional) {
      const experimental = join(dir,'scope-demonstration');
      const broad = cli(['gate',baseline,path,experimental,...approval]);
      assert.equal(broad.exit,0,JSON.stringify(broad.report));
      wholeFunctionAuthorization = broad.report.decision;
      assert.equal(wholeFunctionAuthorization,'authorized-evolution');
      const shipped = (await load(join(experimental,'module.mjs'))).api.assess;
      scopeDemonstrationAccepted = passesAcceptance(shipped,true);
      for (const note of [false,true]) assert.deepEqual(shipped({},holdout,note),missedHoldout);
      args = ['gate',approvalReference,path,destination];
    } else {
      args.push(...approval,'--vectors',approvedVectors);
    }
  }
  const {report,exit,ms} = cli(args);
  writeFileSync(join(dir,'decision.json'),JSON.stringify(report,null,2)+'\n');
  assert.ok(exit === 0 || exit === 1,JSON.stringify(report));
  const accepted = exit === 0;
  const mustFind = (field,status) => assert.ok(report.changes?.some(c=>c.field===field && c.status===status),task.name);
  switch (task.name) {
    case 'equivalent-threshold': mustFind('body','compatible'); break;
    case 'quarantine-on-first':
      assert.equal(report.decision,'authorized-evolution');
      // The intentional difference stays visible in the authorization receipt.
    case 'off-by-one':
    case 'ignore-calibration':
    case 'omit-rare-reading': mustFind('body','risky'); break;
    case 'quarantine-on-first-and-omit-rare-reading': {
      assert.equal(report.decision,'blocked');
      assert.equal(existsSync(destination),false);
      const {witness} = report.changes.find(c=>c.subject==='assess' && c.field==='body' && c.status==='risky');
      assert.ok(witness.args[0].some(({celsius,calibrated})=>celsius===-137 && calibrated));
      break;
    }
    case 'private-note-disclosure':
      assert.ok(report.after.checks.some(c=>c.property==='observable-independence' && c.status==='violated'));
      break;
    case 'weaken-postcondition': mustFind('ensures','risky'); break;
    case 'require-new-authority': mustFind('reads','policy-violation'); break;
    case 'stale-dependency-pin': assert.equal(report.diagnostic.code,'E_IMPORT'); break;
  }
  if (accepted) acceptance((await load(join(dir,'verified/module.mjs'))).api.assess,task.authorization);
  let tsAccepted, tsTestMs;
  if (task.ts) {
    const candidate = await load(join(out,task.name+'.mjs'));
    const start = performance.now();
    tsAccepted = passesAcceptance(candidate.assess,task.authorization);
    tsTestMs = +(performance.now()-start).toFixed(3);
    if (task === rare || task.additional) {
      assert.deepEqual(assess({},holdout,false),{ok:true,value:{excursions:[-137],quarantine:false}});
      assert.deepEqual(candidate.assess({},holdout,false),missedHoldout);
    }
  }
  metrics.tasks.push({name:task.name, valid:!!task.valid, noitakAccepted:accepted, tsAccepted, tsExpected:task.tsExpected,
    approvalReferenceDecision, wholeFunctionAuthorization, scopeDemonstrationAccepted, gateMs:ms, tsTestMs,
    diagnostic:report.diagnostic?.code ?? report.changes.filter(c=>c.status!=='compatible').map(c=>[c.field,c.status]),
    reusedFunctions:report.after?.verificationSession.reusedFunctions,
    open:report.after?.checks.filter(c=>c.status==='unverified').length});
}
function latency(call) {
  const rows = vectors[2].args[0];
  let observed = 0;
  function sample() {
    const start = performance.now();
    for (let i=0;i<10000;i++) observed += call(rows).value.excursions.length;
    return (performance.now()-start)/10;
  }
  sample();
  const samples = Array.from({length:5},sample).sort((a,b)=>a-b);
  assert.equal(observed,120000);
  return +samples[2].toFixed(3);
}
metrics.microseconds = {generated:latency(rows=>receiveShipment(rows,false)),typescript:latency(rows=>assess({},rows,false))};
writeFileSync(join(out,'comparison.json'),JSON.stringify(metrics,null,2)+'\n');
console.log(JSON.stringify(metrics,null,2));
for (const task of metrics.tasks) {
  assert.equal(task.noitakAccepted,task.valid,`${task.name}: Noitak gate disposition changed`);
  if (task.tsExpected !== undefined)
    assert.equal(task.tsAccepted,task.tsExpected,`${task.name}: TypeScript acceptance disposition changed`);
  if (task.wholeFunctionAuthorization)
    assert.equal(task.scopeDemonstrationAccepted,true,`${task.name}: whole-function authorization acceptance disposition changed`);
}
