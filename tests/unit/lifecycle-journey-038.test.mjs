import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {lifecycleFeedback,renderLifecyclePage} from '../../packages/core/lifecycle-feedback.mjs';
import {lifecycleJourney} from '../../packages/core/lifecycle-journey.mjs';
import {acquisitionProgress,startProgressPage} from '../../distribution/summon-foundation/lib/progress-page.mjs';
import {runtimeObservation} from '../../distribution/summon-foundation/lib/operation-result.mjs';

test('038 actual capability plans show object/scope, not program uninstall or fictitious version',()=>{
  for(const operation of ['install','register','activate','deactivate','uninstall','recover']){
    const session={operation,capabilityId:'ai-product-foundation-kit',capabilityType:'codex-skill',scope:'user',state:'pending',sessionId:'unit',expiresAt:Date.now()+60000};
    const f=lifecycleFeedback(session);assert.equal(f.category,'capability');assert.equal(f.versionText,null);assert.match(f.heading,/Codex/);
    const dom=new JSDOM(renderLifecyclePage(session,'unit'));assert.doesNotMatch(dom.window.document.querySelector('#operation-version').textContent,/未安装|不适用|→/);dom.window.close();
  }
  assert.match(lifecycleFeedback({operation:'register',capabilityId:'ai-product-foundation-kit',capabilityType:'codex-skill',skillRefresh:true}).heading,/刷新/);
  const unknown=lifecycleFeedback({operation:'invented',state:'completed'});assert.equal(unknown.canConfirm,false);assert.equal(unknown.title,'状态待核实');
});
test('038 projection preserves prior program result when independent Skill fails or is cancelled',()=>{
  assert.equal(lifecycleFeedback({operation:'install',state:'completed',targetVersion:'target-only',result:{current:{version:'verified-installed'}}}).versionText,'已安装 verified-installed');
  const previous={sessionId:'program',operationId:'op-a',planHash:'hash-a',operation:'update',state:'completed',result:{stableLauncherHealth:'passed'}};
  for(const state of ['failed','cancelled','expired','verification-required']){
    const view=lifecycleJourney({sessionId:'skill',operation:'register',capabilityId:'ai-product-foundation-kit',state,previousSteps:[previous]});
    assert.match(view.program,/已完成/);assert.equal(view.steps.find(s=>s.key==='program').evidence.sessionId,'program');assert.equal(view.steps.find(s=>s.key==='register').state,state);assert.equal(view.steps.find(s=>s.key==='health').state,'completed');assert.equal(view.executionAuthority,false);assert.equal(view.ended,false);assert.match(view.title,/程序已完成/);
  }
});
test('038 progress uses actual bytes and bounded loopback URL from verified runtime event',()=>{
  const p=acquisitionProgress({operationId:'one',phase:'fetching-and-verifying-runtime',state:'running',terminal:false,installationWrites:'none',download:{downloadedBytes:7,totalBytes:null}});
  assert.equal(p.download.totalBytes,null);assert.match(p.program,/尚未/);assert.equal(p.skill,'Codex 接入可选，尚未选择');assert.equal(p.journey.steps.find(step=>step.key==='register')?.state==='completed',false);
  assert.equal(runtimeObservation({status:'AWAITING_FOUNDATION_DIRECTORY_SELECTION',url:'https://attacker.invalid/'}).confirmationUrl,undefined);
  assert.equal(runtimeObservation({status:'FOUNDATION_SELECTION_BOUND',sessionId:'same',url:'http://127.0.0.1:1234/'}).confirmationUrl,'http://127.0.0.1:1234/');
});
test('038 progress server is live before acquisition, read-only, streams actual terminal then closes',async()=>{
  const record={operationId:'unit-progress',state:'running',phase:'discovering',terminal:false,installationWrites:'none'};
  const page=await startProgressPage(()=>record);
  try{
    const response=await fetch(page.url);assert.equal(response.status,200);assert.match(await response.text(),/目录选择/);
    assert.equal((await fetch(page.url,{method:'POST'})).status,403);
    assert.equal((await fetch(page.url,{headers:{origin:'https://foreign.invalid'}})).status,403);
    const abort=new AbortController(),stream=await fetch(page.url+'/events',{signal:abort.signal}),reader=stream.body.getReader();
    const initial=new TextDecoder().decode((await reader.read()).value);assert.match(initial,/unit-progress/);
    record.state='failed';record.terminal=true;page.publish();const end=new TextDecoder().decode((await reader.read()).value);assert.match(end,/"terminal":true/);assert.match(end,/失败/);abort.abort();
  }finally{await page.close();}
});
