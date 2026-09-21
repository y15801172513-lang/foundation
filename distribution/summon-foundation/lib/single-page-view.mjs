import {singlePageStyle} from './single-page-style.mjs';

// The approved product DOM/CSS; the client consumes facts, not demo timers.
export function singlePageDocument(csrf, {client = singlePageClient, projectPreparation = false, content = null, script = null} = {}) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Foundation ${projectPreparation ? "项目准备" : "安装与维护"}</title><style>body{margin:0}${singlePageStyle}</style><body><div id="foundation-flow-demo" aria-label="Foundation ${projectPreparation ? "项目准备" : "安装与维护"}"><main class="product"><header class="brand"><span class="brand-mark">F</span><span>Foundation</span><span class="private-label">${projectPreparation ? "项目准备" : "安装与维护"}</span></header>${content ?? `<section class="overview"><div class="eyebrow" id="flow-eyebrow">正在核实</div><h1 id="flow-title">Foundation</h1><p id="flow-description"></p><div class="metadata"><span id="flow-version"></span><span id="flow-destination"></span></div><div class="progress-label"><span id="flow-count"></span><span id="flow-status" role="status" aria-live="polite"></span></div><div class="track" role="progressbar" aria-label="已完成步骤" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="flow-bar"></div></div></section><ol id="flow-steps" class="steps"></ol><section id="flow-result" class="result" hidden aria-live="polite"></section><footer><p id="connection" role="status"></p><details><summary>技术详情</summary><pre id="raw" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></details></footer>`}</main></div><script>${script ?? `(${client.toString()})(${JSON.stringify(csrf).replaceAll("<", "\\u003c")});`}</script></body></html>`;
}

function singlePageClient(csrf) {
 const q=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let last=null,busy=false,revision=null,stopped=false,formIdentity=null,submitted=null,posting=false;
 const verbs={install:'安装',update:'更新',uninstall:'卸载'};
 function cleanupText(session){const c=session?.hostCleanup;if(!c)return '';return '<div class="facts"><p>更新成功并通过健康检查后，清理本次下载的归档和展开候选。</p><p>清理位置：'+esc(c.root)+'</p><p>范围：'+esc(c.files?.length??'待核实')+' 个文件；'+(Number.isFinite(c.bytes)?(c.bytes/1048576).toFixed(2)+' MiB':'大小待核实')+'</p><p>保留获取回执、验证材料、回退版本、项目和未知或已修改文件；仍在使用的材料不会强删。</p></div>';}
 function show(p){
  if(last&&p.record.operationId!==last.record.operationId)throw Error('流程身份变化');
  if(submitted&&!posting&&p.record.operationId===submitted.operationId&&(p.record.terminal||p.reconciled===true&&!p.submissionPending&&p.view?.session?.sessionId===submitted.sessionId||p.view?.session?.sessionId&&p.view.session.sessionId!==submitted.sessionId||p.view?.session?.sessionId===submitted.sessionId&&p.view.session.state!=='pending'||submitted.choice&&(p.record.phase!=='choosing-intent'||p.reconciled===true&&!p.submissionPending))){busy=false;submitted=null;revision=null;}
  last=p;const r=p.record,v=p.view,c=p.progress.content,kind=r.kind||'install',verb=verbs[kind],choice=r.phase==='choosing-intent'&&!r.terminal;
  const titles={select:'选择安装位置',acquire:kind==='update'?'下载并检查新版':'下载并检查文件',program:verb+' Foundation',material:'准备安装 Skill',register:kind==='update'?'更新 Codex 中的 Skill':'将 Skill 安装到 Codex',remove:'移除 Codex 中的 Skill',health:'检查'+verb+'结果','optional-skill':'Foundation Skill'};
  const stateLabels={failed:'本步失败',cancelled:'已取消',expired:'已过期','verification-required':'结果待核实',running:'正在执行',executing:'正在执行',consumed:'正在执行',undecided:'可选，待选择'};
  const order=kind==='uninstall'?['remove','program']:['select','acquire','program','material','register','optional-skill','health'];
  const steps=p.progress.journey.steps.map(s=>({...s})).sort((a,b)=>order.indexOf(a.key)-order.indexOf(b.key));
  if(choice)for(const s of steps)s.state=s.key==='select'?'pending':'planned';
  if(r.environment)steps.unshift({key:'environment',title:'检查运行环境',state:r.environment.state==='ready'?'completed':'failed',evidence:(r.environment.preparation?'对话准备的基础环境已复检；':'复用现有入口环境；')+r.environment.platform+' '+r.environment.arch+'；入口 Node '+r.environment.nodeVersion+'；程序使用随包运行时，不修改共享设置'+(r.environment.preparation?'。独立环境回执：'+r.environment.preparation.receipt+'；缓存不自动清理':'')});
  if(r.intentSelected){const s=steps.find(s=>s.key==='select');if(s)s.state='completed';}
  let active=choice?'select':v?.type==='selection'?'select':v?.session?.capabilityId?(v.session.operation==='install'?'material':v.session.operation==='uninstall'?'remove':'register'):v?.session?'program':steps.find(s=>!['completed','skipped','retained'].includes(s.state))?.key;
  // The final result check must not look finished while a chosen Skill step
  // still awaits confirmation. Program health remains visible in its receipt.
  const health=steps.find(s=>s.key==='health');
  if(health?.state==='completed'&&!r.terminal)health.state='planned';
  if(r.terminal)active=null;
  const executing=['executing','consumed'].includes(v?.session?.state)||['executing','skill-executing'].includes(r.phase);
  const count=steps.filter(s=>['completed','skipped','retained'].includes(s.state)).length;
  q('#flow-title').textContent=c.title;
  q('#flow-eyebrow').textContent=r.terminal?'本次结果':executing?'正在执行':busy?'正在提交请求':v||choice?'等待你的操作':'正在进行';
  q('#flow-description').textContent=c.description;
  q('#flow-version').textContent='版本：'+(p.progress.version||'待核实');q('#flow-destination').textContent='程序位置：'+(r.installationRoot||r.destinationIntent||'等待选择');
  q('#flow-count').textContent='已处理 '+count+' / '+steps.length+' 步';q('#flow-status').textContent=r.terminal?(r.state==='completed'?'本次流程已完成':'查看未完成项'):executing?'正在执行当前步骤':busy?'正在提交请求':('当前：'+(titles[active]||p.progress.phase));
  const percent=steps.length?count/steps.length*100:0;q('#flow-bar').style.width=percent+'%';q('.track').setAttribute('aria-valuenow',String(Math.round(percent)));
  const key=JSON.stringify([active,v?.session?.sessionId,v?.session?.state,v?.selectionId,r.terminal,steps.map(s=>s.state),v?.error]);
  if(key!==revision&&!busy){
   const identity=JSON.stringify([r.operationId,active,v?.session?.sessionId]);
   const previous=q('#current-form'),draft=formIdentity===identity&&previous?{destination:previous.elements.destination?.value,skill:previous.elements.includeSkill?.checked,error:q('#step-error')?.textContent,focus:document.activeElement?.id}:null;
   formIdentity=identity;revision=key;
   q('#flow-steps').innerHTML=steps.map((s,i)=>{
    const done=['completed','retained'].includes(s.state),skip=s.state==='skipped',current=s.key===active;
    let body='';
    if(current&&(choice||v?.type==='selection'))body='<form id="current-form"><label class="field" for="install-path">Foundation 安装位置</label><input id="install-path" name="destination" type="text" value="'+esc(r.destinationIntent||v?.suggestion||'')+'" spellcheck="false" required><p class="hint">这里只存放 Foundation 程序。以后不同项目都可以使用它，项目文件仍保存在各自的位置。请输入完整路径，可以包含成对引号；不会覆盖已有文件。</p><label class="check"><input id="include-skill" name="includeSkill" type="checkbox" '+(r.journeyContext?.skillChoice==='skipped'?'':'checked')+'><span>同时启用 Codex 对话功能（Foundation Skill）<br><span class="hint">以后可在 Codex 中说“打开 Foundation”或“用 Foundation 做这个项目”。启用后请在新对话中尝试。</span></span></label><p class="hint">获取缓存：'+esc(r.acquisitionRoot||'以当前任务已披露位置为准')+'。选择不是安装批准。</p><div id="step-error" class="error" role="alert">'+esc(v?.error||'')+'</div><div class="actions"><button class="primary" name="action" value="'+(choice?'choose':'select')+'">使用这个位置</button><button name="action" value="'+(choice?'cancel-intent':'cancel')+'" formnovalidate>取消本步</button></div></form>';
    else if(current&&v?.session){const f=v.feedback;body='<p>'+esc(f.detail)+'</p><div class="facts">'+f.namedTargets.map(t=>'<p>'+esc(t.label)+'：'+esc(t.path||'待核实')+'</p>').join('')+'<p>保留：'+esc(f.preserves.join('；'))+'</p><p>'+esc(f.notDone)+'</p>'+cleanupText(v.session)+((v.session.deletes||[]).length?'<details open><summary>删除范围</summary>'+v.session.deletes.map(x=>'<p>'+esc(x==='foundation-installation:full'?'本安装中经所有权核验的程序、运行时和状态文件；未知或用户修改的文件保留。':typeof x==='string'?x:JSON.stringify(x))+'</p>').join('')+'</details>':'')+'</div><p class="hint">这次只执行上面列出的操作，不批准后续步骤。</p><form id="current-form"><div id="step-error" class="error" role="alert"></div><div class="actions">'+(v.session.state==='pending'?'<button class="'+(kind==='uninstall'?'danger':'primary')+'" name="action" value="'+esc(v.action)+'">'+esc(({program:verb+' Foundation',material:'准备安装 Skill',register:kind==='update'?'更新对话功能':'启用对话功能',remove:'移除对话功能'})[s.key]||'确认本步')+'</button><button name="action" value="cancel-no-change">取消本步</button>':'<p>本步已开始或结束，不能重复确认。</p>')+'</div></form>';}
    else if(current)body='<p role="status" '+(s.key==='acquire'?'data-acquisition-phase':'')+'>'+esc(p.progress.phase)+'</p><p class="hint">下一步会在本页展开，不需要查找其他网址。</p>'+(s.key==='acquire'?'<p class="error" data-download-connection role="status"></p>':'');
    else if(['failed','cancelled','expired','verification-required'].includes(s.state))body='<p class="error">'+esc(s.key==='environment'?c.environment:c.next||p.progress.next)+'</p>';

    return '<li data-step="'+esc(s.key)+'" class="step '+(current?'current':done||skip?'done':'later')+'"><div class="step-top"><span class="step-number">'+(skip?'−':done?'✓':i+1)+'</span><span class="step-title">'+esc(titles[s.key]||s.title)+'</span><span class="step-state">'+esc(skip?'已跳过':done?'已完成':stateLabels[s.state]||(current?(choice?'等待选择':p.progress.phase):r.terminal?'本次未执行':'等待前序步骤'))+'</span></div>'+(body?'<div class="step-body">'+body+'</div>':done||skip?'<details class="completed-detail"><summary>查看结果</summary><p>'+esc(skip?'本次未执行此步骤。':c.summaries[s.key]||'本步已处理；详细记录见技术详情。')+'</p></details>':'')+'</li>';
   }).join('');
   const form=q('#current-form');if(draft&&form){if(form.elements.destination&&draft.destination!==undefined)form.elements.destination.value=draft.destination;if(form.elements.includeSkill&&draft.skill!==undefined)form.elements.includeSkill.checked=draft.skill;if(q('#step-error'))q('#step-error').textContent=draft.error||'';if(draft.focus)document.getElementById(draft.focus)?.focus();}
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
  if(r.terminal)q('#flow-result').innerHTML='<h2>'+esc(c.title)+'</h2><p>'+esc(c.program)+'</p><p>Codex 对话功能：'+esc(c.skill)+'</p><p>项目：'+esc(c.project)+'</p><p class="hint">下一步：'+esc(c.next||p.progress.next)+'</p>';
  const safe=JSON.parse(JSON.stringify(p));if(safe.view){delete safe.view.managerNonce;delete safe.view.nonce;}q('#raw').textContent=JSON.stringify(safe,null,2);
 }
 document.addEventListener('submit',async e=>{if(e.target.id!=='current-form')return;e.preventDefault();if(busy||!last)return;busy=true;posting=true;submitted={operationId:last.record.operationId,sessionId:last.view?.session?.sessionId,choice:last.record.phase==='choosing-intent'};const form=e.target;form.querySelectorAll('button').forEach(b=>b.disabled=true);q('#flow-status').textContent='正在提交请求';const action=e.submitter.value,v=last.view;const body={csrf,operationId:last.record.operationId,action,...(['choose','select'].includes(action)?{destination:form.elements.destination.value,skillChoice:form.elements.includeSkill.checked?'selected':'skipped'}:{managerNonce:v?.managerNonce,sessionId:v?.session?.sessionId,planHash:v?.session?.planHash})};

  try{const response=await fetch(location.pathname+'/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok){q('#step-error').textContent=result.message||result.code||'本步未完成，请核实';busy=false;submitted=null;form.querySelectorAll('button').forEach(b=>b.disabled=false);return;}busy=false;submitted=null;revision=null;await refresh();}catch{q('#connection').textContent='请求结果待核实，不自动重试。已收到的结果保留；使用“重新核对状态”查询同次流程。';}finally{posting=false;}});
 async function refresh(){try{const response=await fetch(location.pathname+'/state');if(!response.ok)throw Error();show(await response.json());q('#connection').textContent=busy?'提交结果仍待核实；不会重复提交原确认。':'';}catch{q('#connection').textContent=last?.record?.terminal?'结果服务已结束，上方保留最后核实结果。可在对话中按本次操作记录再次查询。':'连接已中断，保留最后核实结果；不自动重试操作。';const note=q('.current [data-download-connection]');if(note){note.textContent='连接中断，进度待核实；保留上次收到的数值。';q('.current .step-state').textContent=(last.progress.downloadStatus||last.progress.phase)+' · 待核实';}}}
 const read=document.createElement('button');read.id='read-status';read.type='button';read.textContent='重新核对状态';read.addEventListener('click',refresh);q('footer').prepend(read);
 async function poll(){if(stopped)return;await refresh();if(!stopped)setTimeout(poll,750);}poll();window.addEventListener('pagehide',()=>{stopped=true},{once:true});
}
