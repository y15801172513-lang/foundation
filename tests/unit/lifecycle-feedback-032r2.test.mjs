import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderLifecyclePage} from '../../packages/core/lifecycle-feedback.mjs';
const session={operation:'install',state:'pending',sessionId:'032r2',installationRoot:'/隔离/Foundation',targetVersion:'0.2.4',expiresAt:Date.now()+60000};
test('039R1 update shows only bound preservation facts and correct operation scope',()=>{
  for(const impact of [null,{modifiesUserProjects:false,rollback:'journal-and-previous-current'},{modifiesUserProjects:true,rollback:'unknown'}]){
    const d=new JSDOM(renderLifecyclePage({...session,operation:'update',currentVersion:'0.2.11',targetVersion:'0.2.12',plannedImpact:impact},'nonce')).window.document;
    assert.match(d.body.textContent,/范围：本次更新/);assert.doesNotMatch(d.body.textContent,/范围：本次安装/);
    const visible=d.querySelector('.important').textContent;
    if(impact?.modifiesUserProjects===false){assert.match(visible,/项目文件与制作资料（本次计划不修改）/);assert.match(visible,/计划保留旧版与操作记录用于回退；实际结果完成后核验/);}
    else assert.doesNotMatch(visible,/本次计划不修改|计划保留旧版/);
  }
});
test('032R2 capacity uses binary MiB, raw bytes remain, unknown is not zero',()=>{
  for(const bytes of [1048576,0,undefined]){
    const d=new JSDOM(renderLifecyclePage({...session,byteCount:bytes},'nonce')).window.document;
    assert.match(d.querySelector('.important').textContent,bytes===undefined?/容量未知/:bytes===0?/0.00 MiB/:/1.00 MiB/);
    if(bytes!==undefined)assert.match(d.querySelector('#raw-result').textContent,new RegExp('"byteCount": '+bytes));
    assert.doesNotMatch(d.querySelector('.important').textContent,/CLI|Runtime|0 个文件/);
  }
});
test('032R2 failed refresh preserves verified result and never repeats mutation',async()=>{
  for(const state of ['completed','failed','cancelled','pending']){
    let calls=0;
    const dom=new JSDOM(renderLifecyclePage({...session,state},'nonce'),{runScripts:'dangerously',beforeParse(w){w.fetch=async()=>{calls++;throw Error('offline');};}});
    const d=dom.window.document,previous=d.querySelector('#result-title').textContent;
    d.querySelector('#read-status').click();await new Promise(r=>setImmediate(r));
    assert.equal(calls,1);
    if(state==='pending')assert.equal(d.querySelector('#result-title').textContent,'状态待核实');
    else {assert.equal(d.querySelector('#result-title').textContent,previous);assert.equal(d.querySelector('#refresh-warning').hidden,false);assert.match(d.querySelector('#refresh-warning').textContent,/最后已核实/);assert.equal(d.querySelector('.actions').hidden,true);}
    dom.window.close();
  }
});
