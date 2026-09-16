// Presentation only. Planned steps never grant execution authority.
export function lifecycleContent(record, observations) {
  const kind=record.kind||'install',verb={install:'安装',update:'更新',uninstall:'卸载'}[kind]||'处理';
  const programDone=record.programState==='completed'||observations.program?.state==='completed';
  const registration=observations.register?.state,removal=observations.remove?.state;
  const skipped=record.journeyContext?.skillChoice==='skipped';
  const stepStates=Object.values(observations).map(x=>x?.state);
  const cancelled=['cancelled','cancelled-no-install','shutdown-no-install'].includes(record.state)||record.terminal&&stepStates.includes('cancelled');
  const expired=['expired','expired-no-install'].includes(record.state)||record.terminal&&stepStates.includes('expired');
  const environmentBlocked=record.environment&&record.environment.state!=='ready';
  const anyCompleted=Object.entries(observations).some(([key,value])=>['program','material','register','remove'].includes(key)&&value?.state==='completed');
  let title=verb+' Foundation';
  if(record.terminal){
    if(programDone)title='Foundation 已'+verb;
    else if(cancelled)title='已取消'+verb;
    else if(expired)title=verb+'确认已到期';
    else if(environmentBlocked)title='运行环境需要处理';
    else if(record.state==='failed'||stepStates.includes('failed'))title=verb+'未完成';
    else title=anyCompleted?'部分步骤已完成':'操作结果待确认';
    if(programDone&&kind!=='uninstall'&&!skipped&&!record.skillRegistered)title+='；对话功能'+(['cancelled','skipped'].includes(registration)?'未启用':registration==='failed'?'未处理成功':'尚未完成');
  }
  let program=programDone?'程序'+verb+'已完成。'+(kind==='uninstall'?'卸载结果已保存。':record.runtimeHealth==='passed'?'已检查，可以正常打开。':'能否正常打开仍需检查。')
    :record.installationWrites==='none'||['not-started','cancelled','expired'].includes(record.programState)||['cancelled','expired'].includes(observations.program?.state)?'尚未'+(kind==='install'?'安装 Foundation':'执行程序'+verb)+'。':'程序是否发生变化仍需查看本次结果，请勿重复执行。';
  if(programDone&&kind==='update'&&record.programResult?.cleanup)program+=record.programResult.cleanup.state==='completed'?'本次下载暂存已按计划清理。':'部分下载文件已保留，不影响已完成的更新。';
  if(!programDone&&record.programState==='failed')program=verb+'未完成。'+(record.rollback==='completed'?'本次程序变更已回退；不表示安装成功。':'是否已回退仍待核实；不要重复执行。');
  const skill=kind==='uninstall'?(removal==='completed'?'已处理本安装的对话功能文件；修改或未知文件按计划保留。':removal?'对话功能尚未移除成功，原文件保留。':record.hadSkill===false?'本安装没有已登记的对话功能，此次未删除其他 Skill。':'尚未确认是否需要移除对话功能。')
    :record.skillRegistered===true?'对话功能文件已就位，请在新 Codex 对话中尝试“打开 Foundation”。'
    :skipped?(kind==='update'?'本次未新增对话功能。':'本次不启用 Codex 对话功能。')
    :['cancelled','skipped'].includes(registration)?'本次未启用 Codex 对话功能。'
    :registration==='failed'?'对话功能未处理成功；只需检查这一项，不必重装程序。'
    :record.terminal&&!programDone&&(cancelled||expired||record.programState==='failed')?'本次未安装或启用 Skill；程序失败不会继续安装 Skill。'
    :observations.material?.state==='completed'?'Skill 已准备，还需要你确认启用到 Codex。'
    :record.journeyContext?.skillChoice==='selected'?'已选择对话功能，仍需单独确认后才能启用。':'可选择是否启用 Codex 对话功能。';
  const description=record.terminal?program+' '+skill:kind==='install'?'给当前用户安装一份 Foundation，不同项目按需使用，项目资料各自保管。'+(skipped?'本次不启用对话功能。':'对话功能可选，需另外确认。')
    :kind==='update'?'更新这份 Foundation，具体保留范围见本步计划。'+(record.hadSkill===true?'已有对话功能会另行询问是否更新。':record.hadSkill===false?'本次不新增对话功能。':'正在检查已有对话功能。')
    :'只移除本次确认的 Foundation 文件，不清空整个文件夹。'+(removal==='completed'?'对话功能已按前一步结果处理，现在确认程序卸载。':record.hadSkill===true?'先单独确认移除它的对话功能。':record.hadSkill===false?'本安装未登记对话功能，不删除其他 Skill。':'正在检查是否存在关联的对话功能。');
  const environment=environmentBlocked?'运行环境检查未通过。'+(record.environment.missing?.length?'缺少：'+record.environment.missing.join('、')+'。':'')+(record.environment.preparation?.reason||'请在当前 Codex 对话中检查所需环境；不会自动安装或更改系统工具。'):'环境已就绪。';
  const summaries={select:'已确认本次软件位置；项目仍在各自的位置。',acquire:'下载文件已通过来源与完整性检查。',program,material:'Skill 已准备；是否启用到 Codex，请看后续结果。',register:skill,remove:skill,health:'已检查程序，能够正常打开。',environment,cleanup:'本次下载文件已按结果处理；未能安全删除的文件保留。'};
  const next=environmentBlocked?environment:record.terminal&&programDone?(kind==='uninstall'?'保留本次卸载结果；其中列有剩余文件和缓存清理说明。':record.skillRegistered?'请在新 Codex 对话中尝试“打开 Foundation”；使用具体项目时再单独接入。':skipped?'可从程序安装位置重新打开 Foundation。需要对话功能时，再在当前对话中提出。':'在当前对话中说明只继续未完成的对话功能；先检查结果，不重复安装程序。'):record.terminal&&(cancelled||expired)?'本次不会继续执行。如仍需'+verb+'，请在当前对话中重新提出，并核对新的计划。':record.next;
  return {title,program,skill,description,environment,summaries,next,project:kind==='install'?'本次没有接入任何项目；以后在需要的项目中单独确认。':'项目文件仍按各自项目管理；本次不会自动接入其他项目。'};
}

export function journeyView({id,kind='install',observations={},skillChoice='undecided',includeAcquisition=false,includeSelection=false,includeHealth=true,includeCleanup=false,includeSkillRemoval=false}) {
  const labels={acquire:'获取并核验运行文件',select:'选择安装目录',program:({install:'安装程序',update:'更新程序',uninstall:'移除程序'})[kind]||'执行当前维护',health:'验证稳定入口',cleanup:'处理本次暂存',material:'准备对话能力材料',register:'注册到 Codex',remove:'移除 Codex 注册'};
  const statusLabels={completed:'已完成',pending:'待确认',planned:'尚待处理',running:'进行中',executing:'进行中',consumed:'进行中',failed:'失败',cancelled:'已取消',expired:'已过期',skipped:'已跳过',undecided:'可选，待选择',retained:'已处理，保留部分材料','verification-required':'待核实'};
  const keys=[...(includeAcquisition?['acquire']:[]),...(includeSelection?['select']:[]),...(includeSkillRemoval?['remove']:[]),'program',...(includeHealth?['health']:[]),...(includeCleanup?['cleanup']:[])];
  if(kind!=='uninstall'&&(observations.material||observations.register||skillChoice==='selected'))keys.push('material','register');else if(kind!=='uninstall')keys.push('optional-skill');
  const steps=keys.map(key=>{const supplied=observations[key],state=key==='optional-skill'?(skillChoice==='skipped'?'skipped':'undecided'):supplied?.state||'planned';return{id:`${id}:${key}`,key,title:labels[key]||'Codex 对话能力',state,label:statusLabels[state]||'待核实',evidence:supplied?.evidence||null,required:key!=='optional-skill'};});
  const unresolved=steps.filter(s=>s.required&&!['completed','skipped','retained'].includes(s.state)),name=({install:'安装',update:'更新',uninstall:'卸载'})[kind]||'维护';
  const program=observations.program?.state==='completed',trouble=unresolved.find(s=>['failed','cancelled','expired','verification-required'].includes(s.state));
  const title=!unresolved.length?`${name}完成`:program?`程序已完成，${(trouble||unresolved[0]).title}${trouble?'未完成':'仍待处理'}`:trouble?`${name}未完成`:`${name}流程`;
  return {schemaVersion:'1.1.0',id,kind,title,ended:unresolved.length===0,steps,remaining:unresolved.map(s=>s.title),summary:unresolved.length?`尚余：${unresolved.map(s=>s.title+'（'+s.label+'）').join('、')}`:kind==='uninstall'?'本次卸载步骤已完成。请查看卸载回执中的实际删除范围、保留文件与清理说明。':skillChoice==='undecided'&&!observations.register?'已确定操作已完成；对话能力可选，尚未选择。项目接入独立。':'本次已选择步骤均已处理；新任务发现及项目接入另验。',executionAuthority:false};
}
