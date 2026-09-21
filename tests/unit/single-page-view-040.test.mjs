import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {singlePageDocument} from '../../distribution/summon-foundation/lib/single-page-view.mjs';
import {acquisitionProgress} from '../../distribution/summon-foundation/lib/progress-page.mjs';
import {runtimeObservation} from '../../distribution/summon-foundation/lib/operation-result.mjs';

test('health failure shows unfinished install, verified rollback, no Skill and folded diagnostics after disconnect',async()=>{
 const record={operationId:'health-failure',kind:'install',skillRegistered:false,...runtimeObservation({status:'BOOTSTRAP_OPERATION_ENDED',state:'failed',journeyContext:{skillChoice:'selected'},failure:{code:'EXECUTABLE_HEALTH_FAILED',stage:'health-check',details:{rollback:'completed',healthCheck:{phase:'staged-payload',exitCode:17,signal:null,timedOut:false,stderr:{text:'intentional health failure'}}}}})};
 record.phase='executing'; // The terminal record can retain its last execution phase.
 const page=await livePage(record);try{
  const document=page.dom.window.document;assert.equal(document.querySelector('#flow-title').textContent,'安装未完成');assert.equal(document.querySelector('#flow-status').textContent,'查看未完成项');
  assert.match(document.querySelector('#flow-result').textContent,/已回退/);assert.match(document.querySelector('#flow-result').textContent,/未安装或启用 Skill/);assert.match(document.querySelector('#flow-result').textContent,/不要重放旧确认/);
  assert.equal(document.querySelector('#current-form'),null);assert.equal(document.querySelector('#raw').closest('details').open,false);assert.match(document.querySelector('#raw').textContent,/staged-payload/);
  const before=document.querySelector('#flow-result').textContent;await page.refresh({},true);assert.equal(document.querySelector('#flow-result').textContent,before);
 }finally{page.dom.window.close();}
});

async function livePage(record){
 let tick,fail=false;
 const dom=new JSDOM(singlePageDocument('progress-fixture'),{url:'http://127.0.0.1:43123/progress-fixture',runScripts:'dangerously',beforeParse(w){
  w.setTimeout=fn=>{tick=fn;return 1};w.fetch=async()=>{if(fail)throw Error('isolated disconnection');return{ok:true,json:async()=>({record,progress:acquisitionProgress(record),view:null})}};
 }});
 await new Promise(r=>setTimeout(r,10));
 return{dom,async refresh(patch,disconnected=false){Object.assign(record,patch);fail=disconnected;await tick()},status:()=>dom.window.document.querySelector('[data-step="acquire"] .step-state')?.textContent};
}

for(const kind of ['install','update'])test('C5 '+kind+' right-hand status follows bytes, phase and same-operation refresh without rebuilding forms',async()=>{
 const p=await livePage({operationId:'one-operation',kind,state:'running',terminal:false,phase:'discovering',intentSelected:true,journeyContext:{skillChoice:'skipped'}});
 try{
  assert.equal(p.status(),'正在查询版本');
  await p.refresh({phase:'fetching-and-verifying-runtime',download:{attempt:1,asset:'first',downloadedBytes:1048576,totalBytes:4194304}});assert.equal(p.status(),'下载 25% · 1.00 MiB / 4.00 MiB');
  const row=p.dom.window.document.querySelector('[data-step="acquire"]');
  await p.refresh({download:{attempt:1,asset:'first',downloadedBytes:2097152,totalBytes:4194304}});assert.equal(p.status(),'下载 50% · 2.00 MiB / 4.00 MiB');assert.equal(row,p.dom.window.document.querySelector('[data-step="acquire"]'));
  assert.match(row.querySelector('[data-acquisition-phase]').textContent,/正在下载/);assert.doesNotMatch(row.textContent,/查询正式发行/);
  await p.refresh({},true);assert.match(p.status(),/50%.*待核实/);assert.match(row.querySelector('[data-download-connection]').textContent,/上次收到/);
  await p.refresh({download:{attempt:2,asset:'first',downloadedBytes:0,totalBytes:4194304}});assert.equal(p.status(),'重试 2 · 等待下载');assert.doesNotMatch(row.textContent,/50%/);
  await p.refresh({download:{attempt:1,asset:'second',downloadedBytes:1048576,totalBytes:null}});assert.equal(p.status(),'已下载 1.00 MiB');
  await p.refresh({download:{attempt:1,asset:'second',downloadedBytes:4194304,totalBytes:4194304}});assert.equal(p.status(),'正在检查文件');assert(!row.classList.contains('done'));
  await p.refresh({phase:'verifying-runtime'});assert.match(row.querySelector('[data-acquisition-phase]').textContent,/检查文件/);assert(!row.classList.contains('done'));
  await p.refresh({phase:'extracting-and-validating'});assert.equal(p.status(),'正在展开检查');
  await p.refresh({phase:'acquired'});assert.equal(p.status(),'已完成');
 }finally{p.dom.window.close()}
});

test('C5 invalid counts never produce fake percent and acquisition failure remains local',async()=>{
 const p=await livePage({operationId:'counts',kind:'install',state:'running',terminal:false,phase:'fetching-and-verifying-runtime',intentSelected:true,journeyContext:{skillChoice:'skipped'}});
 try{
  for(const download of [{downloadedBytes:0,totalBytes:100},{downloadedBytes:-1,totalBytes:100},{downloadedBytes:NaN,totalBytes:100},{downloadedBytes:Infinity,totalBytes:100},{downloadedBytes:1,totalBytes:0},{downloadedBytes:1,totalBytes:-1},{downloadedBytes:1,totalBytes:Infinity},{downloadedBytes:200,totalBytes:100}]){await p.refresh({download});assert.doesNotMatch(p.status(),/%|NaN|Infinity/)}
  await p.refresh({state:'failed',terminal:true,next:'连接失败，尚未安装'});assert.equal(p.status(),'下载检查失败');assert.match(p.dom.window.document.querySelector('[data-step="acquire"]').textContent,/连接失败，尚未安装/);
 }finally{p.dom.window.close()}
 const uninstall=await livePage({operationId:'uninstall',kind:'uninstall',phase:'executing',state:'running',download:{downloadedBytes:1,totalBytes:2}});try{assert.equal(uninstall.status(),undefined);assert.doesNotMatch(uninstall.dom.window.document.querySelector('#flow-steps').textContent,/下载/)}finally{uninstall.dom.window.close()}
});

async function render(record,view=null){
  let requests=0;
  const dom=new JSDOM(singlePageDocument('test-csrf'),{url:'http://127.0.0.1:43123/test-csrf',runScripts:'dangerously',beforeParse(window){
    window.fetch=async()=>{if(requests++)throw Error('controlled disconnection');return {ok:true,json:async()=>({record,progress:acquisitionProgress(record),view})};};
  }});
  await new Promise(resolve=>setTimeout(resolve,20));
  return dom;
}
test('C7 fresh installation asks only a software location and an optional Skill, without project inputs',async()=>{
 const dom=await render({operationId:'shared-user',kind:'install',state:'running',phase:'choosing-intent',installationWrites:'none',journeyContext:{skillChoice:'undecided'}});
 try{
  const form=dom.window.document.querySelector('#current-form');
  assert.deepEqual([...form.querySelectorAll('input')].map(x=>x.name),['destination','includeSkill']);
  assert.match(form.textContent,/不同项目都可以使用/);
  assert.doesNotMatch(form.textContent,/项目根|在哪里使用|当前用户\/|仅当前项目/);
 }finally{dom.window.close()}
});
test('C8 terminal summaries distinguish no-write cancellation, expiry, environment block and partial Skill outcome',async()=>{
 const base={operationId:'states',kind:'install',terminal:true,installationWrites:'none',journeyContext:{skillChoice:'selected'}};
 for(const [patch,title,body] of [
  [{state:'cancelled-no-install',phase:'choosing-intent'},'已取消安装','尚未安装 Foundation'],
  [{state:'expired-no-install',phase:'choosing-intent'},'安装确认已到期','尚未安装 Foundation'],
  [{state:'failed',phase:'checking-environment',environment:{state:'blocked',missing:['/usr/bin/tar']}},'运行环境需要处理','/usr/bin/tar'],
  [{state:'partial',phase:'finished',programState:'completed',runtimeHealth:'passed',skillSteps:{register:{state:'failed'}}},'Foundation 已安装；对话功能未处理成功','不必重装程序'],
  [{state:'partial',phase:'finished',programState:'completed',runtimeHealth:'passed',skillSteps:{register:{state:'cancelled'}}},'Foundation 已安装；对话功能未启用','本次未启用 Codex 对话功能']
 ]){
  const dom=await render({...base,...patch});try{
   assert.equal(dom.window.document.querySelector('#flow-title').textContent,title);
   assert.match(dom.window.document.querySelector('.product').textContent,new RegExp(body));
   assert.equal(dom.window.document.querySelector('#current-form'),null);
   if(patch.environment)assert.match(dom.window.document.querySelector('[data-step="environment"]').textContent,/运行环境检查未通过/);
  }finally{dom.window.close()}
 }
});
test('C8 completed steps summarize facts without showing machine evidence as ordinary content',async()=>{
 const dom=await render({operationId:'plain',kind:'install',terminal:true,state:'completed',phase:'finished',programState:'completed',runtimeHealth:'passed',skillRegistered:true,journeyContext:{skillChoice:'selected'},skillSteps:{material:{state:'completed',evidence:{planRef:'internal-plan'}},register:{state:'completed',evidence:{planRef:'internal-plan'}}}});
 try{
  const details=[...dom.window.document.querySelectorAll('.completed-detail')].map(x=>x.textContent).join(' ');
  assert.doesNotMatch(details,/internal-plan|planRef|evidence/);
  assert.match(details,/新 Codex 对话/);
  assert.match(dom.window.document.querySelector('#raw').textContent,/internal-plan/);
  assert.match(dom.window.document.querySelector('#flow-description').textContent,/程序安装已完成/);
  assert.doesNotMatch(dom.window.document.querySelector('#flow-description').textContent,/需另外确认/);
 }finally{dom.window.close()}
});
test('040 final verification is not shown as finished before chosen Skill confirmations',async()=>{
  const record={operationId:'same',kind:'install',state:'running',terminal:false,phase:'skill-confirmation',programState:'completed',runtimeHealth:'passed',journeyContext:{skillChoice:'selected'},skillSteps:{material:{state:'pending'}}};
  const dom=await render(record);
  try{
    const rows=[...dom.window.document.querySelectorAll('.step')];
    const health=rows.find(row=>row.textContent.includes('检查安装结果'));
    assert.equal(health.classList.contains('done'),false);
    assert.match(rows.find(row=>row.textContent.includes('安装 Foundation')).textContent,/已完成/);
    assert.match(dom.window.document.querySelector('#flow-count').textContent,/3 \/ 6/);
  }finally{dom.window.close();}
});
test('040 uninstall scope is readable without changing raw plan data',async()=>{
  const record={operationId:'same',kind:'uninstall',state:'running',terminal:false,phase:'program-confirmation',journeyContext:{skillChoice:'skipped'}};
  const view={type:'manager',session:{sessionId:'s',planHash:'h',operation:'uninstall',state:'pending',deletes:['foundation-installation:full']},action:'confirm',feedback:{detail:'确认卸载',namedTargets:[{label:'程序位置',path:'/isolated/Foundation'}],preserves:['用户文件'],notDone:'不删除项目'}};
  const dom=await render(record,view);
  try {assert.match(dom.window.document.querySelector('.current').textContent,/经所有权核验的程序、运行时和状态文件/);assert.doesNotMatch(dom.window.document.querySelector('.current').textContent,/foundation-installation:full/);assert.match(dom.window.document.querySelector('#raw').textContent,/foundation-installation:full/);}finally{dom.window.close();}
});
test('040 partial result labels cancelled Skill and retains verified program result across disconnection',async()=>{
  const record={operationId:'same',kind:'install',state:'partial',terminal:true,phase:'finished',programState:'completed',runtimeHealth:'passed',journeyContext:{skillChoice:'selected'},skillSteps:{material:{state:'completed'},register:{state:'cancelled'}},next:'注册已取消，程序结果保留'};
  const dom=await render(record);
  try{
    assert.match(dom.window.document.querySelector('#flow-result').textContent,/程序安装已完成/);
    assert.match([...dom.window.document.querySelectorAll('.step')].find(row=>row.textContent.includes('将 Skill 安装到 Codex')).textContent,/已取消/);
    await new Promise(resolve=>setTimeout(resolve,780));
    assert.match(dom.window.document.querySelector('#connection').textContent,/保留最后核实结果/);
    assert.match(dom.window.document.querySelector('#flow-result').textContent,/程序安装已完成/);
    assert.equal(dom.window.document.querySelectorAll('iframe').length,0);
  }finally{dom.window.close();}
});

for (const failure of ['response-lost','invalid-json']) test('051 '+failure+' reconciles next session on original page without replay',async()=>{
 let tick,posts=0;
 let record={operationId:'reconcile',kind:'uninstall',state:'running',terminal:false,phase:'skill-confirmation',hadSkill:true,maintenanceSteps:{remove:{state:'pending'}}};
 const feedback={detail:'核对范围',namedTargets:[],preserves:['项目'],notDone:'不改变其他安装'};
 let view={session:{sessionId:'remove',planHash:'one',state:'pending',operation:'uninstall',capabilityId:'skill'},feedback,action:'confirm-exact-operation'};
 const dom=new JSDOM(singlePageDocument('test'),{url:'http://127.0.0.1:43123/test',runScripts:'dangerously',beforeParse(w){w.setTimeout=fn=>{tick=fn};w.fetch=async(url,opts)=>{
  if(opts?.method==='POST'){posts++;record={...record,phase:'awaiting-confirmation',maintenanceSteps:{remove:{state:'completed'},program:{state:'pending'}}};view={session:{sessionId:'program',planHash:'two',state:'pending',operation:'uninstall'},feedback,action:'confirm-exact-operation'};if(failure==='response-lost')throw Error('lost');return {ok:true,json:async()=>{throw Error('json')}};}
  return {ok:true,json:async()=>({record,view,progress:acquisitionProgress(record)})};
 };}});
 try{await new Promise(r=>setTimeout(r,10));const form=dom.window.document.querySelector('#current-form');form.dispatchEvent(new dom.window.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('button')}));await new Promise(r=>setTimeout(r,10));await tick();assert.equal(dom.window.document.querySelector('.current').dataset.step,'program');assert.equal(dom.window.document.querySelector('#current-form button').disabled,false);assert.equal(posts,1);assert.equal(dom.window.location.pathname,'/test');assert(dom.window.document.querySelector('#read-status'));}finally{dom.window.close();}
});

test('051 uncertain same-session pending stays disabled until authoritative recheck confirms no submission in flight',async()=>{
 let tick,posts=0,reconciled=false;
 const record={operationId:'pending-recheck',kind:'uninstall',state:'running',terminal:false,phase:'awaiting-confirmation'};
 const view={session:{sessionId:'pending',planHash:'h',state:'pending',operation:'uninstall'},action:'confirm-exact-operation',feedback:{detail:'卸载',namedTargets:[],preserves:['项目'],notDone:'保留项目'}};
 const dom=new JSDOM(singlePageDocument('test'),{url:'http://127.0.0.1:43123/test',runScripts:'dangerously',beforeParse(w){w.setTimeout=fn=>{tick=fn};w.fetch=async(url,opts)=>{if(opts?.method==='POST'){posts++;throw Error('before-send failure')}return {ok:true,json:async()=>({record,view,progress:acquisitionProgress(record),reconciled,submissionPending:!reconciled})}};}});
 try{await new Promise(r=>setTimeout(r,10));const form=dom.window.document.querySelector('#current-form');form.dispatchEvent(new dom.window.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('button')}));await new Promise(r=>setTimeout(r,10));await tick();assert.equal(form.querySelector('button').disabled,true);reconciled=true;await tick();assert.equal(dom.window.document.querySelector('#current-form button').disabled,false);assert.equal(posts,1);}finally{dom.window.close();}
});
