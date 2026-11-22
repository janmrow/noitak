#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { compile } from './src/frontend.mjs';
import { Diagnostic } from './src/parser.mjs';
import { verify, DEFAULT_LIMIT } from './src/verify.mjs';
import { compare } from './src/diff.mjs';
import { build } from './src/backend.mjs';
import { testVectors } from './src/vectors.mjs';

import { formatReview } from './src/review.mjs';

const usage = 'noitak <check FILE | verify FILE | build FILE NEW_DIR | diff OLD NEW | gate OLD NEW NEW_DIR | test FILE VECTORS> [--json] [--limit N] [--engine enumerate|symbolic]';
const argv = process.argv.slice(2);
const json = argv.includes('--json');
function print(data) {
  if (json) console.log(JSON.stringify(data));
  else if (data.diagnostic) console.error(Object.values(data.diagnostic).join(' '));
  else if (data.changes) console.log(formatReview(data));
  else console.log(JSON.stringify(data, null, 2));
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
  if (argv[0] === '--help') {
    if (json) print({ usage });
    else console.log(usage);
    return;
  }
  const [command, ...tokens] = argv;
  const positions = [];
  let limit = DEFAULT_LIMIT;
  let engine = 'enumerate';
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--limit') limit = Number(tokens[++i]);
    else if (tokens[i] === '--engine') {
      engine = tokens[++i];
      if (!['verify','diff','build','gate'].includes(command) || !['symbolic','enumerate'].includes(engine))
        throw new Error(usage);
    }
    else if (tokens[i] === '--json') continue;
    else if (tokens[i].startsWith('--')) throw new Error(usage);
    else positions.push(tokens[i]);
  }
  const counts = new Map([['check',1], ['verify',1], ['test',2], ['build',2], ['diff',2], ['gate',3]]);
  if (positions.length !== counts.get(command) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000000)
    throw new Error(usage);
  const [path, other] = positions;
  const {unit, bytes} = await load(path);
  let report;
  if (command === 'check') report = { module: unit.name, status: 'typechecked', passed: true };
  else if (command === 'test') report = testVectors(unit, JSON.parse(await readFile(other, 'utf8')));
  else {
    report = verify(unit, bytes, limit, engine);
    if (command === 'diff' || command === 'gate') {
      const newer = await load(other);
      const candidate = verify(newer.unit, newer.bytes, limit, engine);
      report = compare(unit, newer.unit, report, candidate);
      if (command === 'gate' && report.passed) {
        await build(newer.unit, candidate, positions[2], report);
        report = { ...report, artifact: positions[2] };
      }
    } else if (command === 'build' && report.passed) report = await build(unit, report, other);
  }
  print(report);
  if (!report.passed) process.exitCode = 1;
}
try { await main(); } catch (e) {
  print({ diagnostic: e instanceof Diagnostic ? e.detail : { code: 'E_TOOL', message: e.message } });
  process.exitCode = e instanceof Diagnostic ? 1 : 2;
}
