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

function recordType(node, enums) {
  const [id, ...entries] = form(node, 'record');
  if (!entries.length) fail(node, 'E_FORM', 'Expected a record with named fields');
  const key = name(id);
  if (['byte', 'bool'].includes(key)) fail(id, 'E_TYPE', 'Cannot redefine a scalar type');
  const fields = new Map();
  for (const entry of entries) {
    const parts = list(entry);
    if (parts.length !== 2) fail(entry, 'E_FORM', 'Expected (field scalar-or-enum-type)');
    bind(fields, parts[0], type(parts[1], enums));
  }
  return { name: key, fields: [...fields] };
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

function expression(node, env, context) {
  const { reads, types, helpers } = context;
  const check = (expr, scope = env) => expression(expr, scope, context);
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
  if (op === 'make') {
    if (!args.length) fail(node, 'E_FORM', 'Expected record type');
    const record = type(args[0], types);
    if (!record.fields) fail(args[0], 'E_TYPE', 'Expected record type');
    if (args.length !== record.fields.length + 1) fail(node, 'E_FORM', 'Incorrect record field count');
    const fields = record.fields.map(([key, wanted], i) => {
      const entry = args[i + 1];
      const parts = list(entry);
      if (parts.length !== 2 || parts[0].atom !== key)
        fail(entry, 'E_FIELD', 'Expected field ' + key + ' in declaration order');
      const [actual, value] = check(parts[1]);
      expect(entry, actual, wanted);
      return [key, value];
    });
    return [record, ['make', record.name, fields]];
  }
  if (op === 'get') {
    if (args.length !== 2) fail(node, 'E_FORM', 'Expected (get record field)');
    const [record, value] = check(args[0]);
    const field = record.fields?.find(([key]) => key === args[1].atom);
    if (!field) fail(args[1], 'E_FIELD', 'Unknown record field');
    return [field[1], ['get', value, field[0]]];
  }
  if (op === 'call') {
    const target = helpers?.get(args[0]?.atom);
    if (!target) fail(node, 'E_CALL', 'Calls in bodies must name a previously declared helper');
    if (args.length !== target.params.length + 1) fail(node, 'E_FORM', 'Incorrect call arity');
    for (const grant of target.reads)
      if (!reads.includes(grant)) fail(node, 'E_EFFECT', 'Call requires undeclared flag: ' + grant);
    context.calls.add(target.name);
    const values = target.params.map(([, wanted], i) => {
      const [actual, ir] = check(args[i + 1]);
      expect(args[i + 1], actual, wanted);
      return ir;
    });
    // A closed call frame retains the exact implementation reviewed by the caller.
    return [target.output, ['call', target.name, target.params.map(([key]) => key), values,
      target.requires, target.body, target.ensures]];
  }
  if (op === 'tag') {
    if (args.length < 2) fail(node, 'E_FORM', 'Expected enum and variant');
    const enumeration = type(args[0], types);
    const variant = enumeration.variants?.find(v => v.tag === args[1].atom);
    if (!variant) fail(args[1], 'E_VARIANT', 'Unknown variant');
    if (args.length !== (variant.payload ? 3 : 2)) fail(node, 'E_FORM', 'Incorrect variant payload count');
    const ir = ['tag', enumeration.name, variant.tag];
    if (variant.payload) {
      const [actual, value] = check(args[2]);
      expect(args[2], actual, variant.payload);
      ir.push(value);
    }
    return [enumeration, ir];
  }
  if (op === 'match') {
    if (!args.length) fail(node, 'E_FORM', 'Expected match subject');
    const [subjectType, subject] = check(args[0]);
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
      const [actual, value] = check(fields.at(-1), inner);
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
    const [valueType, value] = check(args[1]);
    const inner = new Map(env);
    const key = bind(inner, args[0], valueType);
    const [bodyType, body] = check(args[2], inner);
    return [bodyType, [op, key, value, body]];
  }
  const operands = args.map(arg => check(arg));
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

function fn(node, types, helpers) {
  const kind = node.items?.[0]?.atom === 'helper' ? 'helper' : 'fn';
  const fields = form(node, kind);
  if (![7, 8].includes(fields.length)) fail(node, 'E_FORM', 'Malformed function declaration');
  const [id, paramsNode, ret, effects] = fields;
  const [pre, post, body] = fields.slice(-3);
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
  const protectedParams = new Map();
  if (fields.length === 8) {
    const names = form(fields[4], 'independent');
    if (!names.length) fail(fields[4], 'E_FORM', 'Expected at least one independent parameter');
    for (const item of names) {
      const key = bind(protectedParams, item, true);
      if (!env.has(key)) fail(item, 'E_NAME', 'Unknown independent parameter: ' + key);
    }
  }
  const calls = new Set();
  const checked = (expr, scope, t, callable) => {
    const [actual, ir] = expression(expr, scope, { reads, types, helpers: callable, calls });
    expect(expr, actual, t);
    return ir;
  };
  return { name: name(id), kind, params, output, reads, independent: [...protectedParams.keys()].sort(),
    requires: checked(form(pre, 'requires', 2)[0], env, 'bool'),
    ensures: checked(form(post, 'ensures', 2)[0], new Map(env).set('result', output), 'bool'),
    body: checked(body, env, output, helpers), calls: [...calls].sort(), loc: id.loc };
}

export function compile(source) {
  const root = parse(source);
  const [id, version, ...defs] = form(root, 'module');
  if (!defs.length || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version?.atom))
    fail(root, 'E_FORM', 'Expected module name, numeric version and at least one function');
  const seen = new Map();
  const enums = new Map();
  const tag = node => node.items?.[0]?.atom;
  for (const node of defs.filter(n => tag(n) === 'enum'))
    bind(enums, node.items[1] ?? node, enumeration(node));
  const types = new Map(enums);
  for (const node of defs.filter(n => tag(n) === 'record'))
    bind(types, node.items[1] ?? node, recordType(node, enums));
  const helpers = new Map();
  const functions = [];
  for (const node of defs.filter(n => !['enum', 'record'].includes(tag(n)))) {
    const f = fn(node, types, helpers);
    bind(seen, node.items[1], f);
    boundExpansion(node, f.body);
    if (f.kind === 'helper') helpers.set(f.name, f);
    functions.push(f);
  }
  if (!functions.some(f => f.kind === 'fn')) fail(root, 'E_FORM', 'Expected at least one public function');
  return { enums: [...enums.values()], records: [...types.values()].filter(t => t.fields),
    name: name(id), version: version.atom, functions };
}

// Walk shared subtrees per occurrence. Stop before serializing or running a
// compact call graph whose expanded expression would exceed the language limit.
function boundExpansion(node, body) {
  let remaining = 16384;
  function visit(value, depth) {
    if (--remaining < 0 || depth > 192) fail(node, 'E_LIMIT', 'Expanded body exceeds size or depth limit');
    if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
  }
  visit(body, 0);
}
