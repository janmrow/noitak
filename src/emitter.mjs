// Lower checked IR. Only compiler-generated identifiers enter binding and call
// positions. Source-provided field, grant and export names are quoted data.
import { readFile } from 'node:fs/promises';

const literal = JSON.stringify;

function emitFrame(id, frame, targets) {
  const [names, pre, body, post] = frame;
  const params = new Map(names.map((name,i) => [name, 'args[' + i + ']']));
  let serial = 0;
  const fresh = () => 'v' + serial++;

  function emit(expr, scope) {
    if (typeof expr === 'string') {
      if (!scope.has(expr)) throw new Error('Unbound IR name: ' + expr);
      return scope.get(expr);
    }
    if (!Array.isArray(expr)) return literal(expr);
    const [op,a,b,c] = expr;
    const run = e => emit(e,scope);
    switch (op) {
      case 'text-length': return '(' + run(a) + ').length';
      case 'starts-with': return '(' + run(a) + ').startsWith(' + run(b) + ')';
      case 'ends-with': return '(' + run(a) + ').endsWith(' + run(b) + ')';
      case 'contains': return '(' + run(a) + ').includes(' + run(b) + ')';
      case 'strip-prefix': return 'stripPrefix(' + run(a) + ', ' + run(b) + ')';
      case 'text':
      case 'i32':
      case 'u32':
      case 'uuid': return literal(a);
      case 'widen': return run(a);
      case 'guard': return '(' + run(a) + ' ? ' + run(b) + ' : rejectNested())';
      case 'flag': return 'flags.get(' + literal(a) + ')';
      case 'if': return '(' + run(a) + ' ? ' + run(b) + ' : ' + run(c) + ')';
      case 'not': return '(!' + run(a) + ')';
      case 'and': return '(' + run(a) + ' && ' + run(b) + ')';
      case 'or': return '(' + run(a) + ' || ' + run(b) + ')';
      case 'i32<':
      case 'i32<=': return '(' + run(a) + ' ' + op.slice(3) + ' ' + run(b) + ')';
      case '<':
      case '<=': return '(' + run(a) + ' ' + op + ' ' + run(b) + ')';
      case '=': return 'equalValue(' + run(a) + ', ' + run(b) + ')';
      case 'i32+':
      case 'i32-': return 'inRange(' + run(a) + ' ' + op.at(-1) + ' ' + run(b) + ', 2147483647, -2147483648)';
      case '+':
      case '-':
      case 'u32+':
      case 'u32-':
        return 'inRange(' + run(a) + ' ' + op.at(-1) + ' ' + run(b) + ', ' +
          (op.startsWith('u32') ? 0xffffffff : 255) + ')';
      case 'let': {
        const name = fresh();
        return '((' + name + ') => ' + emit(c,new Map(scope).set(a,name)) + ')(' + run(b) + ')';
      }
      case 'make':
        return '({' + b.map(([key,value]) => '[' + literal(key) + ']: ' + run(value)).join(', ') + '})';
      case 'get': return '(' + run(a) + ')[' + literal(b) + ']';
      case 'tag':
        return '({tag:' + literal(b) + (expr.length === 4 ? ', value:' + run(c) : '') + '})';
      case 'match': {
        const subject = fresh();
        const arms = b.map(([tag,binder,branch]) => {
          const inner = binder ? new Map(scope).set(binder,subject + '.value') : scope;
          return 'case ' + literal(tag) + ': return ' + emit(branch,inner) + ';';
        });
        return '((' + subject + ') => { switch (' + subject + '.tag) { ' + arms.join(' ') +
          ' } throw new Error("Invalid checked tag"); })(' + run(a) + ')';
      }
      case 'append': return 'appendItem(' + run(a) + ', ' + run(b) + ', ' + c + ')';
      case 'items': return '[' + b.map(run).join(', ') + ']';
      case 'length32':
      case 'length': return '(' + run(a) + ').length';
      case 'member': return 'hasMember(' + run(a) + ', ' + run(b) + ')';
      case 'fold': {
        const items = fresh(), acc = fresh(), index = fresh();
        const inner = new Map(scope).set(c[0],acc).set(c[1],items+'['+index+']').set(c[2],index);
        return '((' + items + ', ' + acc + ') => { for (let ' + index + '=0; ' + index + '<' +
          items + '.length; ' + index + '++) ' + acc + '=' + emit(expr[4],inner) + '; return ' +
          acc + '; })(' + run(a) + ', ' + run(b) + ')';
      }
      case 'apply':
      case 'attempt': {
        if (!targets.has(a)) throw new Error('Missing IR call target: ' + a);
        // The attempted position is strict and precedes the actual arguments.
        const index = op === 'attempt' ? run(expr[4]) : 'undefined';
        return 'nested(' + index + ', ' + targets.get(a) + ', flags, [' + b.map(run).join(', ') + '])';
      }
      default: throw new Error('Unsupported artifact instruction: ' + op);
    }
  }

  return 'const ' + id + ' = {\n' +
    '  pre: (args, flags) => ' + emit(pre,params) + ',\n' +
    '  body: (args, flags) => ' + emit(body,params) + ',\n' +
    '  post: (args, flags, result) => ' + emit(post,new Map(params).set('result','result')) + '\n};';
}

// Specialize frequently used, small record shapes. Larger layouts use the
// generic reader so a legal wide record cannot exhaust JS local-variable limits.
function emitReaders(entries) {
  const records = new Map();
  function visit(type) {
    if (type.fields && type.fields.length <= 32) records.set(type.name,type);
    else if (type.element) visit(type.element);
    else if (type.success) visit(type.success);
  }
  for (const entry of entries) {
    for (const [,type] of entry.params) visit(type);
    visit(entry.output);
  }
  const lines = ['const readers = new Map();'];
  for (const [i,record] of [...records.values()].entries()) {
    lines.push('const types' + i + ' = ' + literal(record.fields.map(([,type])=>type)) + ';',
      'readers.set(' + literal(record.name) + ', value => {');
    const fields = [];
    for (const [j,[key]] of record.fields.entries()) {
      const name = 'v' + j;
      lines.push('  const ' + name + ' = argument(types' + i + '[' + j +
        '], Object.getOwnPropertyDescriptor(value, ' + literal(key) + ')?.value, readers);',
        '  if (' + name + ' === undefined) return undefined;');
      fields.push('[' + literal(key) + ']: ' + name);
    }
    lines.push('  return {' + fields.join(', ') + '};', '});');
  }
  return lines.join('\n');
}

export async function emitModule(unit) {
  const entries = unit.functions.filter(f => f.kind === 'fn');
  const frames = new Map();
  for (const f of entries) {
    for (const [name,frame] of Object.entries(f.graph)) frames.set(name,frame);
    if (!f.collector) frames.set(f.name,[f.params.map(([name])=>name),f.requires,f.body,f.ensures]);
  }
  const targets = new Map([...frames.keys()].map((name,i)=>[name,'frame'+i]));
  const [boundary, execution] = await Promise.all(['boundary.mjs','compiled-runtime.js.inc'].map(
    file=>readFile(new URL(file,import.meta.url),'utf8')));
  // Both modules are compiler-owned templates. Inline their declarations into
  // one ESM. Only the frozen public API is exported by the deployed module.
  const lines = [boundary.replace(/^export /gm,''), execution, emitReaders(entries)];
  for (const [name,frame] of frames) lines.push(emitFrame(targets.get(name),frame,targets));
  lines.push('export const api = Object.create(null);');
  for (const [i,f] of entries.entries()) {
    const layout = {params:f.params, output:f.output, reads:f.reads, capacity:f.capacity};
    if (f.collector) {
      lines.push('const entry' + i + ' = ' + literal(layout) + ';',
        'function selectRow' + i + '(row, snapshot) {',
        '  return runCompiled(' + targets.get(f.collector) + ', [row], snapshot);',
        '}',
        'api[' + literal(f.name) + '] = (flags, ...args) => atBoundary(entry' + i + ', flags, args, (_entry, [rows], snapshot) => {',
        '  const output = [];',
        '  for (const row of rows) {',
        '    const contribution = selectRow' + i + '(row, snapshot);',
        '    if (!contribution.ok) return contribution;',
        '    if (contribution.value.tag === "emit") output.push(contribution.value.value);',
        '  }',
        '  return {ok:true,value:output};',
        '}, readers);');
      continue;
    }
    lines.push('const entry' + i + ' = Object.assign(' + literal(layout) + ', ' + targets.get(f.name) + ');',
      'api[' + literal(f.name) + '] = (flags, ...args) => atBoundary(entry' + i + ', flags, args, runCompiled, readers);');
  }
  if (unit.lookups?.length) {
    lines.push(await readFile(new URL('lookup-runtime.js.inc',import.meta.url),'utf8'),
      'export const services = Object.create(null);');
    for (const [i, service] of unit.lookups.entries()) {
      const planner = entries.find(f => f.name === service.planner);
      const resume = entries.find(f => f.name === service.resume);
      const spec = {resource:service.resource, params:planner.params, output:resume.output,
        reads:service.reads, reply:resume.params.at(-1)[1]};
      lines.push('const lookup' + i + ' = ' + literal(spec) + ';',
        'services[' + literal(service.name) + '] = (grant, flags, ...args) => performLookup(lookup' +
        i + ', ' + targets.get(planner.name) + ', ' + targets.get(resume.name) + ', grant, flags, args);');
    }
    lines.push('Object.freeze(services);');
  }
  return [...lines,'Object.freeze(api);',''].join('\n');
}
