import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {lifecycleJourney} from '../../packages/core/lifecycle-journey.mjs';
import {lifecycleFeedback,renderLifecyclePage,renderInstallDestinationPage} from '../../packages/core/lifecycle-feedback.mjs';
import {acquisitionProgress} from '../../distribution/summon-foundation/lib/progress-page.mjs';
const root='/isolated/Foundation 空格',skill='/isolated/account/.codex/skills/foundation';
const base={sessionId:'program',operationId:'op',planHash:'hash',operation:'install',state:'completed',installationRoot:root,result:{stableLauncherHealth:'passed'},recordLocation:'/isolated/receipt.json',journeyContext:{id:'journey',candidateVerified:true,selectionId:'selection',skillChoice:'selected'}};
const cap=(operation,state='completed')=>({sessionId:'skill-'+operation,operationId:'op-'+operation,operation,capabilityId:'ai-product-foundation-kit',capabilityType:'codex-skill',scope:'user',state,installationRoot:root,operationTargets:{program:root,skill,records:'/isolated/records'},expiresAt:Date.now()+60000});
test('038R1 uninstall ends with removal facts, never install choices or discovery instructions',()=>{
  const uninstall={...base,operation:'uninstall',journeyContext:undefined,result:{state:'uninstalled'}};
  for(const previousSteps of [[],[cap('register')],[cap('uninstall')]]){
    const view=lifecycleJourney({...uninstall,previousSteps});
    assert.equal(view.title,'卸载完成');assert.equal(view.ended,true);
    assert.deepEqual(view.steps.map(s=>[s.key,s.state]),previousSteps[0]?.operation==='uninstall'?[['remove','completed'],['program','completed']]:[['program','completed']]);
    assert.doesNotMatch([view.skill,view.summary,view.project].join(' '),/可选|待选择|新任务|项目接入/);
    assert.match(view.summary,/卸载回执.*保留文件/);
    assert.match(view.skill,previousSteps[0]?.operation==='uninstall'?/注册移除：已完成/:/未关联.*不据此判断/);
  }
  for(const state of ['failed','cancelled','expired','verification-required']){
    const view=lifecycleJourney({...uninstall,previousSteps:[cap('uninstall',state)]});
    assert.equal(view.ended,false);assert.equal(view.steps.find(s=>s.key==='program').state,'completed');
    assert.equal(view.steps.find(s=>s.key==='remove').state,state);assert.match(view.skill,/注册移除/);
    assert.doesNotMatch(view.skill,/可选|待选择|新任务/);
  }
});
test('038R1 planned steps terminate only from receipts; registration differs from material and discovery',()=>{
  const pending=lifecycleJourney({...base,state:'pending',result:null});
  assert.deepEqual(pending.steps.map(s=>[s.key,s.state]),[['acquire','completed'],['select','completed'],['program','pending'],['health','planned'],['material','planned'],['register','planned']]);
  const material=lifecycleJourney({...cap('install'),previousSteps:[base,base]});
  assert.equal(material.steps.filter(s=>s.key==='program').length,1);assert.equal(material.ended,false);assert.deepEqual(material.remaining,['注册到 Codex']);
  const done=lifecycleJourney({...cap('register'),previousSteps:[base,cap('install')]});
  assert.equal(done.title,'安装完成');assert.equal(done.ended,true);assert.equal(done.steps.find(s=>s.key==='health').state,'completed');assert.match(done.skill,/发现另验/);
  assert.doesNotMatch(lifecycleFeedback(cap('install')).next,/新对话|新任务/);assert.match(lifecycleFeedback(cap('install')).detail,/还需你确认启用到 Codex/);
});
test('038R1 skip and independent maintenance do not fabricate a full installation',()=>{
  const skipped=lifecycleJourney({...base,journeyContext:{...base.journeyContext,skillChoice:'skipped'}});
  assert.equal(skipped.title,'安装完成');assert.equal(skipped.steps.at(-1).state,'skipped');
  const standalone=lifecycleJourney(cap('register'));
  assert.equal(standalone.steps.length,1);assert.doesNotMatch(standalone.title,/安装完成/);
});
test('038R1 mismatched installation and missing links cannot manufacture overall completion',()=>{
  const current={...base,journeyContext:{...base.journeyContext,skillChoice:'skipped'}};
  for(const previous of [{...base,installationRoot:'/different'}, {operation:'unknown',state:'verification-required'}]){
    const view=lifecycleJourney({...current,previousSteps:[previous]});assert.equal(view.ended,false);assert.match(view.title,/待核实/);assert.equal(view.steps.find(s=>s.key==='program').state,'completed');
  }
});
test('038R1 a new update never borrows old registration or first-install selection success',()=>{
  const update={...base,sessionId:'update',operationId:'update-op',operation:'update',journeyContext:undefined,previousSteps:[base,cap('register')]};
  const view=lifecycleJourney(update);assert.equal(view.id,'update-op');assert.equal(view.steps.some(s=>s.key==='select'||s.key==='register'),false);assert.equal(view.steps.at(-1).state,'undecided');
});
test('038R1 registered targets are typed, internal materials never claim host readiness',()=>{
  for(const operation of ['register','uninstall']){
    const f=lifecycleFeedback(cap(operation));assert.deepEqual(f.namedTargets[0],{role:'skill',label:'Codex 对话功能位置',path:skill});
    const dom=new JSDOM(renderLifecyclePage(cap(operation),'nonce'),{runScripts:'dangerously'});assert.match(dom.window.document.querySelector('#operation-targets').textContent,/Codex 对话功能位置/);assert.match(dom.window.document.querySelector('#operation-targets code').textContent,/\.codex\/skills/);dom.window.close();
  }
  const unknown=lifecycleFeedback({...cap('register'),operationTargets:{program:root}});assert.equal(unknown.namedTargets[0].path,null);
});
test('038R1 directory and acquisition views contain planned next actions, not a history counter',()=>{
  const dom=new JSDOM(renderInstallDestinationPage({version:'0.2.10',suggestion:root,acquisitionRoot:'/isolated/cache',bootstrapStateRoot:'/isolated/records',nonce:'n',expiresAt:Date.now()+60000,journeyContext:{id:'same'}}));
  assert.match(dom.window.document.querySelector('[aria-label="本次流程总览"]').textContent,/安装程序：尚待处理/);assert.equal(dom.window.document.querySelector('option[value="skipped"]').textContent,'本次跳过');dom.window.close();
  const p=acquisitionProgress({operationId:'same',phase:'fetching-and-verifying-runtime',state:'running',terminal:false});assert.equal(p.journey.steps[0].state,'running');assert.equal(p.journey.steps.find(s=>s.key==='program').state,'planned');
  for(const state of ['cancelled-no-install','expired-no-install','shutdown-no-install']){const ended=acquisitionProgress({operationId:'same',phase:'directory-selection-ended',state,terminal:true});assert.equal(ended.journey.steps[0].state,'completed');assert.notEqual(ended.journey.steps.find(s=>s.key==='select').state,'completed');assert.equal(ended.journey.ended,false);}
  const done=acquisitionProgress({operationId:'same',phase:'finished',state:'completed',terminal:true,runtimeHealth:'passed',journeyContext:{skillChoice:'skipped'},confirmationUrl:'http://127.0.0.1:1/',workbench:{state:'ready',url:'http://127.0.0.1:2/'}});assert.equal(done.nextUrl,'http://127.0.0.1:2/');assert.match(done.next,/本次已跳过/);assert.equal(done.nextLabel,'打开已安装工作台');
});
