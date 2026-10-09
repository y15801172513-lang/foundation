// Trusted npm code only. Network/proof routines contain synchronous calls;
// isolate those calls so the read-only progress server remains responsive.
import {parentPort, workerData} from 'node:worker_threads';
import {inspectRelease, acquireRelease} from './acquire.mjs';

import {redactGitHubSecret} from './github-auth.mjs';

let phase='discovering';
try {
  const context = inspectRelease(workerData.version,{auth:workerData.auth});
  // The parent persists context atomically in the stage. Finish that write
  // before checking that the stage contains only this operation's record.
  const recorded = new Promise(resolve=>parentPort.once('message',message=>{
    if(message.type!=='context-recorded')throw Error('获取上下文确认无效');
    resolve();
  }));
  parentPort.postMessage({type:'context',context});
  await recorded;
  const receipt = await acquireRelease(context, workerData.stage, {
    operationId:workerData.operationId,auth:workerData.auth,
    onPhase:value=>{phase=value;parentPort.postMessage({type:'phase',phase});},
    onProgress:download=>parentPort.postMessage({type:'progress',download}),
  });
  parentPort.postMessage({type:'complete',receipt});
} catch(error) {
  parentPort.postMessage({type:'failure',code:error.code||'ACQUISITION_VALIDATION_FAILED',stage:phase,retryable:error.retryable===true||error.code==='ACQUISITION_TRANSPORT_FAILED',diagnostic:error.diagnostic||null,message:redactGitHubSecret(error.message,workerData.auth)});
}
