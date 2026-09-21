import {spawn,spawnSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {plainPath} from './local-path.mjs';

import {operationFailure,installedCommandFailure} from './operation-failure.mjs';
export {operationFailure,installedCommandFailure} from './operation-failure.mjs';

export function assertUpdateEngineSupport(inspection,{root,stage}={}) {
  if(['0.2.15','0.2.16'].includes(inspection?.installation?.current?.version)&&root&&stage){
    const relative=path.relative(path.dirname(plainPath(root)),plainPath(stage));
    if(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))return;
  }
  if(inspection?.supportedLifecycleOptions?.updateCandidateAuthority!=='os-account-acquisition-v1'){
    const detail=operationFailure({code:'UPDATE_ENGINE_ACQUISITION_UNSUPPORTED',stage:'authority',retryable:false});
    throw Object.assign(Error(detail.next),detail,{diagnostic:detail});
  }
}

// A client of the existing installed manager, never a confirmation authority.
export function installedClient(root,env,journeyControl=null) {
  root=plainPath(root);
  const launcher=plainPath(path.join(root,'bin/foundation-kit'));
  const call=args=>{
    const r=spawnSync(launcher,args,{env,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
    if(r.status!==0)throw installedCommandFailure(r);
    return JSON.parse(r.stdout);
  };
  return {root,launcher,call,env,journeyControl};
}

export async function observePlan(client,requested,onChange) {
  if(!/^foundation-plan-[a-f0-9]{64}$/.test(requested.planRef))throw Error('计划标识无效');
  const child=spawn(client.launcher,['manager','open-manager','--plan-ref',requested.planRef,...(client.journeyControl?['--journey-channel']:[])],{env:client.env,stdio:['ignore','pipe','pipe',...(client.journeyControl?['ipc']:[])]});
  client.journeyControl?.attach(child);
  let pending='',json='',finished=false;
  return new Promise((resolve,reject)=>{
    const stop=()=>child.kill('SIGTERM');
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);
      if(!error&&value?.responseFinished!==true)error=Error('当前引擎未核实确认响应结束；保留结果，不降级到旧页面');
      child.kill('SIGTERM');
      error?reject(error):resolve(value);
    };
    const timer=setTimeout(()=>finish(Error('确认等待到期；保留同次计划记录')),Math.max(1,Math.min(16*60*1000,requested.expiresAt-Date.now()+1000)));
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    child.once('error',e=>finish(e));
    child.once('close',()=>{if(!finished)finish(Error('页面进程退出，结果待核实；不自动重放'));});
    child.stderr.on('data',()=>{});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      pending+=chunk;
      if(pending.length+json.length>4*1024*1024)return finish(Error('状态输出超过限制'));
      let end;
      while((end=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,end);pending=pending.slice(end+1);
        if(!json&&!line.trim().startsWith('{'))continue;
        json+=line+'\n';let event;try{event=JSON.parse(json);}catch{continue;}json='';
        if(event.planRef!==requested.planRef)continue;
        client.journeyControl?.observe(child,event).catch(error=>finish(error));
        if(event.status==='AWAITING_FOUNDATION_UI_CONFIRMATION'){
          const url=new URL(event.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)return finish(Error('确认网址无效'));
          onChange({state:'pending',confirmationUrl:url.href,sessionId:event.sessionId});
        }
        if(event.status==='FOUNDATION_OPERATION_STATE')onChange({state:event.state,sessionId:event.sessionId});
        if(event.status==='FOUNDATION_OPERATION_RESULT'){
          // The result comes from this exact installed process/session. Uninstall
          // may already have removed the launcher, so its external manager receipt
          // must remain the durable recovery source; do not execute deleted code.
          if(!event.sessionId)return finish(Error('操作结果缺少会话身份'));
          finish(null,event);
        }
      }
    });
  });
}

// Resolve only the explicitly registered hint; never search for an executable.
export function discoverRegisteredInstallation(bindingFile,env){
  const file=plainPath(bindingFile),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.uid!==process.getuid()||stat.nlink!==1||stat.size>65536)throw Error('安装定位记录类型或归属无效');
  const binding=JSON.parse(fs.readFileSync(file,'utf8'));
  if(binding.schemaVersion!=='1.0.0'||binding.resolver!=='installed-current'||binding.authority!=='discovery-hint-only'||typeof binding.installId!=='string')throw Error('安装定位记录无效，不授予维护权限');
  const client=installedClient(binding.installationRoot,env);
  const inspection=client.call(['manager','inspect','--root',client.root]);
  const current=inspection.installation?.current;
  if(current?.identity?.installId!==binding.installId||inspection.bridge?.currentVersion!==current.version)throw Error('注册位置与当前安装身份或健康不一致');
  if(inspection.supportedLifecycleOptions?.maintenance?.protocol!=='installed-maintenance/1')throw Error('当前安装缺少随包维护能力；请按该版本正式恢复说明处理，不替换旧引擎');
  return {installationRoot:client.root,installId:binding.installId,launcher:client.launcher,currentVersion:current.version,candidateHash:current.candidateHash,inspection,executionAuthority:false};
}
