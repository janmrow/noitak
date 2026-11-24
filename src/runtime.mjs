import { argument, atBoundary, CallFault, equalValue, error, RangeFault } from './boundary.mjs';

function evaluate(expr, env, flags, graph) {
  if (typeof expr === 'string') return env.get(expr);
  if (!Array.isArray(expr)) return expr;
  const [op, a, b, c] = expr;
  const run = e => evaluate(e, env, flags, graph);
  switch (op) {
    case 'text-length': return run(a).length;
    case 'starts-with': return run(a).startsWith(run(b));
    case 'ends-with': return run(a).endsWith(run(b));
    case 'contains': return run(a).includes(run(b));
    case 'strip-prefix': {
      const value = run(a), prefix = run(b);
      return value.startsWith(prefix) ? value.slice(prefix.length) : value;
    }
    case 'text':
    case 'uuid':
    case 'i32':
    case 'u32': return a;
    case 'widen': return run(a);
    case 'let': return evaluate(c, new Map(env).set(a, run(b)), flags, graph);
    case 'if': return run(a) ? run(b) : run(c);
    case 'guard':
      if (!run(a)) throw new CallFault('CALL_PRECONDITION');
      return run(b);
    case 'flag': return flags.get(a);
    case 'not': return !run(a);
    case 'and': return run(a) && run(b);
    case 'or': return run(a) || run(b);
    case '=': return equalValue(run(a), run(b));
    case 'make': return Object.fromEntries(b.map(([key, value]) => [key, run(value)]));
    case 'get': return run(a)[b];
    case 'append': {
      const values = run(a), item = run(b);
      if (values.length >= c) throw new CallFault('CAPACITY');
      return [...values, item];
    }
    case 'items': return b.map(run);
    case 'length32':
    case 'length': return run(a).length;
    case 'member': {
      const values = run(a), item = run(b);
      return values.some(value => equalValue(value,item));
    }
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
    case 'i32<':
    case '<': return run(a) < run(b);
    case 'i32<=':
    case '<=': return run(a) <= run(b);
    case '+':
    case '-':
    case 'u32+':
    case 'u32-':
    case 'i32+':
    case 'i32-': {
      const n = op.endsWith('+') ? run(a) + run(b) : run(a) - run(b);
      const signed = op.startsWith('i32');
      if (signed ? n < -2147483648 || n > 2147483647 : n < 0 || n > (op.startsWith('u32') ? 0xffffffff : 255))
        throw new RangeFault();
      return n;
    }
    default: throw new Error('Invalid instruction');
  }
}

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

function runValidated(f, values, snapshot) {
  if (f.collector) {
    const [names, requires, body, ensures] = f.graph[f.collector];
    const selector = {params: names.map(name => [name]), requires, body, ensures, graph: f.graph};
    const output = [];
    for (const row of values[0]) {
      const contribution = execute(selector, [row], snapshot);
      if (!contribution.ok) return contribution;
      if (contribution.value.tag === 'emit') output.push(contribution.value.value);
    }
    return {ok: true, value: output};
  }
  let outcome;
  if (f.capacity) {
    let state = values[0];
    const items = values[1];
    const admitted = predicate(f, 'requires', [state], snapshot);
    if (admitted !== true) return error(admitted === false ? 'PRECONDITION' : admitted === 'capacity-fault' ? 'CAPACITY' : 'ARITHMETIC', 'requires');
    for (const item of items) {
      const step = execute(f, [state, item], snapshot);
      if (!step.ok) return step;
      state = step.value;
    }
    outcome = {ok: true, value: state};
  } else outcome = execute(f, values, snapshot);
  return outcome;
}

function invoke(f, flags, args) {
  return atBoundary(f, flags, args, runValidated);
}

function predicate(f, field, args, flags, result) {
  const env = new Map(f.params.map(([key], i) => [key, args[i]]));
  if (field === 'ensures') env.set('result', result);
  try { return evaluate(f[field], env, flags, f.graph); }
  catch (e) {
    if (e instanceof CallFault && e.code === 'CAPACITY') return 'capacity-fault';
    if (e instanceof RangeFault) return 'arithmetic-fault';
    throw e;
  }
}

export { argument, execute, invoke, predicate };
