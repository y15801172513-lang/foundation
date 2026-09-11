import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createOperation() {
  return {schemaVersion:'1.0.0',operationId:crypto.randomUUID(),pid:process.pid,startedAt:new Date().toISOString(),phase:'discovering',state:'running',terminal:false,installationWrites:'none',skillRegistered:false};
}
// Observations from the verified runtime, never confirmation or execution authority.
export function runtimeObservation(event) {
  if(event.status==='AWAITING_FOUNDATION_DIRECTORY_SELECTION')return {phase:'selecting-directory',selectionId:event.selectionId,installationWrites:'none'};
  if(['FOUNDATION_SELECTION_BOUND','AWAITING_FOUNDATION_UI_CONFIRMATION'].includes(event.status))return {phase:'awaiting-confirmation',sessionId:event.sessionId,planHash:event.planHash,installationWrites:'none'};
  if(event.status==='FOUNDATION_OPERATION_STATE'&&['executing','consumed'].includes(event.state))return {phase:'executing',sessionId:event.sessionId,installationWrites:'possible'};
  if(event.status==='BOOTSTRAP_OPERATION_ENDED'){
    const state=['completed','failed','cancelled','expired'].includes(event.state)?event.state:'verification-required';
    return {phase:'runtime-ended',state,terminal:state!=='verification-required',sessionId:event.sessionId,installationRoot:event.installationRoot,installationWrites:state==='completed'?'runtime-reported-installed':'unknown',runtimeHealth:event.result?.executableHealth||'unknown',next:'只读核验稳定 installed launcher 或同次 session 结果，不重放确认'};
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
