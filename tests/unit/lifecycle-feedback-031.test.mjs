import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {lifecycleFeedback, renderLifecyclePage} from '../../packages/core/lifecycle-feedback.mjs';
import {visibleLocalManagerSession} from '../../packages/core/lifecycle-manager.mjs';

const session = (operation = 'install', state = 'pending') => ({operation, state, sessionId:'manager-session-test', currentVersion:'0.2.2', targetVersion:'0.2.3', targetRoots:['/isolated/用户 Foundation'], preserves:['project facts'], creates:['runtime'], replacements:[], deletes:[], expiresAt:Date.now()+60000});
const tick = () => new Promise(resolve=>setTimeout(resolve,80));
function page(s, fetch) {
  return new JSDOM(renderLifecyclePage(s,'test-nonce'), {runScripts:'dangerously', pretendToBeVisual:true, url:'http://127.0.0.1/', beforeParse(w){w.fetch=fetch;}});
}
test('031 all actions show plan summary before buttons and folded technical details', () => {
  for(const op of ['install','update','uninstall']){
    const dom=page(session(op),()=>{}); const d=dom.window.document;
    assert.match(d.body.textContent,/用户 Foundation/);
    assert.ok(d.querySelector('.important').compareDocumentPosition(d.querySelector('form')) & 4);
    assert.equal(d.querySelector('details').open,false);
    assert.equal(d.querySelectorAll('form button').length,2);
    assert.equal(d.querySelector('.actions').hidden,false);
    dom.window.close();
  }
});
test('031 click disables immediately, submits once, result replaces actions and refresh never confirms', async () => {
  let calls=0, resolve;
  const dom=page(session(),()=>{calls++;return new Promise(r=>{resolve=r;});}); const d=dom.window.document;
  d.querySelector('button').click();d.querySelector('button').click();
  assert.equal(d.querySelector('button').disabled,true);
  assert.equal(d.querySelector('#result-title').textContent,'正在提交请求');
  await tick();assert.equal(calls,1);
  resolve({json:async()=>({state:'completed',result:{ok:true,status:'INSTALLED'}})});
  await tick();assert.equal(d.querySelector('#result-title').textContent,'安装完成');
  assert.equal(dom.window.getComputedStyle(d.querySelector('.actions')).display,'none');
  dom.window.close();
  const reopened=page(session('install','completed'),()=>{assert.fail('refresh must not submit');});
  assert.equal(reopened.window.document.querySelector('#result-title').textContent,'安装完成');reopened.window.close();
});
test('031 connection loss is unknown, manual recovery reads same state without retry', async()=>{
  let posts=0;const dom=page(session('update'),async url=>{
    if(url.endsWith('/confirm')){posts++;throw Error('connection lost');}
    return {ok:true,json:async()=>({...session('update','completed'),result:{ok:true}})};
  });const d=dom.window.document;d.querySelector('button').click();await tick();
  assert.equal(d.querySelector('#result-title').textContent,'状态待核实');
  d.querySelector('#read-status').click();await tick();
  assert.equal(d.querySelector('#result-title').textContent,'更新完成');assert.equal(posts,1);dom.window.close();
});
test('031 failure cancel expiry and interrupted records do not imply success or retry',()=>{
  for(const state of ['failed','cancelled','expired','verification-required']){
    const f=lifecycleFeedback(session('uninstall',state));assert.equal(f.canConfirm,false);assert.equal(f.terminal,true);assert.doesNotMatch(f.title,/完成/);
  }
  assert.equal(visibleLocalManagerSession({...session('update','consumed'),owner:{pid:999999999}}).state,'verification-required');
  assert.equal(visibleLocalManagerSession({...session(),expiresAt:1}).state,'expired');
  const f=lifecycleFeedback({...session('normal-uninstall','completed'),result:{lifecycleResult:{removed:['owned'],preservedUnknown:['user.txt']}}});
  assert.match(f.detail,/1 个/);assert.deepEqual(f.result.preservedUnknown,['user.txt']);
});
