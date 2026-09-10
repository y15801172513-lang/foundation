import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import test from 'node:test';

import * as core from '../helpers/internal-core.mjs';
import {signTrustedPayload} from '../../packages/core/trusted-authority.mjs';
import {EVENTS, ROOT, copyProjectFixture, makeScopedTempDirectory, projectFixturePath, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {enableProjectFixture, installFoundationFixture, relationMutationPlan} from '../helpers/authorized-project-fixture.mjs';
import {
  applyCapabilityForTest,
  applyLifecycleForTest,
  applyProjectMutationRecoveryForTest,
  authorizeLifecycle,
  authorizeProjectMutation,
} from '../helpers/test-authorization.mjs';
import {inspectTestHumanAuthorization} from '../fixtures/test-protected-host-adapter.mjs';

const LIFECYCLE_CHILD = path.join(ROOT, 'tests', 'fixtures', 'lifecycle-child.mjs');
const PROJECT_MUTATION_CHILD = path.join(ROOT, 'tests', 'fixtures', 'project-mutation-child.mjs');

function treeHash(root) {
  if (!fs.existsSync(root)) return null;
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).replaceAll(path.sep, '/');
      if (entry.isDirectory()) visit(file);
      else if (entry.isSymbolicLink()) records.push(`${relative}:symlink:${fs.readlinkSync(file)}`);
      else records.push(`${relative}:${core.sha256(fs.readFileSync(file))}`);
    }
  };
  visit(root);
  return core.sha256(records.join('\n'));
}

function waitForFile(file, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (fs.existsSync(file)) return resolve(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${file}`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function childResult(child) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => resolve({code, signal, stdout, stderr}));
  });
}

function recomputePlanIntegrity(plan) {
  const {integrity: _integrity, ...unsigned} = plan;
  return {...unsigned, integrity: {algorithm: 'sha256', hash: core.sha256(core.canonicalStringify(unsigned))}};
}

function candidate(root) {
  const source = path.join(root, `source-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(source, 'app'), {recursive: true});
  fs.writeFileSync(path.join(source, 'app', 'foundation-smoke.mjs'), 'console.log(JSON.stringify({ok:true,version:"0.2.0"}))\n');
  fs.cpSync(path.join(ROOT, 'templates'), path.join(source, 'app', 'templates'), {recursive: true});
  fs.cpSync(path.join(ROOT, 'skills'), path.join(source, 'app', 'artifacts', 'skills'), {recursive: true});
  const runtime = path.join(root, 'private-node');
  fs.copyFileSync(process.execPath, runtime);
  fs.chmodSync(runtime, 0o755);
  return core.buildCandidate({sourceRoot: source, outputRoot: path.join(root, 'candidate'), productVersion: '0.2.0', platform: process.platform, arch: process.arch, runtimeSource: runtime, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
}

function lifecyclePlan(root, target, built) {
  const runtime = built.manifest.files.find((record) => record.path === built.manifest.runtime.path);
  return core.createLifecyclePlan({operation: 'install', profile: 'core', targetRoot: target, sandboxRoot: root, targetVersion: '0.2.0', candidate: {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: runtime.sha256, bytes: built.manifest.totalBytes, version: '0.2.0'}, now: 1000});
}

test('026 replacement: capability 身份来自当前安装与 manager control plane，caller host 参数不能控制状态', (t) => {
  const root = makeScopedTempDirectory('project-authority-sandboxes', '024r8-host-identity-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = path.join(root, 'foundation-install');
  applyLifecycleForTest(lifecyclePlan(root, installationRoot, candidate(root)));
  const current = core.inspectInstallation(installationRoot).current;
  const manifestFile = path.join(installationRoot, ...current.appPath.split('/'), 'artifacts', 'skills', 'ai-product-foundation-kit', 'capability.json');
  applyCapabilityForTest(core.createCapabilityPlan({operation: 'install', installationRoot, manifestFile, now: 2000}));
  applyCapabilityForTest(core.createCapabilityPlan({operation: 'register', installationRoot, manifestFile, hostRegistrationIdentity: 'caller-supplied-test-host', now: 3000}));
  applyCapabilityForTest(core.createCapabilityPlan({operation: 'activate', installationRoot, manifestFile, hostRegistrationIdentity: 'caller-supplied-test-host', now: 4000}));
  assert.equal(core.inspectCapabilityStatus({installationRoot, manifestFile}).code, 'CAPABILITY_READY');
  assert.equal(core.inspectCapabilityStatus({installationRoot, manifestFile, hostRegistrationIdentity: 'caller-wrong'}).code, 'CAPABILITY_READY');
  const module = new URL('../../packages/core/index.mjs', import.meta.url).href;
  const source = `import {inspectCapabilityStatus} from ${JSON.stringify(module)}; console.log(JSON.stringify(inspectCapabilityStatus({installationRoot:${JSON.stringify(installationRoot)},manifestFile:${JSON.stringify(manifestFile)},hostRegistrationIdentity:'caller-matching'})));`;
  const production = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {cwd: ROOT, encoding: 'utf8', env: {PATH: process.env.PATH || ''}});
  assert.equal(production.status, 0, production.stderr);
  assert.equal(JSON.parse(production.stdout).code, 'CAPABILITY_READY');

  const registrationsFile = path.join(installationRoot, 'state', 'capability-host-registrations.json');
  const document = JSON.parse(fs.readFileSync(registrationsFile, 'utf8'));
  const {integrity: _integrity, ...payload} = document;
  payload.registrations['ai-product-foundation-kit'].hostRegistrationIdentity = 'stale-protected-host';
  fs.writeFileSync(registrationsFile, `${JSON.stringify({...payload, integrity: signTrustedPayload(payload)}, null, 2)}\n`);
  const staleBefore = treeHash(installationRoot);
  assert.equal(core.inspectCapabilityStatus({installationRoot, manifestFile, hostRegistrationIdentity: 'stale-protected-host'}).code, 'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH');
  assert.equal(treeHash(installationRoot), staleBefore, 'stale host status must remain byte-for-byte read-only');
});

test('024R8 failing-first: public core surface 不得暴露 arbitrary callback 或 offer reset', () => {
  assert.equal('executeAuthorizedProjectMutation' in core, false);
  assert.equal('resetInMemoryOfferSuppressionForTest' in core, false);
});

test('024R8 failing-first: production apply signature 不得暴露 fault/process/machine override', () => {
  const source = Function.prototype.toString.call(core.applyLifecyclePlan);
  for (const forbidden of ['faultAt', 'processControl', 'platform =', 'arch =']) assert.equal(source.includes(forbidden), false, forbidden);
});

test('024R8 failing-first: production offer persistence unavailable 必须结构化降级而不是抛 broker error', () => {
  const offerModule = new URL('../../packages/core/offer-consent.mjs', import.meta.url).href;
  const source = `import {markFoundationOfferPresented,recordFoundationOfferDecision,evaluateFoundationOffer} from ${JSON.stringify(offerModule)};\nconst shown=markFoundationOfferPresented();\nconst declined=recordFoundationOfferDecision({decision:'decline'});\nconst repeat=evaluateFoundationOffer({explicitGoal:true,materiallyNeedsFoundation:true});\nconsole.log(JSON.stringify({shown,declined,repeat}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {cwd: ROOT, encoding: 'utf8', env: {PATH: process.env.PATH || ''}});
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.declined.code, 'OFFER_PREFERENCE_PERSISTENCE_UNAVAILABLE');
  assert.equal(result.repeat.decision, 'suppress');
});

test('024R8: closed handler substitution fails before callback/write/receipt consumption', (t) => {
  const root = makeScopedTempDirectory('project-authority-sandboxes', '024r8-handler-binding-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = installFoundationFixture(root);
  const project = projectFixturePath(root, 'project');
  copyProjectFixture(EVENTS, project);
  enableProjectFixture(project, installationRoot);
  const draft = {from: 'page_events_manage', to: 'page_events_home', trigger: 'handler-substitution'};
  const plan = relationMutationPlan(project, installationRoot, draft);
  const issued = authorizeProjectMutation(plan);
  const marker = path.join(root, 'malicious-callback-ran');
  const tampered = structuredClone(plan);
  tampered.handler.handlerId = 'caller-module:evil-handler';
  const forgedIntegrity = recomputePlanIntegrity(tampered);
  const before = treeHash(project);
  assert.throws(
    () => core.applyProjectMutationPlan({plan: forgedIntegrity, mutate: () => fs.writeFileSync(marker, 'ran')}),
    (error) => ['PROJECT_HANDLER_UNKNOWN', 'PROJECT_HANDLER_BINDING_MISMATCH'].includes(error.code),
  );
  assert.equal(fs.existsSync(marker), false);
  assert.equal(treeHash(project), before);
  assert.equal(inspectTestHumanAuthorization(issued.authorizationId).state, 'issued');
  for (const forbidden of ['executeAuthorizedProjectMutation', 'registerProjectMutationHandler', 'setProjectMutationHandler', 'executeClosedProjectHandler']) assert.equal(forbidden in core, false, forbidden);
});

test('024R8: runtime identity cannot be spoofed by caller fields and mismatch rejects before target/write/consume', (t) => {
  const root = makeScopedTempDirectory('project-authority-sandboxes', '024r8-runtime-identity-');
  t.after(() => removeTempDirectory(root));
  const built = candidate(root);
  const target = path.join(root, 'spoof-target');
  const plan = core.createLifecyclePlan({operation: 'install', profile: 'core', targetRoot: target, sandboxRoot: root, targetVersion: '0.2.0', candidate: {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: built.manifest.files.find((record) => record.path === built.manifest.runtime.path).sha256, bytes: built.manifest.totalBytes, version: '0.2.0'}, platform: 'spoof', arch: 'spoof', now: 1000});
  assert.equal(plan.platform, process.platform);
  assert.equal(plan.arch, process.arch);
  const tampered = recomputePlanIntegrity({...plan, platform: plan.platform === 'darwin' ? 'win32' : 'darwin'});
  const issued = authorizeLifecycle(tampered);
  assert.throws(() => core.applyLifecyclePlan({plan: tampered, now: 1001}), (error) => error.code === 'MACHINE_IDENTITY_CHANGED');
  assert.equal(fs.existsSync(target), false);
  assert.equal(inspectTestHumanAuthorization(issued.authorizationId).state, 'issued');
});

test('024R8: absent lifecycle target killed before exclusive acquire stays absent and exact reservation is recoverable', async (t) => {
  const root = makeScopedTempDirectory('project-authority-sandboxes', '024r8-absent-target-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'absent-install');
  const plan = lifecyclePlan(root, target, candidate(root));
  const planFile = path.join(root, 'install-plan.json');
  const marker = path.join(root, 'pre-exclusive-marker.json');
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  const issued = authorizeLifecycle(plan);
  const child = spawn(process.execPath, [LIFECYCLE_CHILD, planFile, 'operation', 'before-exclusive-acquire', marker], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await waitForFile(marker);
  assert.equal(fs.existsSync(target), false);
  child.kill('SIGKILL');
  assert.equal((await childResult(child)).signal, 'SIGKILL');
  assert.equal(fs.existsSync(target), false);
  assert.equal(inspectTestHumanAuthorization(issued.authorizationId).state, 'reserved');
  const recovery = core.inspectLifecycleRecovery(target);
  assert.equal(recovery.status, 'recovery-required');
  const recoverPlan = core.createLifecyclePlan({operation: 'recover', profile: 'core', targetRoot: target, sandboxRoot: root, recoverySnapshot: recovery, now: 2000});
  const recovered = applyLifecycleForTest(recoverPlan);
  assert.equal(recovered.targetPreservedAbsent, true);
  assert.equal(fs.existsSync(target), false);
  assert.equal(inspectTestHumanAuthorization(issued.authorizationId).state, 'revoked');
  assert.throws(() => core.applyLifecyclePlan({plan, now: 1001}), (error) => ['HUMAN_AUTHORIZATION_REVOKED', 'HUMAN_AUTHORIZATION_REPLAYED'].includes(error.code));
});

test('024R8: project mutation SIGKILL before/after consume has exact classification, rollback and no replay', async (t) => {
  const root = makeScopedTempDirectory('project-authority-sandboxes', '024r8-project-crash-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = installFoundationFixture(root);
  const project = projectFixturePath(root, 'project');
  copyProjectFixture(EVENTS, project);
  enableProjectFixture(project, installationRoot);

  const crashAndRecover = async (stage, label) => {
    const before = treeHash(project);
    const plan = relationMutationPlan(project, installationRoot, {from: 'page_events_manage', to: 'page_events_home', trigger: label});
    const issued = authorizeProjectMutation(plan);
    const planFile = path.join(root, `${label}.plan.json`);
    const marker = path.join(root, `${label}.marker.json`);
    fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
    const child = spawn(process.execPath, [PROJECT_MUTATION_CHILD, planFile, stage, marker], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
    await waitForFile(marker);
    const atCrash = treeHash(project);
    if (stage !== 'after-project-handler-execute') assert.equal(atCrash, before, `${stage} must precede project bytes`);
    else assert.notEqual(atCrash, before, `${stage} must prove the handler had written`);
    child.kill('SIGKILL');
    assert.equal((await childResult(child)).signal, 'SIGKILL');
    const snapshot = core.inspectProjectMutationRecovery(project);
    assert.equal(snapshot.status, 'recovery-required', JSON.stringify(snapshot));
    const recoveryPlan = core.createProjectMutationRecoveryPlan({project, now: Date.now()});
    const result = applyProjectMutationRecoveryForTest(recoveryPlan);
    assert.equal(result.status, 'recovered');
    assert.equal(core.inspectProjectMutationRecovery(project).status, 'clean');
    assert.equal(treeHash(project), before, `${stage} recovery must restore exact project bytes`);
    const receiptState = inspectTestHumanAuthorization(issued.authorizationId).state;
    assert.equal(receiptState, stage === 'after-project-durable-pre-intent' ? 'revoked' : 'consumed');
    assert.throws(() => core.applyProjectMutationPlan({plan, now: plan.createdAt + 1}), (error) => ['HUMAN_AUTHORIZATION_REVOKED', 'HUMAN_AUTHORIZATION_REPLAYED'].includes(error.code));
  };

  await crashAndRecover('after-project-durable-pre-intent', 'before-consume');
  await crashAndRecover('after-project-authorization-consume', 'after-consume');
  await crashAndRecover('after-project-handler-execute', 'after-handler');
});

test('024R8: two real processes with distinct receipts serialize one before-state and stale loser re-plans', async (t) => {
  const root = makeScopedTempDirectory('project-authority-sandboxes', '024r8-project-race-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = installFoundationFixture(root);
  const project = projectFixturePath(root, 'project');
  copyProjectFixture(EVENTS, project);
  enableProjectFixture(project, installationRoot);
  const planA = relationMutationPlan(project, installationRoot, {from: 'page_events_manage', to: 'page_events_home', trigger: 'process-A'});
  const planB = relationMutationPlan(project, installationRoot, {from: 'page_events_manage', to: 'page_events_home', trigger: 'process-B'});
  const receiptA = authorizeProjectMutation(planA);
  const receiptB = authorizeProjectMutation(planB);
  const fileA = path.join(root, 'a.plan.json');
  const fileB = path.join(root, 'b.plan.json');
  const markerA = path.join(root, 'a.marker.json');
  const markerB = path.join(root, 'b.marker.json');
  const releaseA = path.join(root, 'a.release');
  const releaseB = path.join(root, 'b.release');
  fs.writeFileSync(fileA, `${JSON.stringify(planA, null, 2)}\n`);
  fs.writeFileSync(fileB, `${JSON.stringify(planB, null, 2)}\n`);
  const childA = spawn(process.execPath, [PROJECT_MUTATION_CHILD, fileA, 'after-project-exclusive-acquire', markerA, releaseA], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
  t.after(() => { if (childA.exitCode === null && childA.signalCode === null) childA.kill('SIGKILL'); });
  await waitForFile(markerA);
  const childB = spawn(process.execPath, [PROJECT_MUTATION_CHILD, fileB, 'after-project-durable-pre-intent', markerB, releaseB], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
  t.after(() => { if (childB.exitCode === null && childB.signalCode === null) childB.kill('SIGKILL'); });
  await waitForFile(markerB);
  assert.equal(inspectTestHumanAuthorization(receiptB.authorizationId).state, 'reserved');
  fs.writeFileSync(releaseB, 'release\n');
  fs.writeFileSync(releaseA, 'release\n');
  const [resultA, resultB] = await Promise.all([childResult(childA), childResult(childB)]);
  assert.equal(resultA.code, 0, resultA.stderr);
  assert.equal(resultB.code, 1, resultB.stderr);
  assert.match(resultB.stderr, /PROJECT_HANDLER_BINDING_MISMATCH|PROJECT_HANDLER_WRITE_SET_MISMATCH/u);
  assert.equal(inspectTestHumanAuthorization(receiptA.authorizationId).state, 'consumed');
  assert.equal(inspectTestHumanAuthorization(receiptB.authorizationId).state, 'revoked');
  const relations = JSON.parse(fs.readFileSync(path.join(project, '.foundation', 'facts', 'relations.json'), 'utf8'));
  assert.equal(relations.items.filter((item) => item.trigger === 'process-A').length, 1);
  assert.equal(relations.items.filter((item) => item.trigger === 'process-B').length, 0);
});

test('024R8: production offer unavailable is one-process-only across ignore/decline/repeat/reopen', () => {
  const offerModule = new URL('../../packages/core/offer-consent.mjs', import.meta.url).href;
  const source = `import {evaluateFoundationOffer,markFoundationOfferPresented,recordFoundationOfferDecision,inspectFoundationOfferPreference} from ${JSON.stringify(offerModule)};\nconst discovery=evaluateFoundationOffer({explicitGoal:true,materiallyNeedsFoundation:true,discoveryOnly:true});\nconst first=evaluateFoundationOffer({explicitGoal:true,materiallyNeedsFoundation:true});\nconst shown=markFoundationOfferPresented();\nconst ignoredRepeat=evaluateFoundationOffer({explicitGoal:true,materiallyNeedsFoundation:true});\nconst declined=recordFoundationOfferDecision({decision:'decline'});\nconst declineRepeat=evaluateFoundationOffer({explicitGoal:true,materiallyNeedsFoundation:true});\nconst reopened=recordFoundationOfferDecision({decision:'reopen'});\nconst afterReopen=evaluateFoundationOffer({explicitGoal:true,materiallyNeedsFoundation:true});\nconsole.log(JSON.stringify({discovery,first,shown,ignoredRepeat,declined,declineRepeat,reopened,afterReopen,preference:inspectFoundationOfferPreference()}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {cwd: ROOT, encoding: 'utf8', env: {PATH: ''}});
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.discovery.decision, 'do-not-offer');
  assert.equal(result.first.decision, 'offer-once');
  assert.equal(result.shown.code, 'OFFER_PREFERENCE_PERSISTENCE_UNAVAILABLE');
  assert.equal(result.ignoredRepeat.decision, 'suppress');
  assert.equal(result.declined.durableDecisionRecorded, false);
  assert.equal(result.declineRepeat.decision, 'suppress');
  assert.equal(result.reopened.code, 'OFFER_REOPEN_AUTHORITY_UNAVAILABLE');
  assert.equal(result.reopened.suppressionChanged, false);
  assert.equal(result.reopened.applyAuthorized, false);
  assert.equal(result.afterReopen.decision, 'suppress');
  assert.equal(result.preference.available, false);
  assert.equal(result.preference.state, 'offered-awaiting-response');
});
