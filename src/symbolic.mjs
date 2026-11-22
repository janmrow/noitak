import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { invoke } from './runtime.mjs';

export const symbolicConfig = { method: 'z3-bv8-datatypes-v1', timeoutMsPerQuery: 3000, timeoutMsPerWorker: 10000 };
const worker = fileURLToPath(new URL('./symbolic_worker.py', import.meta.url));

export function solve(f, enums, spawn = spawnSync) {
  const input = JSON.stringify({ function: f, enums, timeoutMs: symbolicConfig.timeoutMsPerQuery });
  const proc = spawn('python3', ['-I', worker], { input, encoding: 'utf8',
    timeout: symbolicConfig.timeoutMsPerWorker, killSignal: 'SIGKILL' });
  const unknown = reason => ({ status: 'unverified', reason });
  if (proc.error || proc.status !== 0)
    return unknown(proc.error?.code ?? 'worker-failed');
  let answer;
  try { answer = JSON.parse(proc.stdout); } catch { return unknown('invalid-worker-response'); }
  if (!answer || typeof answer !== 'object') return unknown('invalid-worker-response');
  if (answer.status === 'unverified' && typeof answer.reason === 'string')
    return { ...unknown(answer.reason), solverVersion: answer.solverVersion };
  if (typeof answer.solverVersion !== 'string') return unknown('invalid-worker-response');
  const { solverVersion } = answer;
  if (answer.status === 'proven' && answer.safety === 'unsat' && answer.admission === 'sat')
    return { status: 'proven', solverVersion, safety: 'unsat', admission: 'sat' };
  if (answer.status === 'violated') {
    if (answer.reason === 'empty-admission-domain') return { status: 'violated', reason: answer.reason, solverVersion };
    if (Array.isArray(answer.input?.args)) {
      const { args, flags } = answer.input;
      const outcome = invoke(f, flags, args);
      if (['POSTCONDITION','ARITHMETIC'].includes(outcome.code))
        return { status: 'violated', solverVersion, counterexample: {args, flags, outcome} };
      return unknown('model-replay-disagreement');
    }
  }
  return unknown('invalid-worker-response');
}
