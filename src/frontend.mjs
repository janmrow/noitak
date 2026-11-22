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

function type(node, types) {
  if (['byte', 'bool'].includes(node.atom)) return node.atom;
  if (types.has(node.atom)) return types.get(node.atom);
  fail(node, 'E_TYPE', 'Unknown type: ' + node.atom);
}

function enumeration(node) {
  const [id, ...entries] = form(node, 'enum');
  if (!entries.length) fail(node, 'E_FORM', 'Expected a type name and one or more variants');
  const key = name(id);
  if (['byte', 'bool'].includes(key)) fail(id, 'E_TYPE', 'Cannot redefine a scalar type');
  const tags = new Map();
  for (const entry of entries) {
    const fields = list(entry);
    if (![1, 2].includes(fields.length)) fail(entry, 'E_FORM', 'Expected (tag) or (tag scalar-type)');
    bind(tags, fields[0], fields[1] ? type(fields[1], new Map()) : null);
  }
  const variants = [...tags.keys()].sort().map(tag => ({ tag, payload: tags.get(tag) }));
  return { name: key, variants };
}

function expect(node, actual, wanted) {
  if (actual !== wanted) fail(node, 'E_TYPE', 'Expected ' + (wanted.name ?? wanted) + ', got ' + (actual.name ?? actual));
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

function expression(node, env, reads, types) {
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
  if (op === 'tag') {
    if (args.length < 2) fail(node, 'E_FORM', 'Expected enum and variant');
    const enumeration = type(args[0], types);
    const variant = enumeration.variants?.find(v => v.tag === args[1].atom);
    if (!variant) fail(args[1], 'E_VARIANT', 'Unknown variant');
    if (args.length !== (variant.payload ? 3 : 2)) fail(node, 'E_FORM', 'Incorrect variant payload count');
    const ir = ['tag', enumeration.name, variant.tag];
    if (variant.payload) {
      const [actual, value] = expression(args[2], env, reads, types);
      expect(args[2], actual, variant.payload);
      ir.push(value);
    }
    return [enumeration, ir];
  }
  if (op === 'match') {
    if (!args.length) fail(node, 'E_FORM', 'Expected match subject');
    const [subjectType, subject] = expression(args[0], env, reads, types);
    if (!subjectType.variants) fail(args[0], 'E_TYPE', 'Expected an enum');
    const arms = new Map();
    let output;
    for (const arm of args.slice(1)) {
      const [label, ...fields] = list(arm);
      const variant = subjectType.variants.find(v => v.tag === label?.atom);
      if (!variant || arms.has(variant.tag)) fail(arm, 'E_VARIANT', 'Unknown or repeated match arm');
      if (fields.length !== (variant.payload ? 2 : 1)) fail(arm, 'E_FORM', 'Incorrect match arm arity');
      const inner = new Map(env);
      const binder = variant.payload ? bind(inner, fields[0], variant.payload) : null;
      const [actual, value] = expression(fields.at(-1), inner, reads, types);
      output ??= actual;
      expect(arm, actual, output);
      arms.set(variant.tag, [variant.tag, binder, value]);
    }
    if (arms.size !== subjectType.variants.length) fail(node, 'E_MATCH', 'Missing match arm');
    return [output, ['match', subject, subjectType.variants.map(v => arms.get(v.tag))]];
  }
  if (!arities.has(op) || arities.get(op) !== args.length)
    fail(node, 'E_FORM', 'Unknown operator or incorrect operand count: ' + op);
  if (op === 'flag') {
    const key = name(args[0]);
    if (!reads.includes(key)) fail(args[0], 'E_EFFECT', 'Undeclared flag: ' + key);
    return ['bool', [op, key]];
  }
  if (op === 'let') {
    const [valueType, value] = expression(args[1], env, reads, types);
    const inner = new Map(env);
    const key = bind(inner, args[0], valueType);
    const [bodyType, body] = expression(args[2], inner, reads, types);
    return [bodyType, [op, key, value, body]];
  }
  const operands = args.map(arg => expression(arg, env, reads, types));
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

function fn(node, types) {
  const [id, paramsNode, ret, effects, pre, post, body] = form(node, 'fn', 8);
  const env = new Map();
  const params = list(paramsNode).map(p => {
    if (list(p).length !== 2) fail(p, 'E_FORM', 'Expected (name type)');
    const t = type(p.items[1], types);
    return [bind(env, p.items[0], t), t];
  });
  const output = type(ret, types);
  const grants = new Map();
  for (const item of form(effects, 'reads')) bind(grants, item, 'bool');
  const reads = [...grants.keys()].sort();
  const checked = (expr, scope, t) => {
    const [actual, ir] = expression(expr, scope, reads, types);
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
  const types = new Map();
  const declarations = defs.filter(node => node.items?.[0]?.atom === 'enum');
  for (const node of declarations) bind(types, node.items[1] ?? node, enumeration(node));
  const functions = defs.filter(node => node.items?.[0]?.atom !== 'enum').map(node => {
    const f = fn(node, types);
    bind(seen, node.items[1], f);
    return f;
  });
  if (!functions.length) fail(root, 'E_FORM', 'Expected at least one function');
  return { enums: [...types.values()], name: name(id), version: version.atom, functions };
}
