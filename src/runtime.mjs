// This file is also copied into each standalone ES module.
function equalValue(left, right) {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(k => Object.hasOwn(right, k) && equalValue(left[k], right[k]));
}

function evaluate(expr, env, flags) {
  if (typeof expr === 'string') return env.get(expr);
  if (!Array.isArray(expr)) return expr;
  const [op, a, b, c] = expr;
  const run = e => evaluate(e, env, flags);
  switch (op) {
    case 'let': return evaluate(c, new Map(env).set(a, run(b)), flags);
    case 'if': return run(a) ? run(b) : run(c);
    case 'flag': return flags.get(a);
    case 'not': return !run(a);
    case 'and': return run(a) && run(b);
    case 'or': return run(a) || run(b);
    case '=': return equalValue(run(a), run(b));
    case 'make': return Object.fromEntries(b.map(([key, value]) => [key, run(value)]));
    case 'get': return run(a)[b];
    case 'call': {
      const args = c.map(run);
      const frame = new Map(b.map((name, i) => [name, args[i]]));
      if (!evaluate(expr[4], frame, flags)) throw new CallFault('CALL_PRECONDITION');
      const value = evaluate(expr[5], frame, flags);
      if (!evaluate(expr[6], frame.set('result', value), flags)) throw new CallFault('CALL_POSTCONDITION');
      return value;
    }
    case 'tag': return expr.length === 4 ? { tag: b, value: run(c) } : { tag: b };
    case 'match': {
      const subject = run(a);
      const [, binder, branch] = b.find(([tag]) => tag === subject.tag);
      const scope = binder ? new Map(env).set(binder, subject.value) : env;
      return evaluate(branch, scope, flags);
    }
    case '<': return run(a) < run(b);
    case '<=': return run(a) <= run(b);
    case '+':
    case '-': {
      const n = op === '+' ? run(a) + run(b) : run(a) - run(b);
      if (n < 0 || n > 255) throw new RangeFault();
      return n;
    }
    default: throw new Error('Invalid instruction');
  }
}

class RangeFault extends Error {}
class CallFault extends Error {
  constructor(code) { super(code); this.code = code; }
}
const error = (code, phase) => ({ ok: false, code, phase });

function execute(f, args, flags) {
  const env = new Map(f.params.map(([key], i) => [key, args[i]]));
  let phase = 'requires';
  try {
    if (!evaluate(f.requires, env, flags)) return error('PRECONDITION', phase);
    phase = 'body';
    const value = evaluate(f.body, env, flags);
    phase = 'ensures';
    if (!evaluate(f.ensures, env.set('result', value), flags)) return error('POSTCONDITION', phase);
    return { ok: true, value };
  } catch (e) {
    if (e instanceof RangeFault) return error('ARITHMETIC', phase);
    if (e instanceof CallFault) return error(e.code, phase);
    throw e;
  }
}

function argument(type, value) {
  if (type === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (type === 'byte') return Number.isInteger(value) && value >= 0 && value <= 255 ? value + 0 : undefined;
  if (value === null || typeof value !== 'object') return undefined;
  if (type.fields) {
    const copy = {};
    for (const [key, fieldType] of type.fields) {
      const field = argument(fieldType, Object.getOwnPropertyDescriptor(value, key)?.value);
      if (field === undefined) return undefined;
      Object.defineProperty(copy, key, { value: field, enumerable: true, writable: true, configurable: true });
    }
    return copy;
  }
  const tag = Object.getOwnPropertyDescriptor(value, 'tag')?.value;
  const variant = type.variants.find(v => v.tag === tag);
  if (!variant) return undefined;
  if (!variant.payload) return { tag };
  const payload = argument(variant.payload, Object.getOwnPropertyDescriptor(value, 'value')?.value);
  return payload === undefined ? undefined : { tag, value: payload };
}

function invoke(f, flags, args) {
  if (args.length !== f.params.length) return error('ARGUMENT', 'boundary');
  let values;
  try { values = args.map((v, i) => argument(f.params[i][1], v)); }
  catch { return error('ARGUMENT', 'boundary'); }
  if (values.includes(undefined)) return error('ARGUMENT', 'boundary');
  const snapshot = new Map();
  if (!flags || typeof flags !== 'object') return error('CAPABILITY', 'boundary');
  try {
    for (const key of f.reads) {
      const descriptor = Object.getOwnPropertyDescriptor(flags, key);
      if (typeof descriptor?.value !== 'boolean') return error('CAPABILITY', 'boundary');
      snapshot.set(key, descriptor.value);
    }
  } catch {
    return error('CAPABILITY', 'boundary');
  }
  const outcome = execute(f, values, snapshot);
  // Materialize a fresh value tree so JS reference aliases cannot expose which
  // source expression produced equal structured results.
  if (outcome.ok) outcome.value = argument(f.output, outcome.value);
  return outcome;
}

function predicate(f, field, args, flags, result) {
  const env = new Map(f.params.map(([key], i) => [key, args[i]]));
  if (field === 'ensures') env.set('result', result);
  try { return evaluate(f[field], env, flags); }
  catch (e) {
    if (e instanceof RangeFault) return 'arithmetic-fault';
    throw e;
  }
}

export { argument, execute, invoke, predicate };
