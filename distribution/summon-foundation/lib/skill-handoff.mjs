import path from 'node:path';
import fs from 'node:fs';
import {installedClient,observePlan} from './manager-step.mjs';
import {plainPath} from './acquire.mjs';

// Coordinates existing exact-plan APIs. It never sends a confirmation request.
// The installed launcher resolves current on every call; downloaded code is not
// reused as installed authority. onChange is observation, not authorization.
export async function followSelectedSkill({operation,env,onChange,journeyControl=null}) {
  if(operation.programState!=='completed'||operation.journeyContext?.skillChoice!=='selected')throw Error('Skill 接续需要已完成程序和明确所选意向');
  const client=installedClient(operation.installationRoot,env,journeyControl),{root,call}=client;
  const initial=call(['manager','inspect','--root',root]);
  const identity=initial.installation?.current;
  if(!identity?.identity?.installId||initial.bridge?.currentVersion!==identity.version)throw Error('当前安装身份无法核实，停止 Skill 接续');
  if(operation.installId&&operation.installId!==identity.identity.installId)throw Error('恢复记录属于另一安装，停止接续');
  onChange({installId:identity.identity.installId,installedCandidateHash:identity.candidateHash});
  const manifestFile=plainPath(path.join(root,identity.appPath,'artifacts/skills/ai-product-foundation-kit/capability.json'));
  if(!manifestFile.startsWith(root+path.sep))throw Error('Skill 材料必须属于当前安装');
  if(initial.codexSkill?.state==='files-installed-host-discovery-unverified'){
    const destination=plainPath(initial.codexSkill.destination);
    const binding=JSON.parse(fs.readFileSync(plainPath(path.join(destination,'foundation-installation.json'))));
    if(binding.installId===identity.identity.installId&&binding.installationRoot===root&&fs.readFileSync(plainPath(path.join(destination,'SKILL.md'))).equals(fs.readFileSync(path.join(path.dirname(manifestFile),'SKILL.md'))))return {state:'completed',terminal:true,phase:'finished',skillRegistered:true,skillDestination:destination,hostDiscoveryVerified:false,skillSteps:{material:{state:'completed',evidence:{source:'installed-owned-current-bytes'}},register:{state:'completed',evidence:{source:'installed-owned-current-bytes'}}},next:'当前版本 Skill 文件和归属已核实，无需重复注册；新任务识别另验。'};
  }
  const checkIdentity=()=>{
    const current=call(['manager','inspect','--root',root]);
    if(current.installation?.current?.identity?.installId!==identity.identity.installId||current.installation.current.candidateHash!==identity.candidateHash)throw Error('接续期间安装发生变化，需重新核实');
    return current;
  };
  let previousPlanRef=operation.previousPlanRef||null;
  const steps={};
  const material=call(['capability','status','--root',root,'--manifest',manifestFile]);
  const reusable=['CAPABILITY_NOT_REGISTERED','CAPABILITY_INACTIVE','PROJECT_NOT_ENABLED','CAPABILITY_READY'].includes(material.code);
  const ownedUpdate=operation.kind==='update'&&initial.codexSkill?.state==='files-installed-host-discovery-unverified'&&material.code==='CAPABILITY_IDENTITY_MISMATCH';
  if(!reusable&&material.code!=='CAPABILITY_NOT_INSTALLED'&&!ownedUpdate)throw Error('已有 Skill 材料不兼容或归属待核实；不自动覆盖');
  if(reusable)steps.material={state:'completed',evidence:{source:'installed-capability-status',code:material.code}};
  for(const kind of [...(!reusable?['material']:[]),'register']) {
    checkIdentity();
    const requested=call(['manager','request-plan','--operation',kind==='material'?'capability-install':'capability-register','--parameters-json',JSON.stringify({installationRoot:root,manifestFile,...(kind==='register'?{connectCodex:true}:{})}),...(previousPlanRef?['--previous-plan-ref',previousPlanRef]:operation.sessionId?['--previous-session-id',operation.sessionId]:[])]);
    if(!/^foundation-plan-[a-f0-9]{64}$/.test(requested.planRef))throw Error('接续计划标识无效');
    steps[kind]={state:'pending',evidence:{planRef:requested.planRef}};
    onChange({state:'awaiting-skill',phase:'skill-confirmation',terminal:false,skillSteps:{...steps},currentPlanRef:requested.planRef,next:kind==='material'?'确认准备对话能力材料；随后继续注册确认':'确认将 Foundation Skill 接入 Codex'});
const event=await observePlan(client,requested,observation=>onChange({phase:observation.state==='pending'?'skill-confirmation':'skill-executing',...(observation.temporaryManager?{temporaryManager:observation.temporaryManager}:{}),...(observation.confirmationUrl?{confirmationUrl:observation.confirmationUrl}:{}),skillSteps:{...steps,[kind]:{state:observation.state,evidence:{planRef:requested.planRef,sessionId:observation.sessionId}}}}));
    const result=call(['manager','status','--plan-ref',requested.planRef]);
    if(result.sessionId!==event.sessionId||result.state!==event.state)throw Error('Skill 记录与事件不一致');
    steps[kind]={state:result.state,evidence:{planRef:requested.planRef,sessionId:result.sessionId,recordLocation:result.recordLocation}};
    onChange({skillSteps:{...steps}});
    if(result.state!=='completed')return {state:'partial',phase:'finished',terminal:true,skillRegistered:false,skillSteps:steps,next:'程序已安装；本次 Skill 未完成。保留同次计划结果，需要时仅继续未完成步骤。'};
    previousPlanRef=requested.planRef;
  }
  const verified=checkIdentity().codexSkill;
  if(verified?.state!=='files-installed-host-discovery-unverified')throw Error('Skill 注册文件与归属未通过核验；程序成功保留');
  return {state:'completed',phase:'finished',terminal:true,skillRegistered:true,skillDestination:verified.destination,skillSteps:steps,hostDiscoveryVerified:false,next:'程序与所选 Skill 文件已就位；新开 Codex 对话验证识别，项目接入另行确认。'};
}
