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

function expression(node, env, context, depth = 1) {
  const { budget } = context;
  budget.work++;
  budget.depth = Math.max(budget.depth, depth);
  const { reads, types, helpers } = context;
  const check = (expr, scope = env) => expression(expr, scope, context, depth + 1);
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
  if (op === 'items') {
    if (!args.length) fail(node, 'E_FORM', 'Expected a sequence type');
    const sequence = type(args[0], types);
    if (!sequence.element) fail(args[0], 'E_TYPE', 'Expected a sequence type');
    if (args.length - 1 > sequence.capacity) fail(node, 'E_LIMIT', 'Sequence literal exceeds capacity');
    const values = args.slice(1).map(arg => {
      const [actual, ir] = check(arg);
      expect(arg, actual, sequence.element);
      return ir;
    });
    return [sequence, ['items', sequence.name, values]];
  }
  if (op === 'length' || op === 'fold') {
    if (args.length !== (op === 'length' ? 1 : 4)) fail(node, 'E_FORM', 'Incorrect sequence operation arity');
    const [sequence, value] = check(args[0]);
    if (!sequence.element) fail(args[0], 'E_TYPE', 'Expected a sequence');
    if (op === 'length') return ['byte', ['length', value]];
    const [acc, initial] = check(args[1]);
    const scope = new Map(env);
    const binders = list(args[2]);
    if (binders.length !== 3) fail(args[2], 'E_FORM', 'Expected (accumulator element index)');
    const names = binders.map((b, i) => bind(scope, b, [acc, sequence.element, 'byte'][i]));
    const start = budget.work;
    const [out, body] = check(args[3], scope);
    expect(args[3], out, acc);
    budget.work += (sequence.capacity - 1) * (budget.work - start);
    return [acc, ['fold', value, initial, names, body, sequence.capacity]];
  }
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
  if (op === 'call' || op === 'attempt') {
    let outcome, index;
    if (op === 'attempt') {
      if (args.length < 3) fail(node, 'E_FORM', 'Expected (attempt outcome index target arguments...)');
      outcome = type(args.shift(), types);
      if (!outcome.success) fail(node, 'E_TYPE', 'Expected an outcome type');
      const position = args.shift();
      const [actual, ir] = check(position);
      expect(position, actual, 'byte');
      index = ir;
    }
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
    budget.work += target.budget.work;
    budget.depth = Math.max(budget.depth, depth + target.budget.depth);
    if (outcome) {
      expect(node, target.output, outcome.success);
      return [outcome, ['attempt', target.name, values, outcome.name, index]];
    }
    return [target.output, ['apply', target.name, values]];
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

function fn(node, types, helpers, prefix) {
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
  const budget = { work: 0, depth: 0 };
  const checked = (expr, scope, t, callable) => {
    const [actual, ir] = expression(expr, scope, { reads, types, helpers: callable, calls, budget });
    expect(expr, actual, t);
    return ir;
  };
  return { name: prefix + name(id), kind, params, output, reads, independent: [...protectedParams.keys()].sort(),
    requires: checked(form(pre, 'requires', 2)[0], env, 'bool'),
    ensures: checked(form(post, 'ensures', 2)[0], new Map(env).set('result', output), 'bool'),
    body: checked(body, env, output, helpers), calls: [...calls].sort(), budget, loc: id.loc };
}

export function importsOf(root) {
  const imports = new Map();
  for (const node of form(root, 'module').slice(2).filter(node => node.items?.[0]?.atom === 'import')) {
    const [id, digest] = form(node, 'import', 3);
    bind(imports, id, digest.atom);
    if (!/^[a-f0-9]{64}$/.test(digest.atom ?? '')) fail(digest, 'E_IMPORT', 'Expected a SHA-256 digest');
  }
  return imports;
}

export function compile(source) {
  return compileModule(parse(source), new Map());
}

export function compileModule(root, dependencies, prefix = '') {
  const [id, version, ...defs] = form(root, 'module');
  if (!defs.length || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version?.atom))
    fail(root, 'E_FORM', 'Expected module name, numeric version and at least one function');
  const moduleName = name(id);
  const types = new Map(), helpers = new Map(), seen = new Map();
  const allTypes = new Map(), allFunctions = new Map();
  for (const [key, digest] of importsOf(root)) {
    const dep = dependencies.get(key);
    if (dep?.digest !== digest || dep.unit.name !== key) fail(root, 'E_IMPORT', 'Missing or mismatched import: ' + key);
    for (const t of dep.unit.types) allTypes.set(t.name, t);
    for (const f of dep.unit.functions) allFunctions.set(f.name, f);
    for (const t of dep.unit.localTypes) types.set(t.name, t);
    for (const f of dep.unit.localFunctions) if (f.kind === 'imported') helpers.set(f.name, f);
  }
  const localTypes = [], localFunctions = [];
  const tag = node => node.items?.[0]?.atom;
  function declare(node, t) {
    bind(types, node.items[1], t);
    t.name = prefix + t.name;
    localTypes.push(t);
    allTypes.set(t.name,t);
  }
  for (const node of defs.filter(n => tag(n) === 'enum')) declare(node, enumeration(node));
  const enums = new Map([...types].filter(([,t]) => t.variants && !t.success));
  for (const node of defs.filter(n => tag(n) === 'record')) declare(node, recordType(node, enums));
  for (const node of defs.filter(n => tag(n) === 'sequence' || tag(n) === 'outcome')) {
    const kind = tag(node);
    const [id, item, size] = form(node, kind, kind === 'sequence' ? 4 : 3);
    const key = name(id), element = type(item, types);
    if (['byte','bool'].includes(key) || element.element || element.success)
      fail(node, 'E_TYPE', 'Expected a new name and scalar, enum or record element type');
    if (kind === 'sequence') {
      if (!/^[1-8]$/.test(size.atom ?? '')) fail(size, 'E_LIMIT', 'Sequence capacity must be 1 through 8');
      declare(node, {name:key, element, capacity:Number(size.atom)});
    } else {
      declare(node, {name:key, success:element, variants:[{tag:'committed',payload:element}, {tag:'rejected',payload:'byte'}]});
    }
  }
  for (const node of defs.filter(n => !['import','enum','record','sequence','outcome'].includes(tag(n)))) {
    const f = fn(node, types, helpers, prefix);
    const local = bind(seen, node.items[1], f);
    if (f.budget.work > 16384 || f.budget.depth > 192) fail(node, 'E_LIMIT', 'Expression work or depth exceeds limit');
    const frames = new Map();
    for (const key of f.calls) {
      const target = allFunctions.get(key);
      for (const entry of Object.entries(target.graph)) frames.set(...entry);
      frames.set(key, [target.params.map(([k]) => k), target.requires, target.body, target.ensures]);
    }
    f.graph = Object.fromEntries([...frames].sort(([a],[b]) => a < b ? -1 : 1));
    if (f.kind === 'helper') helpers.set(local, f);
    else if (prefix) f.kind = 'imported';
    allFunctions.set(f.name,f);
    localFunctions.push(f);
  }
  if (!localFunctions.some(f => f.kind !== 'helper')) fail(root, 'E_FORM', 'Expected at least one public function');
  const declarations = [...allTypes.values()];
  return { types: declarations, localTypes, localFunctions,
    enums: declarations.filter(t => t.variants), records: declarations.filter(t => t.fields),
    name: moduleName, version: version.atom, functions: [...allFunctions.values()] };
}
