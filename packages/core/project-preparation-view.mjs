import {singlePageDocument} from '../../distribution/summon-foundation/lib/single-page-view.mjs';
import {lifecycleJourney} from './lifecycle-journey.mjs';

export function renderProjectPreparationPage(session, nonce, planRef) {
  return singlePageDocument({session,nonce,planRef,journey:lifecycleJourney(session)}, {projectPreparation:true,client:projectPreparationClient});
}

// Uses the installation page shell, content roles, steps and responsive CSS.
// All progress is read from the manager; polling never starts a mutation.
function projectPreparationClient(initial) {
 const q=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let current=initial,busy=false,uncertain=false,stopped=false,revision=null,resultRevision=null;
 const disclosure=document.createElement('div');disclosure.className='facts';disclosure.id='project-disclosure';
 disclosure.innerHTML='<p><strong>本项目持续同步</strong>：修改后自动维护受支持的项目资料与预览登记。关闭面板或对话不撤销；明确停用或撤销才停止。</p><p>保留项目代码、现有技术栈、用户规则和例外。安装依赖、扩大范围及其他项目不在本次授权内。</p>';
 const options=document.createElement('p');options.id='project-scope-options';disclosure.append(options);
 q('.overview').insertBefore(disclosure,q('.progress-label'));
 const form=document.createElement('form');form.id='project-action';form.innerHTML='<div class="actions"></div><p id="project-error" class="error" role="alert"></p>';q('#flow-steps').after(form);form.className='result';
 const read=document.createElement('button');read.type='button';read.textContent='刷新状态';read.addEventListener('click',()=>refresh());q('footer').prepend(read);
 function show(packet){
  current=packet;const s=packet.session,j=packet.journey,ready=j.ended;
  const running=['executing','consumed'].includes(s.state),enabled=s.result?.state==='enabled'||s.projectPreparation.initial?.enabled;
  const revoked=packet.authorization==='revoked'||packet.authorization==='not-granted'&&enabled;
  q('#flow-title').textContent=j.title;q('#flow-description').textContent='接入项目、准备资料并采用制作规则，随后开始制作。';
  q('#project-scope-options').textContent=(s.projectPreparation.technology==='preserve'?'沿用现有技术栈。':'本次采用新 React 项目的 shadcn 制作规则，不安装依赖。')+(s.projectPreparation.includePreview?'本次包含受支持的预览登记。':'本次未包含预览准备与登记。');
  q('#flow-version').textContent=s.projectPreparation.name;q('#flow-destination').textContent=s.operationTargets.project;
  q('#flow-eyebrow').textContent=revoked?'持续同步已停止':ready?'准备完成':running?'正在准备':s.state==='pending'?'核对项目与授权范围':'查看已完成与待处理步骤';
  const count=j.steps.filter(step=>['completed','verified-skipped'].includes(step.state)).length;
  q('#flow-count').textContent='已核实 '+count+' / '+j.steps.length+' 步';q('#flow-status').textContent=running?'正在执行':busy?'正在提交请求':revoked?'授权已撤销':ready?'项目准备就绪':({'failed':'准备尚未完成','cancelled':'本次已取消','expired':'确认已过期','verification-required':'连接或结果待核实'})[s.state]||'等待你的操作';
  const percent=count/j.steps.length*100;q('#flow-bar').style.width=percent+'%';q('.track').setAttribute('aria-valuenow',String(percent));
  const key=JSON.stringify([s.sessionId,s.state,j.steps,ready,revoked]);
  if(key!==revision){revision=key;q('#flow-steps').innerHTML=j.steps.map((step,i)=>'<li class="step '+(['completed','verified-skipped'].includes(step.state)?'done':['executing','pending','failed'].includes(step.state)?'current':'later')+'" data-step="'+step.key+'"><div class="step-top"><span class="step-number">'+(['completed','verified-skipped'].includes(step.state)?'✓':i+1)+'</span><span class="step-title">'+esc(step.title)+'</span><span class="step-state">'+esc(step.label)+'</span></div></li>').join('');}
  const action=revoked||running||ready?null:enabled?'resume-project':s.state==='pending'?'confirm-exact-operation':'recheck-project';
  const actionKey=action+':'+s.sessionId;
  if(form.dataset.actionKey!==actionKey){form.dataset.actionKey=actionKey;form.querySelector('.actions').innerHTML=action?'<button class="primary" name="action" value="'+action+'">'+(action==='resume-project'?'检查并继续准备':action==='recheck-project'?'重新核对项目':'接入并准备')+'</button>'+(s.state==='pending'&&!enabled?'<button name="action" value="cancel-no-change">暂不接入</button>':''):'';}
  form.hidden=!action;q('#project-error').textContent=s.failure?.message||s.result?.preparation?.error?.message||'';form.querySelectorAll('button').forEach(b=>b.disabled=busy||uncertain);
  q('#flow-result').hidden=!(ready||enabled||['failed','cancelled','expired','verification-required'].includes(s.state)||revoked);
  const resultKey=JSON.stringify([ready,enabled,revoked,j.summary,j.next,s.projectPreparation.includePreview]);
  if(resultRevision!==resultKey){resultRevision=resultKey;
  q('#flow-result').innerHTML='<h2>'+esc(revoked?'持续同步已停止':ready?'项目准备就绪':enabled?'已完成步骤保留':'本次尚未准备就绪')+'</h2><p>'+esc(j.summary)+'</p><p>'+esc(revoked?'打开或刷新不会恢复授权。若要重新启用，请在当前对话明确提出。':j.next)+'</p>'+(ready?'<p class="hint">准备成功不等于业务内容交付完整，也不表示新任务已经自动发现项目。预览登记：'+(s.projectPreparation.includePreview?'已纳入；真实运行待核':'本次未纳入')+'。</p><button id="next-task" type="button">复制下一步制作指令</button>':'');
  q('#next-task')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText('继续制作项目 '+s.operationTargets.project+'：先检查 Foundation 同步状态，再按我描述的需求制作。');q('#connection').textContent='已复制，回到当前对话补充你的制作需求。';}catch{q('#connection').textContent='回到当前对话，提供上面的项目路径并描述制作需求。';}});
  }
  const safe={...packet};delete safe.nonce;q('#raw').textContent=JSON.stringify(safe,null,2);
 }
 async function refresh(){try{const response=await fetch('/__foundation/manager/project-state',{cache:'no-store'});if(!response.ok)throw Error();uncertain=false;show(await response.json());q('#connection').textContent='';}catch{q('#connection').textContent='连接中断，保留最后核实结果；不会自动重复提交。恢复连接后刷新状态。';}}
 form.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);q('#flow-status').textContent='正在提交请求';
  try{const response=await fetch('/__foundation/manager/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({managerNonce:current.nonce,action:e.submitter.value})});const result=await response.json();if(!response.ok)q('#project-error').textContent=result.message||result.code;await refresh();}catch{uncertain=true;q('#connection').textContent='提交结果待核实。请刷新状态，不要重复提交。';}finally{busy=false;show(current);form.querySelectorAll('button').forEach(b=>b.disabled=uncertain);}});
 show(initial);if(typeof EventSource!=='undefined'){const events=new EventSource('/__foundation/manager/events?session-id='+encodeURIComponent(initial.session.sessionId));events.onmessage=event=>{try{const packet=JSON.parse(event.data);if(packet.session?.sessionId===current.session.sessionId)show(packet);}catch{q('#connection').textContent='实时状态待核实，请刷新状态。';}};window.addEventListener('pagehide',()=>events.close(),{once:true});}
 async function poll(){if(stopped)return;await refresh();if(!stopped)setTimeout(poll,750);}poll();window.addEventListener('pagehide',()=>stopped=true,{once:true});
}
