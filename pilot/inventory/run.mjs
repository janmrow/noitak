import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const out = resolve(process.argv[2] ?? 'build/inventory');
mkdirSync(resolve(out,'..'),{recursive:true});
mkdirSync(out);
function run(args) {
  const child = spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(child.status,0,child.error?.message ?? child.stdout + child.stderr);
  return child.stdout;
}
const manifest = JSON.parse(run(['noitak.mjs','build','pilot/inventory/inventory.noi',join(out,'verified'),'--engine','auto','--json']));
assert.deepEqual(manifest.artifactValidation.lookups,[{service:'replenish',authorizedCalls:4,deniedCalls:3}]);
copyFileSync('pilot/inventory/service.mts',join(out,'service.mts'));
run(['node_modules/typescript/bin/tsc','--strict','--module','nodenext',join(out,'service.mts')]);
const {purchasingDesk} = await import(pathToFileURL(join(out,'service.mjs')));
const store = new Map();
const desk = purchasingDesk(store,['pencil','paper']);
const invoke = (units,sku='pencil') => desk({sku, units});
const ok = (tag,value) => ({ok:true,value:value === undefined ? {tag} : {tag,value}});
assert.deepEqual(invoke(3),ok('unknown_sku'));
let cases = 0;
for (const hand of [0,1,4,250,255]) {
  for (const reserved of [0,1,2,4,254,255]) {
    store.set('pencil',{on_hand:hand,reserved});
    for (const units of [1,2,4,127,255]) {
      const shortage = Math.max(0,units + reserved - hand);
      const expected = reserved > hand ? ok('invalid_balance') : shortage ? ok('order',shortage) : ok('covered');
      assert.deepEqual(invoke(units),expected);
      cases++;
    }
  }
}
assert.deepEqual(invoke(0),{ok:false,code:'PRECONDITION',phase:'requires'});
assert.deepEqual(invoke(2,'other'),{ok:false,code:'CAPABILITY',phase:'boundary'});
console.log('Strict TypeScript inventory consumer matched', cases, 'stock allocations and 3 boundary cases');
