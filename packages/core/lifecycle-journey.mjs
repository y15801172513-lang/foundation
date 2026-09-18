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
  if (session.projectPreparation) {
    const preparation = session.result?.preparation, initial = session.projectPreparation.initial || {};
    const enabled = session.result?.state === 'enabled' || initial.enabled;
    const observed = key => preparation?.steps?.find(step => step.step === key);
    const done = key => ['completed','verified-skipped'].includes(observed(key)?.state);
    const running = ['executing','consumed'].includes(session.state);
    const terminal = ['failed','cancelled','expired','verification-required'].includes(session.state);
    const steps = [
      {key:'enable',title:'启用 Foundation',state:enabled ? initial.enabled ? 'verified-skipped' : 'completed' : running ? 'executing' : terminal ? session.state : 'pending'},
      {key:'preparation',title:'准备项目资料',state:done('preparation') ? observed('preparation').state : initial.factsReady ? 'verified-skipped' : enabled && running ? 'executing' : enabled && preparation && !preparation.ok && !observed('adoption') ? 'failed' : 'planned'},
      {key:'adoption',title:'采用制作规则',state:done('adoption') ? observed('adoption').state : initial.rulesReady ? 'verified-skipped' : enabled && preparation && !preparation.ok && done('preparation') ? 'failed' : 'planned'}
    ].map(step=>({...step,id:`${id}:${step.key}`,label:({'completed':'已完成','verified-skipped':'已核实','executing':'正在执行','failed':'待处理','cancelled':'已取消','expired':'已过期','verification-required':'待核实','pending':'等待授权','planned':'等待前序步骤'})[step.state]}));
    const ready = preparation?.ok === true;
    return {id,title:ready ? '项目准备就绪' : '让项目准备就绪',ended:ready,steps,summary:preparation?.error?.message || session.failure?.message || (ready ? '接入、项目资料与制作规则已核实。' : '接入项目、准备资料并采用制作规则，随后开始制作。'),next:ready ? '回到当前 Codex 对话，描述要制作的页面或功能。业务内容、真实运行和预览仍需分别核验。' : enabled ? '已完成的启用和资料保留。重新检查并继续未完成步骤，无需再次授予日常同步权限。' : '核对项目与授权范围后，一次接入并准备。',executionAuthority:false};
  }
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
