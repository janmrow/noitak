import { parentPort, workerData } from 'node:worker_threads';
import { Session } from 'node:inspector';
import { isDeepStrictEqual, promisify } from 'node:util';
import { domainOf, sampleValue } from './domain.mjs';
import { invoke } from './runtime.mjs';

function check(api, entries, witnesses, vectors) {
  for (const v of vectors)
    if (!entries.some(f => f.name === v?.fn) || !Array.isArray(v.args) || typeof v.expected?.ok !== 'boolean')
      throw new Error('Malformed application vector');
  const checks = [];
  for (const f of entries) {
    const params = f.collector ? [['row', f.params[0][1].element]] : f.params;
    const domain = domainOf({...f, params});
    const hostArgs = args => f.collector ? [args] : f.capacity ? [args[0],[args[1]]] : args;
    const positioned = domain.total !== null;
    const count = positioned ? Number(domain.total < 64n ? domain.total : 64n) : 16;
    function sample(i) {
      if (positioned) return domain.at(count === 1 ? 0n : BigInt(i)*(domain.total-1n)/BigInt(count-1));
      return {args:params.map(([,t],j) => sampleValue(t,i && i+j)),
        flags:new Map(f.reads.map((k,j) => [k, Boolean((i >> (j % 4)) & 1)]))};
    }
    let cases = 0, returned = 0, admittedBodies = 0, applicationCases = 0;
    let nonemptyCalls = 0, expectedSelectorExecutions = 0, emittedValues = 0;
    function probe(flags,args,origin,oracle) {
      const expected = invoke(f,flags,args);
      const actual = api[f.name](flags,...args);
      cases++;
      if (origin === 'admission-witness' && !expected.ok) throw new Error('Admission witness rejected for ' + f.name);
      if (oracle && !isDeepStrictEqual(oracle, actual))
        return {function:f.name,args,flags,expected:oracle,actual,reference:expected,origin};
      const validFailure = expected.code === 'PRECONDITION' ||
        (oracle !== undefined && ['ARGUMENT','CAPABILITY'].includes(expected.code));
      if (!isDeepStrictEqual(actual,expected) || (!expected.ok && !validFailure))
        return {function:f.name,args,flags,expected,actual,origin};
      if (actual.ok) {
        returned++;
        if (f.collector) {
          if (args[0].length > 0) nonemptyCalls++;
          expectedSelectorExecutions += args[0].length;
          emittedValues += actual.value.length;
        } else if (!f.capacity || args[1].length > 0) admittedBodies++;
      }
    }
    let witness;
    for (let i=0; i<count; i++) {
      // Mixed radix positions include both ends. Small step domains are visited in full.
      const {args,flags} = sample(i);
      const grants = Object.fromEntries(flags);
      witness = probe(grants,hostArgs(args),'typed-sample');
      if (witness) return {witness};
      if (f.capacity && (i === 0 || i === count-1)) {
        witness = probe(grants,[args[0],[]],'typed-sample');
        if (!witness && f.capacity >= 2)
          witness = probe(grants,[args[0],[args[1],args[1]]],'typed-sample');
        if (witness) return {witness};
      }
    }
    if (f.collector) {
      const first = sample(0), last = sample(count-1);
      const grants = Object.fromEntries(first.flags);
      const rows = Array.from({length:f.params[0][1].capacity}, (_, i) => (i % 2 ? last : first).args[0]);
      witness = probe(grants,[[]],'typed-sample') ?? probe(grants,[rows],'typed-sample');
      if (witness) return {witness};
    }
    const admission = witnesses.get(f.name);
    if (admission) {
      const args = f.collector ? admission.args : hostArgs(admission.args);
      witness = probe(admission.flags,args,'admission-witness');
      if (witness) return {witness};
    }
    for (const v of vectors.filter(v => v.fn === f.name)) {
      witness = probe(v.flags,v.args,'application-vector',v.expected);
      if (witness) return {witness};
      applicationCases++;
    }
    const first = sample(0);
    const args = hostArgs(first.args);
    witness = probe(Object.fromEntries(first.flags),[...args,null],'boundary-oracle',
      {ok:false,code:'ARGUMENT',phase:'boundary'});
    if (!witness && f.reads.length) witness = probe({},args,'boundary-oracle',{ok:false,code:'CAPABILITY',phase:'boundary'});
    if (witness) return {witness};
    checks.push({function:f.name,scope:f.collector ? 'collector-host-calls' : f.capacity ? 'reducer-host-calls' : 'function-host-calls',
      domainPositions:positioned ? count : 0, typedSamples:count, admissionWitness: Boolean(admission),
      applicationCases,cases,returned,admittedBodies,status:admittedBodies ? 'tested' : 'incomplete',
      ...(f.collector && {nonemptyCalls,expectedSelectorExecutions,emittedValues}) });
  }
  return {checks};
}

// Load the exact bytes supplied to the publisher. A relative runtime import
// would fail here, as required for a standalone bundle.
const url = 'data:text/javascript;base64,' + Buffer.from(workerData.source).toString('base64');
// Count real selector dispatches in the imported bytes. Output agreement alone
// cannot tell an always-skip selector from a loop that never calls it.
const session = workerData.entries.some(f => f.collector) ? new Session() : null;
const post = session && promisify(session.post.bind(session));
if (post) {
  session.connect();
  await post('Profiler.enable');
  await post('Profiler.startPreciseCoverage', {callCount:true, detailed:false});
}
const module = await import(url);
const api = module.api;
if (!isDeepStrictEqual(Object.keys(module),['api']) || !api || Object.getPrototypeOf(api) !== null ||
    !Object.isFrozen(api) || Reflect.ownKeys(api).length !== workerData.entries.length ||
    !workerData.entries.every(f=>typeof Object.getOwnPropertyDescriptor(api,f.name)?.value === 'function'))
  throw new Error('Unexpected public surface in emitted module');
const report = check(api,workerData.entries,workerData.witnesses,workerData.vectors);
if (post) {
  const {result} = await post('Profiler.takePreciseCoverage');
  session.disconnect();
  const functions = result.find(script => script.url === url)?.functions ?? [];
  for (const [i, row] of (report.checks ?? []).entries()) {
    if (row.scope !== 'collector-host-calls') continue;
    const selector = functions.find(f => f.functionName === 'selectRow' + i);
    row.selectorExecutions = selector?.ranges[0].count ?? 0;
    row.selectorMeasurement = 'v8-precise-coverage';
    if (row.selectorExecutions !== row.expectedSelectorExecutions)
      throw new Error('Unexpected selector execution count for ' + row.function);
    delete row.expectedSelectorExecutions;
    row.admittedBodies = row.nonemptyCalls;
    row.status = row.selectorExecutions ? 'tested' : 'incomplete';
  }
}
parentPort.postMessage(report);
