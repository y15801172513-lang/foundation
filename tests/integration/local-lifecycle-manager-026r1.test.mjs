import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import test from 'node:test';

import {buildCandidate, canonicalStringify, createCapabilityPlan, createFoundationRuntimeDescriptor, createLifecyclePlan, createProjectAuthorityPlan, hashDirectory, inspectInstallation, sha256} from '@foundation/core';
import {makeScopedTempDirectory, projectFixturePath, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {applyCapabilityForTest} from '../helpers/test-authorization.mjs';

const importCore = (name) => import(new URL(`../../packages/core/${name}.mjs`, import.meta.url));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(prefix) {
  const root = makeScopedTempDirectory('026R1', prefix);
  const project = projectFixturePath(root, 'project');
  const stateRoot = path.join(root, 'manager-state');
  fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
  writeJson(path.join(project, '.foundation', 'foundation.json'), {projectId: 'legacy-project', dataFormatVersion: '0.1.0'});
  writeJson(path.join(project, '.foundation', 'facts', 'project.json'), {items: [{id: 'fact', value: 'preserve'}]});
  fs.mkdirSync(path.join(project, 'src'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src', 'index.js'), 'export const project = true;\n');
  return {root, project, stateRoot};
}

function request(port, {method = 'GET', pathname = '/', headers = {}, body = ''} = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({host: '127.0.0.1', port, method, path: pathname, headers}, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

async function confirm(plan, stateRoot, action = 'confirm-exact-operation') {
  const {createLocalLifecycleManagerServer} = await importCore('lifecycle-manager-host');
  const server = createLocalLifecycleManagerServer({plan, stateRoot});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const port = server.address().port;
    const page = await request(port);
    const managerNonce = /name="managerNonce" value="([^"]+)"/u.exec(page.body)?.[1];
    const response = await request(port, {method: 'POST', pathname: '/__foundation/manager/confirm', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`}, body: JSON.stringify({managerNonce, action})});
    return {page: page.body, response};
  } finally { server.close(); }
}

async function migrate(project, stateRoot) {
  const layout = await importCore('project-layout');
  const result = await confirm(layout.createProjectLayoutMigrationPlan({project}), stateRoot);
  assert.equal(result.response.status, 200, result.response.body);
  return layout;
}

test('026R1 failing-first: uninstall classification preserves unknown modified nested and unsafe leaves', async (t) => {
  const {root, project, stateRoot} = fixture('leaf-classification-');
  t.after(() => removeTempDirectory(root));
  const layout = await migrate(project, stateRoot);
  const cache = path.join(project, '.foundation', 'generated-cache');
  const integration = path.join(project, '.foundation', 'integration');
  fs.writeFileSync(path.join(cache, 'generated.json'), '{"generated":true}\n');
  const generatedBytes = fs.readFileSync(path.join(cache, 'generated.json'));
  const ownershipFile = path.join(project, '.foundation', 'ownership.json');
  const ownership = JSON.parse(fs.readFileSync(ownershipFile, 'utf8'));
  ownership.ownedLeaves = [...(ownership.ownedLeaves || []), {path: '.foundation/generated-cache/generated.json', kind: 'generated-cache', type: 'file', sha256: sha256(generatedBytes), byteLength: generatedBytes.length}];
  const {integrity: _previousIntegrity, ...ownershipPayload} = ownership;
  ownership.integrity = {algorithm: 'sha256', hash: sha256(canonicalStringify(ownershipPayload))};
  writeJson(ownershipFile, ownership);
  fs.writeFileSync(path.join(cache, 'generated.json'), '{"user":"modified"}\n');
  fs.writeFileSync(path.join(cache, 'user-added.txt'), 'keep user cache content\n');
  fs.mkdirSync(path.join(integration, 'nested'), {recursive: true});
  fs.writeFileSync(path.join(integration, 'nested', 'unknown.txt'), 'keep nested unknown\n');
  fs.symlinkSync('../facts/project.json', path.join(cache, 'unsafe-link'));
  const resultFile = path.join(root, 'residual-result.json');
  const plan = layout.createNormalUninstallProjectPlan({projects: [{projectId: 'legacy-project', realPath: project}], resultFile});
  const classifications = plan.accessible[0].ownershipClassification;
  assert.ok(classifications.some((entry) => entry.path.endsWith('generated.json') && entry.classification === 'owned-but-modified'));
  assert.ok(classifications.some((entry) => entry.path.endsWith('user-added.txt') && entry.classification === 'unknown-or-untracked'));
  assert.ok(classifications.some((entry) => entry.path.endsWith('nested/unknown.txt') && entry.classification === 'unknown-or-untracked'));
  assert.ok(classifications.some((entry) => entry.path.endsWith('unsafe-link') && entry.classification === 'unsafe-type-or-symlink'));
  assert.equal(plan.accessible[0].removeOwned.includes('.foundation/generated-cache'), false);
  const applied = await confirm(plan, path.join(root, 'detach-manager'), 'continue-accessible-with-residuals');
  assert.equal(applied.response.status, 200, applied.response.body);
  assert.equal(fs.readFileSync(path.join(cache, 'generated.json'), 'utf8'), '{"user":"modified"}\n');
  assert.equal(fs.readFileSync(path.join(cache, 'user-added.txt'), 'utf8'), 'keep user cache content\n');
  assert.equal(fs.readFileSync(path.join(integration, 'nested', 'unknown.txt'), 'utf8'), 'keep nested unknown\n');
  assert.equal(fs.lstatSync(path.join(cache, 'unsafe-link')).isSymbolicLink(), true);
  const residualResult = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  for (const classification of ['owned-but-modified', 'unknown-or-untracked', 'unsafe-type-or-symlink']) assert.ok(residualResult.residuals.some((entry) => entry.classification === classification), classification);
});

test('026R1 failing-first: missing or tampered ownership authorizes no recursive deletion', async (t) => {
  const {root, project, stateRoot} = fixture('manifest-invalid-');
  t.after(() => removeTempDirectory(root));
  const layout = await migrate(project, stateRoot);
  const userFile = path.join(project, '.foundation', 'generated-cache', 'user.txt');
  fs.writeFileSync(userFile, 'keep\n');
  fs.rmSync(path.join(project, '.foundation', 'ownership.json'));
  const missing = layout.createNormalUninstallProjectPlan({projects: [{projectId: 'legacy-project', realPath: project}]});
  assert.deepEqual(missing.accessible[0].removeOwned, []);
  assert.ok(missing.residuals.some((entry) => entry.reason === 'OWNERSHIP_MANIFEST_MISSING'));
  writeJson(path.join(project, '.foundation', 'ownership.json'), {schemaVersion: '1.0.0', layoutVersion: '2.0.0', projectId: 'legacy-project', ownedLeaves: [], integrity: {algorithm: 'sha256', hash: '0'.repeat(64)}});
  const tampered = layout.createNormalUninstallProjectPlan({projects: [{projectId: 'legacy-project', realPath: project}]});
  assert.deepEqual(tampered.accessible[0].removeOwned, []);
  assert.ok(tampered.residuals.some((entry) => entry.reason === 'OWNERSHIP_MANIFEST_TAMPERED'));
  assert.equal(fs.readFileSync(userFile, 'utf8'), 'keep\n');
});

test('026R1 failing-first: clean plan followed by leaf drift is zero target writes', async (t) => {
  const {root, project, stateRoot} = fixture('preapply-drift-');
  t.after(() => removeTempDirectory(root));
  const layout = await migrate(project, stateRoot);
  const binding = path.join(project, '.foundation', 'integration', 'binding.json');
  const plan = layout.createNormalUninstallProjectPlan({projects: [{projectId: 'legacy-project', realPath: project}]});
  fs.appendFileSync(binding, '\n');
  const drifted = hashDirectory(project);
  const result = await confirm(plan, path.join(root, 'detach-state'));
  assert.equal(result.response.status, 409, result.response.body);
  assert.equal(JSON.parse(result.response.body).code, 'MANAGER_PLAN_STATE_DRIFT');
  assert.equal(hashDirectory(project), drifted);
});

test('026R1 failing-first: project transaction protocol declares every durable checkpoint', async () => {
  const transaction = await importCore('project-transaction');
  assert.deepEqual(transaction.PROJECT_TRANSACTION_CHECKPOINTS, [
    'after-exclusive-guard',
    'after-durable-pre-intent',
    'after-snapshot-durable',
    'after-confirmation-consume',
    'after-target-apply',
    'after-postcondition-verify',
    'after-durable-completion',
  ]);
  assert.equal(typeof transaction.inspectProjectTransactions, 'function');
  assert.equal(typeof transaction.recoverProjectTransactions, 'function');
});

test('026R1 failing-first: manager UI renders explicit modified unknown residual inventory', async (t) => {
  const {root, project, stateRoot} = fixture('ui-residual-');
  t.after(() => removeTempDirectory(root));
  const layout = await migrate(project, stateRoot);
  fs.writeFileSync(path.join(project, '.foundation', 'generated-cache', 'user-visible.txt'), 'preserve me\n');
  const plan = layout.createNormalUninstallProjectPlan({projects: [{projectId: 'legacy-project', realPath: project}], resultFile: path.join(root, 'residual.json')});
  const {page} = await confirm(plan, path.join(root, 'ui-state'), 'cancel-no-change');
  assert.match(page, /legacy-project/u);
  assert.match(page, /expected-before SHA-256 [0-9a-f]{64}/u);
  assert.match(page, /user-visible\.txt/u);
  assert.match(page, /unknown-or-untracked/u);
  assert.match(page, /预期状态|expected-before/u);
  assert.equal(fs.readFileSync(path.join(project, '.foundation', 'generated-cache', 'user-visible.txt'), 'utf8'), 'preserve me\n');
});

test('026R1 failing-first: open-manager accepts only opaque planRef and rejects raw plan controls', async () => {
  const manager = await importCore('lifecycle-manager');
  for (const invalid of [
    {plan: {}},
    {path: '/tmp/plan.json'},
    {targetRoot: '/tmp/target'},
    {planRef: 'not-an-opaque-reference', action: 'confirm-exact-operation'},
  ]) assert.throws(() => manager.openLocalLifecycleManagerPlan(invalid), (error) => ['MANAGER_PLAN_REF_REQUIRED', 'MANAGER_PLAN_REF_INVALID', 'MANAGER_OPEN_INPUT_INVALID'].includes(error?.code));
});

test('026R1 four-operation handoff: request-plan to open-manager to status writes only manager state', async (t) => {
  const {root, project, stateRoot} = fixture('four-operation-');
  t.after(() => removeTempDirectory(root));
  const manager = await importCore('lifecycle-manager');
  const targetBefore = hashDirectory(project);
  const inspected = manager.inspectLocalLifecycle({project});
  assert.equal(inspected.mutationPerformed, false);
  assert.equal(hashDirectory(project), targetBefore);
  const marker = path.join(root, 'handoff-server.json');
  const worker = path.join(path.resolve(import.meta.dirname, '../..'), 'tests', 'fixtures', 'manager-handoff-worker-026r1.mjs');
  const loader = `--import=${path.join(path.resolve(import.meta.dirname, '../..'), 'tests', 'helpers', 'register-test-host.mjs')}`;
  const server = spawn(process.execPath, [worker, 'serve', project, '', marker], {cwd: path.resolve(import.meta.dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, NODE_OPTIONS: loader, PATH: '', FOUNDATION_TEST_MANAGER_STATE_ROOT: stateRoot}});
  t.after(() => { if (!server.killed) server.kill('SIGTERM'); });
  await waitForFile(marker);
  const {requested, port} = JSON.parse(fs.readFileSync(marker, 'utf8'));
  assert.match(requested.planRef, /^foundation-plan-[0-9a-f]{64}$/u);
  assert.equal('plan' in requested, false);
  assert.equal(requested.managerStateMutationPerformed, true);
  assert.equal(hashDirectory(project), targetBefore);
  const managerAfterRequest = hashDirectory(stateRoot);
  assert.equal(hashDirectory(project), targetBefore);
  const statusBefore = hashDirectory(stateRoot);
  const statusRun = spawnSync(process.execPath, [worker, 'status', project, requested.planRef, marker], {cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8', env: {...process.env, NODE_OPTIONS: loader, PATH: '', FOUNDATION_TEST_MANAGER_STATE_ROOT: stateRoot}});
  assert.equal(statusRun.status, 0, statusRun.stderr);
  assert.equal(JSON.parse(statusRun.stdout).state, 'preview');
  assert.equal(hashDirectory(stateRoot), statusBefore);
  const preview = await request(port);
  const managerNonce = /name="managerNonce" value="([^"]+)"/u.exec(preview.body)?.[1];
  const cancelled = await request(port, {method: 'POST', pathname: '/__foundation/manager/confirm', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`}, body: JSON.stringify({managerNonce, action: 'cancel-no-change'})});
  assert.equal(cancelled.status, 200);
  const cancelledStatus = spawnSync(process.execPath, [worker, 'status', project, requested.planRef, marker], {cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8', env: {...process.env, NODE_OPTIONS: loader, PATH: '', FOUNDATION_TEST_MANAGER_STATE_ROOT: stateRoot}});
  assert.equal(JSON.parse(cancelledStatus.stdout).state, 'cancelled');
  assert.equal(hashDirectory(project), targetBefore);
  assert.notEqual(hashDirectory(stateRoot), managerAfterRequest);
  server.kill('SIGTERM');
  await collectChild(server);
});

test('026R1 manager drift invalidates the old confirmation and reloads a newly generated exact preview', async (t) => {
  const {root, project, stateRoot} = fixture('drift-repreview-');
  t.after(() => removeTempDirectory(root));
  const marker = path.join(root, 'handoff-server.json');
  const worker = path.join(path.resolve(import.meta.dirname, '../..'), 'tests', 'fixtures', 'manager-handoff-worker-026r1.mjs');
  const loader = `--import=${path.join(path.resolve(import.meta.dirname, '../..'), 'tests', 'helpers', 'register-test-host.mjs')}`;
  const server = spawn(process.execPath, [worker, 'serve', project, '', marker], {cwd: path.resolve(import.meta.dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, NODE_OPTIONS: loader, PATH: '', FOUNDATION_TEST_MANAGER_STATE_ROOT: stateRoot}});
  t.after(() => { if (!server.killed) server.kill('SIGTERM'); });
  await waitForFile(marker);
  const {requested, port} = JSON.parse(fs.readFileSync(marker, 'utf8'));
  const originalPage = await request(port);
  const originalStatus = JSON.parse((await request(port, {pathname:'/__foundation/manager/status'})).body);
  const originalNonce = /name="managerNonce" value="([^"]+)"/u.exec(originalPage.body)?.[1];
  fs.appendFileSync(path.join(project, 'src', 'index.js'), '// drift before confirmation\n');
  const targetAtDrift = hashDirectory(project);
  const rejected = await request(port, {method: 'POST', pathname: '/__foundation/manager/confirm', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`}, body: JSON.stringify({managerNonce: originalNonce, action: 'confirm-exact-operation'})});
  assert.equal(rejected.status, 409, rejected.body);
  const failure = JSON.parse(rejected.body);
  assert.equal(failure.code, 'MANAGER_PLAN_STATE_DRIFT');
  const sameOperation = await request(port, {pathname:'/__foundation/manager/status?session-id='+originalStatus.sessionId});
  assert.equal(JSON.parse(sameOperation.body).sessionId, originalStatus.sessionId);
  assert.equal(JSON.parse(sameOperation.body).state, 'failed');
  assert.match(failure.replacementPlanRef, /^foundation-plan-[0-9a-f]{64}$/u);
  assert.notEqual(failure.replacementPlanRef, requested.planRef);
  assert.equal(hashDirectory(project), targetAtDrift);
  const replacementPage = await request(port);
  assert.match(replacementPage.body, new RegExp(failure.replacementPlanRef, 'u'));
  const replacementNonce = /name="managerNonce" value="([^"]+)"/u.exec(replacementPage.body)?.[1];
  assert.notEqual(replacementNonce, originalNonce);
  const oldStatus = spawnSync(process.execPath, [worker, 'status', project, requested.planRef, marker], {cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8', env: {...process.env, NODE_OPTIONS: loader, PATH: '', FOUNDATION_TEST_MANAGER_STATE_ROOT: stateRoot}});
  const newStatus = spawnSync(process.execPath, [worker, 'status', project, failure.replacementPlanRef, marker], {cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8', env: {...process.env, NODE_OPTIONS: loader, PATH: '', FOUNDATION_TEST_MANAGER_STATE_ROOT: stateRoot}});
  assert.equal(JSON.parse(oldStatus.stdout).state, 'failed');
  assert.equal(JSON.parse(newStatus.stdout).state, 'preview');
  server.kill('SIGTERM');
  await collectChild(server);
});

test('026R1 version-neutral bridge follows compatible 0.2 to 0.3 descriptor and fails inert', async (t) => {
  const {root, project: legacyProject} = fixture('bridge-descriptor-');
  t.after(() => removeTempDirectory(root));
  const project = legacyProject;
  const runtime = path.join(root, 'private-node');
  fs.copyFileSync(process.execPath, runtime); fs.chmodSync(runtime, 0o755);
  const candidate = (version, formats, endpoint) => {
    const source = path.join(root, `source-${version}`);
    fs.mkdirSync(path.join(source, 'app'), {recursive: true});
    fs.writeFileSync(path.join(source, 'app', 'foundation-smoke.mjs'), `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))\n`);
    const endpointRelative = `artifacts/${endpoint}`;
    const endpointRoot = path.join(source, 'app', ...endpointRelative.split('/'));
    const capabilityRoot = path.join(endpointRoot, 'skills', 'ai-product-foundation-kit');
    fs.mkdirSync(capabilityRoot, {recursive: true});
    fs.writeFileSync(path.join(endpointRoot, 'rules.json'), '{}\n');
    fs.copyFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'skills', 'ai-product-foundation-kit', 'SKILL.md'), path.join(capabilityRoot, 'SKILL.md'));
    fs.copyFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'skills', 'ai-product-foundation-kit', 'capability.json'), path.join(capabilityRoot, 'capability.json'));
    fs.writeFileSync(path.join(source, 'app', 'foundation-runtime-descriptor.json'), `${JSON.stringify(createFoundationRuntimeDescriptor({productVersion: version, platform: process.platform, arch: process.arch, buildIdentity: `test-${version}`, supportedProjectDataFormats: formats, ruleCapabilityEndpoint: endpointRelative, ruleCapabilityEndpointRoot: endpointRoot, capabilityFacts: {bundled: [{capabilityId: 'ai-product-foundation-kit', type: 'codex-skill', version: '0.2.0', manifestPath: 'skills/ai-product-foundation-kit/capability.json', installed: true, active: false, projectScoped: false}], installedStateSource: 'state/capabilities.json', activeStateSource: 'state/capabilities.json', registrationStateSource: 'state/capability-host-registrations.json'}}), null, 2)}\n`);
    fs.cpSync(path.join(path.resolve(import.meta.dirname, '../..'), 'templates'), path.join(source, 'app', 'templates'), {recursive: true});
    const built = buildCandidate({sourceRoot: source, outputRoot: path.join(root, `candidate-${version}`), productVersion: version, platform: process.platform, arch: process.arch, runtimeSource: runtime, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
    const runtimeRecord = built.manifest.files.find((entry) => entry.path === built.manifest.runtime.path);
    return {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: runtimeRecord.sha256, bytes: built.manifest.totalBytes, version};
  };
  const installationRoot = path.join(root, 'foundation-install');
  const c020 = candidate('0.2.0', ['0.1.0'], 'rules-0.2');
  const installPlan = createLifecyclePlan({operation: 'install', targetRoot: installationRoot, sandboxRoot: root, targetVersion: '0.2.0', candidate: c020});
  assert.equal((await confirm(installPlan, path.join(root, 'install-manager'))).response.status, 200);
  const layout = await migrate(project, path.join(root, 'migrate-manager'));
  const enable = createProjectAuthorityPlan({operation: 'enable', project, installationRoot});
  assert.equal((await confirm(enable, path.join(root, 'enable-manager'))).response.status, 200);
  const activate = () => {
    const current = inspectInstallation(installationRoot).current;
    const descriptor = JSON.parse(fs.readFileSync(path.join(installationRoot, ...current.appPath.split('/'), 'foundation-runtime-descriptor.json'), 'utf8'));
    const manifestFile = path.join(installationRoot, ...current.appPath.split('/'), ...descriptor.ruleCapabilityEndpoint.path.split('/'), 'skills', 'ai-product-foundation-kit', 'capability.json');
    for (const operation of ['install', 'register', 'activate']) applyCapabilityForTest(createCapabilityPlan({operation, installationRoot, manifestFile}));
  };
  activate();
  const bridge = await importCore('ai-bridge');
  const ready020 = bridge.resolveFoundationBridgeContext({installationRoot, project});
  assert.equal(ready020.state, 'ready');
  assert.match(ready020.currentRuleEndpoint, /rules-0\.2$/u);
  const oldTask = bridge.openFoundationBridgeTask({resolved: ready020});
  const c030 = candidate('0.3.0', ['0.1.0', '0.2.0'], 'rules-0.3');
  const updatePlan = createLifecyclePlan({operation: 'update', targetRoot: installationRoot, sandboxRoot: root, currentVersion: '0.2.0', targetVersion: '0.3.0', candidate: c030});
  assert.equal((await confirm(updatePlan, path.join(installationRoot, 'state', 'local-manager', 'update-030'))).response.status, 200);
  assert.equal(inspectInstallation(installationRoot).current.version, '0.3.0');
  const ready030 = bridge.resolveFoundationBridgeContext({installationRoot, project});
  assert.equal(ready030.state, 'ready');
  assert.match(ready030.currentRuleEndpoint, /rules-0\.3$/u);
  assert.notEqual(ready030.descriptorHash, ready020.descriptorHash);
  assert.equal(bridge.inspectFoundationBridgeTask(oldTask, {resolved: ready030}).state, 'stale');
  const projectBefore = hashDirectory(project);
  const descriptorFile = path.join(installationRoot, ...inspectInstallation(installationRoot).current.appPath.split('/'), 'foundation-runtime-descriptor.json');
  const identityFile = path.join(project, '.foundation', 'identity', 'project.json');
  const compatibleIdentity = fs.readFileSync(identityFile);
  const incompatibleIdentity = JSON.parse(compatibleIdentity.toString('utf8'));
  incompatibleIdentity.dataFormatVersion = '9.0.0';
  writeJson(identityFile, incompatibleIdentity);
  assert.equal(bridge.resolveFoundationBridgeContext({installationRoot, project}).reason, 'PROJECT_DATA_INCOMPATIBLE_READ_ONLY');
  fs.writeFileSync(identityFile, compatibleIdentity);
  const tampered = JSON.parse(fs.readFileSync(descriptorFile, 'utf8')); tampered.supportedProjectDataFormats = ['0.1.0']; writeJson(descriptorFile, tampered);
  assert.equal(bridge.resolveFoundationBridgeContext({installationRoot, project}).reason, 'RUNTIME_DESCRIPTOR_TAMPERED');
  fs.rmSync(descriptorFile);
  assert.equal(bridge.resolveFoundationBridgeContext({installationRoot, project}).reason, 'RUNTIME_DESCRIPTOR_MISSING');
  assert.equal(hashDirectory(project), projectBefore);
  assert.equal(layout.inspectProjectLayout(project).state, 'current');
});

async function waitForFile(file) {
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`等待 manager handoff worker 超时：${file}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function collectChild(child) {
  return new Promise((resolve) => child.once('close', (code) => resolve(code)));
}
