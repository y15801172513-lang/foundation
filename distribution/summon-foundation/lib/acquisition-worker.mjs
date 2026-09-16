// Trusted npm code only. Network/proof routines contain synchronous calls;
// isolate those calls so the read-only progress server remains responsive.
import {parentPort, workerData} from 'node:worker_threads';
import {inspectRelease, acquireRelease} from './acquire.mjs';

try {
  const context = inspectRelease(workerData.version);
  // The parent persists context atomically in the stage. Finish that write
  // before checking that the stage contains only this operation's record.
  const recorded = new Promise(resolve=>parentPort.once('message',message=>{
    if(message.type!=='context-recorded')throw Error('获取上下文确认无效');
    resolve();
  }));
  parentPort.postMessage({type:'context',context});
  await recorded;
  const receipt = await acquireRelease(context, workerData.stage, {
    operationId:workerData.operationId,
    onPhase:phase=>parentPort.postMessage({type:'phase',phase}),
    onProgress:download=>parentPort.postMessage({type:'progress',download}),
  });
  parentPort.postMessage({type:'complete',receipt});
} catch(error) {
  parentPort.postMessage({type:'failure',code:error.code,diagnostic:error.diagnostic||null,message:String(error.message).replace(/https?:\/\/\S+/g,'[已脱敏网址]').replace(/(?:github_pat_|ghp_|npm_)[A-Za-z0-9_]+/g,'[已脱敏凭据]')});
}
