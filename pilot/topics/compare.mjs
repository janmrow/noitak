// Exercise both components through the public CLI, then compare two checked host
// implementations of the same topic policy, including deliberately edited copies.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const out = resolve(process.argv[2] ?? 'build/components');
mkdirSync(resolve(out,'..'), {recursive:true});
mkdirSync(out);
const read = file => readFileSync(file,'utf8');
const cli = (args, expected = 0) => {
  const p = spawnSync(process.execPath,['noitak.mjs',...args,'--engine','auto','--json'],{encoding:'utf8'});
  assert.equal(p.status,expected,p.error?.message ?? p.stdout+p.stderr);
  return JSON.parse(p.stdout);
};
const measure = fn => {
  const start = performance.now();
  const value = fn();
  return {value, ms:Math.round(performance.now()-start)};
};
const metrics = {node:process.version, components:{}, mutations:[]};
for (const name of ['events','topics']) {
  const dir = join(out,name);
  mkdirSync(dir);
  const source = 'pilot/'+name+'/'+name+'.noi';
  const proof = measure(() => cli(['verify',source]));
  const built = measure(() => cli(['build',source,join(dir,'verified'),'--vectors','pilot/'+name+'/vectors.json']));
  assert.ok(proof.value.passed && built.value.artifactValidation.status === 'tested');
  metrics.components[name] = {verifyMs:proof.ms, buildIncludingProofMs:built.ms,
    checks:proof.value.checks.map(({property,method,status}) => ({property,method,status})),
    artifact:built.value.artifactValidation};
}

// Retain the membership contract and change only its implementation. A solver
// timeout in this cost experiment is an open obligation, recorded verbatim.
metrics.sequenceCosts = [];
const eventSource = read('pilot/events/events.noi');
const membership = '(member (get delivery labels) "ci:urgent")';
for (const capacity of [4,16,128]) for (const strategy of ['member','fold']) {
  let source = eventSource.replace('labels text 128','labels text '+capacity);
  if (strategy === 'fold') {
    const offset = source.lastIndexOf(membership);
    assert.ok(offset > source.indexOf(membership));
    source = source.slice(0,offset) + '(fold (get delivery labels) false (seen label index) (or seen (= label "ci:urgent")))' +
      source.slice(offset+membership.length);
  }
  const path = join(out,'events',strategy+'-'+capacity+'.noi');
  writeFileSync(path,source);
  const run = measure(() => spawnSync(process.execPath,['noitak.mjs','verify',path,'--engine','auto','--json'],{encoding:'utf8'}));
  assert.ok([0,1].includes(run.value.status),run.value.stderr);
  const report = JSON.parse(run.value.stdout);
  const check = report.checks.find(c=>c.function==='dispatch_push' && c.property==='admissible-and-safe');
  metrics.sequenceCosts.push({capacity,strategy,ms:run.ms,status:check.status,reason:check.reason});
}

const dir = join(out,'topics');
copyFileSync('pilot/topics/service.mts',join(dir,'service.mts'));
copyFileSync('pilot/topics/reference.mts',join(dir,'reference.mts'));
const compile = files => execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--strict','--module','nodenext',...files]);
metrics.tsCompileMs = measure(() => compile([join(dir,'service.mts'),join(dir,'reference.mts')])).ms;
const load = file => import(pathToFileURL(join(dir,file)));
const {api} = await load('verified/module.mjs');
const baseline = (await load('reference.mjs')).authorize;
const {mayRead} = await load('service.mjs');
const vectors = JSON.parse(read('pilot/topics/vectors.json'));
const cases = vectors.map(v => ({args:[v.flags,...v.args],expected:v.expected}));
const tenant = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const scopes = [{tag:'none'}, {tag:'exact',value:'ops/a'}, {tag:'subtree',value:'ops/'},
  {tag:'subtree',value:'ops'}, {tag:'exact',value:'system/x'}];
// Table entries say which grant positions authorize each key before global policy checks.
for (const [key,allowed] of [['',[]],['ops/',[]],['ops/a',[1,2]],['ops/a/b',[2]],
  ['Ops/a',[]],['ops2/a',[]],['system/x',[4]],['ops/😀',[2]],['xops/a',[]]]) {
  for (const [index,grant] of scopes.entries()) for (const disabled of [false,true])
    for (const owner of [tenant,other]) for (const system_topics of [false,true]) {
      const req = {actor:{tenant,disabled,grant},topic:{tenant:owner,key}};
      const tag = disabled || owner !== tenant || key === '' ? 'unavailable' :
        key === 'system/x' && !system_topics ? 'protected' : allowed.includes(index) ? 'allow' : 'outside_scope';
      cases.push({args:[{system_topics},req,'audit'],expected:{ok:true,value:{tag}}});
    }
}
const sample = vectors[0].args[0];
const flags = {system_topics:false};
const fault = code => ({ok:false,code,phase:'boundary'});
const trapped = Object.defineProperty({},'actor',{get() {throw new Error('getter invoked');}});
for (const args of [[flags,trapped,''],[flags,Object.create(sample),''],[flags,sample,'x'.repeat(1025)],
  [flags,{...sample,actor:{...sample.actor,disabled:0}},''],[flags,sample], [flags,sample,'',0]])
  cases.push({args,expected:fault('ARGUMENT')});
cases.push({args:[Object.create(flags),sample,''],expected:fault('CAPABILITY')});
for (const {args,expected} of cases) {
  assert.deepEqual(baseline(...args),expected);
  assert.deepEqual(api.authorize(...args),expected);
}
assert.equal(mayRead(sample,'',false),true);
metrics.policyCases = cases.length;

const src = read('pilot/topics/topics.noi');
const ts = read('pilot/topics/reference.mts');
function edit(source, from, to) {
  assert.equal(source.split(from).length,2,'Edit must have one target');
  return source.replace(from,to);
}
for (const [name,noiEdit,tsEdit,proofFails] of [
  ['include-root',['(not (= root k))','true'],['topic.key.length > grant.value.length','topic.key.length >= grant.value.length'],true],
  ['deny-reason',['(tag decision protected)','(tag decision outside_scope)'],["return 'protected'","return 'outside_scope'"],false]
]) {
  const source = join(dir,name+'.noi');
  writeFileSync(source,edit(src,...noiEdit));
  const changedTs = join(dir,name+'.mts');
  writeFileSync(changedTs,edit(ts,...tsEdit));
  compile([changedTs]);
  const mutant = (await load(name+'.mjs')).authorize;
  const failures = cases.filter(({args,expected}) => JSON.stringify(mutant(...args)) !== JSON.stringify(expected)).length;
  assert.ok(failures > 0);
  const gate = measure(() => cli(['gate','pilot/topics/topics.noi',source,join(dir,name+'-bundle')],1));
  assert.equal(gate.value.after.passed,!proofFails);
  const witness = proofFails ? gate.value.after.checks[0].counterexample :
    gate.value.changes.find(c => c.field === 'body' && c.status === 'risky')?.witness;
  assert.ok(witness);
  assert.notDeepEqual(baseline(witness.flags,...witness.args),mutant(witness.flags,...witness.args));
  writeFileSync(join(dir,name+'-review.json'),JSON.stringify(gate.value,null,2)+'\n');
  metrics.mutations.push({name,tsTypechecked:true,tsCaseFailures:failures,noitakProofPassed:!proofFails,
    gatePassed:gate.value.passed,gateMs:gate.ms,witnessReplayedInTypeScript:true});
}
// Include both validation paths and public return objects. Time typed calls only.
const typed = cases.filter(c => c.expected.ok);
function throughput(call) {
  const iterations = 100000;
  let checksum = 0;
  const times = [];
  for (let trial=0; trial<6; trial++) {
    const start = performance.now();
    for (let i=0; i<iterations; i++) checksum += Number(call(...typed[i%typed.length].args).value.tag === 'allow');
    if (trial) times.push((performance.now()-start)*1000/iterations);
  }
  assert.ok(checksum > 0);
  return Number(times.sort((a,b)=>a-b)[2].toFixed(3));
}
metrics.medianMicrosecondsPerHostCall = {noitak:throughput(api.authorize),typescript:throughput(baseline)};
writeFileSync(join(out,'comparison.json'),JSON.stringify(metrics,null,2)+'\n');
console.log(JSON.stringify(metrics,null,2));
