import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {normalizeInstallDestinationInput} from '../../packages/core/install-destination.mjs';
import {renderInstallDestinationPage} from '../../packages/core/lifecycle-feedback.mjs';
import {parseCliInvocation} from '../../packages/cli/command-contract.mjs';
import {createProjectAuthorityPlan, createProjectMutationPlan, applyProjectMutationPlan} from '../../packages/core/project-authority.mjs';
import {installFoundationFixture, enableProjectFixture} from '../helpers/authorized-project-fixture.mjs';
import {authorizeProjectMutation, applyProjectForTest} from '../helpers/test-authorization.mjs';
import {configureRuntimeControl} from '../fixtures/test-runtime-surface.mjs';
import {makeTempDirectory, projectFixturePath, copyProjectFixture, DEMO} from '../helpers/project-fixture.mjs';
import {sha256} from '../../packages/core/install-contract.mjs';
import {inspectProjectPreparation} from '../../packages/core/facts.mjs';
import {deriveClosedHandlerBinding} from '../../packages/core/project-mutation-handlers.mjs';
import {effectiveProjectPolicy, projectWithEffectivePolicy} from '../../packages/core/ui-policy.mjs';
import {buildContextRecord, contextPlainText} from '../../packages/core/context.mjs';
import {projectGovernance} from '../../packages/core/assets.mjs';

test('037R1 preparation proposes only missing files, rejects corrupt partial state and keeps preview optional', () => {
  const root=makeTempDirectory('037r1-preparation-'),project=projectFixturePath(root,'partial');
  fs.mkdirSync(project);fs.mkdirSync(path.join(project,'.foundation/facts'),{recursive:true});
  const file=path.join(project,'.foundation/facts/project.json'),original='{"schemaVersion":"0.1.0","items":[],"custom":"keep"}\n';fs.writeFileSync(file,original);
  const derive=()=>deriveClosedHandlerBinding({operation:'foundation-skeleton-and-facts-create',project,handlerPayload:{includePreview:false,generatedAt:'2026-09-11T00:00:00Z'}});
  const state=inspectProjectPreparation(project);assert.equal(state.state,'preparation-required');assert.equal(state.preview.state,'absent');assert.equal(state.factsReady,false);
  const binding=derive();assert(!binding.allowedWriteSet.includes('.foundation/preview.json'));assert(!binding.allowedWriteSet.includes('.foundation/facts/project.json'));assert.deepEqual(binding.creates,binding.allowedWriteSet);assert.equal(fs.readFileSync(file,'utf8'),original);
  fs.writeFileSync(file,'broken');assert.equal(inspectProjectPreparation(project).state,'blocked');assert.throws(derive,{code:'PROJECT_PREPARATION_CONFLICT'});assert.equal(fs.readFileSync(file,'utf8'),'broken');
  fs.writeFileSync(file,original);fs.writeFileSync(path.join(project,'.foundation/preview.json'),'{"mode":"user-framework-preview"}');assert.equal(inspectProjectPreparation(project).preview.state,'unsupported');assert(!derive().allowedWriteSet.includes('.foundation/preview.json'));
  assert.throws(()=>deriveClosedHandlerBinding({operation:'foundation-skeleton-and-facts-create',project,handlerPayload:{includePreview:true,generatedAt:'2026-09-11T00:00:00Z'}}),{code:'PROJECT_PREPARATION_CONFLICT'});
});

test('037R1 effective policy wins over historical identity in every copied scope and badge; inert states stay inert', () => {
  for(const kind of ['new','existing']) {
    const identity={projectId:'project_test',projectKind:kind,uiPolicy:{governanceMode:'preserve-and-inventory',classification:'new-shadcn'},governanceMode:'preserve-and-inventory'};
    const governanceMode=kind==='new'?'shadcn-first':'preserve-and-inventory';
    const adoption={technology:kind==='new'?'react-shadcn':'preserve',governanceMode,adoptedRuleVersion:'1.0.0',exceptions:[{scope:'button',reason:'user theme'}]};
    const input={identity,adoption,ruleVersion:'1.0.1',programVersion:'engineering',currentIdentityHash:'current-proof',endpointIdentity:'rules-proof',factsReady:true};
    const policy=effectiveProjectPolicy(input),project=projectWithEffectivePolicy(identity,policy);
    assert.equal(policy.classification,kind==='new'?'new-shadcn':'unstable-ui');
    assert.equal(projectGovernance(project).mode,governanceMode);assert.equal(identity.uiPolicy.governanceMode,'preserve-and-inventory');
    for(const scope of ['page','component','asset']) {const record=buildContextRecord({project,scope});assert.deepEqual(record.uiPolicy,policy);const text=contextPlainText(record);assert(text.includes('ui governance mode: '+governanceMode));assert(text.includes('current rule version: 1.0.1'));assert(text.includes('adopted rule version: 1.0.0'));assert(text.includes('user theme'));}
    for(const [delta,state] of [[{adoption:null},'not-adopted'],[{factsReady:false},'preparation-required'],[{adoption:{...adoption,technology:'unknown'}},'incompatible']]) {const inactive=effectiveProjectPolicy({...input,...delta});assert.equal(inactive.state,state);assert.equal(inactive.executable,false);assert.equal(projectGovernance(projectWithEffectivePolicy(identity,inactive)).writes,false);}
  }
});

test('037 pasted path normalization preserves inner spaces, rejects Windows and is not shell interpretation', () => {
  for(const value of ['  "/local/我的 项目"  ', " '/local/我的 项目' ", '“/local/我的 项目”']) assert.equal(normalizeInstallDestinationInput(value), '/local/我的 项目');
  assert.equal(normalizeInstallDestinationInput('/local/a  b'),'/local/a  b');
  assert.equal(normalizeInstallDestinationInput('/local/$(do-not-run)'),'/local/$(do-not-run)');
  for(const value of ['C:\\Users\\test', 'D:/Foundation', '\\\\server\\share', '//server/share', '~/Foundation', '', '/local/\nname']) assert.throws(()=>normalizeInstallDestinationInput(value));
  const html=renderInstallDestinationPage({version:'engineering',suggestion:'/local/我的 项目',acquisitionRoot:'/local/cache',bootstrapStateRoot:'/local/state',nonce:'fixture',expiresAt:Date.now()+1000});
  assert.match(html,/aria-describedby="destination-hint destination-error"/);assert.match(html,/id="destination-error" role="alert"/);assert.match(html,/field.setAttribute\('aria-invalid','true'\)/);
  assert.deepEqual(parseCliInvocation(['rules','inspect','--root','/local/Foundation']).route,['rules','inspect']);
  assert.throws(()=>parseCliInvocation(['rules','apply','--root','/local/Foundation']));
  assert.throws(()=>parseCliInvocation(['fd','some-file']));
});

test('037 existing project enable does not claim new/shadcn; existing identity is preserved', () => {
  const root=makeTempDirectory('037-kind-'),installationRoot=installFoundationFixture(root);
  const project=projectFixturePath(root,'existing');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'existing.vue'),'<template>existing</template>');
  const plan=createProjectAuthorityPlan({operation:'enable',project,installationRoot});applyProjectForTest(plan);
  const file=path.join(project,'.foundation/identity/project.json');const identity=JSON.parse(fs.readFileSync(file));
  assert.equal(identity.projectKind,'existing');assert.equal(identity.governanceMode,'preserve-and-inventory');assert.equal(identity.uiPolicy.classification,'unstable-ui');
  const original=fs.readFileSync(file);applyProjectForTest(createProjectAuthorityPlan({operation:'disable',project,installationRoot}));assert.deepEqual(fs.readFileSync(file),original);
});

test('037 exact asset batch preserves other records, rejects source drift, replay, absent approval and rolls back', () => {
  const root=makeTempDirectory('037-batch-'),installationRoot=installFoundationFixture(root);
  const project=projectFixturePath(root,'existing-html');copyProjectFixture(DEMO,project);enableProjectFixture(project,installationRoot);
  const file=path.join(project,'.foundation/facts/components.json'),source=path.join(project,'src/button.mjs');
  const before=fs.readFileSync(file),facts=JSON.parse(before);const other=structuredClone(facts.items[1]);
  const payload=()=>({scope:'只改基础 Button 的登记名称，源码未变；不改另一个变体',generatedAt:new Date().toISOString(),sources:[{path:'src/button.mjs',sha256:sha256(fs.readFileSync(source))}],documents:[{kind:'components',expectedSha256:sha256(fs.readFileSync(file)),upserts:[{id:facts.items[0].id,name:'基础按钮',implementationMapping:'src/button.mjs',verificationStatus:'unverified'}]}]});
  const create=()=>createProjectMutationPlan({operation:'asset-facts-batch',project,installationRoot,handlerPayload:payload()});
  const noApproval=create();assert.throws(()=>applyProjectMutationPlan({plan:noApproval}));assert.deepEqual(fs.readFileSync(file),before);
  const stale=create();fs.appendFileSync(source,'\n// source changed\n');assert.throws(()=>{authorizeProjectMutation(stale);applyProjectMutationPlan({plan:stale});});assert.deepEqual(fs.readFileSync(file),before);
  const rollback=create();authorizeProjectMutation(rollback);configureRuntimeControl({faultAt:'after-project-handler-execute'});
  try {assert.throws(()=>applyProjectMutationPlan({plan:rollback}),{code:'FAULT_INJECTED'});} finally {configureRuntimeControl(null);}
  assert.deepEqual(fs.readFileSync(file),before);
  const plan=create();authorizeProjectMutation(plan);const result=applyProjectMutationPlan({plan});assert.equal(result.ok,true);
  const after=JSON.parse(fs.readFileSync(file));assert.equal(after.items[0].name,'基础按钮');assert.deepEqual(after.items[1],other);assert.equal(after.items[0].family,facts.items[0].family);
  assert.throws(()=>applyProjectMutationPlan({plan}));
  const invalid=payload();invalid.documents[0].upserts[0].usageLocations=[{pageId:'missing',instanceId:'bad'}];assert.throws(()=>createProjectMutationPlan({operation:'asset-facts-batch',project,installationRoot,handlerPayload:invalid}));
  fs.writeFileSync(path.join(root,'evidence.json'),JSON.stringify({engineeringOnly:true,project,planHash:plan.integrity.hash,changed:result.changed,realUserConfirmation:false},null,2));
});
