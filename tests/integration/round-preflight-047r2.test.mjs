import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {makeTempDirectory,projectFixturePath} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest,applyProjectForTest} from '../helpers/test-authorization.mjs';
import {createLifecyclePlan,sha256} from '../../packages/core/install-contract.mjs';
import {createProjectAuthorityPlan} from '../../packages/core/project-authority.mjs';
import {synchronizeProject} from '../../packages/core/project-sync.mjs';
import {prepareRoundTransition,verifyRoundTransition} from '../../packages/core/project-context-round.mjs';
import {readFacts} from '../../packages/core/facts.mjs';
import {inspectProjectDeliveryFiles} from '../../packages/core/project-delivery.mjs';
import {inspectProjectStructure,inspectSemanticCoverage} from '../../packages/core/project-coverage.mjs';
import {prepareWorkbenchSnapshot} from '../../apps/management-center/src/server/workbench-snapshot.mjs';
test('047R2 preflight drift cannot be erased by starting a document round',{timeout:180000},()=>{
 const base=makeTempDirectory('047r2-preflight-'),candidate=fs.realpathSync(process.env.FOUNDATION_047_CANDIDATE),manifest=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json'))),installationRoot=path.join(base,'installation');
 applyLifecycleForTest(createLifecyclePlan({operation:'install',targetRoot:installationRoot,sandboxRoot:base,targetVersion:manifest.productVersion,candidate:{path:candidate,manifestHash:manifest.candidateHash,runtimeHash:manifest.files.find(f=>f.path===manifest.runtime.path).sha256,bytes:manifest.totalBytes,version:manifest.productVersion}}));
 const project=projectFixturePath(base,'ordinary');fs.mkdirSync(project,{recursive:true});assert(applyProjectForTest(createProjectAuthorityPlan({operation:'enable',project,installationRoot,continuousSync:'grant',includePreview:true})).ok);
 const sync=options=>{const result=synchronizeProject({project,installationRoot,...options});assert(!['failed','conflict'].includes(result.state),JSON.stringify(result));return result;};
 sync({roundAction:'begin',taskId:'build'});fs.writeFileSync(path.join(project,'index.html'),'<main>原页面</main>');sync({roundAction:'finish',taskId:'build'});
 // External visual drift occurs before the next begin; the previous end must remain evidence.
 fs.writeFileSync(path.join(project,'index.html'),'<main>原页面<button>未经上报的新操作</button></main>');fs.writeFileSync(path.join(project,'guide.md'),'本次只维护文档。\n');
 sync({roundAction:'begin',taskId:'docs'});sync({});
 const task={id:'docs',name:'文档维护',source:'user-request',status:'draft',verificationStatus:'unverified',implementationMapping:'guide.md',deliveryScope:{schemaVersion:'2.0.0',taskId:'docs',revision:1,platform:'document',deliverable:'维护说明',depth:'presentation',included:['文档'],excluded:['界面'],layoutPolicy:{mode:'not-applicable',source:'guide.md#L1-L1',reason:'文本'},sourceRefs:[{id:'req',kind:'user-request',ref:'guide.md#L1-L1'}],items:[{requirementId:'docs',description:'维护说明',factIds:['docs'],sourceRefIds:['req'],requiredEvidenceDimensions:[],applicability:{state:'not-applicable',source:'guide.md#L1-L1',reason:'文本'}}]}};
 const payload={scope:'维护说明',generatedAt:new Date().toISOString(),sources:[{path:'guide.md',sha256:sha256(fs.readFileSync(path.join(project,'guide.md')))}],documents:[{kind:'changes',expectedSha256:sha256(fs.readFileSync(path.join(project,'.foundation/facts/changes.json'))),upserts:[task]}]};
 sync({handlerPayload:payload,roundAction:'finish',taskId:'docs'});const result=inspectProjectDeliveryFiles({project,installationRoot});fs.writeFileSync(path.join(base,'preflight-delivery.json'),JSON.stringify(result,null,2));console.log('047R2 preflight evidence='+base);assert.equal(result.deliveryReady,false,'已观察到的前置源码漂移不可被新的文档基线抹去');assert.equal(result.taskReady,true);assert(result.projectPendingChanges.some(change=>change.path==='index.html'));
 for(let i=0;i<2;i++){sync({roundAction:'begin',taskId:'docs'});sync({roundAction:'finish',taskId:'docs'});sync({});const again=inspectProjectDeliveryFiles({project,installationRoot});assert.equal(again.taskReady,true);assert.equal(again.projectDeliveryReady,false);assert(again.projectPendingChanges.some(change=>change.path==='index.html'));}
 const transition=prepareRoundTransition({project,facts:readFacts(project),taskId:'docs',action:'observe',installationRoot});
 fs.appendFileSync(path.join(project,'index.html'),'<aside>轮后改变</aside>');assert.throws(()=>verifyRoundTransition(project,transition),/漂移/);const unread=inspectProjectDeliveryFiles({project,installationRoot});assert.equal(unread.projectDeliveryReady,false);assert(unread.projectPendingChanges.some(change=>change.path==='index.html'));sync({});assert.equal(inspectProjectDeliveryFiles({project,installationRoot}).projectDeliveryReady,false);
 const factsTransition=prepareRoundTransition({project,facts:readFacts(project),taskId:'docs',action:'observe',installationRoot}),factFile=path.join(project,'.foundation/facts/changes.json'),original=fs.readFileSync(factFile);const modified=JSON.parse(original);modified.items[0].name+=' 并发';fs.writeFileSync(factFile,JSON.stringify(modified));assert.throws(()=>verifyRoundTransition(project,factsTransition),/事实发生漂移/);fs.writeFileSync(factFile,original);
});
