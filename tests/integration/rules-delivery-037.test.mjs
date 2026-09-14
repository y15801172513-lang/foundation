import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildRepositoryCandidateForTest} from '../helpers/repository-candidate.mjs';
import {makeTempDirectory, projectFixturePath, copyProjectFixture, DEMO} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest, applyProjectForTest, authorizeProjectMutation} from '../helpers/test-authorization.mjs';
import {enableProjectFixture} from '../helpers/authorized-project-fixture.mjs';
import {createLifecyclePlan} from '../../packages/core/install-contract.mjs';
import {createProjectAuthorityPlan, createProjectMutationPlan, applyProjectMutationPlan, inventoryProject} from '../../packages/core/project-authority.mjs';
import {readCurrentFoundationRules, readProjectPolicyForDisplay} from '../../packages/core/rules-delivery.mjs';
import {configureRuntimeControl} from '../fixtures/test-runtime-surface.mjs';
import {buildContextRecord, contextPlainText} from '../../packages/core/context.mjs';
import {projectWithEffectivePolicy} from '../../packages/core/ui-policy.mjs';
import {readFacts} from '../../packages/core/facts.mjs';
import {projectGovernance} from '../../packages/core/assets.mjs';
import {sha256} from '../../packages/core/install-contract.mjs';

test('037 actual candidate rules consumer, confirmed adoption, rollback, overrides, tamper and disabled refusal', () => {
  const root=makeTempDirectory('037-rules-delivery-'),built=buildRepositoryCandidateForTest();
  const manifest=JSON.parse(fs.readFileSync(path.join(built.candidate,'manifest.json')));
  const installationRoot=path.join(root,'installed');
  const candidate={path:built.candidate,manifestHash:manifest.candidateHash,runtimeHash:manifest.files.find(file=>file.path===manifest.runtime.path).sha256,bytes:manifest.totalBytes,version:manifest.productVersion};
  applyLifecycleForTest(createLifecyclePlan({operation:'install',targetRoot:installationRoot,sandboxRoot:root,targetVersion:manifest.productVersion,candidate}));
  const base=readCurrentFoundationRules({installationRoot});assert.equal(base.ruleVersion,'1.0.0');assert.equal(base.documents.length,2);assert.equal(base.projectRulesReady,false);
  const project=projectFixturePath(root,'existing-non-shadcn');copyProjectFixture(DEMO,project);enableProjectFixture(project,installationRoot);
  const agents=path.join(project,'AGENTS.md');const original='# User rules\nKeep vanilla JavaScript.\n';fs.writeFileSync(agents,original);
  const prepare=()=>createProjectMutationPlan({operation:'project-rules-adopt',project,installationRoot,handlerPayload:{installationRoot,technology:'preserve',generatedAt:new Date().toISOString()}});
  fs.writeFileSync(path.join(project,'AGENTS.override.md'),'User-owned override');assert.throws(prepare,/AGENTS.override/);fs.unlinkSync(path.join(project,'AGENTS.override.md'));
  const failed=prepare();assert.throws(()=>applyProjectMutationPlan({plan:failed}));assert.equal(fs.readFileSync(agents,'utf8'),original);
  authorizeProjectMutation(failed);configureRuntimeControl({faultAt:'after-project-handler-execute'});try{assert.throws(()=>applyProjectMutationPlan({plan:failed}),{code:'FAULT_INJECTED'});}finally{configureRuntimeControl(null);}
  assert.equal(fs.readFileSync(agents,'utf8'),original);assert(!fs.existsSync(path.join(project,'.foundation/identity/rules-adoption.json')));
  const plan=prepare();authorizeProjectMutation(plan);assert.equal(applyProjectMutationPlan({plan}).ok,true);
  assert(fs.readFileSync(agents,'utf8').startsWith(original));const adopted=readCurrentFoundationRules({installationRoot,project});assert(adopted.projectRulesReady);assert.equal(adopted.adoption.governanceMode,'preserve-and-inventory');assert.throws(prepare,/已有项目采用记录/);
  const record=path.join(project,'.foundation/identity/rules-adoption.json');const adoption=JSON.parse(fs.readFileSync(record));adoption.exceptions=[{reason:'User-owned theme',scope:'all pages'}];fs.writeFileSync(record,JSON.stringify(adoption));assert.deepEqual(readCurrentFoundationRules({installationRoot,project}).adoption.exceptions,adoption.exceptions);
  fs.writeFileSync(record,JSON.stringify({...adoption,ruleMajor:2}));assert.throws(()=>readCurrentFoundationRules({installationRoot,project}),{code:'RULES_ADOPTION_INCOMPATIBLE'});fs.writeFileSync(record,JSON.stringify(adoption));
  fs.writeFileSync(record,JSON.stringify({...adoption,ruleMajor:2}));const unavailable=readProjectPolicyForDisplay({installationRoot,project});assert.equal(unavailable.executable,false);assert.equal(unavailable.governanceMode,'unconfigured');assert.equal(unavailable.authority,'current-rules-unavailable-no-fallback');assert.deepEqual(unavailable.exceptions,[]);fs.writeFileSync(record,JSON.stringify(adoption));
  // No hidden skeleton fixture: the same inspect nextStep used by the bundled
  // Skill chooses the existing exact handler, with separate engineering consent.
  const existing=projectFixturePath(root,'ordinary-existing');fs.mkdirSync(existing);
  fs.writeFileSync(path.join(existing,'app.mjs'),'export const title = "Existing vanilla application";\n');
  fs.writeFileSync(path.join(existing,'AGENTS.md'),'# User rules\nKeep vanilla JavaScript.\n');
  applyProjectForTest(createProjectAuthorityPlan({operation:'enable',project:existing,installationRoot}));
  let readiness=readCurrentFoundationRules({installationRoot,project:existing});assert.equal(readiness.projectEnabled,true);assert.equal(readiness.projectRulesReady,false);assert.equal(readiness.preparation.factsReady,false);assert.equal(readiness.adoption,null);assert.equal(readiness.nextStep.action,'confirm-project-preparation');
  const adoptExisting=()=>createProjectMutationPlan({operation:'project-rules-adopt',project:existing,installationRoot,handlerPayload:{installationRoot,technology:'preserve',generatedAt:new Date().toISOString()}});
  assert.throws(adoptExisting,{code:'PROJECT_PREPARATION_REQUIRED'});
  const preparation=()=>createProjectMutationPlan({operation:readiness.nextStep.operation,project:existing,installationRoot,handlerPayload:{...readiness.nextStep.handlerPayload,generatedAt:new Date().toISOString()}});
  const notConfirmed=preparation();assert.throws(()=>applyProjectMutationPlan({plan:notConfirmed}));assert.equal(readCurrentFoundationRules({installationRoot,project:existing}).projectRulesReady,false);
  const failedPreparation=preparation();authorizeProjectMutation(failedPreparation);configureRuntimeControl({faultAt:'after-project-handler-execute'});
  try{assert.throws(()=>applyProjectMutationPlan({plan:failedPreparation}),{code:'FAULT_INJECTED'});}finally{configureRuntimeControl(null);}
  assert.equal(readCurrentFoundationRules({installationRoot,project:existing}).preparation.factsReady,false);
  const confirmedPreparation=preparation();authorizeProjectMutation(confirmedPreparation);applyProjectMutationPlan({plan:confirmedPreparation});
  readiness=readCurrentFoundationRules({installationRoot,project:existing});assert.equal(readiness.preparation.factsReady,true);assert.equal(readiness.projectRulesReady,false);assert.equal(readiness.nextStep.action,'confirm-rules-adoption');assert(!fs.existsSync(path.join(existing,'.foundation/preview.json')));
  const adoptedExisting=adoptExisting();authorizeProjectMutation(adoptedExisting);assert(applyProjectMutationPlan({plan:adoptedExisting}).ok);
  const pageFile=path.join(existing,'.foundation/facts/pages.json');
  const batch=createProjectMutationPlan({operation:'asset-facts-batch',project:existing,installationRoot,handlerPayload:{scope:'登记现有应用，不建立或转换预览',generatedAt:new Date().toISOString(),sources:[{path:'app.mjs',sha256:sha256(fs.readFileSync(path.join(existing,'app.mjs')))}],documents:[{kind:'pages',expectedSha256:sha256(fs.readFileSync(pageFile)),upserts:[{id:'page_app',name:'现有应用',route:'/',entry:true,status:'registered',source:'engineering-fixture',implementationMapping:'app.mjs',verificationStatus:'unverified'}]}]}});
  authorizeProjectMutation(batch);assert(applyProjectMutationPlan({plan:batch}).ok);assert(!fs.existsSync(path.join(existing,'.foundation/preview.json')));
  const fresh=projectFixturePath(root,'new-react');applyProjectForTest(createProjectAuthorityPlan({operation:'enable',project:fresh,installationRoot,createFromTemplate:true}));
  const freshAdoption=createProjectMutationPlan({operation:'project-rules-adopt',project:fresh,installationRoot,handlerPayload:{installationRoot,technology:'react-shadcn',generatedAt:new Date().toISOString()}});authorizeProjectMutation(freshAdoption);assert(applyProjectMutationPlan({plan:freshAdoption}).ok);
  for(const [target,mode] of [[existing,'preserve-and-inventory'],[fresh,'shadcn-first']]){
    const rules=readCurrentFoundationRules({installationRoot,project:target});assert(rules.projectRulesReady);assert.equal(rules.effectivePolicy.governanceMode,mode);assert.equal(rules.effectivePolicy.authority,'verified-installed-rules-and-project-adoption');
    assert.deepEqual(inventoryProject(target,{installationRoot}).effectivePolicy,rules.effectivePolicy);assert.equal(inventoryProject(target).effectivePolicy,null);
    const identity=readFacts(target).foundation,projectView=projectWithEffectivePolicy(identity,rules.effectivePolicy);assert.equal(projectGovernance(projectView).mode,mode);
    for(const scope of ['page','component','asset']) {const context=buildContextRecord({project:projectView,scope});assert.equal(context.uiPolicy.governanceMode,mode);assert(contextPlainText(context).includes('policy state: ready'));assert.equal(context.uiPolicy.currentIdentityHash,rules.currentIdentityHash);}
    assert.equal(readFacts(target).foundation.uiPolicy.governanceMode,'preserve-and-inventory');
  }
  const rule=base.documents[0].path,bytes=fs.readFileSync(rule);fs.appendFileSync(rule,'\ntampered');assert.throws(()=>readCurrentFoundationRules({installationRoot}),{code:'RULES_CURRENT_UNAVAILABLE'});fs.writeFileSync(rule,bytes);fs.renameSync(rule,rule+'.missing-fixture');assert.throws(()=>readCurrentFoundationRules({installationRoot}));fs.renameSync(rule+'.missing-fixture',rule);assert.equal(readCurrentFoundationRules({installationRoot}).ruleVersion,'1.0.0');
  applyProjectForTest(createProjectAuthorityPlan({operation:'disable',project,installationRoot}));assert.throws(()=>readCurrentFoundationRules({installationRoot,project}));assert.deepEqual(JSON.parse(fs.readFileSync(record)).exceptions,adoption.exceptions);assert(fs.readFileSync(agents,'utf8').includes('停用、绑定缺失、安装失效时，本段惰性'));
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({engineeringOnly:true,manifestHash:manifest.candidateHash,version:manifest.productVersion,ruleVersion:base.ruleVersion,project,planHash:plan.integrity.hash,hostDiscovery:'pending',realUserConfirmation:false},null,2));
});
