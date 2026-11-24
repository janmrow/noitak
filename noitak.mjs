#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { load } from './src/loader.mjs';
import { Diagnostic } from './src/parser.mjs';
import { verify, verifyPair, hash, DEFAULT_LIMIT, VERSION } from './src/verify.mjs';
import { authorize } from './src/authorization.mjs';
import { compare } from './src/diff.mjs';
import { ArtifactMismatch } from './src/artifact-check.mjs';
import { build } from './src/backend.mjs';
import { testVectors } from './src/vectors.mjs';

import { formatReview } from './src/review.mjs';

const usage = 'noitak <check FILE | verify FILE | build FILE NEW_DIR | diff OLD NEW | gate OLD NEW NEW_DIR | test FILE VECTORS> [--json] [--vectors FILE (build/gate)] [--authorization FILE (gate)] [--limit N] [--engine enumerate|symbolic|auto]';
const argv = process.argv.slice(2);
const json = argv.includes('--json');
function print(data) {
  if (json) console.log(JSON.stringify(data));
  else if (data.diagnostic) console.error(Object.values(data.diagnostic).join(' '));
  else if (data.changes) console.log(formatReview(data));
  else console.log(JSON.stringify(data, null, 2));
}
async function main() {
  if (argv[0] === '--version') {
    if (json) print({ version: VERSION });
    else console.log(VERSION);
    return;
  }
  if (argv[0] === '--help') {
    if (json) print({ usage });
    else console.log(usage);
    return;
  }
  const [command, ...tokens] = argv;
  const positions = [];
  let limit = DEFAULT_LIMIT;
  let engine = 'enumerate';
  let vectorPath, authorizationPath;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--limit') limit = Number(tokens[++i]);
    else if (tokens[i] === '--authorization') {
      if (command !== 'gate' || authorizationPath || !tokens[i+1] || tokens[i+1].startsWith('--')) throw new Error(usage);
      authorizationPath = tokens[++i];
    }
    else if (tokens[i] === '--vectors') {
      if (!['build','gate'].includes(command) || vectorPath || !tokens[i+1] || tokens[i+1].startsWith('--')) throw new Error(usage);
      vectorPath = tokens[++i];
    }
    else if (tokens[i] === '--engine') {
      engine = tokens[++i];
      if (!['verify','diff','build','gate'].includes(command) || !['symbolic','enumerate','auto'].includes(engine))
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
  const vectorBytes = vectorPath ? await readFile(vectorPath) : undefined;
  let report;
  if (command === 'check') report = { module: unit.name, status: 'typechecked', passed: true };
  else if (command === 'test') report = testVectors(unit, JSON.parse(await readFile(other, 'utf8')));
  else {
    if (command === 'diff' || command === 'gate') {
      const newer = await load(other);
      const [baseline, candidate] = verifyPair({unit, bytes}, newer, limit, engine);
      report = compare(unit, newer.unit, baseline, candidate);
      if (authorizationPath) {
        const policy = await readFile(authorizationPath);
        report = authorize(report, JSON.parse(policy), hash(policy));
      }
      if (command === 'gate' && report.passed) {
        const manifest = await build(newer.unit, candidate, positions[2], report, vectorBytes);
        report = { ...report, artifact: positions[2], artifactValidation: manifest.artifactValidation };
      }
    } else {
      report = verify(unit, bytes, limit, engine);
      if (command === 'build' && report.passed) report = await build(unit, report, other, undefined, vectorBytes);
    }
  }
  print(report);
  if (!report.passed) process.exitCode = 1;
}
try { await main(); } catch (e) {
  print({ diagnostic: e instanceof Diagnostic || e instanceof ArtifactMismatch ? e.detail : { code: 'E_TOOL', message: e.message } });
  process.exitCode = e instanceof Diagnostic ? 1 : 2;
}
