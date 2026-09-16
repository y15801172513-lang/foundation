import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {singlePageDocument} from '../../distribution/summon-foundation/lib/single-page-view.mjs';
import {acquisitionProgress} from '../../distribution/summon-foundation/lib/progress-page.mjs';

async function render(record,view=null){
  let requests=0;
  const dom=new JSDOM(singlePageDocument('test-csrf'),{url:'http://127.0.0.1:43123/test-csrf',runScripts:'dangerously',beforeParse(window){
    window.fetch=async()=>{if(requests++)throw Error('controlled disconnection');return {ok:true,json:async()=>({record,progress:acquisitionProgress(record),view})};};
  }});
  await new Promise(resolve=>setTimeout(resolve,20));
  return dom;
}
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
