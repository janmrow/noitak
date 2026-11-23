// Run beside the compiled service and the verified component directory.
import assert from 'node:assert/strict';
import { MeterStore } from './service.mjs';

const meter = '00112233-4455-6677-8899-aabbccddeeff';
const account = {meter, limit:1000000, used:0, serial:100000, status:{tag:'ready'}};
const accounts = new Map([[meter,account]]);
const store = new MeterStore(accounts);
const readings = Array.from({length:1000},(_,i)=>({meter,serial:100001+i,units:1000}));
const rejected = store.submit(meter,[...readings,{meter,serial:101001,units:1}]);
assert.deepEqual(rejected,{status:'rejected',reason:'quota_exceeded'});
assert.equal(accounts.get(meter),account);
const committed = store.submit(meter,readings);
assert.deepEqual(committed,{status:'committed',serial:101000,used:1000000});
assert.equal(store.submit(meter,[{...readings[0],units:NaN}]).status,'invalid-input');
console.log(JSON.stringify({rejected,committed}));
