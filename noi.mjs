#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { compile } from './src/frontend.mjs';
import { Diagnostic } from './src/parser.mjs';
import { verify, DEFAULT_LIMIT } from './src/verify.mjs';
import { compare } from './src/diff.mjs';
import { build } from './src/backend.mjs';
import { testVectors } from './src/vectors.mjs';

const usage = 'noi <check FILE | verify FILE | build FILE NEW_DIR | diff OLD NEW | test FILE VECTORS> [--json] [--limit N]';
const argv = process.argv.slice(2);
const json = argv.includes('--json');
function print(data) {
  if (json) console.log(JSON.stringify(data));
  else if (data.diagnostic) console.error(Object.values(data.diagnostic).join(' '));
  else if (data.changes) {
    console.log(data.passed ? 'Policy passed' : 'Review required');
    for (const c of data.changes) {
      console.log(c.status, c.subject, c.field, JSON.stringify(c.before), '->', JSON.stringify(c.after));
      if (c.witness) console.log('  Witness', JSON.stringify(c.witness));
      if (c.equalOutcomes) console.log('  Equal outcomes on', c.equalOutcomes, 'tuples');
    }
  } else console.log(JSON.stringify(data, null, 2));
}
async function load(path) {
  const bytes = await readFile(path);
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { unit: compile(source), bytes };
  } catch (e) {
    if (e instanceof Diagnostic) e.detail.file = path;
    throw e;
  }
}
async function main() {
  if (argv[0] === '--help') { console.log(usage); return; }
  const [command, ...tokens] = argv;
  const positions = [];
  let limit = DEFAULT_LIMIT;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--limit') limit = Number(tokens[++i]);
    else if (tokens[i] === '--json') continue;
    else if (tokens[i].startsWith('--')) throw new Error(usage);
    else positions.push(tokens[i]);
  }
  const counts = new Map([['check',1], ['verify',1], ['test',2], ['build',2], ['diff',2]]);
  if (positions.length !== counts.get(command) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000000)
    throw new Error(usage);
  const [path, other] = positions;
  const {unit, bytes} = await load(path);
  let report;
  if (command === 'check') report = { module: unit.name, status: 'typechecked', passed: true };
  else if (command === 'test') report = testVectors(unit, JSON.parse(await readFile(other, 'utf8')));
  else {
    report = verify(unit, bytes, limit);
    if (command === 'diff') {
      const newer = await load(other);
      report = compare(unit, newer.unit, report, verify(newer.unit, newer.bytes, limit));
    } else if (command === 'build' && report.passed) report = await build(unit, report, other);
  }
  print(report);
  if (!report.passed) process.exitCode = 1;
}
try { await main(); } catch (e) {
  print({ diagnostic: e instanceof Diagnostic ? e.detail : { code: 'E_TOOL', message: e.message } });
  process.exitCode = e instanceof Diagnostic ? 1 : 2;
}
