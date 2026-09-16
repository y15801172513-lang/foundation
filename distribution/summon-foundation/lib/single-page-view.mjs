import {singlePageStyle} from './single-page-style.mjs';

// The approved product DOM/CSS; the client consumes facts, not demo timers.
export function singlePageDocument(csrf) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Foundation 安装与维护</title><style>body{margin:0}${singlePageStyle}</style><body><div id="foundation-flow-demo" aria-label="Foundation 安装与维护"><main class="product"><header class="brand"><span class="brand-mark">F</span><span>Foundation</span><span class="private-label">安装与维护</span></header><section class="overview"><div class="eyebrow" id="flow-eyebrow">正在核实</div><h1 id="flow-title">Foundation</h1><p id="flow-description"></p><div class="metadata"><span id="flow-version"></span><span id="flow-destination"></span></div><div class="progress-label"><span id="flow-count"></span><span id="flow-status" role="status" aria-live="polite"></span></div><div class="track" role="progressbar" aria-label="已完成步骤" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="flow-bar"></div></div></section><ol id="flow-steps" class="steps"></ol><section id="flow-result" class="result" hidden aria-live="polite"></section><footer><p id="connection" role="status"></p><details><summary>技术详情</summary><pre id="raw" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></details></footer></main></div><script>(${singlePageClient.toString()})(${JSON.stringify(csrf)});</script></body></html>`;
}

function singlePageClient(csrf) {
 const q=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let last=null,busy=false,revision=null,stopped=false;
 const verbs={install:'安装',update:'更新',uninstall:'卸载'};
 function cleanupText(session){const c=session?.hostCleanup;if(!c)return '';return '<div class="facts"><p>更新成功并通过健康检查后，清理本次下载的归档和展开候选。</p><p>清理位置：'+esc(c.root)+'</p><p>范围：'+esc(c.files?.length??'待核实')+' 个文件；'+(Number.isFinite(c.bytes)?(c.bytes/1048576).toFixed(2)+' MiB':'大小待核实')+'</p><p>保留获取回执、验证材料、回退版本、项目和未知或已修改文件；仍在使用的材料不会强删。</p></div>';}
 function show(p){
  last=p;const r=p.record,v=p.view,kind=r.kind||'install',verb=verbs[kind],choice=r.phase==='choosing-intent';
  const titles={select:'选择安装位置',acquire:kind==='update'?'下载并检查新版':'下载并检查文件',program:verb+' Foundation',material:'准备安装 Skill',register:kind==='update'?'更新 Codex 中的 Skill':'将 Skill 安装到 Codex',remove:'移除 Codex 中的 Skill',health:'检查'+verb+'结果','optional-skill':'Foundation Skill'};
  const stateLabels={failed:'本步失败',cancelled:'已取消',expired:'已过期','verification-required':'结果待核实',running:'正在执行',executing:'正在执行',consumed:'正在执行',undecided:'可选，待选择'};
  const order=kind==='uninstall'?['remove','program']:['select','acquire','program','material','register','optional-skill','health'];
  const steps=p.progress.journey.steps.map(s=>({...s})).sort((a,b)=>order.indexOf(a.key)-order.indexOf(b.key));
  if(choice)for(const s of steps)s.state=s.key==='select'?'pending':'planned';
  if(r.environment)steps.unshift({key:'environment',title:'检查使用环境',state:r.environment.state==='ready'?'completed':'failed',evidence:(r.environment.preparation?'对话准备的基础环境已复检；':'复用现有入口环境；')+r.environment.platform+' '+r.environment.arch+'；入口 Node '+r.environment.nodeVersion+'；程序使用随包运行时，不修改共享设置'+(r.environment.preparation?'。独立环境回执：'+r.environment.preparation.receipt+'；缓存不自动清理':'')});
  if(r.intentSelected){const s=steps.find(s=>s.key==='select');if(s)s.state='completed';}
  let active=choice?'select':v?.type==='selection'?'select':v?.session?.capabilityId?(v.session.operation==='install'?'material':v.session.operation==='uninstall'?'remove':'register'):v?.session?'program':steps.find(s=>!['completed','skipped','retained'].includes(s.state))?.key;
  // The final result check must not look finished while a chosen Skill step
  // still awaits confirmation. Program health remains visible in its receipt.
  const health=steps.find(s=>s.key==='health');
  if(health?.state==='completed'&&!r.terminal)health.state='planned';
  if(r.terminal)active=null;
  const executing=['executing','consumed'].includes(v?.session?.state)||['executing','skill-executing'].includes(r.phase);
  const count=steps.filter(s=>['completed','skipped','retained'].includes(s.state)).length;
  q('#flow-title').textContent=r.terminal?(r.state==='completed'?'Foundation '+verb+'完成':'本次'+verb+'未全部完成'):verb+' Foundation';
  q('#flow-eyebrow').textContent=r.terminal?'本次结果':executing?'正在执行':busy?'正在提交请求':v||choice?'等待你的操作':'正在进行';
  q('#flow-description').textContent=kind==='install'?'安装程序和 Skill，让 Codex 可以使用 Foundation。':kind==='update'?'更新程序和已有 Skill，保留你的项目与制作资料。':'移除 Foundation 和它的 Skill，保留你的项目与制作资料。';
  q('#flow-version').textContent='版本：'+(p.progress.version||'待核实');q('#flow-destination').textContent='程序位置：'+(r.installationRoot||r.destinationIntent||'等待选择');
  q('#flow-count').textContent='已处理 '+count+' / '+steps.length+' 步';q('#flow-status').textContent=executing?'正在执行当前步骤':busy?'正在提交请求':r.terminal?(r.state==='completed'?'本次流程已完成':'查看未完成项'):('当前：'+(titles[active]||p.progress.phase));
  const percent=steps.length?count/steps.length*100:0;q('#flow-bar').style.width=percent+'%';q('.track').setAttribute('aria-valuenow',String(Math.round(percent)));
  const key=JSON.stringify([active,v?.session?.sessionId,v?.session?.state,v?.selectionId,r.terminal,steps.map(s=>s.state),v?.error]);
  if(key!==revision&&!busy){
   revision=key;
   q('#flow-steps').innerHTML=steps.map((s,i)=>{
    const done=['completed','retained'].includes(s.state),skip=s.state==='skipped',current=s.key===active;
    let body='';
    if(current&&(choice||v?.type==='selection'))body='<form id="current-form"><label class="field" for="install-path">安装到哪里？</label><input id="install-path" name="destination" type="text" value="'+esc(r.destinationIntent||v?.suggestion||'')+'" spellcheck="false" required><p class="hint">请输入完整路径，可以包含成对引号。不会覆盖已有内容，最终目录仍由程序检查。</p><label class="check"><input id="include-skill" name="includeSkill" type="checkbox" '+(r.journeyContext?.skillChoice==='skipped'?'':'checked')+'><span>同时安装 Foundation Skill<br><span class="hint">让 Codex 能识别 Foundation 指令，并按 Foundation 规范工作。</span></span></label><p class="hint">获取缓存：'+esc(r.acquisitionRoot||'以当前任务已披露位置为准')+'。选择不是安装批准。</p><div id="step-error" class="error" role="alert">'+esc(v?.error||'')+'</div><div class="actions"><button class="primary" name="action" value="'+(choice?'choose':'select')+'">使用这个位置</button><button name="action" value="'+(choice?'cancel-intent':'cancel')+'" formnovalidate>取消本步</button></div></form>';
    else if(current&&v?.session){const f=v.feedback;body='<p>'+esc(f.detail)+'</p><div class="facts">'+f.namedTargets.map(t=>'<p>'+esc(t.label)+'：'+esc(t.path||'待核实')+'</p>').join('')+'<p>保留：'+esc(f.preserves.join('；'))+'</p><p>'+esc(f.notDone)+'</p>'+cleanupText(v.session)+((v.session.deletes||[]).length?'<details open><summary>删除范围</summary>'+v.session.deletes.map(x=>'<p>'+esc(x==='foundation-installation:full'?'本安装中经所有权核验的程序、运行时和状态文件；未知或用户修改的文件保留。':typeof x==='string'?x:JSON.stringify(x))+'</p>').join('')+'</details>':'')+'</div><p class="hint">每次确认只针对当前计划，不批准后续步骤。Skill 文件就位不等于新对话已识别。</p><form id="current-form"><div id="step-error" class="error" role="alert"></div><div class="actions">'+(v.session.state==='pending'?'<button class="'+(kind==='uninstall'?'danger':'primary')+'" name="action" value="'+esc(v.action)+'">确认'+esc(titles[s.key])+'</button><button name="action" value="cancel-no-change">取消本步</button>':'<p>本步已开始或结束，不能重复确认。</p>')+'</div></form>';}
    else if(current)body='<p role="status" '+(s.key==='acquire'?'data-acquisition-phase':'')+'>'+esc(p.progress.phase)+'</p><p class="hint">下一步会在本页展开，不需要查找其他网址。</p>'+(s.key==='acquire'?'<p class="error" data-download-connection role="status"></p>':'');
    else if(s.key==='acquire'&&s.state==='failed')body='<p class="error">'+esc(p.progress.next)+'</p>';
    if(current&&(choice||v?.type==='selection'))body=body.replace('<form id="current-form">','<form id="current-form"><label class="field" for="scope-kind">在哪里使用？</label><select id="scope-kind" name="scopeKind"><option value="user" '+(r.scopeIntent?.kind!=='project'?'selected':'')+'>当前用户使用（推荐）</option><option value="project" '+(r.scopeIntent?.kind==='project'?'selected':'')+'>仅当前项目使用</option></select><p class="hint">当前用户：多个项目共用，Skill 为用户级，不是所有系统账户。项目模式：绑定具体仓库，Skill 仅放入该项目；已有用户级 Skill 不会消失，同名冲突会停止注册。</p><label class="field" for="project-root">项目根路径（仅项目模式需要）</label><input id="project-root" type="text" name="projectRoot" value="'+esc(r.scopeIntent?.projectRoot||'')+'" spellcheck="false"><p class="hint">程序仍使用与业务项目不重叠的独立目录，通过真实项目身份限定使用，不修改业务依赖或 AGENTS。</p>');
    return '<li data-step="'+esc(s.key)+'" class="step '+(current?'current':done||skip?'done':'later')+'"><div class="step-top"><span class="step-number">'+(skip?'−':done?'✓':i+1)+'</span><span class="step-title">'+esc(titles[s.key]||s.title)+'</span><span class="step-state">'+esc(skip?'已跳过':done?'已完成':stateLabels[s.state]||(current?(choice?'等待选择':p.progress.phase):r.terminal?'本次未执行':'等待前序步骤'))+'</span></div>'+(body?'<div class="step-body">'+body+'</div>':done||skip?'<details class="completed-detail"><summary>查看结果</summary><p>'+esc(skip?'本次未执行此步骤。':s.evidence?JSON.stringify(s.evidence):'结果来自本次操作记录')+'</p></details>':'')+'</li>';
   }).join('');
  }
  if(busy&&executing){const live=q('.current .step-state');if(live)live.textContent='正在执行';}
  // Byte/phase updates must not rebuild the form or depend on its revision key.
  const downloadRow=q('[data-step="acquire"]');
  if(downloadRow&&(active==='acquire'||r.terminal&&steps.find(s=>s.key==='acquire')?.state==='failed')){
   downloadRow.querySelector('.step-state').textContent=p.progress.downloadStatus||p.progress.phase;
   const phase=downloadRow.querySelector('[data-acquisition-phase]');if(phase)phase.textContent=p.progress.downloadStatus==='正在检查文件'?'正在检查文件':p.progress.phase;
   const connection=downloadRow.querySelector('[data-download-connection]');if(connection)connection.textContent='';
  }
  q('#flow-result').hidden=!r.terminal;
  if(r.terminal)q('#flow-result').innerHTML='<h2>'+esc(r.state==='completed'?verb+'完成':'部分完成 / 待核实')+'</h2><p>'+esc(p.progress.program)+'</p><p>Skill：'+esc(p.progress.skill)+'</p><p>项目：'+esc(p.progress.project)+'</p><p class="hint">下一步：'+esc(p.progress.next)+'</p>';
  const safe=JSON.parse(JSON.stringify(p));if(safe.view){delete safe.view.managerNonce;delete safe.view.nonce;}q('#raw').textContent=JSON.stringify(safe,null,2);
 }
 document.addEventListener('submit',async e=>{if(e.target.id!=='current-form')return;e.preventDefault();if(busy||!last)return;busy=true;const form=e.target;form.querySelectorAll('button').forEach(b=>b.disabled=true);q('#flow-status').textContent='正在提交请求';const action=e.submitter.value,v=last.view;const body={csrf,operationId:last.record.operationId,action,...(['choose','select'].includes(action)?{destination:form.elements.destination.value,skillChoice:form.elements.includeSkill.checked?'selected':'skipped'}:{managerNonce:v?.managerNonce,sessionId:v?.session?.sessionId,planHash:v?.session?.planHash})};
  if(['choose','select'].includes(action)){body.scopeKind=form.elements.scopeKind.value;body.projectRoot=body.scopeKind==='project'?form.elements.projectRoot.value:null;}
  try{const response=await fetch(location.pathname+'/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok){q('#step-error').textContent=result.message||result.code||'本步未完成，请核实';busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);return;}busy=false;revision=null;await refresh();}catch{q('#connection').textContent='请求结果待核实，不自动重试。已收到的结果保留；刷新查询同次流程。';}});
 async function refresh(){try{const response=await fetch(location.pathname+'/state');if(!response.ok)throw Error();show(await response.json());q('#connection').textContent='';}catch{q('#connection').textContent=last?.record?.terminal?'结果服务已结束，上方保留最后核实结果。可在对话中按本次操作记录再次查询。':'连接已中断，保留最后核实结果；不自动重试操作。';const note=q('.current [data-download-connection]');if(note){note.textContent='连接中断，进度待核实；保留上次收到的数值。';q('.current .step-state').textContent=(last.progress.downloadStatus||last.progress.phase)+' · 待核实';}}}
 async function poll(){if(stopped)return;await refresh();if(!stopped)setTimeout(poll,750);}poll();window.addEventListener('pagehide',()=>{stopped=true},{once:true});
}
