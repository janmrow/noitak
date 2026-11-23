// Run this driver against either checkout. Proof, import and fixture setup are untimed.
import assert from 'node:assert/strict';
import { Session } from 'node:inspector/promises';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const checkout = resolve(process.argv[2] ?? '.');
const tool = file => import(pathToFileURL(join(checkout,'src',file+'.mjs')));
const {compile} = await tool('frontend');
const {verify, VERSION} = await tool('verify');
const {build} = await tool('backend');
const {argument, predicate} = await tool('runtime');
const dir = await mkdtemp(join(tmpdir(),'noitak-execution-'));

function median(run) {
  const times = [];
  for (let i=0; i<11; i++) {
    const start = performance.now();
    run();
    if (i>=4) times.push(performance.now()-start);
  }
  return Number(times.sort((a,b)=>a-b)[3].toFixed(3));
}

async function profile(label, run) {
  const medianMs = median(run);
  const session = new Session();
  session.connect();
  try {
    await session.post('HeapProfiler.startSampling', {samplingInterval:32768,
      includeObjectsCollectedByMajorGC:true, includeObjectsCollectedByMinorGC:true});
    for (let i=0; i<8; i++) run();
    const {profile} = await session.post('HeapProfiler.stopSampling');
    const bytes = profile.samples.reduce((total,sample)=>total+sample.size,0);
    console.log({label, medianMs, sampledMiBPerRun:Number((bytes/8/2**20).toFixed(2))});
  } finally { session.disconnect(); }
}

async function component(name) {
  const source = await readFile(join(checkout,'pilot',name,name+'.noi'),'utf8');
  const unit = compile(source);
  const proof = verify(unit,source,65536,'auto');
  assert.ok(proof.passed);
  await build(unit,proof,join(dir,name));
  const file = join(dir,name,'module.mjs');
  const {api} = await import(pathToFileURL(file));
  console.log({version:VERSION, node:process.version, name, esmBytes:(await stat(file)).size});
  return {api, unit};
}

try {
  const {api,unit} = await component('metering');
  const f = unit.functions.find(f=>f.name==='reconcile');
  const meter = '00112233-4455-6677-8899-aabbccddeeff';
  const initial = {meter,used:0,limit:10000000,serial:0,status:{tag:'ready'}};
  const rows = Array.from({length:8192},(_,i)=>({meter,serial:i+1,units:1000}));
  const states = Array.from({length:rows.length+1},(_,i)=>({...initial,used:i*1000,serial:i}));
  const rejected = [{...rows[0],serial:2},...rows.slice(1)];
  const malformed = [...rows.slice(0,-1),{...rows.at(-1),units:-1}];
  assert.deepEqual(api.reconcile({},initial,rows),{ok:true,value:states.at(-1)});
  assert.equal(api.reconcile({},initial,rejected).value.status.tag,'out_of_order');
  assert.equal(api.reconcile({},initial,malformed).code,'ARGUMENT');
  const flags = new Map();
  // Independent microbenchmarks; body includes nested helper contracts.
  console.log({
    referenceSnapshotMs:median(()=>argument({element:f.params[1][1],capacity:f.capacity},rows)),
    referenceBodyMs:median(()=>{
      for (let i=0; i<rows.length; i++) predicate(f,'body',[states[i],rows[i]],flags);
    }),
    referenceEntryExitContractsMs:median(()=>{
      for (let i=0; i<rows.length; i++) {
        const args = [states[i],rows[i]];
        predicate(f,'requires',args,flags);
        predicate(f,'ensures',args,flags,states[i+1]);
      }
    })
  });
  await profile('accepted',()=>api.reconcile({},initial,rows));
  await profile('first row rejected',()=>api.reconcile({},initial,rejected));
  await profile('malformed tail',()=>api.reconcile({},initial,malformed));
  const {api: access} = await component('access');
  const p = {tenant:meter,user:meter,suspended:false};
  const r = {tenant:meter,owner:meter,reader:meter,has_reader:false,expires:0};
  assert.equal(access.authorize({delegation:false},p,r,0,meter).value.tag,'owner');
  await profile('4096 owner decisions',()=>{
    for (let i=0; i<4096; i++) access.authorize({delegation:false},p,r,i,meter);
  });
} finally { await rm(dir,{recursive:true,force:true}); }
