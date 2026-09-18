import {parentPort} from 'node:worker_threads';
import {analyzeSourcesInWorker} from './source-analysis.mjs';

parentPort?.on('message', ({id,options}) => {
  try {parentPort.postMessage({id,result:analyzeSourcesInWorker(options)});}
  catch(error) {parentPort.postMessage({id,error:`源码分析失败：${error.message}`});}
});
