import {Worker} from 'node:worker_threads';

export function acquireInWorker({version,stage,operationId,onContext=()=>{},onPhase=()=>{},onProgress=()=>{}}) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./acquisition-worker.mjs',import.meta.url),{workerData:{version,stage,operationId}});
    let receipt,context,failure;
    const interrupt=()=>{failure=Object.assign(Error('获取任务被中断；保留本次材料'),{code:'ACQUISITION_INTERRUPTED'});void worker.terminate();};
    process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
    worker.on('message',event=>{
      if(event.type==='context'){context=event.context;onContext(context);worker.postMessage({type:'context-recorded'});}
      else if(event.type==='phase')onPhase(event.phase);
      else if(event.type==='progress')onProgress(event.download);
      else if(event.type==='complete')receipt=event.receipt;
      else if(event.type==='failure')failure=Object.assign(Error(event.message),{code:event.code,diagnostic:event.diagnostic});
    });
    worker.on('error',error=>{failure=error;});
    worker.once('exit',code=>{
      process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
      if(failure)reject(failure);
      else if(code!==0||!receipt||!context)reject(Error('获取进程未提供已验证结果；不启动运行文件'));
      else resolve({context,receipt});
    });
  });
}
