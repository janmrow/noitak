// Test the deployable ESM in a short-lived JS realm. Exiting workers release
// both the imported module and its checked graph in long-lived build processes.
import { Worker } from 'node:worker_threads';

export class ArtifactMismatch extends Error {
  constructor(witness) {
    super('Generated module failed a reference, safety or application comparison');
    this.detail = {code:'E_ARTIFACT_MISMATCH',message:this.message,...witness};
  }
}

export async function checkArtifact(unit, source, timeoutMs = 30000, witnesses = new Map(), vectors = []) {
  const entries = unit.functions.filter(f=>f.kind==='fn');
  const worker = new Worker(new URL('./artifact-worker.mjs',import.meta.url), {
    workerData:{entries,source,witnesses,vectors}, execArgv:[]
  });
  let timedOut = false;
  const timer = setTimeout(()=>{
    timedOut = true;
    void worker.terminate();
  },timeoutMs);
  try {
    return await new Promise((resolve,reject)=>{
      let reply, messages = 0;
      worker.on('message', data=>{reply = data; messages++;});
      worker.once('error',reject);
      worker.once('exit',code=>{
        if (timedOut) return reject(new Error('Artifact comparison timed out'));
        if (code !== 0 || messages !== 1) return reject(new Error('Incomplete artifact comparison'));
        if (reply?.witness) return reject(new ArtifactMismatch(reply.witness));
        const checks = reply?.checks;
        if (!Array.isArray(checks) || checks.length !== entries.length ||
            !checks.every((c,i)=>c.function === entries[i].name && Number.isSafeInteger(c.cases) &&
              c.cases > 0 && Number.isSafeInteger(c.returned) && c.returned >= 0 && c.returned <= c.cases &&
              Number.isSafeInteger(c.admittedBodies) && c.admittedBodies >= 0 && c.admittedBodies <= c.returned &&
              c.status === (c.admittedBodies ? 'tested' : 'incomplete')))
          return reject(new Error('Invalid artifact comparison report'));
        const status = checks.every(c => c.status === 'tested') ? 'tested' : 'incomplete';
        resolve({status, method:'interpreter-differential-v2', timeoutMs, checks});
      });
    });
  } finally { clearTimeout(timer); }
}
