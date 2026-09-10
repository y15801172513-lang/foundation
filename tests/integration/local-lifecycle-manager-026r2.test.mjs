import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildCandidate,
  canonicalStringify,
  createCapabilityPlan,
  createFoundationRuntimeDescriptor,
  createLifecyclePlan,
  createProjectAuthorityPlan,
  hashDirectory,
  inspectInstallation,
  sha256,
} from '@foundation/core';
import {signTrustedPayload} from '../../packages/core/trusted-authority.mjs';
import {applyCapabilityForTest, applyLifecycleForTest, applyProjectForTest} from '../helpers/test-authorization.mjs';
import {makeScopedTempDirectory, projectFixturePath, removeTempDirectory, ROOT} from '../helpers/project-fixture.mjs';
import {prepareCurrentProjectLayoutFixture} from '../helpers/authorized-project-fixture.mjs';
import {buildRepositoryCandidateForTest} from '../helpers/repository-candidate.mjs';

const importCore = (name) => import(new URL(`../../packages/core/${name}.mjs`, import.meta.url));
const CAPABILITY_ID = 'ai-product-foundation-kit';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function rebindDescriptor(document) {
  const {integrity: _integrity, ...withHealth} = document;
  const {healthIdentity: _healthIdentity, ...payload} = withHealth;
  const healthIdentity = sha256(canonicalStringify(payload));
  const bound = {...payload, healthIdentity};
  return {...bound, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(bound))}};
}

function candidate(root, version = '0.2.0', endpoint = `artifacts/rules-${version}`, {formats = ['0.1.0'], descriptorMutation = null} = {}) {
  const source = path.join(root, `source-${version}-${cryptoRandom()}`);
  const app = path.join(source, 'app');
  const endpointRoot = path.join(app, endpoint);
  const capabilityRoot = path.join(endpointRoot, 'skills', CAPABILITY_ID);
  fs.mkdirSync(capabilityRoot, {recursive: true});
  fs.writeFileSync(path.join(app, 'foundation-smoke.mjs'), `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))\n`);
  fs.writeFileSync(path.join(endpointRoot, 'rules.json'), `${JSON.stringify({version})}\n`);
  fs.copyFileSync(path.join(ROOT, 'skills', CAPABILITY_ID, 'SKILL.md'), path.join(capabilityRoot, 'SKILL.md'));
  fs.copyFileSync(path.join(ROOT, 'skills', CAPABILITY_ID, 'capability.json'), path.join(capabilityRoot, 'capability.json'));
  fs.cpSync(path.join(ROOT, 'templates'), path.join(app, 'templates'), {recursive: true});
  let descriptor = createFoundationRuntimeDescriptor({
    productVersion: version,
    platform: process.platform,
    arch: process.arch,
    buildIdentity: `026R2-${version}`,
    supportedProjectDataFormats: formats,
    ruleCapabilityEndpoint: endpoint,
    ruleCapabilityEndpointRoot: endpointRoot,
    capabilityFacts: {
      bundled: [{capabilityId: CAPABILITY_ID, type: 'codex-skill', version: '0.2.0', manifestPath: `skills/${CAPABILITY_ID}/capability.json`, installed: true, active: false, projectScoped: false}],
      installedStateSource: 'state/capabilities.json',
      activeStateSource: 'state/capabilities.json',
      registrationStateSource: 'state/capability-host-registrations.json',
    },
  });
  if (descriptorMutation) descriptor = rebindDescriptor(descriptorMutation(structuredClone(descriptor)));
  writeJson(path.join(app, 'foundation-runtime-descriptor.json'), descriptor);
  const runtime = path.join(root, 'private-node');
  if (!fs.existsSync(runtime)) { fs.copyFileSync(process.execPath, runtime); fs.chmodSync(runtime, 0o755); }
  return buildCandidate({sourceRoot: source, outputRoot: path.join(root, `candidate-${version}-${cryptoRandom()}`), productVersion: version, platform: process.platform, arch: process.arch, runtimeSource: runtime, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test', buildIdentity: `026R2-${version}`});
}

function cryptoRandom() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function install(root, built, {operation = 'install', installationRoot = path.join(root, 'foundation-install')} = {}) {
  const runtime = built.manifest.files.find((record) => record.path === built.manifest.runtime.path);
  const current = inspectInstallation(installationRoot).current;
  const plan = createLifecyclePlan({
    operation,
    profile: 'core',
    targetRoot: installationRoot,
    sandboxRoot: root,
    currentVersion: current?.version,
    targetVersion: built.manifest.productVersion,
    candidate: {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: runtime.sha256, bytes: built.manifest.totalBytes, version: built.manifest.productVersion},
    now: Date.now(),
  });
  applyLifecycleForTest(plan);
  return installationRoot;
}

function capabilityManifest(installationRoot) {
  const current = inspectInstallation(installationRoot).current;
  const app = path.join(installationRoot, ...current.appPath.split('/'));
  const descriptor = JSON.parse(fs.readFileSync(path.join(app, 'foundation-runtime-descriptor.json'), 'utf8'));
  return path.join(app, ...descriptor.ruleCapabilityEndpoint.path.split('/'), 'skills', CAPABILITY_ID, 'capability.json');
}

function activateCapability(installationRoot) {
  const manifestFile = capabilityManifest(installationRoot);
  for (const operation of ['install', 'register', 'activate']) applyCapabilityForTest(createCapabilityPlan({operation, installationRoot, manifestFile, now: Date.now()}));
}

function projectFixture(root) {
  const project = projectFixturePath(root, 'project');
  fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
  writeJson(path.join(project, '.foundation', 'foundation.json'), {projectId: 'bridge-project', dataFormatVersion: '0.1.0'});
  fs.writeFileSync(path.join(project, '.foundation', 'facts', 'sentinel.json'), '{"preserve":true}\n');
  fs.writeFileSync(path.join(project, 'README.md'), 'project sentinel\n');
  prepareCurrentProjectLayoutFixture(project);
  return project;
}

function enableProject(project, installationRoot) {
  applyProjectForTest(createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: Date.now()}));
}

function signedRewrite(file, mutate) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const {integrity: _integrity, ...payload} = document;
  mutate(payload);
  writeJson(file, {...payload, integrity: signTrustedPayload(payload)});
}

test('026R2 actual repository-built candidate declares inactive and cannot become Bridge ready without live state', async (t) => {
  const root = makeScopedTempDirectory('026R2', 'actual-candidate-');
  t.after(() => removeTempDirectory(root));
  const candidateRoot = buildRepositoryCandidateForTest().candidate;
  const actual = {root: candidateRoot, manifest: JSON.parse(fs.readFileSync(path.join(candidateRoot, 'manifest.json'), 'utf8'))};
  const descriptor = JSON.parse(fs.readFileSync(path.join(candidateRoot, 'payload', 'app', 'foundation-runtime-descriptor.json'), 'utf8'));
  assert.equal(descriptor.capabilityFacts.bundled[0].active, false);
  const installationRoot = install(root, actual);
  const bridge = await importCore('ai-bridge');
  const result = bridge.resolveFoundationBridgeContext({installationRoot, operationRequirement: 'plugin-use', capabilityId: CAPABILITY_ID});
  assert.equal(result.state, 'inert');
  assert.equal(result.reason, 'CAPABILITY_NOT_INSTALLED');
  assert.equal(result.usable, false);
});

test('026R2 inactive built runtime is inert and caller CAPABILITY_READY cannot override Foundation truth', async (t) => {
  const root = makeScopedTempDirectory('026R2', 'inactive-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root, candidate(root));
  const project = projectFixture(root);
  enableProject(project, installationRoot);
  const bridge = await importCore('ai-bridge');
  const inactive = bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use'});
  assert.equal(inactive.state, 'inert');
  assert.equal(inactive.reason, 'CAPABILITY_NOT_INSTALLED');
  assert.equal(inactive.usable, false);
  const fabricated = bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use', capabilityStatus: {code: 'CAPABILITY_READY', capabilityId: CAPABILITY_ID, usable: true}});
  assert.equal(fabricated.state, 'inert');
  assert.equal(fabricated.reason, 'BRIDGE_INPUT_INVALID');
});

test('026R2 capability missing malformed integrity-invalid wrong-version and inactive states fail closed distinctly', async (t) => {
  const root = makeScopedTempDirectory('026R2', 'capability-state-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root, candidate(root));
  const project = projectFixture(root);
  enableProject(project, installationRoot);
  const bridge = await importCore('ai-bridge');
  const inspect = () => bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.equal(inspect().reason, 'CAPABILITY_NOT_INSTALLED');
  activateCapability(installationRoot);
  assert.equal(inspect().state, 'ready');
  const stateFile = path.join(installationRoot, 'state', 'capabilities.json');
  const valid = fs.readFileSync(stateFile);
  fs.writeFileSync(stateFile, '{malformed');
  assert.equal(inspect().reason, 'CAPABILITY_STATE_MALFORMED');
  fs.writeFileSync(stateFile, valid);
  const invalid = JSON.parse(valid.toString('utf8'));
  invalid.capabilities[CAPABILITY_ID].active = false;
  writeJson(stateFile, invalid);
  assert.equal(inspect().reason, 'CAPABILITY_STATE_INTEGRITY_INVALID');
  fs.writeFileSync(stateFile, valid);
  signedRewrite(stateFile, (payload) => { payload.capabilities[CAPABILITY_ID].version = '9.9.9'; });
  assert.equal(inspect().reason, 'CAPABILITY_IDENTITY_MISMATCH');
  fs.writeFileSync(stateFile, valid);
  signedRewrite(stateFile, (payload) => { payload.capabilities[CAPABILITY_ID].active = false; });
  assert.equal(inspect().reason, 'CAPABILITY_INACTIVE');
});

test('026R2 ready requires verified endpoint and rejects missing changed wrong-type and symlink endpoints', async (t) => {
  const root = makeScopedTempDirectory('026R2', 'endpoint-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root, candidate(root));
  const project = projectFixture(root);
  enableProject(project, installationRoot);
  activateCapability(installationRoot);
  const bridge = await importCore('ai-bridge');
  const inspect = () => bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.equal(inspect().state, 'ready');
  const current = inspectInstallation(installationRoot).current;
  const app = path.join(installationRoot, ...current.appPath.split('/'));
  const descriptor = JSON.parse(fs.readFileSync(path.join(app, 'foundation-runtime-descriptor.json'), 'utf8'));
  const endpoint = path.join(app, ...descriptor.ruleCapabilityEndpoint.path.split('/'));
  const backup = path.join(root, 'endpoint-backup');
  fs.cpSync(endpoint, backup, {recursive: true});
  fs.rmSync(endpoint, {recursive: true});
  assert.equal(inspect().reason, 'RUNTIME_ENDPOINT_MISSING');
  fs.cpSync(backup, endpoint, {recursive: true});
  fs.appendFileSync(path.join(endpoint, 'rules.json'), 'changed\n');
  assert.equal(inspect().reason, 'RUNTIME_ENDPOINT_IDENTITY_MISMATCH');
  fs.rmSync(endpoint, {recursive: true}); fs.cpSync(backup, endpoint, {recursive: true});
  fs.rmSync(endpoint, {recursive: true}); fs.writeFileSync(endpoint, 'wrong type\n');
  assert.equal(inspect().reason, 'RUNTIME_ENDPOINT_UNSAFE');
  fs.rmSync(endpoint); fs.symlinkSync(backup, endpoint);
  assert.equal(inspect().reason, 'RUNTIME_ENDPOINT_UNSAFE');
});

test('026R2 descriptor path escape and receipt-owned app tamper are distinct inert results', async (t) => {
  const root = makeScopedTempDirectory('026R2', 'unsafe-descriptor-');
  t.after(() => removeTempDirectory(root));
  const escaped = candidate(root, '0.2.0', 'artifacts/rules-0.2.0', {descriptorMutation(document) { document.ruleCapabilityEndpoint.path = '../outside'; return document; }});
  const installationRoot = install(root, escaped);
  const bridge = await importCore('ai-bridge');
  assert.equal(bridge.resolveFoundationBridgeContext({installationRoot, operationRequirement: 'lifecycle-inspect'}).reason, 'RUNTIME_ENDPOINT_UNSAFE');

  const healthyRoot = path.join(root, 'second-install');
  install(root, candidate(root, '0.2.1'), {installationRoot: healthyRoot});
  const current = inspectInstallation(healthyRoot).current;
  const template = path.join(healthyRoot, ...current.appPath.split('/'), 'templates', 'foundation-project', 'README.md');
  fs.appendFileSync(template, 'tampered\n');
  assert.equal(bridge.resolveFoundationBridgeContext({installationRoot: healthyRoot, operationRequirement: 'lifecycle-inspect'}).reason, 'FOUNDATION_CURRENT_RECEIPT_INVALID');
});

test('026R2 project binding and data compatibility are independent gates before ready', async (t) => {
  const root = makeScopedTempDirectory('026R2', 'project-gates-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root, candidate(root));
  activateCapability(installationRoot);
  const project = projectFixture(root);
  const bridge = await importCore('ai-bridge');
  const inspect = () => bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.equal(inspect().reason, 'PROJECT_DISABLED');
  enableProject(project, installationRoot);
  assert.equal(inspect().state, 'ready');
  const identity = path.join(project, '.foundation', 'identity', 'project.json');
  const value = JSON.parse(fs.readFileSync(identity, 'utf8'));
  value.dataFormatVersion = '9.0.0';
  writeJson(identity, value);
  assert.equal(inspect().reason, 'PROJECT_DATA_INCOMPATIBLE_READ_ONLY');
});

test('026R2 compatible 0.2 to 0.3 update follows endpoint and stales old task on endpoint or active identity change', async (t) => {
  const root = makeScopedTempDirectory('026R2', 'update-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root, candidate(root, '0.2.0', 'artifacts/rules-0.2'));
  activateCapability(installationRoot);
  const project = projectFixture(root);
  enableProject(project, installationRoot);
  const bridge = await importCore('ai-bridge');
  const resolve = () => bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  const ready020 = resolve();
  assert.equal(ready020.state, 'ready');
  const task = bridge.openFoundationBridgeTask({resolved: ready020});
  install(root, candidate(root, '0.3.0', 'artifacts/rules-0.3', {formats: ['0.1.0', '0.2.0']}), {operation: 'update', installationRoot});
  const ready030 = resolve();
  assert.equal(ready030.state, 'ready');
  assert.match(ready030.currentRuleEndpoint, /rules-0\.3$/u);
  assert.equal(bridge.inspectFoundationBridgeTask(task, {resolved: ready030}).state, 'stale');
  const task030 = bridge.openFoundationBridgeTask({resolved: ready030});
  signedRewrite(path.join(installationRoot, 'state', 'capabilities.json'), (payload) => { payload.capabilities[CAPABILITY_ID].active = false; });
  assert.equal(bridge.inspectFoundationBridgeTask(task030, {resolved: resolve()}).state, 'stale');
});

test('026R2 every ready and inert inspection is zero-write across installation project manager and outside sentinels', async (t) => {
  const root = makeScopedTempDirectory('026R2', 'zero-write-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root, candidate(root));
  activateCapability(installationRoot);
  const project = projectFixture(root);
  enableProject(project, installationRoot);
  const managerState = path.join(root, 'manager-state');
  fs.mkdirSync(managerState);
  fs.writeFileSync(path.join(managerState, 'sentinel'), 'manager\n');
  const outside = path.join(root, 'outside-sentinel');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel'), 'outside\n');
  const bridge = await importCore('ai-bridge');
  const before = {installation: hashDirectory(installationRoot), project: hashDirectory(project), manager: hashDirectory(managerState), outside: hashDirectory(outside)};
  const ready = bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.equal(ready.state, 'ready');
  const inert = bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: 'missing-capability'});
  assert.equal(inert.state, 'inert');
  const after = {installation: hashDirectory(installationRoot), project: hashDirectory(project), manager: hashDirectory(managerState), outside: hashDirectory(outside)};
  assert.deepEqual(after, before);
});
