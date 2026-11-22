// This file is also copied into each standalone ES module.
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
    case '=': {
      const left = run(a), right = run(b);
      return typeof left === 'object' ? left.tag === right.tag && left.value === right.value : left === right;
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
    throw e;
  }
}

function argument(type, value) {
  if (type === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (type === 'byte') return Number.isInteger(value) && value >= 0 && value <= 255 ? value + 0 : undefined;
  if (value === null || typeof value !== 'object') return undefined;
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
  return execute(f, values, snapshot);
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

export { execute, invoke, predicate };
