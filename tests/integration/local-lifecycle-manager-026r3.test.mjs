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
  inspectLocalLifecycle,
  PROJECT_BINDING_VERSION,
  PROJECT_LAYOUT_VERSION,
  sha256,
} from '@foundation/core';
import {signTrustedPayload} from '../../packages/core/trusted-authority.mjs';
import {applyCapabilityForTest, applyLifecycleForTest, applyProjectForTest} from '../helpers/test-authorization.mjs';
import {prepareCurrentProjectLayoutFixture} from '../helpers/authorized-project-fixture.mjs';
import {makeScopedTempDirectory, projectFixturePath, removeTempDirectory, ROOT} from '../helpers/project-fixture.mjs';

const importCore = (name) => import(new URL(`../../packages/core/${name}.mjs`, import.meta.url));
const CAPABILITY_ID = 'ai-product-foundation-kit';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function actualCandidate() {
  const root = path.join(ROOT, '.tmp', 'candidates', `foundation-0.2.0-${process.platform}-${process.arch}`);
  assert.equal(fs.existsSync(root), true, 'run npm run candidate before the 026R3 focused gate');
  return {root, manifest: JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))};
}

function install(root, candidate = actualCandidate()) {
  const runtime = candidate.manifest.files.find((record) => record.path === candidate.manifest.runtime.path);
  const installationRoot = path.join(root, 'foundation-install');
  const plan = createLifecyclePlan({
    operation: 'install', profile: 'core', targetRoot: installationRoot, sandboxRoot: root,
    targetVersion: candidate.manifest.productVersion,
    candidate: {path: candidate.root, manifestHash: candidate.manifest.candidateHash, runtimeHash: runtime.sha256, bytes: candidate.manifest.totalBytes, version: candidate.manifest.productVersion},
    now: Date.now(),
  });
  applyLifecycleForTest(plan);
  return installationRoot;
}

function projectScopedCandidate(root) {
  const base = actualCandidate();
  const source = path.join(root, 'project-scoped-source');
  const app = path.join(source, 'app');
  fs.cpSync(path.join(base.root, 'payload', 'app'), app, {recursive: true});
  const manifestFile = path.join(app, 'artifacts', 'skills', CAPABILITY_ID, 'capability.json');
  const capability = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  capability.projectScoped = true;
  writeJson(manifestFile, capability);
  const descriptor = createFoundationRuntimeDescriptor({
    productVersion: base.manifest.productVersion,
    platform: process.platform,
    arch: process.arch,
    buildIdentity: '026R4-project-scoped-fixture',
    supportedProjectDataFormats: ['0.1.0', '0.1.1'],
    ruleCapabilityEndpoint: 'artifacts',
    ruleCapabilityEndpointRoot: path.join(app, 'artifacts'),
    capabilityFacts: {
      bundled: [{capabilityId: capability.capabilityId, type: capability.type, version: capability.version, manifestPath: `skills/${capability.capabilityId}/capability.json`, installed: true, active: false, projectScoped: true}],
      installedStateSource: 'state/capabilities.json',
      activeStateSource: 'state/capabilities.json',
      registrationStateSource: 'state/capability-host-registrations.json',
    },
  });
  writeJson(path.join(app, 'foundation-runtime-descriptor.json'), descriptor);
  const runtime = path.join(root, 'project-scoped-private-node');
  fs.copyFileSync(process.execPath, runtime);
  fs.chmodSync(runtime, 0o755);
  return buildCandidate({
    sourceRoot: source,
    outputRoot: path.join(root, 'project-scoped-candidate'),
    productVersion: base.manifest.productVersion,
    platform: process.platform,
    arch: process.arch,
    runtimeSource: runtime,
    entrypoint: 'app/packages/cli/index.mjs',
    sourceKind: 'local-test',
    buildIdentity: '026R4-project-scoped-fixture',
  });
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

let projectSequence = 0;
function projectFixture(root, label = 'project') {
  projectSequence += 1;
  const project = projectFixturePath(root, `${label}-${projectSequence}`);
  fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
  writeJson(path.join(project, '.foundation', 'foundation.json'), {projectId: `bridge-project-${projectSequence}`, dataFormatVersion: '0.1.0'});
  fs.writeFileSync(path.join(project, '.foundation', 'facts', 'sentinel.json'), '{"preserve":true}\n');
  fs.writeFileSync(path.join(project, 'README.md'), 'project sentinel\n');
  prepareCurrentProjectLayoutFixture(project);
  return project;
}

function enableProject(project, installationRoot) {
  applyProjectForTest(createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: Date.now()}));
}

function portableBindingOnly(project) {
  const identity = JSON.parse(fs.readFileSync(path.join(project, '.foundation', 'identity', 'project.json'), 'utf8'));
  writeJson(path.join(project, '.foundation', 'integration', 'binding.json'), {
    schemaVersion: '1.0.0', layoutVersion: PROJECT_LAYOUT_VERSION, bindingVersion: PROJECT_BINDING_VERSION,
    projectId: identity.projectId, identity: {scheme: 'foundation-project-id-v2', value: identity.projectId}, state: 'enabled',
    product: 'AI Product Foundation Kit', disabledBindingRetained: false,
  });
}

function rewriteSigned(file, mutate) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const {integrity: _integrity, ...payload} = document;
  mutate(payload);
  writeJson(file, {...payload, integrity: signTrustedPayload(payload)});
}

function corruptIntegrity(file) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  document.integrity.hash = '0'.repeat(64);
  writeJson(file, document);
}

test('026R3 project use requires explicit project and authoritative portable plus machine agreement', async (t) => {
  const root = makeScopedTempDirectory('026R3', 'project-required-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root);
  activateCapability(installationRoot);
  const bridge = await importCore('ai-bridge');

  const missing = bridge.resolveFoundationBridgeContext({installationRoot, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.equal(missing.state, 'inert');
  assert.equal(missing.reason, 'PROJECT_REQUIRED');

  const project = projectFixture(root, 'portable-only');
  portableBindingOnly(project);
  const result = bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.equal(result.state, 'inert');
  assert.equal(result.reason, 'PROJECT_AUTHORITY_MISMATCH');
  const lifecycle = inspectLocalLifecycle({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.notEqual(lifecycle.project.state, 'enabled');
  assert.equal(lifecycle.bridge.state, 'inert');
  const pluginWithProject = bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'plugin-use', capabilityId: CAPABILITY_ID});
  assert.equal(pluginWithProject.reason, 'PROJECT_AUTHORITY_MISMATCH');
});

test('026R3 copied moved disabled and corrupt registry project cases stay inert while exact agreement is ready', async (t) => {
  const root = makeScopedTempDirectory('026R3', 'project-matrix-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root);
  activateCapability(installationRoot);
  const bridge = await importCore('ai-bridge');
  const resolve = (project) => bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});

  const enabled = projectFixture(root, 'enabled');
  enableProject(enabled, installationRoot);
  assert.equal(resolve(enabled).state, 'ready');
  const exact = inspectLocalLifecycle({installationRoot, project: enabled, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.equal(exact.project.state, 'enabled');
  assert.equal(exact.project.agreement, true);
  assert.equal(exact.bridge.state, 'ready');

  const bindingFile = path.join(enabled, '.foundation', 'integration', 'binding.json');
  const bindingValid = fs.readFileSync(bindingFile);
  fs.rmSync(bindingFile);
  const machineOnly = inspectLocalLifecycle({installationRoot, project: enabled, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.notEqual(machineOnly.project.state, 'enabled');
  assert.equal(machineOnly.bridge.reason, 'PROJECT_DISABLED');
  fs.writeFileSync(bindingFile, bindingValid);

  const copied = projectFixturePath(root, 'copied');
  fs.cpSync(enabled, copied, {recursive: true});
  assert.equal(resolve(copied).reason, 'PROJECT_AUTHORITY_MISMATCH');

  const moveSource = projectFixture(root, 'move-source');
  enableProject(moveSource, installationRoot);
  const moved = projectFixturePath(root, 'moved');
  fs.renameSync(moveSource, moved);
  assert.equal(resolve(moved).reason, 'PROJECT_AUTHORITY_MISMATCH');

  const registryFile = path.join(installationRoot, 'state', 'projects.json');
  const registryValid = fs.readFileSync(registryFile);
  const enabledId = JSON.parse(fs.readFileSync(path.join(enabled, '.foundation', 'identity', 'project.json'), 'utf8')).projectId;
  rewriteSigned(registryFile, (payload) => { payload.projects[enabledId].state = 'disabled'; });
  assert.equal(resolve(enabled).reason, 'PROJECT_AUTHORITY_MISMATCH');
  fs.writeFileSync(registryFile, registryValid);

  const binding = JSON.parse(bindingValid.toString('utf8'));
  binding.state = 'disabled'; binding.disabledBindingRetained = true;
  writeJson(bindingFile, binding);
  assert.equal(resolve(enabled).reason, 'PROJECT_AUTHORITY_MISMATCH');
  rewriteSigned(registryFile, (payload) => {
    payload.projects[enabledId].state = 'disabled';
    payload.projects[enabledId].portableBindingHash = sha256(fs.readFileSync(bindingFile));
  });
  const disabled = inspectLocalLifecycle({installationRoot, project: enabled, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.equal(disabled.project.state, 'disabled');
  assert.equal(disabled.project.agreement, true);
  assert.equal(disabled.bridge.reason, 'PROJECT_DISABLED');
  fs.writeFileSync(bindingFile, bindingValid);
  fs.writeFileSync(registryFile, registryValid);

  fs.writeFileSync(bindingFile, '{malformed');
  assert.equal(resolve(enabled).reason, 'PROJECT_AUTHORITY_MISMATCH');
  fs.writeFileSync(bindingFile, bindingValid);

  rewriteSigned(registryFile, (payload) => { payload.projects[enabledId].realPath = path.join(root, 'wrong-project'); });
  assert.equal(resolve(enabled).reason, 'PROJECT_AUTHORITY_MISMATCH');
  fs.writeFileSync(registryFile, registryValid);
  rewriteSigned(registryFile, (payload) => { payload.projects[enabledId].projectIdentity.inode = '0'; });
  assert.equal(resolve(enabled).reason, 'PROJECT_AUTHORITY_MISMATCH');
  fs.writeFileSync(registryFile, registryValid);

  fs.rmSync(registryFile);
  assert.equal(resolve(enabled).reason, 'PROJECT_AUTHORITY_MISMATCH');
  fs.writeFileSync(registryFile, registryValid);
  fs.writeFileSync(registryFile, '{malformed');
  assert.equal(resolve(enabled).reason, 'PROJECT_AUTHORITY_MISMATCH');
  assert.doesNotThrow(() => inspectLocalLifecycle({installationRoot, project: enabled, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID}));
  fs.writeFileSync(registryFile, registryValid);
  corruptIntegrity(registryFile);
  assert.equal(resolve(enabled).reason, 'PROJECT_AUTHORITY_MISMATCH');
  fs.writeFileSync(registryFile, registryValid);
  rewriteSigned(registryFile, (payload) => { payload.installId = 'stale-install'; });
  assert.equal(resolve(enabled).reason, 'PROJECT_AUTHORITY_MISMATCH');
  fs.writeFileSync(registryFile, registryValid);

  assert.equal(resolve(ROOT).state, 'inert');
  assert.equal(resolve(installationRoot).state, 'inert');
  assert.equal(resolve(path.join(ROOT, 'templates')).state, 'inert');
  assert.equal(resolve(path.join(ROOT, 'examples')).state, 'inert');
  assert.equal(resolve(actualCandidate().root).state, 'inert');
});

test('026R4 project-scoped capability requires two-sided project authority for Skill and Plugin use', async (t) => {
  const root = makeScopedTempDirectory('026R4', 'project-scoped-capability-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root, projectScopedCandidate(root));
  activateCapability(installationRoot);
  const bridge = await importCore('ai-bridge');
  for (const operationRequirement of ['project-skill-use', 'plugin-use']) {
    const missing = bridge.resolveFoundationBridgeContext({installationRoot, operationRequirement, capabilityId: CAPABILITY_ID});
    assert.equal(missing.reason, 'PROJECT_REQUIRED', operationRequirement);
  }
  const project = projectFixture(root, 'project-scoped');
  portableBindingOnly(project);
  assert.equal(bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'plugin-use', capabilityId: CAPABILITY_ID}).reason, 'PROJECT_AUTHORITY_MISMATCH');
  enableProject(project, installationRoot);
  assert.equal(bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'plugin-use', capabilityId: CAPABILITY_ID}).state, 'ready');
});

test('026R3 strict signed capability state and registration identities fail closed with structured codes', async (t) => {
  const root = makeScopedTempDirectory('026R3', 'capability-matrix-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root);
  activateCapability(installationRoot);
  const bridge = await importCore('ai-bridge');
  const resolve = () => bridge.resolveFoundationBridgeContext({installationRoot, operationRequirement: 'plugin-use', capabilityId: CAPABILITY_ID});
  assert.equal(resolve().state, 'ready');

  const stateFile = path.join(installationRoot, 'state', 'capabilities.json');
  const registrationFile = path.join(installationRoot, 'state', 'capability-host-registrations.json');
  const validState = fs.readFileSync(stateFile);
  const validRegistration = fs.readFileSync(registrationFile);
  assert.equal(typeof JSON.parse(validState.toString('utf8')).capabilities[CAPABILITY_ID].installed, 'boolean');

  const stateCases = [
    ['top install', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.installId = 'wrong-install'; }],
    ['schema', 'CAPABILITY_STATE_SCHEMA_INVALID', (p) => { p.schemaVersion = '9.0.0'; }],
    ['map type', 'CAPABILITY_STATE_SCHEMA_INVALID', (p) => { p.capabilities = []; }],
    ['internal id', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].capabilityId = 'wrong'; }],
    ['missing internal id', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { delete p.capabilities[CAPABILITY_ID].capabilityId; }],
    ['type', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].type = 'plugin'; }],
    ['version', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].version = '9.0.0'; }],
    ['content', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].contentHash = '0'.repeat(64); }],
    ['record install', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].foundationInstallId = 'wrong'; }],
    ['project scoped', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].projectScoped = true; }],
    ['required Foundation', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].requiredFoundationVersion = '>=9.0.0'; }],
    ['file inventory', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].files[0].sha256 = '0'.repeat(64); }],
    ['dependency identity', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].dependencies = ['unexpected-dependency']; }],
    ['type primitive', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].type = null; }],
    ['version primitive', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].version = 2; }],
    ['content primitive', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].contentHash = false; }],
    ['record install primitive', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].foundationInstallId = []; }],
    ['project scope primitive', 'CAPABILITY_STATE_SCHEMA_INVALID', (p) => { p.capabilities[CAPABILITY_ID].projectScoped = 'false'; }],
    ['required Foundation primitive', 'CAPABILITY_IDENTITY_MISMATCH', (p) => { p.capabilities[CAPABILITY_ID].requiredFoundationVersion = null; }],
    ['file inventory primitive', 'CAPABILITY_STATE_SCHEMA_INVALID', (p) => { p.capabilities[CAPABILITY_ID].files = {}; }],
    ['dependency primitive', 'CAPABILITY_STATE_SCHEMA_INVALID', (p) => { p.capabilities[CAPABILITY_ID].dependencies = {}; }],
    ['installed false', 'CAPABILITY_NOT_INSTALLED', (p) => { p.capabilities[CAPABILITY_ID].installed = false; }],
    ['active false', 'CAPABILITY_INACTIVE', (p) => { p.capabilities[CAPABILITY_ID].active = false; }],
    ['unexpected record field', 'CAPABILITY_STATE_SCHEMA_INVALID', (p) => { p.capabilities[CAPABILITY_ID].unexpected = true; }],
    ['installed shape', 'CAPABILITY_STATE_SCHEMA_INVALID', (p) => { p.capabilities[CAPABILITY_ID].installed = 1; }],
    ['active shape', 'CAPABILITY_STATE_SCHEMA_INVALID', (p) => { p.capabilities[CAPABILITY_ID].active = 1; }],
  ];
  for (const [label, code, mutate] of stateCases) {
    fs.writeFileSync(stateFile, validState); rewriteSigned(stateFile, mutate);
    const result = resolve();
    assert.equal(result.state, 'inert', label); assert.equal(result.reason, code, label);
  }
  fs.writeFileSync(stateFile, '{malformed'); assert.equal(resolve().reason, 'CAPABILITY_STATE_MALFORMED');
  fs.writeFileSync(stateFile, validState); corruptIntegrity(stateFile); assert.equal(resolve().reason, 'CAPABILITY_STATE_INTEGRITY_INVALID');
  fs.writeFileSync(stateFile, validState);

  fs.rmSync(stateFile); assert.equal(resolve().reason, 'CAPABILITY_NOT_INSTALLED');
  fs.writeFileSync(stateFile, validState);
  const stateTarget = path.join(path.dirname(stateFile), 'capabilities-target.json');
  fs.writeFileSync(stateTarget, validState); fs.rmSync(stateFile); fs.symlinkSync(stateTarget, stateFile);
  assert.equal(resolve().reason, 'CAPABILITY_STATE_UNSAFE');
  fs.rmSync(stateFile); fs.writeFileSync(stateFile, validState); fs.rmSync(stateTarget);

  const validRegistrationDocument = JSON.parse(validRegistration.toString('utf8'));
  assert.equal(validRegistrationDocument.registrations[CAPABILITY_ID].type, 'codex-skill');
  assert.equal(validRegistrationDocument.registrations[CAPABILITY_ID].version, '0.2.0');
  assert.equal(validRegistrationDocument.registrations[CAPABILITY_ID].projectScoped, false);

  const registrationCases = [
    ['top install', (p) => { p.installId = 'wrong'; }],
    ['schema', (p) => { p.schemaVersion = '9.0.0'; }],
    ['map type', (p) => { p.registrations = []; }],
    ['internal id', (p) => { p.registrations[CAPABILITY_ID].capabilityId = 'wrong'; }],
    ['missing internal id', (p) => { delete p.registrations[CAPABILITY_ID].capabilityId; }],
    ['type', (p) => { p.registrations[CAPABILITY_ID].type = 'plugin'; }],
    ['version', (p) => { p.registrations[CAPABILITY_ID].version = '9.0.0'; }],
    ['project scope', (p) => { p.registrations[CAPABILITY_ID].projectScoped = true; }],
    ['content', (p) => { p.registrations[CAPABILITY_ID].contentHash = '0'.repeat(64); }],
    ['record install', (p) => { p.registrations[CAPABILITY_ID].foundationInstallId = 'wrong'; }],
    ['host', (p) => { p.registrations[CAPABILITY_ID].hostRegistrationIdentity = 'wrong'; }],
    ['type primitive', (p) => { p.registrations[CAPABILITY_ID].type = null; }],
    ['version primitive', (p) => { p.registrations[CAPABILITY_ID].version = []; }],
    ['project scope primitive', (p) => { p.registrations[CAPABILITY_ID].projectScoped = 'false'; }],
    ['content primitive', (p) => { p.registrations[CAPABILITY_ID].contentHash = 1; }],
    ['record install primitive', (p) => { p.registrations[CAPABILITY_ID].foundationInstallId = {}; }],
    ['host primitive', (p) => { p.registrations[CAPABILITY_ID].hostRegistrationIdentity = []; }],
    ['registered time primitive', (p) => { p.registrations[CAPABILITY_ID].registeredAt = 'now'; }],
    ['active shape', (p) => { p.registrations[CAPABILITY_ID].active = 1; }],
    ['unexpected record field', (p) => { p.registrations[CAPABILITY_ID].unexpected = true; }],
  ];
  for (const [label, mutate] of registrationCases) {
    fs.writeFileSync(registrationFile, validRegistration); rewriteSigned(registrationFile, mutate);
    const result = resolve();
    assert.equal(result.state, 'inert', label); assert.equal(result.reason, 'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH', label);
  }
  fs.writeFileSync(registrationFile, '{malformed'); assert.equal(resolve().reason, 'CAPABILITY_REGISTRATION_STATE_MALFORMED');
  fs.writeFileSync(registrationFile, validRegistration); corruptIntegrity(registrationFile); assert.equal(resolve().reason, 'CAPABILITY_REGISTRATION_STATE_INTEGRITY_INVALID');
  fs.writeFileSync(registrationFile, validRegistration);
  fs.rmSync(registrationFile); assert.equal(resolve().reason, 'CAPABILITY_NOT_REGISTERED');
  fs.writeFileSync(registrationFile, validRegistration);
  const registrationTarget = path.join(path.dirname(registrationFile), 'registrations-target.json');
  fs.writeFileSync(registrationTarget, validRegistration); fs.rmSync(registrationFile); fs.symlinkSync(registrationTarget, registrationFile);
  assert.equal(resolve().reason, 'CAPABILITY_STATE_UNSAFE');
  fs.rmSync(registrationFile); fs.writeFileSync(registrationFile, validRegistration); fs.rmSync(registrationTarget);
  rewriteSigned(registrationFile, (p) => { delete p.registrations[CAPABILITY_ID]; }); assert.equal(resolve().reason, 'CAPABILITY_NOT_REGISTERED');
  fs.writeFileSync(registrationFile, validRegistration);
  rewriteSigned(registrationFile, (p) => { p.registrations[CAPABILITY_ID].active = false; }); assert.equal(resolve().reason, 'CAPABILITY_INACTIVE');
});

test('026R3 validated authority changes stale tasks and every inspection is zero-write', async (t) => {
  const root = makeScopedTempDirectory('026R3', 'stale-zero-write-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = install(root);
  activateCapability(installationRoot);
  const project = projectFixture(root, 'ready');
  enableProject(project, installationRoot);
  const manager = path.join(root, 'manager-state');
  const outside = path.join(root, 'outside-sentinel');
  fs.mkdirSync(manager); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(manager, 'sentinel'), 'manager\n');
  fs.writeFileSync(path.join(outside, 'sentinel'), 'outside\n');
  const bridge = await importCore('ai-bridge');
  const resolve = () => bridge.resolveFoundationBridgeContext({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  const ready = resolve();
  assert.equal(ready.state, 'ready');
  const task = bridge.openFoundationBridgeTask({resolved: ready});

  const registrationFile = path.join(installationRoot, 'state', 'capability-host-registrations.json');
  const valid = fs.readFileSync(registrationFile);
  rewriteSigned(registrationFile, (payload) => { payload.unexpectedValidatedAuthorityField = 'changed'; });
  const changed = resolve();
  assert.equal(changed.state, 'inert');
  assert.equal(bridge.inspectFoundationBridgeTask(task, {resolved: changed}).state, 'stale');
  fs.writeFileSync(registrationFile, valid);

  const before = {installation: hashDirectory(installationRoot), project: hashDirectory(project), manager: hashDirectory(manager), outside: hashDirectory(outside), state: sha256(fs.readFileSync(path.join(installationRoot, 'state', 'capabilities.json'))), registration: sha256(fs.readFileSync(registrationFile))};
  assert.equal(resolve().state, 'ready');
  assert.equal(bridge.resolveFoundationBridgeContext({installationRoot, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID}).reason, 'PROJECT_REQUIRED');
  assert.equal(bridge.resolveFoundationBridgeContext({installationRoot, operationRequirement: 'plugin-use', capabilityId: 'missing'}).state, 'inert');
  const after = {installation: hashDirectory(installationRoot), project: hashDirectory(project), manager: hashDirectory(manager), outside: hashDirectory(outside), state: sha256(fs.readFileSync(path.join(installationRoot, 'state', 'capabilities.json'))), registration: sha256(fs.readFileSync(registrationFile))};
  assert.deepEqual(after, before);
  assert.notEqual(sha256(canonicalStringify(task.binding)), sha256(canonicalStringify({state: 'changed'})));
});
