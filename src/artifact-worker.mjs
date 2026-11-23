import { parentPort, workerData } from 'node:worker_threads';
import { isDeepStrictEqual } from 'node:util';
import { domainOf } from './domain.mjs';
import { invoke } from './runtime.mjs';

function check(api, entries) {
  const checks = [];
  for (const f of entries) {
    const domain = domainOf(f);
    const count = Number(domain.total < 64n ? domain.total : 64n);
    let cases = 0, returned = 0;
    function probe(flags,args,typed) {
      const expected = invoke(f,flags,args);
      const actual = api[f.name](flags,...args);
      cases++;
      if (actual.ok) returned++;
      if (!isDeepStrictEqual(actual,expected) || (typed && !expected.ok && expected.code !== 'PRECONDITION'))
        return {function:f.name,args,flags,expected,actual};
    }
    let witness;
    for (let i=0; i<count; i++) {
      // Mixed radix positions include both ends. Small step domains are visited in full.
      const index = count === 1 ? 0n : BigInt(i)*(domain.total-1n)/BigInt(count-1);
      const {args,flags} = domain.at(index);
      const grants = Object.fromEntries(flags);
      witness = probe(grants,f.capacity ? [args[0],[args[1]]] : args,true);
      if (witness) return {witness};
      if (f.capacity && (i === 0 || i === count-1)) {
        witness = probe(grants,[args[0],[]],true);
        if (!witness && f.capacity >= 2)
          witness = probe(grants,[args[0],[args[1],args[1]]],true);
        if (witness) return {witness};
      }
    }
    const first = domain.at(0n);
    const hostArgs = f.capacity ? [first.args[0],[first.args[1]]] : first.args;
    witness = probe(Object.fromEntries(first.flags),[...hostArgs,null],false);
    if (!witness && f.reads.length) witness = probe({},hostArgs,false);
    if (witness) return {witness};
    checks.push({function:f.name,scope:f.capacity ? 'reducer-host-calls' : 'function-host-calls',
      domainPositions:count,cases,returned});
  }
  return {checks};
}

// Load the exact bytes supplied to the publisher. A relative runtime import
// would fail here, as required for a standalone bundle.
const url = 'data:text/javascript;base64,' + Buffer.from(workerData.source).toString('base64');
const module = await import(url);
const api = module.api;
if (!isDeepStrictEqual(Object.keys(module),['api']) || !api || Object.getPrototypeOf(api) !== null ||
    !Object.isFrozen(api) || Reflect.ownKeys(api).length !== workerData.entries.length ||
    !workerData.entries.every(f=>typeof Object.getOwnPropertyDescriptor(api,f.name)?.value === 'function'))
  throw new Error('Unexpected public surface in emitted module');
parentPort.postMessage(check(api,workerData.entries));
