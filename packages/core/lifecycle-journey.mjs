import {lifecycleFeedback} from './lifecycle-feedback.mjs';
import {journeyView} from '../../distribution/summon-foundation/lib/journey-view.mjs';

// Presentation projection only. previousSteps are resolved by the manager from
// linked records in its own state root, not supplied as success booleans by AI.
export function lifecycleJourney(session) {
  const unique=new Map();
  let unresolvedLink=false;
  for(const record of [...(session.previousSteps || []),session]) {
    if(session.installationRoot && record.installationRoot && record.installationRoot!==session.installationRoot || session.installId && record.installId && session.installId!==record.installId) {unresolvedLink=true;continue;}
    if(record.operation==='unknown')unresolvedLink=true;
    unique.set(record.sessionId || record.operationId || 'unresolved',record);
  }
  const records=[...unique.values()], program=records.filter(r=>lifecycleFeedback(r).category==='installation').at(-1);
  const context=program?.journeyContext || {};
  const id=context.id || program?.operationId || program?.sessionId || session.operationId || session.sessionId || 'unresolved';
  if(!program) {
    const f=lifecycleFeedback(session), state=['preview'].includes(session.state)?'pending':session.state;
    const ended=state==='completed';
    return {id,title:ended?f.title:'独立维护 · '+f.heading,ended,steps:[{id:`${id}:operation`,title:f.heading,state,label:f.title,evidence:session.recordLocation}],program:'关联程序不表示本次执行了安装或更新',skill:f.category==='capability'?f.detail:'对话能力未在本次操作中处理',project:'项目接入独立确认',next:f.next,summary:f.next,executionAuthority:false};
  }
  const kind=['uninstall','normal-uninstall'].includes(program.operation)?'uninstall':program.operation;
  const observations={};
  const observe=(key,record,state=record.state)=>{observations[key]={state:state==='preview'?'pending':state,evidence:{sessionId:record.sessionId,operationId:record.operationId,planHash:record.planHash,recordLocation:record.recordLocation}};};
  observe('program',program);
  const result=program.result?.lifecycleResult||program.result||{};
  if(result.stableLauncherHealth)observe('health',program,result.stableLauncherHealth==='passed'?'completed':'verification-required');
  if(result.cleanup)observe('cleanup',program,result.cleanup.state==='completed'?'completed':'retained');
  if(context.candidateVerified)observe('acquire',records.find(r=>r.journeyContext),'completed');
  if(context.selectionId)observe('select',records.find(r=>r.journeyContext),'completed');
  // A new program operation starts a new result epoch. A prior registration
  // cannot prove registration against the newly installed payload.
  const capabilityRecords=records.filter(r=>r.capabilityType==='codex-skill'||r.capabilityId==='ai-product-foundation-kit');
  const currentCapabilities=kind==='uninstall'?capabilityRecords.slice(-1):records.slice(records.indexOf(program)+1).filter(r=>r.capabilityType==='codex-skill'||r.capabilityId==='ai-product-foundation-kit');
  for(const record of currentCapabilities) {
    const op=record.operation.replace(/^capability-/,'');
    if(op==='install')observe('material',record);
    if(op==='register')observe('register',record);
    if(op==='uninstall')observe('remove',record);
  }
  const registered=observations.register;
  // A completed register validates its material prerequisite, not host discovery.
  if(registered?.state==='completed'&&!observations.material)observations.material={...registered};
  const view=journeyView({id,kind,observations,skillChoice:context.skillChoice||'undecided',includeAcquisition:Boolean(context.candidateVerified),includeSelection:Boolean(context.selectionId),includeHealth:kind!=='uninstall',includeCleanup:Boolean(program.hostCleanup||result.cleanup),includeSkillRemoval:Boolean(observations.remove)});
  if(unresolvedLink){view.ended=false;view.title='已核实结果保留，关联步骤待核实';view.summary='部分历史记录缺失或安装身份不符；不据此判定整次流程完成。';view.steps.push({id:`${id}:unresolved`,key:'unresolved',title:'核实关联记录',state:'verification-required',label:'待核实'});}
  const skill=kind==='uninstall'
    ?observations.remove?`Codex 注册移除：${view.steps.find(s=>s.key==='remove')?.label}；具体删除与保留项以该操作回执为准`
      :'本次未关联 Codex 注册移除记录；不据此判断用户级 Skill 是否仍存在'
    :registered?`Codex 注册：${view.steps.find(s=>s.key==='register')?.label}；新任务发现另验`:observations.material?'材料准备不是宿主注册；注册仍须独立确认':context.skillChoice==='skipped'?'对话能力：本次已跳过':context.skillChoice==='selected'?'已选择对话能力；准备及注册仍须分别确认':'对话能力：可选，待选择';
  return {...view,owner:'manager-record-projection',program:`${lifecycleFeedback(program).heading}：${view.steps.find(s=>s.key==='program')?.label}`,skill,project:kind==='uninstall'?'项目与用户文件的保留范围以本次卸载计划和回执为准':'项目接入独立，不阻止程序收尾',next:view.summary};
}
