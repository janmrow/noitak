import assert from 'node:assert/strict';
import test from 'node:test';
import { compile } from '../src/frontend.mjs';
import { invoke } from '../src/runtime.mjs';
import { emitModule } from '../src/emitter.mjs';
import { verify } from '../src/verify.mjs';

const selection = `(module accounting 1.0.0
  (sequence entries i32 4)
  (reducer lowest ((minimum i32) (entry i32)) i32 (reads enabled)
    (capacity 4) (invariant (<= minimum 0i32))
    (ensures (<= result minimum))
    (if (and (flag enabled) (< entry minimum)) entry minimum))
  (helper negatives ((rows entries)) entries (reads)
    (requires true) (ensures (<= (length result) (length rows)))
    (fold rows (items entries) (out x idx) (if (< x 0i32) (append out x) out)))
  (fn reconcile ((rows entries) (seed i32)) i32 (reads enabled)
    (requires (<= seed 0i32)) (ensures (<= result seed))
    (reduce lowest seed (call negatives rows))))`;

async function implementations(source, name) {
  const unit = compile(source);
  const f = unit.functions.find(entry => entry.name === name);
  const js = await emitModule(unit);
  const {api} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  return [(flags, ...args) => invoke(f, flags, args), api[name]];
}

test('filtered signed ledger entries compose with a named checked reducer', async () => {
  const calls = await implementations(selection, 'reconcile');
  const rows = [2147483647, -2147483648, -3, 0];
  for (const call of calls) for (let n = 0; n <= rows.length; n++) {
    const batch = rows.slice(0, n);
    for (const enabled of [false, true]) {
      const minimum = enabled ? Math.min(-1, ...batch) : -1;
      assert.deepEqual(call({enabled}, batch, -1), {ok:true, value:minimum});
    }
    assert.equal(call({}, batch, 0).code, 'CAPABILITY');
  }
  for (const [before, after, code] of [
    ['(capacity 4)', '(capacity 3)', 'E_LIMIT'],
    ['(seed i32)) i32 (reads enabled)', '(seed i32)) i32 (reads)', 'E_EFFECT'],
    ['(append out x)', '(append out true)', 'E_TYPE']
  ]) assert.throws(() => compile(selection.replace(before,after)), e => e.detail.code === code);
  const open = selection.replace('(requires (<= seed 0i32))', '(requires true)');
  for (const call of await implementations(open, 'reconcile'))
    assert.deepEqual(call({enabled:true}, [], 2), {ok:false, code:'CALL_PRECONDITION', phase:'body'});
});

test('append preserves order, handles an element which is itself a sequence, and checks capacity', async () => {
  const src = `(module m 1.0.0 (sequence row bool 2) (sequence rows row 2)
    (fn store ((xs rows) (row row)) rows (reads) (requires true) (ensures true) (append xs row)))`;
  const arrays = [[], [true], [false, true]];
  for (const call of await implementations(src, 'store')) {
    for (const row of arrays) for (const first of arrays) {
      const result = call({}, [first], row);
      assert.deepEqual(result, {ok:true, value:[first, row]});
      assert.notEqual(result.value[0], first);
      assert.notEqual(result.value[1], row);
    }
    assert.deepEqual(call({}, [[],[]], []), {ok:false, code:'CAPACITY', phase:'body'});
  }
  assert.equal(verify(compile(src),src,10000).checks[0].status,'violated');
});

test('i32 arithmetic matches a BigInt oracle across extrema, signs and zero', async () => {
  const numbers = [-2147483648, -2147483647, -999, -1, 0, 1, 999, 2147483646, 2147483647];
  for (const op of ['+', '-', '<', '<=']) {
    const source = `(module m 1.0.0 (fn calc ((a i32) (b i32)) ${op.startsWith('<') ? 'bool' : 'i32'}
      (reads) (requires true) (ensures true) (${op} a b)))`;
    for (const call of await implementations(source, 'calc')) {
      for (const n of numbers) for (const m of numbers) {
        const a = BigInt(n), b = BigInt(m);
        const value = op === '+' ? a+b : op === '-' ? a-b : op === '<' ? a<b : a<=b;
        const expected = typeof value === 'boolean' ? {ok:true,value} :
          value < -2147483648n || value > 2147483647n ? {ok:false,code:'ARITHMETIC',phase:'body'} :
            {ok:true,value:Number(value)};
        assert.deepEqual(call({},n,m), expected);
      }
      for (const invalid of [2**31, -(2**31)-1, 1.1, NaN, '0'])
        assert.equal(call({},invalid,0).code, 'ARGUMENT');
    }
  }
});

test('wide sequence lengths and fold positions remain exact across the byte boundary', async () => {
  const source = `(module m 1.0.0 (sequence rows bool 512 u32)
    (fn last ((rows rows)) u32 (reads) (requires true) (ensures (<= result (length rows)))
      (fold rows 0u32 (prior bit index) (if bit index prior))))`;
  for (const call of await implementations(source, 'last')) {
    for (const length of [0,1,255,256,257,512])
      assert.deepEqual(call({},Array(length).fill(true)),{ok:true,value:Math.max(0,length-1)});
    assert.equal(call({},Array(513).fill(true)).code, 'ARGUMENT');
  }
});
