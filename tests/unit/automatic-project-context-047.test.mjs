import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {assessDelivery} from '../../packages/core/project-delivery.mjs';
import {enrichInspectorObject,buildInspectorCopyPayload} from '../../apps/management-center/src/workspace/inspector-context.mjs';
import {announcePreview} from '../../examples/foundation-events/src/bridge.mjs';

const model={project:{projectId:'p'},pages:[{id:'home'}],assets:[],relations:[{id:'rename_safe',from:'action_save',to:'dialog_editor',trigger:'旧保存文案'},{id:'name_only',from:'home',to:'other',trigger:'保存'}]};
test('047 ID-bound logic survives rename; matching names remain candidates',()=>{
 const object=enrichInspectorObject({inspectorId:'runtime:1',persistentId:'action_save',pageId:'home',name:'储存',role:'button'},model);
 assert.deepEqual(object.relatedLogic.map(x=>x.id),['rename_safe']);
 const local=enrichInspectorObject({inspectorId:'runtime:2',pageId:'home',name:'保存',role:'button'},model);
 assert.deepEqual(local.relatedLogic,[]);assert(local.gaps.length>0);
});
test('047 copy cannot promote temporary handles or empty checks to stable complete context',()=>{
 const text=buildInspectorCopyPayload({project:model.project,object:{inspectorId:'object-2',name:'✓✓✦',role:'div',pageId:'home'}});
 assert.doesNotMatch(text,/object stable identity: object-2|未发现已知缺口/);
 assert.match(text,/temporary|临时/);assert.match(text,/source|源码/);
});
test('047 decoration retains characters and aria-hidden while naming remains explicitly limited',()=>{
 const dom=new JSDOM('<main><div aria-hidden="true">✓✓✦</div></main>',{url:'http://localhost/events'});
 const messages=[];Object.defineProperty(dom.window,'parent',{value:{postMessage:m=>messages.push(m)}});
 announcePreview({win:dom.window});const decoration=messages[0].object.tree[0].children[0];
 assert.notEqual(decoration.name,'✓✓✦');assert.match(decoration.name,/装饰|待命名/);
 assert.equal(dom.window.document.querySelector('div').textContent,'✓✓✦');assert.equal(dom.window.document.querySelector('div').getAttribute('aria-hidden'),'true');
 dom.window.close();
});
function scopedFacts({dimensions=['scope','content','definition','runtime','layout'],na=false}={}){
 const scope={schemaVersion:'2.0.0',taskId:'task',revision:1,platform:'web',sourceRefs:[{id:'request',kind:'user-request',ref:'request.md#L1-L1'}],items:[{requirementId:'req',factIds:['home'],sourceRefIds:['request'],applicability:na?{state:'not-applicable',reason:'caller says so',source:'caller'}:{state:'required',source:'request'},requiredEvidenceDimensions:dimensions}]};
 return {pages:{items:[{id:'home'}]},components:{items:[]},changes:{items:[{id:'task',deliveryScope:scope,evidenceIndex:[{evidenceId:'legacy',kind:'browser-observation',scopeRevision:1,taskId:'task',subject:{requirementId:'req'},dimensions}]}]}};
}
test('047 legacy browser success without product capability observations cannot deliver',()=>{
 const assessment=assessDelivery(scopedFacts(),{contentIntegrity:{ready:true,issues:[]},evidenceResults:{legacy:{state:'verified',result:'passed'}}});
 assert.notEqual(assessment.aggregate,'passed');
 assert(assessment.issues.some(i=>/预览|握手|覆盖/.test(i.message)));
});
test('047 caller N/A cannot exempt an implemented visible object',()=>{
 const assessment=assessDelivery(scopedFacts({na:true}),{contentIntegrity:{ready:true,issues:[]}});
 assert.notEqual(assessment.aggregate,'passed');
});

import fs from 'node:fs';
import path from 'node:path';
import {inspectProjectStructure,inspectStructureCoverage,attachObservedStructure} from '../../packages/core/project-coverage.mjs';
import {bindPreviewContext,announcePreview as announceStandard,createInspectorBridge as standardBridge} from '../../packages/core/preview-bridge.mjs';
import {resolveObjectLocator,objectLocator} from '../../packages/core/object-identity.mjs';
const fixture=files=>{fs.mkdirSync(path.resolve('.tmp/047r1'),{recursive:true});const root=fs.mkdtempSync(path.resolve('.tmp/047r1/structure-'));for(const [name,bytes]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),bytes);}return root;};
test('047 independent HTML and JSX inventory finds internal objects and source bindings before any facts',()=>{
 const root=fixture({'index.html':'<main><header><button aria-controls="editor">新建</button><input type="search"></header><section><article>今日</article><article>计划</article></section><dialog id="editor"><input name="title"><button>保存</button></dialog></main>', 'src/Panel.jsx':'export function Panel(){return <aside><h2>天气</h2><ul>{rows.map(row=><li key={row.id} onClick={()=>edit(row.id)}>{row.name}</li>)}</ul></aside>}'});
 const inventory=inspectProjectStructure(root);
 assert(inventory.objects.some(x=>x.tag==='dialog'));assert(inventory.objects.some(x=>x.tag==='li'&&x.bindings.some(b=>b.kind==='onClick')));
 const facts={pages:{items:[{id:'home',implementationMapping:'index.html'}]}};
 assert.equal(inspectStructureCoverage(facts,inventory).state,'pending');
 const batch=attachObservedStructure({sources:inventory.sources,documents:[{kind:'pages',upserts:[{id:'home',name:'保留用户命名',implementationMapping:'index.html'},{id:'weather',implementationMapping:'src/Panel.jsx'}]}]},inventory);
 assert.equal(batch.documents[0].upserts[0].name,'保留用户命名');
 assert(batch.documents[0].upserts[0].sourceStructure.relations.some(r=>r.type==='contains'));
 facts.pages.items=batch.documents[0].upserts;assert.equal(inspectStructureCoverage(facts,inventory).state,'structurally-recorded');
 const saved=JSON.stringify(facts);fs.appendFileSync(path.join(root,'index.html'),'<footer><button>取消</button></footer>');
 const next=inspectProjectStructure(root);assert(inspectStructureCoverage(facts,next).missing.length>0);assert.equal(JSON.stringify(facts),saved);
 assert.equal(inspectProjectStructure(root).sourceDigest,next.sourceDigest);
});
test('047 standard bridge preserves annotated identity through insertion/rename/reorder and rejects old session and duplicate keys',()=>{
 const html='<main data-foundation-object-id="screen"><button data-foundation-object-id="save" data-foundation-incarnation="birth-1" data-foundation-source="src/View.jsx" data-foundation-label="保存">💾 保存</button></main>';
 const make=()=>{const dom=new JSDOM(html,{url:'http://localhost/app?projectId=p&revision=r1&channel=c',pretendToBeVisual:true});const sent=[];const parent={postMessage:m=>sent.push(m)};Object.defineProperty(dom.window,'parent',{value:parent});bindPreviewContext(dom.window,{pageId:'screen',identityHistory:[{persistentId:'save',instanceKey:null,generation:'birth-1',incarnation:'birth-1',state:'active'}]});const bridge=standardBridge({win:dom.window});return {dom,sent,parent,bridge};};
 const one=make();announceStandard({win:one.dom.window});const before=one.sent.at(-1).object.tree[0].children[0];
 const button=one.dom.window.document.querySelector('button');button.setAttribute('data-foundation-label','储存');button.parentElement.prepend(one.dom.window.document.createElement('article'));announceStandard({win:one.dom.window});
 const after=one.sent.at(-1).object.tree[0].children.find(x=>x.persistentId==='save');assert.equal(before.inspectorId,after.inspectorId);assert.equal(after.name,'储存');assert.equal(after.sourceLocation.file,'src/View.jsx');
 const two=make();announceStandard({win:two.dom.window});const refreshed=two.sent.at(-1).object.tree[0].children[0];assert.notEqual(before.inspectorId,refreshed.inspectorId);
 assert.equal(resolveObjectLocator({...objectLocator(before),projectId:'p'},[refreshed],{projectId:'p',revision:'r1',session:refreshed.session}).state,'resolved');
 const expired={...objectLocator(before),projectId:'p',kind:'temporary'};assert.equal(resolveObjectLocator(expired,[refreshed],{projectId:'p',revision:'r1',session:refreshed.session}).state,'invalid');
 assert.equal(resolveObjectLocator({...objectLocator(before),projectId:'p'},[refreshed,refreshed],{projectId:'p',revision:'r1'}).state,'ambiguous');
 button.parentElement.append(button.cloneNode(true));announceStandard({win:one.dom.window});assert(one.sent.at(-1).object.tree[0].children.filter(x=>x.role==='button').every(x=>x.identity.kind==='temporary'));
 const count=one.sent.length;one.dom.window.dispatchEvent(new one.dom.window.MessageEvent('message',{source:one.parent,origin:'http://localhost',data:{namespace:'ai-product-foundation-preview',kind:'preview-status-request',projectId:'other',revision:'r1',channel:'c'}}));assert.equal(one.sent.length,count);
 for(const item of [one,two]){item.bridge.destroy();item.dom.window.close();}
});
test('047 no omitted dimension bypass and positive current capability assessment',()=>{
 const facts=scopedFacts({dimensions:['scope','content','definition','runtime','layout']});
 const options={contentIntegrity:{ready:true,issues:[]},structureCoverage:{state:'structurally-recorded',sourceDigest:'current'},evidenceResults:{legacy:{state:'verified',result:'passed',report:{verifierVersion:'foundation-browser-checks/2.0.0',checks:['workbench-handshake','object-location','project-reopen'].map(id=>({id,result:'passed'}))}}}};
 facts.changes.items[0].evidenceIndex.push({...facts.changes.items[0].evidenceIndex[0],evidenceId:'semantic',kind:'semantic-review',dimensions:['scope','content']});
 options.evidenceResults.semantic={state:'verified',result:'passed',report:{verifierVersion:'foundation-semantic-contract/2.0.0',structureDigest:'current'}};
 assert.equal(assessDelivery(facts,options).aggregate,'passed');
 facts.changes.items[0].deliveryScope.items[0].requiredEvidenceDimensions=['scope'];
 facts.changes.items[0].evidenceIndex[0].dimensions=['scope'];
 assert.notEqual(assessDelivery(facts,options).aggregate,'passed');
});

import {createAssetSceneBridge} from '../../packages/core/asset-preview-bridge.mjs';
test('047 asset adapter rejects wrong scene/root and unrelated sender; DOM geometry is simulated here',()=>{
 const dom=new JSDOM('<main data-foundation-component-id="card" data-foundation-scene="default">业务原文</main>',{url:'http://localhost/scene?projectId=p&revision=r&channel=c&assetId=card&scenarioId=default',referrer:'http://localhost/workbench'});
 const sent=[],parent={postMessage:m=>sent.push(m)};Object.defineProperty(dom.window,'parent',{value:parent});const root=dom.window.document.querySelector('main');root.getBoundingClientRect=()=>({width:100,height:40});
 const bridge=createAssetSceneBridge({win:dom.window,root,definitionId:'card',scenarioId:'default'});assert.equal(sent.at(-1).status,'ready');const count=sent.length;
 dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:parent,origin:'http://localhost',data:{namespace:'ai-product-foundation-asset-preview',kind:'status-request',projectId:'wrong',revision:'r',channel:'c',assetId:'card'}}));assert.equal(sent.length,count);
 bridge.destroy();const wrong=createAssetSceneBridge({win:dom.window,root,definitionId:'other',scenarioId:'default'});assert.equal(sent.at(-1).status,'unsupported');assert.equal(root.textContent,'业务原文');wrong.destroy();dom.window.close();
});
test('047 supported page evidence is distinct from an arbitrary missing definition',async()=>{
 const {inspectAssetReferences}=await import('../../packages/core/asset-model.mjs');
 const facts=scopedFacts();facts.changes.items[0].evidenceIndex[0].subject.definitionId='home';
 assert(inspectAssetReferences(facts).some(issue=>issue.includes('证据任务')));
 facts.pages.items[0].sourceStructure={objects:[{key:'index.html:0'}]};assert(!inspectAssetReferences(facts).some(issue=>issue.includes('证据任务')));
 facts.changes.items[0].evidenceIndex[0].subject.definitionId='missing';assert(inspectAssetReferences(facts).some(issue=>issue.includes('证据任务')));
});

// 047R1: applicability belongs to the current task, never the project history.
function nonvisualFacts(platform='web') {
 const facts=scopedFacts();
 const old=facts.changes.items[0];old.id='old';old.updatedAt='2026-01-01';old.deliveryScope.taskId='old';
 facts.changes.items.push({id:'maintenance',name:'维护说明',implementationMapping:'guide.md',updatedAt:'2026-02-01',deliveryScope:{schemaVersion:'2.0.0',taskId:'maintenance',revision:1,platform,sourceRefs:[{id:'request',kind:'user-request',ref:'guide.md#L1-L2'}],items:[{requirementId:'docs',factIds:['maintenance'],sourceRefIds:['request'],applicability:{state:'not-applicable',reason:'只修改维护说明，无页面或依赖变化',source:'guide.md#L1-L2'},requiredEvidenceDimensions:[]}]}});
 return facts;
}
test('047R1 historical web pages do not impose visual checks on current sourced nonvisual work',()=>{
 for(const platform of ['web','other']) {
  const result=assessDelivery(nonvisualFacts(platform),{contentIntegrity:{ready:true,issues:[]}});
  assert.equal(result.aggregate,'passed');assert.equal(result.runtime.state,'not-applicable');assert.equal(result.applicability.visual,false);
 }
});
test('047R1 visual impact cannot be hidden by platform, omitted factIds or N/A',()=>{
 const facts=nonvisualFacts('other');facts.changes.items[1].affectedPages=['home'];
 const result=assessDelivery(facts,{contentIntegrity:{ready:true,issues:[]}});
 assert.equal(result.applicability.visual,true);assert.notEqual(result.aggregate,'passed');
});
test('047R1 unsourced N/A remains pending for nonvisual work',()=>{
 const facts=nonvisualFacts();facts.changes.items[1].deliveryScope.items[0].applicability.source='caller says so';
 assert.notEqual(assessDelivery(facts,{contentIntegrity:{ready:true,issues:[]}}).aggregate,'passed');
});
test('047R1 stale persistent locators without an incarnation cannot cross revisions',()=>{
 const old=objectLocator({projectId:'p',persistentId:'save',revision:'r1',session:'s1'});
 assert.equal(resolveObjectLocator(old,[{persistentId:'save',revision:'r2'}],{projectId:'p',revision:'r2',session:'s2'}).state,'invalid');
});
test('047R1 persistent generations reject deletion/reuse but preserve reorder and display rename',async()=>{
 const {reconcileObjectHistory}=await import('../../packages/core/object-identity.mjs');
 const source=[{persistentId:'save',instanceKey:'a',name:'保存'},{persistentId:'save',instanceKey:'b',name:'保存'}];
 const first=reconcileObjectHistory([],source);
 const renamed=reconcileObjectHistory(first,[{...source[1],name:'同名'}, {...source[0],name:'同名'}]);
 assert.deepEqual(renamed,first);
 const removed=reconcileObjectHistory(renamed,[source[1]]);
 assert.equal(removed.find(x=>x.instanceKey==='a').state,'removed');
 const rebuilt=reconcileObjectHistory(removed,source);
 const a=first.find(x=>x.instanceKey==='a'),replacement=rebuilt.find(x=>x.instanceKey==='a');
 assert.notEqual(a.generation,replacement.generation);
 const locator=objectLocator({projectId:'p',persistentId:'save',instanceId:'a',identityGeneration:a.generation,revision:'r1'});
 assert.equal(resolveObjectLocator(locator,[{persistentId:'save',instanceId:'a',identityGeneration:replacement.generation}],{projectId:'p',revision:'r2'}).state,'invalid');
 assert.equal(resolveObjectLocator(locator,[{persistentId:'save',instanceId:'a',identityGeneration:a.generation}],{projectId:'p',revision:'r2'}).state,'resolved');
});
test('047R1 semantic coverage rejects omitted branches/edges even with complete DOM inventory',async()=>{
 const {inspectSemanticCoverage,projectObjectRelations}=await import('../../packages/core/project-coverage.mjs');
 const root=fixture({'src/Editor.jsx':`export function Editor(){const [query,setQuery]=useState('');function save(){if(query===''){setQuery('empty')}else{setQuery('saved')}}return <main><input onChange={e=>setQuery(e.target.value)}/><button data-foundation-object-id="save" onClick={save}>储存</button></main>}`});
 const inventory=inspectProjectStructure(root);
 assert(inventory.obligations.some(x=>x.kind==='state-branch'));
 const batch=attachObservedStructure({sources:inventory.sources,documents:[{kind:'pages',upserts:[{id:'editor',implementationMapping:'src/Editor.jsx'}]}]},inventory);
 const facts={pages:{items:batch.documents[0].upserts}};
 assert.equal(inspectStructureCoverage(facts,inventory).state,'structurally-recorded');
 facts.pages.items[0].sourceStructure.semantics.relations=[];
 assert.equal(inspectSemanticCoverage(facts,inventory).state,'pending');
 const keys=inventory.obligations.map(x=>x.key),sources=inventory.sources;
 facts.pages.items[0].sourceStructure.semantics={nodes:[{id:'save',kind:'interaction',name:'储存操作',objectIds:['save'],sourceKeys:keys,sources},{id:'query',kind:'state',name:'编辑值与储存反馈',sourceKeys:keys,sources}],relations:[{id:'save_result',type:'data-affects',from:'save',to:'query',sourceKeys:keys,sources}]};
 assert.equal(inspectSemanticCoverage(facts,inventory).state,'recorded-not-reviewed');
 const model={project:{projectId:'p'},pages:facts.pages.items,assets:[],relations:[],objectRelations:projectObjectRelations(facts)};
 assert.equal(enrichInspectorObject({pageId:'editor',persistentId:'save',name:'新的显示名'},model).relatedLogic[0]?.type,'data-affects');
 facts.pages.items[0].sourceStructure.semantics.relations[0].sourceKeys=keys.filter(key=>key!==inventory.obligations.find(x=>x.kind==='state-branch').key);
 assert.equal(inspectSemanticCoverage(facts,inventory).state,'pending');
});
test('047R1 whole-page fake scene is rejected even when unrelated regions are hidden',async()=>{
 const {mountAssetScene}=await import('../../packages/core/asset-preview-bridge.mjs');
 const dom=new JSDOM('<main data-foundation-component-id="card" data-foundation-scene="default">card</main><aside hidden>another business region</aside>',{url:'http://localhost/scene?projectId=p&revision=r&channel=c&assetId=card&scenarioId=default',referrer:'http://localhost/workbench'});
 const sent=[];Object.defineProperty(dom.window,'parent',{value:{postMessage:m=>sent.push(m)}});
 const root=dom.window.document.querySelector('main');root.getBoundingClientRect=()=>({width:100,height:40});
 const bridge=createAssetSceneBridge({win:dom.window,root,definitionId:'card',scenarioId:'default'});
 assert.equal(sent.at(-1).status,'unsupported');
 await assert.rejects(mountAssetScene({win:dom.window,definitionId:'card',scenarioId:'default',render(){}}),/空白文档/);
 assert.equal(dom.window.document.querySelector('aside').textContent,'another business region');bridge.destroy();dom.window.close();
});
test('047R1 shared source invalidates all registered consumers; unrelated and local sources stay scoped',async()=>{
 const {inspectFactSourceImpact}=await import('../../packages/core/project-sync.mjs');
 const a={id:'a',implementationMapping:'a.jsx',implementationSha256:'a',assetModel:{implementationInputs:[{kind:'source',to:'shared.css',sha256:'old'}]}};
 const b={...a,id:'b',implementationMapping:'b.jsx',implementationSha256:'b'};
 let sources=[{path:'a.jsx',sha256:'a'},{path:'b.jsx',sha256:'b'},{path:'shared.css',sha256:'old'},{path:'unrelated.js',sha256:'new'}];
 assert.equal(inspectFactSourceImpact(a,sources).state,'unchanged');assert.equal(inspectFactSourceImpact(b,sources).state,'unchanged');
 sources=sources.map(x=>x.path==='a.jsx'?{...x,sha256:'local'}:x);
 assert.deepEqual(inspectFactSourceImpact(a,sources).changed.map(x=>x.path),['a.jsx']);assert.equal(inspectFactSourceImpact(b,sources).state,'unchanged');
 sources=sources.map(x=>x.path==='shared.css'?{...x,sha256:'shared'}:x);
 assert(inspectFactSourceImpact(a,sources).changed.some(x=>x.path==='shared.css'));assert.deepEqual(inspectFactSourceImpact(b,sources).changed.map(x=>x.path),['shared.css']);
});
test('047R1 delivery files do not demand historical preview for an actual current document task',async()=>{
 const {FACT_FILES}=await import('../../packages/core/facts.mjs');
 const {inspectProjectDeliveryFiles}=await import('../../packages/core/project-delivery.mjs');
 const {sha256}=await import('../../packages/core/install-contract.mjs');
 const project=fixture({'guide.md':'只更新维护说明，不改变界面或程序。\n'});
 fs.mkdirSync(path.join(project,'.foundation/facts'),{recursive:true});fs.mkdirSync(path.join(project,'.foundation/identity'),{recursive:true});
 fs.writeFileSync(path.join(project,'.foundation/identity/project.json'),JSON.stringify({schemaVersion:'1.0.0',projectId:'docs_project'}));
 const facts=nonvisualFacts('document'),task=facts.changes.items[1];
 Object.assign(task,{status:'draft',source:'user-request',verificationStatus:'unverified',implementationSha256:sha256(fs.readFileSync(path.join(project,'guide.md')))});
 Object.assign(task.deliveryScope,{deliverable:'维护说明',depth:'presentation',included:['维护说明'],excluded:['界面'],layoutPolicy:{mode:'not-applicable',source:'guide.md#L1-L2',reason:'文本维护'}});
 task.deliveryScope.items[0].description='维护说明核对';
 const old=facts.changes.items[0];old.deliveryScope={...structuredClone(task.deliveryScope),taskId:old.id,platform:'web'};old.deliveryScope.items[0].factIds=['home'];old.evidenceIndex=[];
 for(const record of [old,...facts.pages.items])Object.assign(record,{status:'draft',source:'historical-user-request',updatedAt:'2026-01-01T00:00:00.000Z',verificationStatus:'unverified'});facts.pages.items[0].entry=true;
 for(const kind of FACT_FILES)fs.writeFileSync(path.join(project,'.foundation/facts',kind+'.json'),JSON.stringify({schemaVersion:'0.1.0',kind,items:facts[kind]?.items || []}));
 const result=inspectProjectDeliveryFiles({project});
 assert(result.preparation?.factsReady!==false,JSON.stringify(result));
 assert.equal(result.preview.required,false);assert.equal(result.assessment.aggregate,'passed');assert.equal(result.deliveryReady,true,JSON.stringify(result.issues));
 assert(!result.issues.some(issue=>issue.code.startsWith('PREVIEW')));
 fs.unlinkSync(path.join(project,'guide.md'));
 assert(inspectProjectDeliveryFiles({project}).issues.some(issue=>issue.code==='APPLICABILITY_SOURCE_INVALID'));
});
