import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createOperation() {
  return {schemaVersion:'1.0.0',operationId:crypto.randomUUID(),pid:process.pid,startedAt:new Date().toISOString(),phase:'discovering',state:'running',terminal:false,installationWrites:'none',skillRegistered:false};
}
// Product outcome, never the confirmation server's exit status, controls the CLI.
export function operationExitCode(record) {
  if (!record?.terminal) return 1;
  if (record.state === 'completed') return 0;
  if (['cancelled','cancelled-no-install'].includes(record.state)) return 2;
  if (['expired','expired-no-install'].includes(record.state)) return 3;
  return 1;
}
// Observations from the verified runtime, never confirmation or execution authority.
export function runtimeObservation(event) {
  let confirmationUrl;
  if(event.url){const url=new URL(event.url);if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password)confirmationUrl=url.href;}
  if(event.status==='AWAITING_FOUNDATION_DIRECTORY_SELECTION')return {phase:'selecting-directory',selectionId:event.selectionId,journeyContext:event.journeyContext,installationWrites:'none',...(confirmationUrl?{confirmationUrl}:{})};
  if(['FOUNDATION_SELECTION_BOUND','AWAITING_FOUNDATION_UI_CONFIRMATION'].includes(event.status))return {phase:'awaiting-confirmation',...(event.journeyContext?{journeyContext:event.journeyContext}:{}),sessionId:event.sessionId,planHash:event.planHash,installationWrites:'none',...(confirmationUrl?{confirmationUrl}:{})};
  if(event.status==='FOUNDATION_OPERATION_STATE'&&['executing','consumed'].includes(event.state))return {phase:'executing',sessionId:event.sessionId,installationWrites:'possible'};
  if(event.status==='BOOTSTRAP_OPERATION_ENDED'){
    const state=event.state==='completed'&&event.result?.ok!==true?'verification-required':['completed','failed','cancelled','expired'].includes(event.state)?event.state:'verification-required';
    const selectedPending=state==='completed'&&event.journeyContext?.skillChoice==='selected';
    const rollback=event.failure?.details?.rollback||'unknown';
    const failureNext=rollback==='completed'?'本次程序变更已回退；Skill 未安装。保留本次记录，在原对话查看健康检查错误，修复后再申请新计划；不要重放旧确认。':'回退情况待核实；Skill 未安装。保留本次记录，在原对话核实健康检查与恢复状态；不要自动重试。';
    return {phase:'runtime-ended',programState:state,state:selectedPending?'awaiting-skill':state,terminal:state!=='verification-required'&&!selectedPending,sessionId:event.sessionId,installationRoot:event.installationRoot,installationWrites:state==='completed'?'runtime-reported-installed':rollback==='completed'?'rolled-back':'unknown',runtimeHealth:event.result?.stableLauncherHealth||event.result?.lifecycleResult?.stableLauncherHealth||event.result?.executableHealth||'unknown',failure:event.failure||null,rollback,journeyContext:event.journeyContext,next:selectedPending?'程序已完成，正在准备所选 Codex 接入的独立确认':state==='failed'?failureNext:'只读核验稳定 installed launcher 或同次 session 结果，不重放确认'};
  }
  if(['cancelled-no-install','expired-no-install','shutdown-no-install'].includes(event.state))return {phase:'directory-selection-ended',state:event.state,terminal:true,installationWrites:'none'};
  return null;
}
export function saveOperation(record,stage) {
  if(!stage)return null;
  try{
    for(let p=stage;p!==path.dirname(p);p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink())throw Error('symlink');}
    const s=fs.lstatSync(stage);if(!s.isDirectory()||s.uid!==process.getuid()||(s.mode&511)!==448)throw Error('private stage required');
    const file=path.join(stage,'operation-result.json');
    if(fs.existsSync(file)){const old=fs.lstatSync(file);if(!old.isFile()||old.isSymbolicLink()||old.nlink!==1||old.uid!==process.getuid()||(old.mode&511)!==384)throw Error('unknown record');const previous=JSON.parse(fs.readFileSync(file));if(previous.operationId!==record.operationId)throw Error('different operation');}
    const tmp=path.join(stage,`.operation-${crypto.randomUUID()}.json`);fs.writeFileSync(tmp,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);return file;
  }catch{return null;}
}
export function readOperation(file) {
  if(!path.isAbsolute(file)||path.normalize(file)!==file)throw Error('结果路径必须为规范化绝对路径');
  for(let p=file;p!==path.dirname(p);p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink())throw Error('拒绝链接结果路径');}
  const s=fs.lstatSync(file);if(!s.isFile()||s.size>1_000_000||s.uid!==process.getuid()||(s.mode&511)!==384)throw Error('结果文件类型、大小或归属无效');
  const r=JSON.parse(fs.readFileSync(file));if(r.schemaVersion!=='1.0.0'||typeof r.operationId!=='string'||typeof r.terminal!=='boolean')throw Error('结果记录无效');
  return {...r,...(!r.terminal?{state:'verification-required',note:'这是最后一次记录，不证明原进程仍活着。先查原工具句柄和同次记录；不自动重试。'}:{}),readOnly:true,executionAuthority:false};
}
