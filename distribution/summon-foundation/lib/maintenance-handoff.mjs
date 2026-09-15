import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {plainPath} from './acquire.mjs';
import {installedClient,observePlan} from './manager-step.mjs';
import {followSelectedSkill} from './skill-handoff.mjs';

// The running owned engine emits the result body; disk additionally stores its
// integrity envelope. Bind every body field to that live result, not to the
// receipt's self-asserted signature (the uninstall may remove its local key).
export function matchesUninstallResult(receipt,payload,installId) {
  const {integrity,...body}=receipt||{};
  return body.state==='uninstalled'&&body.installId===installId&&
    typeof body.operationId==='string'&&body.operationId===payload?.operationId&&
    integrity?.algorithm==='hmac-sha256'&&/^[a-f0-9]{64}$/.test(integrity.hash||'')&&
    isDeepStrictEqual(body,payload);
}

// Only coordinates the installed exact-plan API. Every mutation waits for its
// own manager confirmation. Even the first update uses the OLD stable launcher.
export async function followMaintenance({operation,kind,candidate,env,onChange}) {
  if(!['update','uninstall'].includes(kind))throw Error('维护类型无效');
  const client=installedClient(operation.installationRoot,env),{root,call}=client;
  const before=call(['manager','inspect','--root',root]),current=before.installation?.current;
  if(!current?.identity?.installId||before.bridge?.currentVersion!==current.version)throw Error('当前安装无法核实');
  if(kind==='update'&&(!candidate||candidate.version===current.version))throw Error('目标版本无效或已经安装；不重复更新或解除 Skill');
  const manifest=plainPath(path.join(root,current.appPath,'artifacts/skills/ai-product-foundation-kit/capability.json'));
  if(!manifest.startsWith(root+path.sep))throw Error('当前材料路径越界');
  // On 0.2.10 inspect has no codexSkill field. File presence only requests an
  // ownership-checked plan; the old engine validates its signed receipt/files.
  const registration=plainPath(path.join(root,'state/codex-skill-registration.json'));
  const hadSkill=fs.existsSync(registration);
  let previousPlanRef=null;
  const steps={};
  onChange({kind,currentVersion:current.version,installId:current.identity.installId,previousCandidateHash:current.candidateHash,journeyContext:{id:operation.operationId,skillChoice:kind==='update'&&hadSkill?'selected':'skipped'},next:hadSkill?(kind==='update'?'先确认程序更新，再确认刷新完整归属的 Codex 文件；未知或修改文件保留。':'先核对并确认解除已关联的 Codex 副本，再继续程序卸载；未知或修改文件保留。'):'核对程序操作；本次不会新增 Codex Skill。'});
  const run=async(key,op,parameters)=>{
    const now=call(['manager','inspect','--root',root]).installation?.current;
    if(now?.identity?.installId!==current.identity.installId||now.candidateHash!==current.candidateHash)throw Error('维护期间安装身份变化，停止接续');
    const requested=call(['manager','request-plan','--operation',op,'--parameters-json',JSON.stringify(parameters),...(previousPlanRef?['--previous-plan-ref',previousPlanRef]:[])]);
    steps[key]={state:'pending',evidence:{planRef:requested.planRef}};
    onChange({phase:key==='program'?'awaiting-confirmation':'skill-confirmation',currentPlanRef:requested.planRef,maintenanceSteps:{...steps},terminal:false});
const event=await observePlan(client,requested,observation=>onChange({phase:observation.state==='pending'?(key==='program'?'awaiting-confirmation':'skill-confirmation'):(key==='program'?'executing':'skill-executing'),...(observation.state!=='pending'?{installationWrites:'possible'}:{}),...(observation.temporaryManager?{temporaryManager:observation.temporaryManager}:{}),...(observation.confirmationUrl?{confirmationUrl:observation.confirmationUrl}:{}),maintenanceSteps:{...steps,[key]:{state:observation.state,evidence:{planRef:requested.planRef,sessionId:observation.sessionId}}}}));
    // Uninstall removes the executable, but its result and external receipt are
    // emitted by the already-running manager. Other steps are reread normally.
    const result=kind==='uninstall'&&key==='program'?event:call(['manager','status','--plan-ref',requested.planRef]);
    if(result.sessionId!==event.sessionId||result.state!==event.state)throw Error('维护结果与会话不一致');
    steps[key]={state:result.state,evidence:{planRef:requested.planRef,sessionId:result.sessionId,recordLocation:result.recordLocation},result:result.result};
    previousPlanRef=requested.planRef;
    onChange({maintenanceSteps:{...steps},previousPlanRef});
    return result;
  };
  if(hadSkill&&kind==='uninstall'){
    const removed=await run('remove','capability-uninstall',{installationRoot:root,manifestFile:manifest});
    if(removed.state!=='completed')return {state:'partial',terminal:true,phase:'finished',programState:'not-started',next:'Codex 解除未完成，程序未更新或卸载；保留原入口和文件。'};
    if(fs.existsSync(registration))throw Error('解除后归属记录仍存在，不继续程序操作');
  }
  const parameters={targetRoot:root,currentVersion:current.version,targetVersion:kind==='update'?candidate?.version:current.version};
  if(kind==='uninstall')parameters.mode='full'; // Owned program/runtime/state only; user data remains protected by the exact plan.
  if(kind==='update'){
    if(!candidate||candidate.version===current.version)throw Error('目标版本无效或已经安装；不重复更新');
    parameters.candidate=candidate;
    if(before.supportedLifecycleOptions?.update?.includes('cleanupAcquisition'))parameters.cleanupAcquisition=true;
  }
  const result=await run('program',kind,parameters);
  const payload=result.result?.lifecycleResult||result.result||{};
  onChange({programState:result.state,sessionId:result.sessionId,runtimeHealth:payload.stableLauncherHealth||'unknown',programResult:payload,phase:'runtime-ended'});
  if(result.state!=='completed')return {state:'partial',terminal:true,phase:'finished',next:'程序操作未完成；保留结果和恢复记录，不自动补做。先核验程序与 Codex 各自状态。'};
  if(kind==='uninstall'){
    const file=plainPath(path.join(root,'uninstall-result.json')),receipt=JSON.parse(fs.readFileSync(file));
    if(!matchesUninstallResult(receipt,payload,current.identity.installId))throw Error('卸载独立回执与本次已安装引擎结果不一致');
    return {state:'completed',terminal:true,phase:'finished',skillRegistered:false,uninstallReceipt:file,next:'卸载完成；保留项目资料、用户修改文件及卸载回执。缓存清理说明见独立回执，不自动清理其他缓存。'};
  }
  const after=call(['manager','inspect','--root',root]).installation?.current;
  if(after?.identity?.installId!==current.identity.installId||after.version!==candidate.version||after.candidateHash!==candidate.manifestHash||payload.stableLauncherHealth!=='passed')throw Error('更新后的稳定入口身份或健康待核实');
  if(hadSkill)return followSelectedSkill({operation:{...operation,kind:'update',installationRoot:root,programState:'completed',sessionId:null,previousPlanRef,journeyContext:{id:operation.operationId,skillChoice:'selected'}},env,onChange});
  return {state:'completed',terminal:true,phase:'finished',skillRegistered:false,next:'更新及稳定入口健康核验完成；未新增 Skill，项目与用户数据按计划保留。'};
}
