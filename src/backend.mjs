import { readFile, mkdir, mkdtemp, writeFile, rename, rm, rmdir, lstat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { hash } from './verify.mjs';

const scalarTypes = {byte: 'number', u32: 'number', bool: 'boolean', uuid: 'string'};

function ts(t) {
  if (typeof t === 'string') return scalarTypes[t];
  const prefix = t.element ? 'Seq_' : t.fields ? 'Record_' : 'Enum_';
  return prefix + t.name.replaceAll('.', '$');
}

function declarations({ functions, enums, records, types }) {
  const lines = [
    "export type Result<T> = { ok: true; value: T } | { ok: false; code: 'ARGUMENT' | 'CAPABILITY' | 'ARITHMETIC' | 'PRECONDITION' | 'POSTCONDITION' | 'CALL_PRECONDITION' | 'CALL_POSTCONDITION'; phase: 'boundary' | 'requires' | 'body' | 'ensures' };",
  ];
  for (const e of enums) {
    const members = e.variants.map(({tag, payload}) =>
      '{ readonly tag: ' + JSON.stringify(tag) + (payload ? '; readonly value: ' + ts(payload) : '') + ' }');
    lines.push('export type ' + ts(e) + ' = ' + members.join(' | ') + ';');
  }
  for (const record of records) {
    const fields = record.fields.map(([key, t]) => 'readonly ' + key + ': ' + ts(t));
    lines.push('export type ' + ts(record) + ' = { ' + fields.join('; ') + ' };');
  }
  for (const t of types.filter(t => t.element))
    lines.push('export type ' + ts(t) + ' = ReadonlyArray<' + ts(t.element) + '>;');
  lines.push('export declare const api: {');
  for (const f of functions.filter(f => f.kind === 'fn')) {
    if (f.capacity)
      lines.push('  /** Ordered reduction. Maximum input length: ' + f.capacity + '. */');
    if (f.independent.length)
      lines.push('  /** Verified admission and return value independence from ' + f.independent.join(', ') + '. */');
    const flags = f.reads.map(k => 'readonly ' + k + ': boolean').join('; ');
    const params = f.params.map(([name, t], i) => 'arg_' + name + ': ' +
      (f.capacity && i === 1 ? 'ReadonlyArray<' + ts(t) + '>' : ts(t)));
    lines.push('  readonly ' + f.name + ': (' + ['flags: { ' + flags + ' } & object', ...params].join(', ') +
      ') => Result<' + ts(f.output) + '>;');
  }
  return [...lines, '};', ''].join('\n');
}

export async function publishDirectory(staged, target) {
  // Windows directory renames already fail when the destination directory exists.
  if (process.platform === 'win32') return rename(staged, target);
  // POSIX rename can replace an empty directory. Claim the name before renaming.
  await mkdir(target, { mode: 0o700 });
  try {
    await rename(staged, target);
  } catch (error) {
    await rmdir(target);
    throw error;
  }
}

export async function build(unit, report, destination, review) {
  if (!report.passed) throw new Error('Required proof failed');
  const runtime = await readFile(new URL('./runtime.mjs', import.meta.url), 'utf8');
  const exports = 'export { argument, execute, invoke, predicate };';
  if (!runtime.trimEnd().endsWith(exports)) throw new Error('Unexpected runtime export layout');
  const core = runtime.trimEnd().slice(0, -exports.length);
  const entries = unit.functions.filter(f => f.kind === 'fn');
  const graph = Object.fromEntries(entries.flatMap(f => Object.entries(f.graph)));
  const functions = JSON.stringify(entries.map(({loc, graph, budget, ...f}) => f));
  const js = core + '\nconst graph = ' + JSON.stringify(graph) + ';\nconst functions = ' + functions + ';\n' +
    'export const api = Object.create(null);\n' +
    'for (const f of functions) { f.graph = graph; api[f.name] = (flags, ...args) => invoke(f, flags, args); }\n' +
    'Object.freeze(api);\n';
  const types = declarations(unit);
  const files = new Map([['module.mjs', js], ['module.d.mts', types]]);
  if (review) {
    if (!review.passed || review.after.sourceSha256 !== report.sourceSha256)
      throw new Error('Review does not authorize this source');
    files.set('review.json', JSON.stringify(review, null, 2) + '\n');
  }
  const artifacts = Object.fromEntries([...files].map(([name, content]) => [name, hash(content)]));
  const manifest = { ...report, artifacts };
  files.set('report.json', JSON.stringify(manifest, null, 2) + '\n');
  const target = resolve(destination);
  try {
    await lstat(target);
    throw new Error('Build destination already exists: ' + target);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(dirname(target), { recursive: true });
  const temp = await mkdtemp(join(dirname(target), '.noitak-'));
  try {
    for (const [file, data] of files)
      await writeFile(join(temp, file), data);
    await publishDirectory(temp, target);
  } finally { await rm(temp, { recursive: true, force: true }); }
  return manifest;
}
