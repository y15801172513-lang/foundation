import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';

import {buildCandidate, createLifecyclePlan, createNormalUninstallCompositePlan, createProjectAuthorityPlan, hashDirectory, inspectInstallation, sha256} from '@foundation/core';
import {makeScopedTempDirectory, projectFixturePath, removeTempDirectory, ROOT} from '../helpers/project-fixture.mjs';

const importCore = (name) => import(new URL(`../../packages/core/${name}.mjs`, import.meta.url));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(prefix) {
  const root = makeScopedTempDirectory('026', prefix);
  const project = projectFixturePath(root, 'project');
  const stateRoot = path.join(root, 'manager-state');
  fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
  writeJson(path.join(project, '.foundation', 'foundation.json'), {projectId: 'legacy-project', dataFormatVersion: '0.1.0', userField: 'preserve'});
  writeJson(path.join(project, '.foundation', 'project-binding.json'), {schemaVersion: '1.0.0', state: 'disabled', projectId: 'legacy-project'});
  writeJson(path.join(project, '.foundation', 'facts', 'project.json'), {schemaVersion: '0.1.0', items: [{id: 'fact-1', value: 'preserve'}]});
  writeJson(path.join(project, '.foundation', 'backups', 'user-backup.json'), {preserve: true});
  writeJson(path.join(project, '.foundation', 'unknown.json'), {preserve: true});
  fs.mkdirSync(path.join(project, 'src'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src', 'index.js'), 'export const project = true;\n');
  return {root, project, stateRoot};
}

function request(port, {method = 'GET', pathname = '/', headers = {}, body = ''} = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({host: '127.0.0.1', port, method, path: pathname, headers}, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8')}));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

async function openServer(plan, stateRoot) {
  const host = await importCore('lifecycle-manager-host');
  const server = host.createLocalLifecycleManagerServer({plan, stateRoot});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {server, port: server.address().port};
}

test('026 failing-first: legacy inspection is byte-for-byte zero-write and classifies every legacy case', async (t) => {
  const {root, project} = fixture('legacy-inspect-');
  t.after(() => removeTempDirectory(root));
  const before = hashDirectory(project);
  const {inspectProjectLayout} = await importCore('project-layout');
  const result = inspectProjectLayout(project);
  assert.equal(hashDirectory(project), before);
  assert.equal(result.state, 'legacy');
  assert.deepEqual(result.legacy.present.sort(), ['.foundation/backups', '.foundation/foundation.json', '.foundation/project-binding.json']);
  assert.ok(result.preserved.includes('.foundation/facts'));
  assert.ok(result.preserved.includes('.foundation/unknown.json'));
  assert.equal(result.mutationPerformed, false);
});

test('026 failing-first: manager migration preserves facts/backups/unknown/code and replay is rejected', async (t) => {
  const {root, project, stateRoot} = fixture('migration-');
  t.after(() => removeTempDirectory(root));
  const layout = await importCore('project-layout');
  const plan = layout.createProjectLayoutMigrationPlan({project, now: Date.now()});
  const factsBefore = hashDirectory(path.join(project, '.foundation', 'facts'));
  const backupsBefore = hashDirectory(path.join(project, '.foundation', 'backups'));
  const codeBefore = hashDirectory(path.join(project, 'src'));
  const unknownBefore = sha256(fs.readFileSync(path.join(project, '.foundation', 'unknown.json')));
  const {server, port} = await openServer(plan, stateRoot);
  t.after(() => server.close());
  const page = await request(port);
  const nonce = /name="managerNonce" value="([^"]+)"/u.exec(page.body)?.[1];
  assert.ok(nonce);
  const body = JSON.stringify({managerNonce: nonce, action: 'confirm-exact-operation'});
  const first = await request(port, {method: 'POST', pathname: '/__foundation/manager/confirm', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`}, body});
  assert.equal(first.status, 200, first.body);
  const second = await request(port, {method: 'POST', pathname: '/__foundation/manager/confirm', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`}, body});
  assert.equal(second.status, 409);
  assert.equal(hashDirectory(path.join(project, '.foundation', 'facts')), factsBefore);
  assert.equal(hashDirectory(path.join(project, '.foundation', 'backups')), backupsBefore);
  assert.equal(hashDirectory(path.join(project, 'src')), codeBefore);
  assert.equal(sha256(fs.readFileSync(path.join(project, '.foundation', 'unknown.json'))), unknownBefore);
  assert.ok(fs.existsSync(path.join(project, '.foundation', 'identity', 'project.json')));
  assert.ok(fs.existsSync(path.join(project, '.foundation', 'ownership.json')));
});

test('026 failing-first: complete state drift invalidates manager confirmation before project writes', async (t) => {
  const {root, project, stateRoot} = fixture('drift-');
  t.after(() => removeTempDirectory(root));
  const layout = await importCore('project-layout');
  const plan = layout.createProjectLayoutMigrationPlan({project, now: Date.now()});
  const {server, port} = await openServer(plan, stateRoot);
  t.after(() => server.close());
  const page = await request(port);
  const nonce = /name="managerNonce" value="([^"]+)"/u.exec(page.body)?.[1];
  fs.writeFileSync(path.join(project, 'src', 'index.js'), 'export const project = "changed-after-plan";\n');
  const changed = hashDirectory(project);
  const response = await request(port, {method: 'POST', pathname: '/__foundation/manager/confirm', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`}, body: JSON.stringify({managerNonce: nonce, action: 'confirm-exact-operation'})});
  assert.equal(response.status, 409);
  assert.equal(JSON.parse(response.body).code, 'MANAGER_PLAN_STATE_DRIFT');
  assert.equal(hashDirectory(project), changed);
  assert.equal(fs.existsSync(path.join(project, '.foundation', 'identity', 'project.json')), false);
});

test('026 failing-first: concurrent confirmation has one winner and no half-applied layout', async (t) => {
  const {root, project, stateRoot} = fixture('concurrent-');
  t.after(() => removeTempDirectory(root));
  const {createProjectLayoutMigrationPlan} = await importCore('project-layout');
  const {server, port} = await openServer(createProjectLayoutMigrationPlan({project, now: Date.now()}), stateRoot);
  t.after(() => server.close());
  const page = await request(port);
  const nonce = /name="managerNonce" value="([^"]+)"/u.exec(page.body)?.[1];
  const options = {method: 'POST', pathname: '/__foundation/manager/confirm', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`}, body: JSON.stringify({managerNonce: nonce, action: 'confirm-exact-operation'})};
  const results = await Promise.all([request(port, options), request(port, options)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, '.foundation', 'ownership.json'), 'utf8')).layoutVersion, '2.0.0');
});

test('026 failing-first: normal uninstall preserves project data and reports inaccessible residuals', async (t) => {
  const {root, project} = fixture('uninstall-residual-');
  t.after(() => removeTempDirectory(root));
  const layout = await importCore('project-layout');
  const missing = path.join(root, 'missing-project');
  const plan = layout.createNormalUninstallProjectPlan({projects: [{projectId: 'legacy-project', realPath: project}, {projectId: 'missing-project', realPath: missing}]});
  assert.equal(plan.status, 'decision-required');
  assert.deepEqual(plan.allowedDecisions, ['cancel-no-change', 'continue-accessible-with-residuals']);
  assert.equal(plan.accessible.length, 1);
  assert.ok(plan.residuals.some((entry) => entry.reason === 'PROJECT_UNAVAILABLE'));
  assert.ok(plan.preserves.includes('project-code'));
  assert.ok(plan.preserves.includes('.foundation/facts'));
  assert.ok(plan.preserves.includes('.foundation/identity'));
  assert.doesNotMatch(JSON.stringify(plan), /delete.*facts/iu);
});

test('026: empty-PATH sandbox install/status/doctor/update/rollback/repair/disable/detach/residual-uninstall matrix', async (t) => {
  // Explicit isolated test setup; do not depend on another file's first install.
  (await importCore('trusted-authority')).loadTrustedAuthorityKey({create: true});
  const {root, project: legacyProject} = fixture('composite-uninstall-');
  t.after(() => removeTempDirectory(root));
  const project = legacyProject;
  const runtime = path.join(root, 'private-node');
  fs.copyFileSync(process.execPath, runtime); fs.chmodSync(runtime, 0o755);
  const candidate = (version) => {
    const source = path.join(root, `candidate-source-${version}`);
    fs.mkdirSync(path.join(source, 'app'), {recursive: true});
    fs.writeFileSync(path.join(source, 'app', 'foundation-smoke.mjs'), `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))\n`);
    fs.cpSync(path.join(ROOT, 'templates'), path.join(source, 'app', 'templates'), {recursive: true});
    const built = buildCandidate({sourceRoot: source, outputRoot: path.join(root, `candidate-${version}`), productVersion: version, platform: process.platform, arch: process.arch, runtimeSource: runtime, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
    const runtimeRecord = built.manifest.files.find((entry) => entry.path === built.manifest.runtime.path);
    return {built, binding: {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: runtimeRecord.sha256, bytes: built.manifest.totalBytes, version}};
  };
  const candidate020 = candidate('0.2.0');
  const candidate021 = candidate('0.2.1');
  const installationRoot = path.join(root, 'foundation-install');
  const installPlan = createLifecyclePlan({operation: 'install', targetRoot: installationRoot, sandboxRoot: root, targetVersion: '0.2.0', candidate: candidate020.binding, now: Date.now()});
  const confirm = async (plan, stateRoot, action = 'confirm-exact-operation') => {
    const {server, port} = await openServer(plan, stateRoot);
    t.after(() => server.close());
    const managerPage = await request(port);
    const nonce = /name="managerNonce" value="([^"]+)"/u.exec(managerPage.body)?.[1];
    const response = await request(port, {method: 'POST', pathname: '/__foundation/manager/confirm', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`}, body: JSON.stringify({managerNonce: nonce, action})});
    return {response, page: managerPage.body};
  };
  const originalPath = process.env.PATH;
  process.env.PATH = '';
  t.after(() => { process.env.PATH = originalPath; });
  const installed = await confirm(installPlan, path.join(root, 'manager-install'));
  assert.equal(installed.response.status, 200, installed.response.body);
  assert.equal(inspectInstallation(installationRoot).current.version, '0.2.0');
  const cli = path.join(ROOT, 'packages', 'cli', 'index.mjs');
  for (const args of [['status', '--root', installationRoot], ['doctor', '--root', installationRoot]]) {
    const run = spawnSync(process.execPath, [cli, ...args], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PATH: '', NODE_OPTIONS: ''}});
    assert.equal(run.status, 0, `${args.join(' ')}\n${run.stderr || run.stdout}`);
  }
  const updatePlan = createLifecyclePlan({operation: 'update', targetRoot: installationRoot, sandboxRoot: root, currentVersion: '0.2.0', targetVersion: '0.2.1', candidate: candidate021.binding, now: Date.now()});
  assert.equal((await confirm(updatePlan, path.join(installationRoot, 'state', 'local-manager', 'update'))).response.status, 200);
  assert.equal(inspectInstallation(installationRoot).current.version, '0.2.1');
  const rollbackPlan = createLifecyclePlan({operation: 'rollback', targetRoot: installationRoot, sandboxRoot: root, currentVersion: '0.2.1', targetVersion: '0.2.0', now: Date.now()});
  assert.equal((await confirm(rollbackPlan, path.join(installationRoot, 'state', 'local-manager', 'rollback'))).response.status, 200);
  assert.equal(inspectInstallation(installationRoot).current.version, '0.2.0');
  const repairPlan = createLifecyclePlan({operation: 'repair', targetRoot: installationRoot, sandboxRoot: root, currentVersion: '0.2.0', targetVersion: '0.2.0', candidate: candidate020.binding, now: Date.now()});
  assert.equal((await confirm(repairPlan, path.join(installationRoot, 'state', 'local-manager', 'repair'))).response.status, 200);
  const {createProjectLayoutMigrationPlan} = await importCore('project-layout');
  assert.equal((await confirm(createProjectLayoutMigrationPlan({project}), path.join(root, 'manager-migrate'))).response.status, 200);
  assert.equal((await importCore('project-layout')).inspectProjectLayout(project).state, 'current');
  const enablePlan = createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: Date.now()});
  assert.equal((await confirm(enablePlan, path.join(installationRoot, 'state', 'local-manager', 'enable'))).response.status, 200);
  const disablePlan = createProjectAuthorityPlan({operation: 'disable', project, installationRoot, now: Date.now()});
  assert.equal((await confirm(disablePlan, path.join(installationRoot, 'state', 'local-manager', 'disable'))).response.status, 200);
  const reenablePlan = createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: Date.now()});
  assert.equal((await confirm(reenablePlan, path.join(installationRoot, 'state', 'local-manager', 'reenable'))).response.status, 200);
  fs.mkdirSync(path.join(project, '.foundation', 'generated-cache'), {recursive: true});
  fs.writeFileSync(path.join(project, '.foundation', 'generated-cache', 'owned.json'), '{}\n');
  const codeBefore = hashDirectory(path.join(project, 'src'));
  const factsBefore = hashDirectory(path.join(project, '.foundation', 'facts'));
  const identityBefore = sha256(fs.readFileSync(path.join(project, '.foundation', 'identity', 'project.json')));
  const stat = fs.statSync(project);
  const missing = projectFixturePath(root, 'offline-project');
  const lifecyclePlan = createLifecyclePlan({operation: 'uninstall', mode: 'full', targetRoot: installationRoot, sandboxRoot: root, currentVersion: '0.2.0', targetVersion: '0.2.0', now: Date.now()});
  const plan = createNormalUninstallCompositePlan({lifecyclePlan, projects: [{projectId: enablePlan.projectId, realPath: project, projectIdentity: {device: String(stat.dev), inode: String(stat.ino), kind: 'directory'}}, {projectId: 'offline-project', realPath: missing}]});
  const projectBeforeCancel = hashDirectory(project);
  const registryBeforeCancel = sha256(fs.readFileSync(plan.registry.file));
  assert.equal(plan.registry.fileHash, registryBeforeCancel);
  assert(plan.replacements.includes(plan.registry.file));
  const currentBeforeCancel = sha256(fs.readFileSync(path.join(installationRoot, 'state', 'current.json')));
  const cancelled = await confirm(plan, path.join(installationRoot, 'state', 'local-manager', 'cancel-uninstall'), 'cancel-no-change');
  assert.equal(cancelled.response.status, 200, cancelled.response.body);
  assert.equal(JSON.parse(cancelled.response.body).result.status, 'CANCELLED_NO_CHANGE');
  assert.equal(hashDirectory(project), projectBeforeCancel);
  assert.equal(sha256(fs.readFileSync(plan.registry.file)), registryBeforeCancel);
  assert.equal(sha256(fs.readFileSync(path.join(installationRoot, 'state', 'current.json'))), currentBeforeCancel);
  const registryBytes = fs.readFileSync(plan.registry.file);
  const layoutForDrift = await importCore('project-layout');
  fs.appendFileSync(plan.registry.file, '\n');
  assert.throws(() => (layoutForDrift.applyNormalUninstallCompositePlan({plan, decision: 'continue-accessible-with-residuals'})), error => error.code === 'MANAGER_PLAN_STATE_DRIFT');
  fs.writeFileSync(plan.registry.file, registryBytes);
  const opened = await confirm(plan, path.join(installationRoot, 'state', 'local-manager', 'uninstall'), 'continue-accessible-with-residuals');
  assert.match(opened.page, /取消且不改变目标/u);
  assert.match(opened.page, /继续卸载可访问项目/u);
  assert.equal(opened.response.status, 200, opened.response.body);
  assert.equal(JSON.parse(opened.response.body).result.status, 'UNINSTALLED_WITH_PROJECT_RESIDUALS');
  assert.equal(hashDirectory(path.join(project, 'src')), codeBefore);
  assert.equal(hashDirectory(path.join(project, '.foundation', 'facts')), factsBefore);
  assert.equal(sha256(fs.readFileSync(path.join(project, '.foundation', 'identity', 'project.json'))), identityBefore);
  assert.equal(fs.existsSync(path.join(project, '.foundation', 'integration', 'binding.json')), false);
  assert.equal(fs.existsSync(path.join(project, '.foundation', 'generated-cache', 'owned.json')), true);
  assert.ok(plan.residuals.some((entry) => entry.path === '.foundation/generated-cache/owned.json' && entry.classification === 'unknown-or-untracked'));
  const residual = JSON.parse(fs.readFileSync(plan.projectPlan.resultFile, 'utf8'));
  assert.equal(residual.status, 'UNINSTALLED_WITH_PROJECT_RESIDUALS');
  assert.equal(residual.containsSecret, false);
  const registry = JSON.parse(fs.readFileSync(plan.registry.file));
  const {integrity, ...registryPayload} = registry;
  assert.equal((await importCore('trusted-authority')).verifyTrustedPayload(registryPayload, integrity), true);
  assert.equal(registry.projects[enablePlan.projectId].state, 'disabled');
  assert.equal(registry.projects[enablePlan.projectId].uninstallHistory.previousState, 'enabled');
  assert.equal(registry.projects[enablePlan.projectId].uninstallHistory.currentAuthority, false);
  const uninstallReceipt = JSON.parse(fs.readFileSync(path.join(installationRoot, 'uninstall-result.json')));
  const indexed = uninstallReceipt.residualInventory.find(item => item.relativePath === 'state/projects.json');
  assert.equal(indexed.category, 'historical-project-index');
  assert.equal(indexed.deletionAuthority, false);
  assert.equal(indexed.sha256, sha256(fs.readFileSync(plan.registry.file)));
  assert.equal(indexed.bytes, fs.statSync(plan.registry.file).size);
  assert.equal(uninstallReceipt.cleanupDiscovery.deletionAuthority, false);
});

test('026 failing-first: project data purge is separate, per-project, sized and manager-confirmed only', async (t) => {
  const {root, project} = fixture('purge-plan-');
  t.after(() => removeTempDirectory(root));
  const layout = await importCore('project-layout');
  const plan = layout.createProjectDataPurgePlan({project, now: Date.now()});
  assert.equal(plan.operation, 'project-data-purge');
  assert.equal(plan.highRisk, true);
  assert.equal(plan.project, project);
  assert.ok(plan.fileCount >= 3);
  assert.ok(plan.byteCount > 0);
  assert.equal(plan.backupRecommended, true);
  assert.throws(() => layout.applyProjectLayoutPlan?.({plan}), (error) => ['MANAGER_CONFIRMATION_REQUIRED', 'HUMAN_AUTHORIZATION_REQUIRED'].includes(error?.code));
});

test('026 failing-first: bridge is inert for unhealthy/disabled/incompatible/inactive and marks old task stale', async (t) => {
  const {root, project} = fixture('bridge-');
  t.after(() => removeTempDirectory(root));
  const bridge = await importCore('ai-bridge');
  const absent = bridge.resolveFoundationBridgeContext({installationRoot: path.join(root, 'absent'), project});
  assert.equal(absent.state, 'inert');
  assert.equal(absent.reason, 'FOUNDATION_NOT_HEALTHY');
  const opened = bridge.openFoundationBridgeTask({resolved: {state: 'ready', currentVersion: '0.2.0', currentIdentityHash: 'a'.repeat(64), projectId: 'project-1', capabilityId: 'cap-1'}});
  const stale = bridge.inspectFoundationBridgeTask(opened, {resolved: {state: 'ready', currentVersion: '0.2.1', currentIdentityHash: 'b'.repeat(64), projectId: 'project-1', capabilityId: 'cap-1'}});
  assert.equal(stale.state, 'stale');
  assert.equal(stale.action, 'refresh-or-reopen-task');
});
