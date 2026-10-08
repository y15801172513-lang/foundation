import {parentPort,workerData} from 'node:worker_threads';
import {registerRuntimeObjectSnapshot} from '../../../../packages/core/workspace-host.mjs';
import {prepareWorkbenchSnapshot} from './workbench-snapshot.mjs';
if(parentPort) {
  try{parentPort.postMessage(workerData.operation==='runtime-observation'?{result:registerRuntimeObjectSnapshot(workerData.input)}:{snapshot:prepareWorkbenchSnapshot(workerData)});}
  catch(error){parentPort.postMessage({error:`工作台任务失败：${error.message}`});}
}
