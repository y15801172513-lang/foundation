import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {makeTempDirectory,projectFixturePath} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest,applyProjectForTest} from '../helpers/test-authorization.mjs';
import {createLifecyclePlan,sha256} from '../../packages/core/install-contract.mjs';
import {createProjectAuthorityPlan} from '../../packages/core/project-authority.mjs';
import {synchronizeProject,verifyProjectDefinition,prepareProjectSemanticReview,submitProjectSemanticReview} from '../../packages/core/project-sync.mjs';
import {inspectProjectDeliveryFiles} from '../../packages/core/project-delivery.mjs';
import {inspectProjectStructure} from '../../packages/core/project-coverage.mjs';
import {readFacts} from '../../packages/core/facts.mjs';
import {verifyInstalledProjectBrowser} from '../../apps/management-center/src/server/center-server.mjs';

test('047 static page source -> automatic structure -> exact sync -> actual workbench -> current semantic coverage',{timeout:180000},async t=>{
 const base=makeTempDirectory('047-static-'),candidate=fs.realpathSync(process.env.FOUNDATION_047_CANDIDATE),manifest=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json'))),installationRoot=path.join(base,'installation');
 applyLifecycleForTest(createLifecyclePlan({operation:'install',targetRoot:installationRoot,sandboxRoot:base,targetVersion:manifest.productVersion,candidate:{path:candidate,manifestHash:manifest.candidateHash,runtimeHash:manifest.files.find(f=>f.path===manifest.runtime.path).sha256,bytes:manifest.totalBytes,version:manifest.productVersion}}));
 const project=projectFixturePath(base,'library-page');fs.mkdirSync(project,{recursive:true});
 const html='<!doctype html><meta charset="utf-8"><title>藏书首页</title><main data-foundation-object-id="library" data-foundation-label="藏书首页" data-foundation-source="index.html"><header data-foundation-object-id="toolbar" data-foundation-label="藏书工具栏"><h1>我的藏书</h1><button data-foundation-object-id="add" data-foundation-label="新增藏书" onclick="document.querySelector(\'dialog\').showModal()">新增</button></header><section data-foundation-object-id="shelf" data-foundation-label="书架"><article>已读 12</article><article>待读 4</article></section><dialog data-foundation-object-id="editor" data-foundation-label="藏书编辑"><label>书名<input name="book"></label><button onclick="this.closest(\'dialog\').close()">取消</button></dialog></main><script type="module">import {bindPreviewContext,createInspectorBridge,announcePreview} from "/foundation-bridge.mjs";bindPreviewContext(window,{pageId:"library"});createInspectorBridge();announcePreview();</script>';
 fs.writeFileSync(path.join(project,'index.html'),html);fs.writeFileSync(path.join(project,'request.md'),'制作藏书首页：顶部新增按钮可打开编辑弹窗，展示已读与待读统计；本次只验证本地展示，不保存业务数据。\n');
 fs.mkdirSync(path.join(project,'dist'));
 for(const file of ['preview-bridge.mjs','object-identity.mjs'])fs.copyFileSync(path.resolve('packages/core',file),path.join(project,'dist',file==='preview-bridge.mjs'?'foundation-bridge.mjs':file));
 assert(applyProjectForTest(createProjectAuthorityPlan({operation:'enable',project,installationRoot,continuousSync:'grant',includePreview:true})).ok);
 const sources=()=>['index.html','dist/foundation-bridge.mjs','dist/object-identity.mjs'].map(file=>({path:file,sha256:sha256(fs.readFileSync(path.join(project,file)))}));
 const common={status:'draft',source:'047 controlled engineering request',verificationStatus:'unverified'};
 const na={state:'not-applicable',source:'request.md#L1-L1',reason:'单页静态展示无跨页导航'};
 let task={...common,id:'task_library',name:'藏书首页制作',implementationMapping:'index.html',affectedPages:['library'],deliveryScope:{schemaVersion:'2.0.0',taskId:'task_library',revision:1,sourceRefs:[{id:'user',kind:'user-request',ref:'request.md#L1-L1'}],deliverable:'藏书首页',platform:'web',depth:'presentation',included:['藏书首页与编辑弹窗'],excluded:['业务存储','二级页面'],layoutPolicy:{mode:'adaptive',source:'request.md#L1-L1',viewports:[{width:375,height:812}]},items:[{requirementId:'library_request',description:'展示藏书统计与编辑入口',sourceRefIds:['user'],factIds:['library'],applicability:{state:'required',source:'user'},requiredEvidenceDimensions:['scope','content','definition','runtime','layout'],browserChecks:[{id:'title',action:'text',selector:'h1',expected:'我的藏书'},{id:'open_editor',action:'click',selector:'header button'},{id:'editor_visible',action:'visible',selector:'dialog'}]}]}};
 const batch=documents=>({scope:'当前用户请求及实际 HTML 实现',generatedAt:new Date().toISOString(),sources:sources(),documents:Object.entries(documents).map(([kind,upserts])=>({kind,expectedSha256:sha256(fs.readFileSync(path.join(project,'.foundation/facts',kind+'.json'))),upserts}))});
 const initial=batch({pages:[{...common,id:'library',name:'藏书首页',entry:true,preview:'/library/',implementationMapping:'index.html',navigationApplicability:na,states:['default','editing']}],changes:[task]});
 initial.preview={expectedSha256:sha256(fs.readFileSync(path.join(project,'.foundation/preview.json'))),routes:[{path:'/library/',file:'index.html'}],assets:[{path:'/foundation-bridge.mjs',file:'dist/foundation-bridge.mjs'},{path:'/object-identity.mjs',file:'dist/object-identity.mjs'}]};
 // The normal source generator must supply the semantics; this fixture supplies no graph.
 const began=synchronizeProject({project,installationRoot,roundAction:'begin',taskId:task.id});assert(began.mutationPerformed,JSON.stringify(began));
 const synchronized=synchronizeProject({project,installationRoot,handlerPayload:initial,roundAction:'finish',taskId:task.id});assert(synchronized.mutationPerformed,JSON.stringify(synchronized));
 const finished=synchronizeProject({project,installationRoot,roundAction:'finish',taskId:task.id});assert(finished.mutationPerformed,JSON.stringify(finished));
 const page=readFacts(project).pages.items.find(page=>page.id==='library');assert(page.sourceStructure.objects.some(object=>object.tag==='dialog'));assert(page.sourceStructure.relations.length>0);assert.equal(page.sourceStructure.semantics.producer,'foundation-source-semantics/1');
 assert.equal(inspectProjectDeliveryFiles({project,installationRoot}).deliveryReady,false);
 const saveReport=(result,name)=>{fs.writeFileSync(path.join(project,name),result.reportText);const {checks,observations,analysis,foundationReceipt,...rest}=result.report;const keys=['kind','subject','taskId','scopeRevision','inputFingerprint','artifactDigest','environment','runnerVersion','verifierVersion','checkIds','dimensions','result','limitations'];const entry=Object.fromEntries(keys.map(key=>[key,rest[key]]));return {...entry,evidenceId:name.replace(/\W/g,'_'),report:{path:name,sha256:result.reportSha256}};};
 const definition=await verifyProjectDefinition({project,installationRoot,entryRoots:['index.html'],taskId:task.id,assetId:'library',requirementId:'library_request'});assert.equal(definition.report.result,'passed');
 const browser=await verifyInstalledProjectBrowser({project,installationRoot,taskId:task.id,assetId:'library',scenarioId:'page',requirementId:'library_request'});
 fs.writeFileSync(path.join(base,'browser-result.json'),JSON.stringify(browser,null,2));assert.equal(browser.state,'passed',JSON.stringify(browser.report?.checks || browser));
 task={...readFacts(project).changes.items.find(x=>x.id===task.id),evidenceIndex:[saveReport(definition,'definition.json'),saveReport(browser,'browser.json')]};
 const persist=()=>{const payload=batch({changes:[task]});for(const evidence of task.evidenceIndex)payload.sources.push({path:evidence.report.path,sha256:evidence.report.sha256});return synchronizeProject({project,installationRoot,handlerPayload:payload});};
 {const result=persist();assert(result.mutationPerformed,JSON.stringify(result));}
 const prepared=prepareProjectSemanticReview({project,installationRoot,taskId:task.id,assetId:'library',requirementId:'library_request'});
 assert(prepared.plan.checks.some(check=>check.id.startsWith('structure_')));
 // Explicit engineering review, never an independent natural-use claim.
 const source=fs.readFileSync(path.join(project,'index.html'),'utf8');assert(source.includes('showModal()'));assert(browser.report.checks.every(check=>check.result==='passed'));
 const review={schemaVersion:'1.0.0',planDigest:prepared.planDigest,reviewer:{kind:'reviewer',label:'047 engineering fixture',source:'source and controlled browser evidence'},checks:prepared.plan.checks.map(check=>({id:check.id,expected:check.expected,observation:'工程材料实读：藏书标题、两类统计、showModal 编辑入口、取消关闭，当前浏览器检查通过；未检查真实存储',judgment:'passed',rationale:'与本夹具明确展示范围一致，未要求二级页或业务数据',coveredFactIds:check.factIds,evidenceIds:task.evidenceIndex.map(e=>e.evidenceId),sourceRefIds:['user'],limitations:['工程已知输入，不证明宿主自然使用']}))};
 const semantic=await submitProjectSemanticReview({project,installationRoot,prepared,review});task.evidenceIndex.push(saveReport(semantic,'semantic.json'));{const result=persist();assert(result.mutationPerformed,JSON.stringify(result));}
 const delivery=inspectProjectDeliveryFiles({project,installationRoot});fs.writeFileSync(path.join(base,'delivery.json'),JSON.stringify(delivery,null,2));assert(delivery.deliveryReady,JSON.stringify(delivery));
 const bytes=fs.readFileSync(path.join(project,'.foundation/facts/pages.json'));assert.equal(synchronizeProject({project,installationRoot}).mutationPerformed,false);assert.deepEqual(fs.readFileSync(path.join(project,'.foundation/facts/pages.json')),bytes);
 fs.appendFileSync(path.join(project,'index.html'),'<footer>新增加的帮助区域</footer>');const drift=inspectProjectDeliveryFiles({project,installationRoot});assert.equal(drift.deliveryReady,false);assert(drift.structureCoverage.missing.length>0);
 t.diagnostic('047 evidence='+base);
});
