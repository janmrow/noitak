import { readFile, mkdir, mkdtemp, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { hash } from './verify.mjs';

const ts = t => t === 'byte' ? 'number' : 'boolean';

function declarations(functions) {
  const lines = [
    "export type Result<T> = { ok: true; value: T } | { ok: false; code: 'ARGUMENT' | 'CAPABILITY' | 'ARITHMETIC' | 'PRECONDITION' | 'POSTCONDITION'; phase: 'boundary' | 'requires' | 'body' | 'ensures' };",
    'export declare const api: {'
  ];
  for (const f of functions) {
    const flags = f.reads.map(k => 'readonly ' + k + ': boolean').join('; ');
    const params = f.params.map(([name, t]) => 'arg_' + name + ': ' + ts(t));
    lines.push('  readonly ' + f.name + ': (' + ['flags: { ' + flags + ' } & object', ...params].join(', ') +
      ') => Result<' + ts(f.output) + '>;');
  }
  return [...lines, '};', ''].join('\n');
}

export async function build(unit, report, destination) {
  if (!report.passed) throw new Error('Required proof failed');
  const runtime = await readFile(new URL('./runtime.mjs', import.meta.url), 'utf8');
  const core = runtime.replace('export { execute, invoke };', '');
  const functions = JSON.stringify(unit.functions.map(({loc, ...f}) => f));
  const js = core + '\nconst functions = ' + functions + ';\n' +
    'export const api = Object.freeze(Object.fromEntries(functions.map(f => [f.name, (flags, ...args) => invoke(f, flags, args)])));\n';
  const types = declarations(unit.functions);
  const manifest = { ...report, artifacts: { 'module.mjs': hash(js), 'module.d.mts': hash(types) } };
  const target = resolve(destination);
  try {
    await lstat(target);
    throw new Error('Build destination already exists: ' + target);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(dirname(target), { recursive: true });
  const temp = await mkdtemp(join(dirname(target), '.noi-'));
  try {
    for (const [file, data] of [['module.mjs', js], ['module.d.mts', types],
      ['report.json', JSON.stringify(manifest, null, 2) + '\n']])
      await writeFile(join(temp, file), data);
    await rename(temp, target);
  } finally { await rm(temp, { recursive: true, force: true }); }
  return manifest;
}
