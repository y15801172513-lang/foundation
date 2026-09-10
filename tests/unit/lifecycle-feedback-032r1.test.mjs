import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderLifecyclePage} from '../../packages/core/lifecycle-feedback.mjs';
const session={operation:'uninstall',state:'pending',sessionId:'session-032r1',targetRoots:['/隔离/Long Foundation 目录'],preserves:['project-data'],expiresAt:Date.now()+60000};

test('032R1 identifiers folded, destructive button explicit and no autofocus',()=>{
  const dom=new JSDOM(renderLifecyclePage(session,'nonce','opaque-ref'));
  const d=dom.window.document;
  assert.ok(d.querySelector('details').textContent.includes('opaque-ref'));
  assert.equal(d.querySelector('details').open,false);
  assert.equal(d.querySelector('[autofocus]'),null);
  assert.match(d.querySelector('.danger').textContent,/卸载/);
  assert.ok(d.querySelector('#state-icon'));
  dom.window.close();
});

test('032R1 same-session event renders real execution/terminal, wrong session ignored, disconnect unknown',()=>{
  let source;
  class Events {constructor(url){this.url=url;source=this;}close(){this.closed=true;}}
  const dom=new JSDOM(renderLifecyclePage(session,'nonce'),{runScripts:'dangerously',beforeParse(w){w.EventSource=Events;}});
  const title=()=>dom.window.document.querySelector('#result-title').textContent;
  assert.match(source.url,/session-id=session-032r1/);
  source.onmessage({data:JSON.stringify({...session,sessionId:'other',state:'completed'})});
  assert.equal(title(),'等待你确认');
  source.onmessage({data:JSON.stringify({...session,state:'executing'})});
  assert.equal(title(),'正在卸载');
  source.onerror();assert.equal(title(),'状态待核实');assert.equal(source.closed,true);
  dom.window.close();
});

test('032R1 installation root first; result file inventory stays folded and user residual visible',()=>{
  const s={...session,state:'completed',installationRoot:'/安装',targetRoots:['/缓存','/安装'],lifecycleMode:'full',result:{removed:['versions/hash/internal.js'],residualPaths:['state/internal-hash','user-keep.txt'],preserved:['.foundation/facts']}};
  const dom=new JSDOM(renderLifecyclePage(s,'nonce'),{runScripts:'dangerously'}),d=dom.window.document;
  assert.equal(d.querySelector('li').textContent,'/安装');
  assert.doesNotMatch(d.querySelector('#result-effects').textContent,/versions\/hash|state\/internal/);
  assert.match(d.querySelector('#result-effects').textContent,/user-keep.txt|项目事实数据/);
  assert.match(d.querySelector('details').textContent,/versions\/hash\/internal.js/);
  assert.doesNotMatch(d.querySelector('.important').textContent,/0 个文件/);
  dom.window.close();
});
