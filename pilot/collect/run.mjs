import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkArtifact} from '../../src/artifact-check.mjs';
import {emitModule} from '../../src/emitter.mjs';
import {load} from '../../src/loader.mjs';

const out = resolve(process.argv[2] ?? 'build/collect');
mkdirSync(resolve(out,'..'),{recursive:true});
mkdirSync(out);
const read = path => readFileSync(path,'utf8');
const baseline = 'pilot/events/collect.noi';
const vectorFile = 'pilot/collect/vectors.json';
const vectors = JSON.parse(read(vectorFile));
const main = vectors[0].args[0][0];
const urgent = vectors[0].args[0][3];

function cli(args, status = 0, engine = 'auto') {
  const options = ['check','test'].includes(args[0]) ? [] : ['--engine',engine];
  const run = spawnSync(process.execPath,['noitak.mjs', ...args, ...options, '--json'],{encoding:'utf8'});
  assert.equal(run.status,status,run.error?.message ?? run.stdout+run.stderr);
  return JSON.parse(run.stdout);
}

function measure(fn) {
  const start = performance.now();
  const value = fn();
  return {value, ms:Math.round(performance.now()-start)};
}

const metrics = {node:process.version, workloads:[], changes:[]};
async function metric(source, capacity, destination, engine, vectorPath) {
  const verification = measure(()=>cli(['verify',source],0,engine));
  const build = measure(()=>cli(['build',source,destination,...(vectorPath ? ['--vectors',vectorPath] : [])],0,engine));
  const proof = verification.value.checks.find(c=>c.function==='select_job' && c.property==='admissible-and-safe');
  const {unit} = await load(source);
  const entry = unit.localFunctions.find(f=>f.collector);
  const stats = {capacity, work:entry.budget.work, verifyMs:verification.ms, buildMs:build.ms,
    selectorMethod:proof.method, selectorStatus:proof.status, selectorQueries:Number(Boolean(proof.safety))+Number(Boolean(proof.admission)),
    selectorCrosscheck:proof.crosscheck, artifact:build.value.artifactValidation.checks[0]};
  metrics.workloads.push(stats);
  return stats;
}

const light = read('pilot/collect/lightweight.noi');
const verified = join(out,'verified');
const webhook = await metric(baseline,32,verified,'auto',vectorFile);
cli(['test',baseline,vectorFile]);
for (const name of ['service','reference']) copyFileSync('pilot/collect/'+name+'.mts',join(out,name+'.mts'));
const strict = measure(()=>spawnSync(process.execPath,[
  'node_modules/typescript/bin/tsc','--strict','--module','nodenext',join(out,'service.mts'),join(out,'reference.mts')
],{encoding:'utf8'}));
assert.equal(strict.value.status,0,strict.value.stdout+strict.value.stderr);
metrics.strictTypeScriptMs = strict.ms;
const loadOutput = path => import(pathToFileURL(path));
const {collect} = await loadOutput(join(out,'service.mjs'));
const {queuedJobs, lightweight} = await loadOutput(join(out,'reference.mjs'));

const trapped = Object.defineProperty({},'repository',{get() {throw new Error('Accessor invoked');}});
const malformed = {ok:false,code:'ARGUMENT',phase:'boundary'};
const bounded = {...urgent,labels:[...Array(127).fill('ordinary'),'ci:urgent']};
const maxBatch = Array(32).fill(bounded);
const job = vectors[5].expected.value[0];
const cases = [
  ...vectors.map(v=>[v.args[0],v.expected]),
  [maxBatch,{ok:true,value:Array(32).fill(job)}],
  [[...maxBatch,main],malformed],
  [[main,{...urgent,labels:[...bounded.labels,'extra']}],malformed],
  [[main,,urgent],malformed],
  [[main,Object.create(urgent)],malformed],
  [[main,trapped],malformed],
  [[main,main],vectors[2].expected]
];
for (const [batch,expected] of cases) {
  assert.deepEqual(queuedJobs(batch),expected);
  assert.deepEqual(collect(batch),expected);
}
const repeated = collect([main,main]).value;
repeated[0].branch = 'mutated';
assert.equal(repeated[1].branch,'main');
assert.equal(main.change.value.ref.value,'refs/heads/main');
metrics.webhookCases = cases.length;

function microseconds(call, rounds) {
  let sink = 0;
  function trial() {
    for (let i=0;i<rounds;i++) sink += call(i).value.length;
  }
  trial();
  const observations = Array.from({length:5},()=>{
    const start = performance.now();
    trial();
    return (performance.now()-start)*1000/rounds;
  }).sort((a,b)=>a-b);
  assert.ok(sink > 0);
  return +observations[2].toFixed(3);
}

const webhookInputs = [[], [main], vectors[0].args[0], maxBatch];
webhook.generatedUs = microseconds(i=>collect(webhookInputs[i%4]),2000);
webhook.typeScriptUs = microseconds(i=>queuedJobs(webhookInputs[i%4]),2000);

for (const capacity of [4,8,9,32,128,255]) {
  const file = join(out,'light-'+capacity+'.noi');
  writeFileSync(file,light.replaceAll('row 4)','row '+capacity+')'));
  const destination = join(out,'light-'+capacity);
  const stats = await metric(file,capacity,destination,'symbolic');
  const {api} = await loadOutput(join(destination,'module.mjs'));
  const full = Array.from({length:capacity},(_,i)=>({tag:i%2 ? 'skip_me' : 'emit_me'}));
  const cases = [[{include:false},[]],[{include:true},full.slice(0,1)],[{include:false},full],[{include:true},full]];
  const reference = (flags,batch)=>lightweight(flags,batch,capacity);
  for (const args of cases) assert.deepEqual(api.queued_jobs(...args),reference(...args));
  stats.generatedUs = microseconds(i=>api.queued_jobs(...cases[i%4]),10000);
  stats.typeScriptUs = microseconds(i=>reference(...cases[i%4]),10000);
}

const src = read(baseline);
copyFileSync('pilot/events/events.noi',join(out,'events.noi'));
const emit = '(tag selection emit job)';
const branch = '(get job branch)';
const projected = name => '(tag selection emit (make events.job (repository '+name+
  ') (branch "replaced") (urgent (get job urgent))))';
const changes = [
  ['equivalent',src.replace(emit,'(if (= '+branch+' "") (tag selection skip) '+emit+')'),
    'selector-contribution','compatible'],
  ['drop-urgent',src.replace(emit,'(if (get job urgent) (tag selection skip) '+emit+')'),
    'selector-contribution','risky'],
  ['change-branch',src.replace(emit,projected('(get job repository)')),'selector-contribution','risky'],
  ['wrong-repository',src.replace(emit,projected('"other"')),'required-proof','policy-violation'],
  ['more-output',src.replace('jobs events.job 32','jobs events.job 33'),'collector-capacities','policy-violation'],
  ['more-authority',src.replace('  (helper select_job','  (helper policy ((x bool)) bool (reads priority)\n'+
    '    (requires true) (ensures true) (or (flag priority) x))\n  (helper select_job')
    .replaceAll('    (reads)','    (reads priority)')
    .replace(emit,'(if (call policy (get job urgent)) '+emit+' (tag selection skip))'),'reads','policy-violation']
];
for (const [name, candidate, field, status] of changes) {
  assert.notEqual(candidate,src);
  const file = join(out,name+'.noi'), destination = join(out,name+'-bundle');
  writeFileSync(file,candidate);
  const accepted = status === 'compatible';
  const gate = measure(()=>cli(['gate',baseline,file,destination,'--vectors',vectorFile],accepted ? 0 : 1));
  const finding = gate.value.changes.find(c=>c.subject==='queued_jobs' && c.field===field && c.status===status);
  assert.ok(finding,JSON.stringify(gate.value.changes));
  assert.equal(existsSync(destination),accepted);
  if (accepted) {
    const saved = JSON.parse(read(join(destination,'review.json')));
    const manifest = JSON.parse(read(join(destination,'report.json')));
    assert.deepEqual(saved.artifactValidation,gate.value.artifactValidation);
    assert.deepEqual(saved.artifactValidation,manifest.artifactValidation);
  }
  if (status === 'risky') {
    const {args,flags,before,after} = finding.witness;
    assert.equal(args[0].length,1);
    assert.deepEqual(collect(args[0]),before);
    assert.deepEqual(queuedJobs(args[0]),before);
    if (name === 'drop-urgent') {
      assert.equal(before.value[0].urgent,true);
      assert.deepEqual(after.value,[]);
    } else assert.equal(after.value[0].branch,'replaced');
    assert.deepEqual(flags,{});
  }
  if (name === 'wrong-repository') {
    assert.equal(finding.property,'admissible-and-safe');
    assert.equal(finding.counterexample.outcome.code,'POSTCONDITION');
  }
  writeFileSync(join(out,name+'-review.json'),JSON.stringify(gate.value,null,2)+'\n');
  metrics.changes.push({name,ms:gate.ms,field,status,witness:finding.witness ?? finding.counterexample});
}

const {unit} = await load(baseline);
const js = await emitModule(unit);
const mutant = js.replace('return {ok:true,value:output};','return {ok:true,value:output.reverse()};');
assert.notEqual(mutant,js);
await assert.rejects(checkArtifact(unit,mutant,30000,new Map(),vectors),error=>{
  const witness = error.detail;
  assert.equal(witness.origin,'application-vector');
  assert.equal(witness.expected.value.length,witness.actual.value.length);
  assert.notDeepEqual(witness.expected,witness.actual);
  metrics.backendMutation = witness;
  return true;
});
writeFileSync(join(out,'measurements.json'),JSON.stringify(metrics,null,2)+'\n');
console.log('Collector matched '+cases.length+' webhook cases, accepted the equivalent rewrite, and refused five changed candidates.');
console.log('Artifact validation caught reversed emissions with equal output length.');
console.table(metrics.workloads.map(({capacity,work,verifyMs,buildMs,selectorMethod,selectorQueries,generatedUs,typeScriptUs})=>
  ({capacity,work,verifyMs,buildMs,selectorMethod,selectorQueries,generatedUs,typeScriptUs})));
