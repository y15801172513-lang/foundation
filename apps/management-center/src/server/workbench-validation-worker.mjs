import {parentPort,workerData} from 'node:worker_threads';
import {prepareWorkbenchSnapshot} from './workbench-snapshot.mjs';
if(parentPort) {
  try{parentPort.postMessage({snapshot:prepareWorkbenchSnapshot(workerData)});}
  catch(error){parentPort.postMessage({error:`工作台快照校验失败：${error.message}`});}
}
