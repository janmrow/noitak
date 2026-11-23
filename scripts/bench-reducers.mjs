// Run against an extracted v0.5.0 checkout and the current tree with the same Node.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const checkout = resolve(process.argv[2] ?? '.');
const fromCheckout = name => import(pathToFileURL(join(checkout,'src',name+'.mjs')));
const {compile} = await fromCheckout('frontend');
const {verify,VERSION} = await fromCheckout('verify');
const {build} = await fromCheckout('backend');

function measure(run) {
  const samples = [];
  let value;
  for (let i=0; i<7; i++) {
    const start = performance.now();
    value = run();
    if (i >= 2) samples.push(performance.now()-start);
  }
  return {value, medianMs: Number(samples.sort((a,b)=>a-b)[2].toFixed(3))};
}

const legacy = VERSION === '0.5.0';
for (const size of legacy ? [8] : [8,8192]) {
  const source = legacy ? `(module parity 1.0.0 (sequence rows bool 8)
    (fn run ((s bool) (xs rows)) bool (reads) (requires true) (ensures true)
      (fold xs s (v x i) (if x (not v) v))))` : `(module parity 1.0.0
    (reducer run ((s bool) (x bool)) bool (reads) (capacity ${size})
      (invariant true) (ensures true) (if x (not s) s)))`;
  const unit = compile(source);
  const {value,medianMs} = measure(()=>verify(unit,source,65536));
  assert.ok(value.passed);
  console.log({version:VERSION, workload:'parity', size, examined:value.checks[0].examined, medianMs});
}

if (!legacy) {
  const dir = await mkdtemp(join(tmpdir(),'noitak-cost-'));
  try {
    for (const name of ['metering','access']) {
      const source = await readFile(join(checkout,'pilot',name,name+'.noi'),'utf8');
      const unit = compile(source);
      const {value,medianMs} = measure(()=>verify(unit,source,65536,'auto'));
      assert.ok(value.passed);
      const bundle = join(dir,name);
      await build(unit,value,bundle);
      const esm = join(bundle,'module.mjs');
      console.log({workload:name, proofMs:medianMs, esmBytes:(await stat(esm)).size});
      if (name !== 'metering') continue;
      execFileSync(process.execPath,[join(checkout,'node_modules/typescript/bin/tsc'),'--strict','--module','nodenext',
        '--outDir',dir,join(checkout,'pilot/metering/reference.mts')]);
      const {reconcile} = await import(pathToFileURL(join(dir,'reference.mjs')));
      const {api} = await import(pathToFileURL(esm));
      const meter = '00112233-4455-6677-8899-aabbccddeeff';
      const state = {meter,used:0,limit:10000000,serial:0,status:{tag:'ready'}};
      const rows = Array.from({length:8192},(_,i)=>({meter,serial:i+1,units:1000}));
      const compiled = measure(()=>api.reconcile({},state,rows));
      const typed = measure(()=>reconcile(state,rows));
      assert.deepEqual(compiled.value,{ok:true,value:typed.value});
      console.log({readings:rows.length, artifactMs:compiled.medianMs, typedModelMs:typed.medianMs});
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
}
