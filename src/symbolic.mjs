import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { argument, invoke, predicate } from './runtime.mjs';

import { exceeds } from './domain.mjs';

export const symbolicConfig = { method: 'z3-datatypes-sequences-v5', timeoutMsPerQuery: 3000, timeoutMsPerWorker: 10000 };
export function usesSymbolic(configuration, domain) {
  return configuration.engine === 'symbolic' ||
    (configuration.engine === 'auto' && exceeds(domain, configuration.maxCasesPerFunction));
}

const worker = fileURLToPath(new URL('./symbolic_worker.py', import.meta.url));

const unknown = reason => ({ status: 'unverified', reason });

// Each worker reply describes exactly one outcome of the requested operation.
function hasFields(record, ...fields) {
  return record !== null && typeof record === 'object' && !Array.isArray(record) &&
    Object.keys(record).length === fields.length && fields.every(key => Object.hasOwn(record, key));
}

function validModel(input, field) {
  const fields = field === 'ensures' ? ['args', 'flags', 'result'] : ['args', 'flags'];
  return hasFields(input, ...fields) && Array.isArray(input.args) &&
    input.flags !== null && typeof input.flags === 'object' && !Array.isArray(input.flags);
}

function query(request, spawn) {
  const input = JSON.stringify({ ...request, timeoutMs: symbolicConfig.timeoutMsPerQuery });
  const proc = spawn('python3', ['-I', worker], { input, encoding: 'utf8',
    timeout: symbolicConfig.timeoutMsPerWorker, killSignal: 'SIGKILL' });
  if (proc.error || proc.status !== 0)
    return unknown(proc.error?.code ?? 'worker-failed');
  let answer;
  try { answer = JSON.parse(proc.stdout); } catch { return unknown('invalid-worker-response'); }
  if (!answer || typeof answer !== 'object') return unknown('invalid-worker-response');
  if (answer.status === 'unverified' && hasFields(answer, 'status', 'reason') &&
      typeof answer.reason === 'string') return answer;
  if (typeof answer.solverVersion !== 'string' || !answer.solverVersion.trim())
    return unknown('invalid-worker-response');
  if (answer.status === 'unverified' &&
      !(hasFields(answer, 'status', 'reason', 'solverVersion') && typeof answer.reason === 'string'))
    return unknown('invalid-worker-response');
  return answer;
}

export function solve(f, types, spawn = spawnSync, contracts) {
  const answer = query({ function: f, types, contracts }, spawn);
  if (contracts && answer.status === 'needs-implementation' && hasFields(answer, 'status', 'solverVersion')) {
    const exact = solve(f, types, spawn);
    return {...exact, abstraction: 'insufficient-callee-contracts'};
  }
  if (answer.status === 'unverified') return answer;
  const { solverVersion } = answer;
  if (answer.status === 'proven' && hasFields(answer, 'status', 'solverVersion', 'safety', 'admission', 'witness') && validModel(answer.witness) &&
      answer.safety === 'unsat' && answer.admission === 'sat') {
    const model = typedInput(f, answer.witness);
    if (!model || !invokeTransition(f, model.flags, model.args).ok) return unknown('admission-replay-disagreement');
    return { status: 'proven', ...(contracts && {method: 'callee-contracts', premises: Object.keys(contracts)}), solverVersion, safety: 'unsat', admission: 'sat',
      admissionWitness: {args:model.args, flags:model.flags} };
  }
  if (answer.status === 'violated') {
    if (hasFields(answer, 'status', 'solverVersion', 'reason', 'safety', 'admission') &&
        answer.reason === 'empty-admission-domain' && answer.safety === 'unsat' && answer.admission === 'unsat')
      return answer;
    if (hasFields(answer, 'status', 'solverVersion', 'input') && validModel(answer.input)) {
      const model = typedInput(f, answer.input);
      if (!model) return unknown('model-replay-disagreement');
      const {args, flags} = model;
      const outcome = invokeTransition(f, flags, args);
      if (['POSTCONDITION','CAPACITY','ARITHMETIC','CALL_PRECONDITION','CALL_POSTCONDITION'].includes(outcome.code))
        return { status: 'violated', solverVersion, counterexample: {args, flags, outcome} };
      return unknown('model-replay-disagreement');
    }
  }
  return unknown('invalid-worker-response');
}

// A reducer proof quantifies one transition. Replay it as a one-element host batch.
function invokeTransition(f, flags, args) {
  return invoke(f, flags, f.capacity ? [args[0], [args[1]]] : args);
}

function typedInput(f, input) {
  if (input.args.length !== f.params.length) return;
  const args = f.params.map(([,type], i) => argument(type, input.args[i]));
  if (args.includes(undefined) || f.reads.some(k => !Object.hasOwn(input.flags,k) || typeof input.flags[k] !== 'boolean')) return;
  const grants = new Map(f.reads.map(k => [k, input.flags[k]]));
  return { args, grants, flags: Object.fromEntries(grants) };
}

function replay(old, next, field, input) {
  const model = typedInput(old,input);
  if (!model) return;
  const {args, grants, flags} = model;
  const oldPre = predicate(old, 'requires', args, grants);
  const newPre = predicate(next, 'requires', args, grants);
  if (oldPre !== true) return;
  if (field === 'requires') {
    if (newPre !== true) return { args, flags, before: oldPre, after: newPre };
    return;
  }
  if (newPre !== true) return;
  if (field === 'ensures') {
    const result = argument(old.output, input.result);
    if (result === undefined) return;
    const before = predicate(old, field, args, grants, result);
    const after = predicate(next, field, args, grants, result);
    if (after === true && before !== true) return { args, flags, result, before, after };
  } else {
    const before = invokeTransition(old, flags, args), after = invokeTransition(next, flags, args);
    if (before.ok && after.ok && JSON.stringify(before.value) !== JSON.stringify(after.value))
      return { args, flags, before, after };
  }
}

export function solveRelation(old, next, types, field, spawn = spawnSync, options = {}) {
  const answer = query({ function: old, candidate: next, types, relation: field, ...options }, spawn);
  const {solverVersion} = answer;
  if (answer.status === 'unverified') return { status: 'undetermined', reason: answer.reason, solverVersion };
  if (answer.relation !== field) return { status: 'undetermined', reason: 'invalid-worker-response' };
  if (answer.answer === 'unsat' && hasFields(answer, 'relation', 'answer', 'solverVersion'))
    return { status: 'compatible', solverVersion, solverAnswer: 'unsat' };
  if (answer.answer === 'sat' && hasFields(answer, 'relation', 'answer', 'solverVersion', 'input') &&
      validModel(answer.input, field)) {
    const witness = replay(old, next, field, answer.input);
    if (witness) return { status: 'risky', witness, solverVersion, solverAnswer: 'sat' };
    return { status: 'undetermined', reason: 'model-replay-disagreement', solverVersion };
  }
  return { status: 'undetermined', reason: 'invalid-worker-response' };
}
