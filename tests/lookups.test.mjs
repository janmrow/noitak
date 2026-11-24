import test from 'node:test';
import assert from 'node:assert/strict';
import {checkArtifact} from '../src/artifact-check.mjs';
import {compare} from '../src/diff.mjs';
import {emitModule} from '../src/emitter.mjs';
import {compile} from '../src/frontend.mjs';
import {verify} from '../src/verify.mjs';

const source = `(module example 1.0.0
  (enum reply (found bool) (missing) (unavailable))
  (record input (alternate bool))
  (fn key ((x input)) text (reads enabled) (requires (flag enabled)) (ensures true)
    (if (get x alternate) "alt" "default"))
  (fn decide ((x input) (r reply)) bool (reads show) (requires true) (ensures true)
    (and (flag show) (match r (found b (= b (get x alternate))) (missing false) (unavailable false))))
  (lookup run directory key decide))`;
const compiled = compile(source);
const flags = {enabled:true,show:true};
const denied = {ok:false,code:'CAPABILITY',phase:'boundary'};
const badResponse = {ok:false,code:'RESOURCE_RESPONSE',phase:'boundary'};
const ok = value => ({ok:true,value});
const artifact = js => import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('a lookup makes exactly one scoped request and resumes against original input and grant snapshots',async () => {
  const js = await emitModule(compiled);
  const {grantLookup,services} = await artifact(js);
  const scoped = ['default'];
  const input = {alternate:false}, grants = {...flags};
  const requests = [];
  const token = grantLookup('directory',scoped,key => {
    requests.push(key);
    grants.show = false;
    input.alternate = true;
    return {tag:'found',value:false};
  });
  scoped.push('alt');
  assert.deepEqual(services.run(token,grants,input),ok(true));
  assert.deepEqual(requests,['default']);
  assert.deepEqual(services.run(token,flags,input),denied);
  for (const fake of [null,{},Object.create(token),{resource:'directory',scope:['alt']}])
    assert.deepEqual(services.run(fake,flags,input),denied);
  const otherRealm = await artifact(js+'\n// second instance');
  assert.deepEqual(otherRealm.services.run(token,flags,input),denied);
  input.alternate = false;
  assert.deepEqual(services.run(token,{enabled:false,show:true},input),{ok:false,code:'PRECONDITION',phase:'requires'});
  assert.deepEqual(services.run(token,{enabled:true},input),denied);
  assert.deepEqual(services.run(token,flags,{}),{ok:false,code:'ARGUMENT',phase:'boundary'});
  assert.deepEqual(requests,['default']);
});

test('lookup rejects malformed replies and models a failed host read explicitly',async () => {
  const {grantLookup,services} = await artifact(await emitModule(compiled));
  const run = read => services.run(grantLookup('directory',['default'],read),flags,{alternate:false});
  let accessorCalls = 0;
  const accessor = Object.defineProperty({tag:'found'},'value',{get() {accessorCalls++; return true;}});
  for (const data of [accessor,Object.create({tag:'found',value:true}),{},null,{tag:'found',value:2},Promise.resolve({tag:'missing'})])
    assert.deepEqual(run(()=>data),badResponse);
  assert.equal(accessorCalls,0);
  assert.deepEqual(run(()=>{throw new Error('private message');}),ok(false));
  assert.throws(()=>grantLookup('directory',Array(4097).fill('x'),()=>true),TypeError);
});

test('lookup stages have checked signatures and a total continuation',() => {
  for (const code of [source.replace('(missing) (unavailable)','(missing) (other)'),
    source.replace('(reads show) (requires true)','(reads show) (requires (flag show))'),
    source.replace('(fn key','(helper key'), source.replace('(r reply)','(r byte)').replace('(match r (found b (= b (get x alternate))) (missing false) (unavailable false))','true')])
    assert.throws(()=>compile(code));
});

test('effect attachment, namespace and request computations each have independent gate findings',() => {
  const before = verify(compiled,source,256);
  assert.equal(before.passed,true);
  assert.equal(before.serviceIndependence,'unverified');
  assert.deepEqual(before.lookups[0].reads,['enabled','show']);
  for (const [candidate,field] of [[source.replace('directory','second'),'lookup'],
    [source.replace('"alt"','"other"'),'lookup-key'],[source.replace('(lookup run directory key decide)',''),'lookup']]) {
    const unit = compile(candidate);
    const change = compare(compiled,unit,before,verify(unit,candidate,256));
    assert.equal(change.passed,false);
    assert.ok(change.changes.some(c=>c.field===field && c.status==='policy-violation'));
  }
});

test('artifact comparison rejects a backend that dispatches outside the grant scope', async () => {
  const js = await emitModule(compiled);
  const report = verify(compiled,source,256);
  const witnesses = new Map(report.checks.map(c=>[c.function,c.admissionWitness]));
  const result = await checkArtifact(compiled,js,30000,witnesses);
  assert.deepEqual(result.lookups,[{service:'run',authorizedCalls:4,deniedCalls:3}]);
  const mutant = js.replace('if (!grant.scope.has(key.value))','if (false)');
  assert.notEqual(mutant,js);
  await assert.rejects(checkArtifact(compiled,mutant,30000,witnesses),/scope mismatch/);
});
