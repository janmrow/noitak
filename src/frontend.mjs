import { parse, fail } from './parser.mjs';

function list(node) {
  if (!node.items) fail(node, 'E_FORM', 'Expected a list');
  return node.items;
}

function form(node, tag, size) {
  const items = list(node);
  if (items[0]?.atom !== tag || (size !== undefined && items.length !== size))
    fail(node, 'E_FORM', 'Malformed ' + tag + ' declaration');
  return items.slice(1);
}

function name(node) {
  if (!node.atom || !/^[a-z][a-z0-9_]*$/.test(node.atom) ||
      ['true', 'false', 'result'].includes(node.atom))
    fail(node, 'E_NAME', 'Expected a non-reserved identifier');
  return node.atom;
}

function type(node) {
  if (!['byte', 'bool'].includes(node.atom)) fail(node, 'E_TYPE', 'Expected byte or bool');
  return node.atom;
}

function expect(node, actual, wanted) {
  if (actual !== wanted) fail(node, 'E_TYPE', 'Expected ' + wanted + ', got ' + actual);
}

function bind(env, node, value) {
  const key = name(node);
  if (env.has(key)) fail(node, 'E_DUPLICATE', 'Repeated binding: ' + key);
  env.set(key, value);
  return key;
}

const arities = new Map(Object.entries({
  let: 3, if: 3, flag: 1, not: 1, and: 2, or: 2, '+': 2, '-': 2, '<': 2, '<=': 2, '=': 2
}));

function expression(node, env, reads) {
  if (node.atom !== undefined) {
    const s = node.atom;
    if (['true', 'false'].includes(s)) return ['bool', s === 'true'];
    if (/^(0|[1-9][0-9]*)$/.test(s)) {
      if (Number(s) > 255) fail(node, 'E_RANGE', 'Byte literal exceeds 255');
      return ['byte', Number(s)];
    }
    if (!env.has(s)) fail(node, 'E_NAME', 'Unknown value: ' + s);
    return [env.get(s), s];
  }
  const [head, ...args] = list(node);
  const op = head?.atom;
  if (!arities.has(op) || arities.get(op) !== args.length)
    fail(node, 'E_FORM', 'Unknown operator or incorrect operand count: ' + op);
  if (op === 'flag') {
    const key = name(args[0]);
    if (!reads.includes(key)) fail(args[0], 'E_EFFECT', 'Undeclared flag: ' + key);
    return ['bool', [op, key]];
  }
  if (op === 'let') {
    const [valueType, value] = expression(args[1], env, reads);
    const inner = new Map(env);
    const key = bind(inner, args[0], valueType);
    const [bodyType, body] = expression(args[2], inner, reads);
    return [bodyType, [op, key, value, body]];
  }
  const operands = args.map(arg => expression(arg, env, reads));
  const operandTypes = operands.map(([t]) => t);
  let out;
  if (op === 'if') {
    expect(args[0], operandTypes[0], 'bool');
    expect(args[2], operandTypes[2], operandTypes[1]);
    out = operandTypes[1];
  } else {
    const input = op === '=' ? operandTypes[0] :
      ['not', 'or', 'and'].includes(op) ? 'bool' : 'byte';
    args.forEach((arg, i) => expect(arg, operandTypes[i], input));
    out = ['+', '-'].includes(op) ? 'byte' : 'bool';
  }
  return [out, [op, ...operands.map(([, e]) => e)]];
}

function fn(node) {
  const [id, paramsNode, ret, effects, pre, post, body] = form(node, 'fn', 8);
  const env = new Map();
  const params = list(paramsNode).map(p => {
    if (list(p).length !== 2) fail(p, 'E_FORM', 'Expected (name type)');
    const t = type(p.items[1]);
    return [bind(env, p.items[0], t), t];
  });
  const output = type(ret);
  const grants = new Map();
  for (const item of form(effects, 'reads')) bind(grants, item, 'bool');
  const reads = [...grants.keys()].sort();
  const checked = (expr, scope, t) => {
    const [actual, ir] = expression(expr, scope, reads);
    expect(expr, actual, t);
    return ir;
  };
  return { name: name(id), params, output, reads,
    requires: checked(form(pre, 'requires', 2)[0], env, 'bool'),
    ensures: checked(form(post, 'ensures', 2)[0], new Map(env).set('result', output), 'bool'),
    body: checked(body, env, output), loc: id.loc };
}

export function compile(source) {
  const root = parse(source);
  const [id, version, ...defs] = form(root, 'module');
  if (!defs.length || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version?.atom))
    fail(root, 'E_FORM', 'Expected module name, numeric version and at least one function');
  const seen = new Map();
  const functions = defs.map(node => {
    const f = fn(node);
    bind(seen, node.items[1], f);
    return f;
  });
  return { name: name(id), version: version.atom, functions };
}
