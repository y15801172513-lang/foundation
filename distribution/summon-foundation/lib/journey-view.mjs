// Presentation only. Planned steps never grant execution authority.
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
