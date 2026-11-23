import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse, Diagnostic, fail } from './parser.mjs';
import { compileModule, importsOf } from './frontend.mjs';

// Resolve only named siblings. Every pin covers the exact bytes read for this build.
export async function load(path) {
  const loaded = new Map(), active = new Set();
  async function visit(file, identity, expected) {
    if (active.has(identity)) throw new Diagnostic('E_IMPORT', {file}, 'Cyclic import: ' + identity);
    const cached = loaded.get(identity);
    if (cached) {
      if (cached.digest !== expected) throw new Diagnostic('E_IMPORT', {file}, 'Conflicting dependency pin');
      return cached;
    }
    if (loaded.size + active.size >= 64) throw new Diagnostic('E_LIMIT', {file}, 'Module graph exceeds 64 files');
    active.add(identity);
    try {
      const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | (expected ? constants.O_NOFOLLOW : 0));
      let bytes;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 1048576) throw new Diagnostic('E_LIMIT', {file}, 'Expected a regular source file up to 1 MiB');
        bytes = await handle.readFile();
        if (bytes.length > 1048576) throw new Diagnostic('E_LIMIT', {file}, 'Source exceeds 1 MiB');
      } finally { await handle.close(); }
      const digest = createHash('sha256').update(bytes).digest('hex');
      const root = parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
      if (expected && (digest !== expected || root.items?.[1]?.atom !== identity))
        fail(root, 'E_IMPORT', 'Dependency identity or SHA-256 mismatch: ' + identity);
      const deps = new Map();
      for (const [key, pin] of importsOf(root)) {
        if (key === root.items[1].atom || key === rootIdentity) fail(root, 'E_IMPORT', 'Cyclic import: ' + key);
        if (identity === null) rootIdentity = root.items[1].atom;
        deps.set(key, await visit(join(dirname(file), key + '.noi'), key, pin));
      }
      const unit = compileModule(root, deps, expected ? identity + '.' : '');
      const item = {unit, bytes, digest};
      loaded.set(identity, item);
      return item;
    } catch (e) {
      if (e instanceof Diagnostic) e.detail.file ??= file;
      throw e;
    } finally { active.delete(identity); }
  }
  let rootIdentity;
  const entry = await visit(path, null, null);
  loaded.delete(null);
  entry.unit.dependencies = Object.fromEntries([...loaded].map(([key, item]) => [key, item.digest]).sort());
  return entry;
}
