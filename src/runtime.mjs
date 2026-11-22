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
    case '=': return run(a) === run(b);
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

function invoke(f, flags, args) {
  if (args.length !== f.params.length || !f.params.every(([, t], i) =>
    t === 'bool' ? typeof args[i] === 'boolean' :
    Number.isInteger(args[i]) && args[i] >= 0 && args[i] <= 255))
    return error('ARGUMENT', 'boundary');
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
  // Canonicalize JavaScript negative zero at the byte boundary.
  return execute(f, args.map(v => Object.is(v, -0) ? 0 : v), snapshot);
}

export { execute, invoke };
