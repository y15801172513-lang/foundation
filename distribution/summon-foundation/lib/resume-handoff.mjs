import {readOperation} from './operation-result.mjs';
import {installedClient} from './manager-step.mjs';
import {followSelectedSkill} from './skill-handoff.mjs';

// Explicit user-requested recovery, never an automatic replay of approval.
export async function resumeSkillHandoff({file,env,onChange,journeyControl=null,newOperation=null}) {
  const previous=readOperation(file);
  if(previous.pid&&previous.pid!==process.pid){
    try{process.kill(previous.pid,0);throw Error('原进程仍存在，先在原任务查询；不并发恢复');}
    catch(e){if(e.code!=='ESRCH')throw e;}
  }
  if(previous.skillRegistered||previous.skillSteps?.register?.state==='completed')throw Error('旧记录已完成 Skill 注册；不通过恢复重新安装后来删除的 Skill');
  if(previous.programState!=='completed'||previous.journeyContext?.skillChoice!=='selected'||!previous.installationRoot)throw Error('该记录不是程序完成后的 Skill 待续；先只读核实原操作，不重跑程序');
  const client=installedClient(previous.installationRoot,env),current=client.call(['manager','inspect','--root',previous.installationRoot]).installation?.current;
  if(!previous.installId||current?.identity?.installId!==previous.installId||previous.installedCandidateHash&&current.candidateHash!==previous.installedCandidateHash)throw Error('恢复记录与当前安装不一致；需重新核实');
  if(previous.currentPlanRef){
    const status=client.call(['manager','status','--plan-ref',previous.currentPlanRef]);
    if(['pending','executing','consumed'].includes(status.state))throw Error('旧计划仅有执行中记录；先核实或按原恢复机制处理，不能自动重试');
    // Completed material is reused by capability status. Cancelled/expired
    // confirmation is not reused: followSelectedSkill requests a fresh plan.
  }
  const operation={...previous,...(newOperation||{}),pid:process.pid,state:'awaiting-skill',terminal:false};
  onChange(operation);
  return followSelectedSkill({operation,env,onChange,journeyControl});
}
