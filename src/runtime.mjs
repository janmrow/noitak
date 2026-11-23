// This file is also copied into each standalone ES module.
function equalValue(left, right) {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(k => Object.hasOwn(right, k) && equalValue(left[k], right[k]));
}

function evaluate(expr, env, flags, graph) {
  if (typeof expr === 'string') return env.get(expr);
  if (!Array.isArray(expr)) return expr;
  const [op, a, b, c] = expr;
  const run = e => evaluate(e, env, flags, graph);
  switch (op) {
    case 'let': return evaluate(c, new Map(env).set(a, run(b)), flags, graph);
    case 'if': return run(a) ? run(b) : run(c);
    case 'flag': return flags.get(a);
    case 'not': return !run(a);
    case 'and': return run(a) && run(b);
    case 'or': return run(a) || run(b);
    case '=': return equalValue(run(a), run(b));
    case 'make': return Object.fromEntries(b.map(([key, value]) => [key, run(value)]));
    case 'get': return run(a)[b];
    case 'items': return b.map(run);
    case 'length': return run(a).length;
    case 'fold': {
      const values = run(a);
      let acc = run(b);
      const scope = new Map(env);
      for (let i = 0; i < values.length; i++) {
        scope.set(c[0], acc).set(c[1], values[i]).set(c[2], i);
        acc = evaluate(expr[4], scope, flags, graph);
      }
      return acc;
    }
    case 'attempt':
    case 'apply': {
      const [names, pre, body, post] = graph[a];
      const index = op === 'attempt' ? run(expr[4]) : undefined;
      const args = b.map(run);
      const frame = new Map(names.map((name, i) => [name, args[i]]));
      if (!evaluate(pre, frame, flags, graph)) {
        if (op === 'attempt') return {tag:'rejected', value:index};
        throw new CallFault('CALL_PRECONDITION');
      }
      const value = evaluate(body, frame, flags, graph);
      if (!evaluate(post, frame.set('result', value), flags, graph)) throw new CallFault('CALL_POSTCONDITION');
      return op === 'attempt' ? {tag:'committed',value} : value;
    }
    case 'call': {
      const args = c.map(run);
      const frame = new Map(b.map((name, i) => [name, args[i]]));
      if (!evaluate(expr[4], frame, flags, graph)) throw new CallFault('CALL_PRECONDITION');
      const value = evaluate(expr[5], frame, flags, graph);
      if (!evaluate(expr[6], frame.set('result', value), flags, graph)) throw new CallFault('CALL_POSTCONDITION');
      return value;
    }
    case 'tag': return expr.length === 4 ? { tag: b, value: run(c) } : { tag: b };
    case 'match': {
      const subject = run(a);
      const [, binder, branch] = b.find(([tag]) => tag === subject.tag);
      const scope = binder ? new Map(env).set(binder, subject.value) : env;
      return evaluate(branch, scope, flags, graph);
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
    if (!evaluate(f.requires, env, flags, f.graph)) return error('PRECONDITION', phase);
    phase = 'body';
    const value = evaluate(f.body, env, flags, f.graph);
    phase = 'ensures';
    if (!evaluate(f.ensures, env.set('result', value), flags, f.graph)) return error('POSTCONDITION', phase);
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
  if (type.element) {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isInteger(length) || length < 0 || length > type.capacity) return undefined;
    const copy = [];
    for (let i = 0; i < length; i++) {
      const item = argument(type.element, Object.getOwnPropertyDescriptor(value, i)?.value);
      if (item === undefined) return undefined;
      copy.push(item);
    }
    return copy;
  }
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
  try { return evaluate(f[field], env, flags, f.graph); }
  catch (e) {
    if (e instanceof RangeFault) return 'arithmetic-fault';
    throw e;
  }
}

export { argument, execute, invoke, predicate };
