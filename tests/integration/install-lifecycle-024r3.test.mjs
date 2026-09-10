import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import test from 'node:test';

import {createManagementCenterServer} from '@foundation/management-center';
import {
  SHADCN_ADAPTER,
  applyLifecyclePlan,
  applyProjectAuthorityPlan,
  assertProjectMutationAuthority,
  buildCandidate,
  createLifecyclePlan,
  createProjectAuthorityPlan,
  explainProjectAuthorityPlan,
  inspectInstallation,
  inspectLifecycleRecovery,
  inspectProjectAuthority,
  inventoryProject,
  listProjectAuthorities,
  projectAuthorityFromNaturalLanguage,
  recoverLifecycleState,
  sha256,
} from '../helpers/internal-core.mjs';
import {loadTrustedAuthorityKey, signTrustedPayload} from '../../packages/core/trusted-authority.mjs';
import {EVENTS, ROOT, copyProjectFixture, makeScopedTempDirectory, makeTempDirectory, projectFixturePath, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest, applyProjectForTest, authorizeLifecycle, authorizeProject, authorizeProjectMutation} from '../helpers/test-authorization.mjs';
import {prepareCurrentProjectLayoutFixture} from '../helpers/authorized-project-fixture.mjs';

const CHILD = path.join(ROOT, 'tests', 'fixtures', 'lifecycle-child.mjs');

function source(root, version) {
  const directory = path.join(root, `source-${version}-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(directory, 'app'), {recursive: true});
  fs.writeFileSync(path.join(directory, 'app', 'foundation-smoke.mjs'), `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))\n`);
  fs.writeFileSync(path.join(directory, 'app', 'version.txt'), `${version}\n`);
  fs.cpSync(path.join(ROOT, 'templates'), path.join(directory, 'app', 'templates'), {recursive: true});
  return directory;
}

function candidate(root, version) {
  const runtime = path.join(root, 'private-node');
  if (!fs.existsSync(runtime)) {
    fs.copyFileSync(process.execPath, runtime);
    fs.chmodSync(runtime, 0o755);
  }
  return buildCandidate({
    sourceRoot: source(root, version),
    outputRoot: path.join(root, `candidate-${version}-${crypto.randomUUID()}`),
    productVersion: version,
    platform: process.platform,
    arch: process.arch,
    runtimeSource: runtime,
    entrypoint: 'app/foundation-smoke.mjs',
    sourceKind: 'local-test',
  });
}

function planFor({operation, root, target, built, version, currentVersion = null, mode = null, now = 1000}) {
  const runtime = built?.manifest.files.find((record) => record.path === built.manifest.runtime.path);
  return createLifecyclePlan({
    operation,
    profile: 'core',
    mode,
    targetRoot: target,
    sandboxRoot: root,
    currentVersion,
    targetVersion: version,
    candidate: built ? {
      path: built.root,
      manifestHash: built.manifest.candidateHash,
      runtimeHash: runtime.sha256,
      bytes: built.manifest.totalBytes,
      version,
      acquisition: 'local-ingestion',
    } : null,
    now,
  });
}

const apply = (plan) => applyLifecycleForTest(plan);

function recover(root, sandboxRoot, now = Date.now()) {
  const recoverySnapshot = inspectLifecycleRecovery(root);
  const currentVersion = inspectInstallation(root).current?.version || null;
  return applyLifecycleForTest(createLifecyclePlan({operation: 'recover', profile: 'core', targetRoot: root, sandboxRoot, currentVersion, targetVersion: currentVersion, recoverySnapshot, now}));
}

function projectFixture(prefix = '024r3-project-') {
  const root = makeScopedTempDirectory('project-authority-sandboxes', prefix);
  const installationRoot = path.join(root, 'foundation-install');
  const built = candidate(root, '0.2.0');
  apply(planFor({operation: 'install', root, target: installationRoot, built, version: '0.2.0'}));
  return {root, installationRoot, built};
}

function fileSnapshot(root) {
  const result = {};
  if (!fs.existsSync(root)) return result;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isSymbolicLink()) result[relative] = `symlink:${fs.readlinkSync(absolute)}`;
      else result[relative] = sha256(fs.readFileSync(absolute));
    }
  };
  visit(root);
  return result;
}

function lifecycleStableSnapshot(target) {
  const selected = ['bin', 'state/current.json', 'state/previous.json', 'state/installations.json', 'state/receipts', 'state/journals'];
  const result = {};
  for (const relative of selected) {
    const absolute = path.join(target, ...relative.split('/'));
    if (!fs.existsSync(absolute)) { result[relative] = null; continue; }
    if (fs.statSync(absolute).isFile()) result[relative] = sha256(fs.readFileSync(absolute));
    else result[relative] = fileSnapshot(absolute);
  }
  return result;
}

function waitForFile(file, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (fs.existsSync(file)) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${file}`));
      setTimeout(check, 20);
    };
    check();
  });
}

function childResult(child) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => resolve({code, signal, stdout, stderr}));
  });
}

function spawnPausedPlan(plan, root, stage, label, {releasable = false} = {}) {
  const planFile = path.join(root, `${label}.plan.json`);
  const marker = path.join(root, `${label}.marker.json`);
  const release = path.join(root, `${label}.release`);
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  authorizeLifecycle(plan);
  const child = spawn(process.execPath, [CHILD, planFile, 'operation', stage, marker, ...(releasable ? [release] : [])], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
  return {child, marker, release};
}

function signedPayload(file) {
  const {integrity: ignored, ...payload} = JSON.parse(fs.readFileSync(file, 'utf8'));
  return payload;
}

function writeSignedOwner(file, payload) {
  fs.writeFileSync(file, `${JSON.stringify({...payload, integrity: signTrustedPayload(payload)}, null, 2)}\n`);
}

function httpRequest(port, {method = 'GET', pathname = '/', headers = {}, body = ''} = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({host: '127.0.0.1', port, method, path: pathname, headers}, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('024R3 failing-first: B 不得在锁前读取旧状态后覆盖 A 已提交的新状态', async (t) => {
  const root = makeTempDirectory('024r3-race-commit-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  const v3 = candidate(root, '0.2.2');
  apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));

  const bPlan = planFor({operation: 'update', root, target, built: v3, version: '0.2.2', currentVersion: '0.2.0'});
  const planFile = path.join(root, 'b-plan.json');
  const marker = path.join(root, 'b-marker.json');
  const release = path.join(root, 'b-release');
  fs.writeFileSync(planFile, `${JSON.stringify(bPlan, null, 2)}\n`);
  authorizeLifecycle(bPlan);
  const child = spawn(process.execPath, [CHILD, planFile, 'operation', 'before-exclusive-acquire', marker, release], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
  await waitForFile(marker);

  apply(planFor({operation: 'update', root, target, built: v2, version: '0.2.1', currentVersion: '0.2.0'}));
  const afterA = lifecycleStableSnapshot(target);
  const outside = path.join(root, 'outside-commit.txt'); fs.writeFileSync(outside, 'unchanged\n');
  fs.writeFileSync(release, 'release\n');
  const exit = await childResult(child);
  assert.equal(exit.code, 1, `B 必须拒绝旧快照；stdout=${exit.stdout} stderr=${exit.stderr}`);
  const error = JSON.parse(exit.stderr.trim().split(/\r?\n/u).at(-1));
  assert.equal(error.code, 'MACHINE_STATE_CHANGED');
  assert.equal(inspectInstallation(target).current.version, '0.2.1');
  assert.equal(fs.existsSync(path.join(target, 'state', 'journals', `${bPlan.planId}.json`)), false);
  assert.deepEqual(lifecycleStableSnapshot(target), afterA);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged\n');
});

test('024R3 A crash 时 B 零隐式恢复地拒绝；explicit authorized recover 后新 uninstall 安全执行', async (t) => {
  const root = makeTempDirectory('024r3-race-crash-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  const v3 = candidate(root, '0.2.2');
  apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));
  apply(planFor({operation: 'update', root, target, built: v2, version: '0.2.1', currentVersion: '0.2.0'}));
  const outside = path.join(root, 'outside.txt'); fs.writeFileSync(outside, 'unchanged\n');
  const bPlan = planFor({operation: 'uninstall', root, target, version: '0.2.1', currentVersion: '0.2.1', mode: 'app-only'});
  const b = spawnPausedPlan(bPlan, root, 'before-exclusive-acquire', 'race-b-uninstall', {releasable: true});
  await waitForFile(b.marker);
  const aPlan = planFor({operation: 'update', root, target, built: v3, version: '0.2.2', currentVersion: '0.2.1'});
  const a = spawnPausedPlan(aPlan, root, 'after-current-switch', 'race-a-crash');
  await waitForFile(a.marker);
  process.kill(a.child.pid, 'SIGKILL');
  const aExit = await childResult(a.child);
  assert.equal(aExit.signal, 'SIGKILL');
  fs.writeFileSync(b.release, 'release\n');
  const bExit = await childResult(b.child);
  assert.equal(bExit.code, 1, bExit.stderr);
  assert.ok(['RECOVERY_REQUIRED', 'TRUSTED_TARGET_RECOVERY_REQUIRED'].includes(JSON.parse(bExit.stderr.trim().split(/\r?\n/u).at(-1)).code));
  assert.equal(fs.existsSync(path.join(target, 'state', 'journals', `${bPlan.planId}.json`)), false);
  recover(target, root, 2000);
  const retriedUninstall = planFor({operation: 'uninstall', root, target, version: '0.2.1', currentVersion: '0.2.1', mode: 'app-only', now: 3000});
  apply(retriedUninstall);
  const aJournal = signedPayload(path.join(target, 'state', 'journals', `${aPlan.planId}.json`));
  const bJournal = signedPayload(path.join(target, 'state', 'journals', `${retriedUninstall.planId}.json`));
  assert.equal(aJournal.status, 'completed');
  assert.equal(aJournal.outcome, 'rolled-back');
  assert.equal(bJournal.status, 'completed');
  assert.equal(fs.existsSync(path.join(target, 'state', 'current.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'bin', process.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit')), false);
  assert.equal(fs.existsSync(path.join(target, 'state', 'installations.json')), true);
  assert.equal(fs.existsSync(path.join(target, 'state', 'previous.json')), true);
  assert.equal(fs.existsSync(path.join(target, 'state', 'receipts', '0.2.1.json')), true);
  assert.equal(fs.existsSync(path.join(target, 'state', 'receipts', '0.2.2.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'versions', '0.2.2')), false);
  assert.equal(fs.existsSync(path.join(target, '.foundation-operation.guard')), false);
  assert.equal(fs.existsSync(path.join(target, '.foundation-operation.lock')), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged\n');
});

test('024R3 A live 时 B 在 journal 前被拒绝且 current/index 字节不变', async (t) => {
  const root = makeTempDirectory('024r3-race-live-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  const v3 = candidate(root, '0.2.2');
  apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));
  const currentFile = path.join(target, 'state', 'current.json');
  const aPlan = planFor({operation: 'update', root, target, built: v2, version: '0.2.1', currentVersion: '0.2.0'});
  const a = spawnPausedPlan(aPlan, root, 'after-staging', 'race-a-live');
  await waitForFile(a.marker);
  const beforeB = lifecycleStableSnapshot(target);
  const bPlan = planFor({operation: 'update', root, target, built: v3, version: '0.2.2', currentVersion: '0.2.0'});
  assert.throws(() => apply(bPlan), (error) => ['OPERATION_LOCKED', 'TRUSTED_TARGET_LOCKED'].includes(error.code));
  assert.deepEqual(lifecycleStableSnapshot(target), beforeB);
  assert.equal(fs.existsSync(path.join(target, 'state', 'journals', `${bPlan.planId}.json`)), false);
  process.kill(a.child.pid, 'SIGKILL');
  await childResult(a.child);
  const recovered = recover(target, root);
  assert.equal(recovered.manual.length, 0, JSON.stringify(recovered));
  assert.equal(inspectInstallation(target).current.version, '0.2.0');
});

test('024R3 owner-before-journal、stale、unavailable、tampered acquisition guard 均确定处理', async (t) => {
  const root = makeTempDirectory('024r3-guard-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));
  const stateBefore = lifecycleStableSnapshot(target);
  const orphanPlan = planFor({operation: 'update', root, target, built: v2, version: '0.2.1', currentVersion: '0.2.0'});
  const orphan = spawnPausedPlan(orphanPlan, root, 'after-exclusive-acquire', 'orphan-before-journal');
  await waitForFile(orphan.marker);
  assert.equal(fs.existsSync(path.join(target, '.foundation-operation.guard')), false, 'R8 exclusive guard lives in protected parent ledger before target mutation');
  assert.equal(fs.existsSync(path.join(target, '.foundation-operation.lock')), false);
  assert.equal(fs.existsSync(path.join(target, 'state', 'journals', `${orphanPlan.planId}.json`)), false);
  assert.equal(inspectLifecycleRecovery(target).status, 'live-operation');
  process.kill(orphan.child.pid, 'SIGKILL');
  await childResult(orphan.child);
  const orphanRecovery = recover(target, root);
  assert.equal(orphanRecovery.status, 'recovered');
  assert.ok(orphanRecovery.recoveredTrustedIntents.some((entry) => entry.intentId === orphanPlan.planId));
  assert.deepEqual(lifecycleStableSnapshot(target), stateBefore);
  assert.equal(inspectLifecycleRecovery(target).status, 'clean');

  loadTrustedAuthorityKey({create: true});
  const guard = path.join(target, '.foundation-operation.guard');
  const stale = {schemaVersion: '1.0.0', operationId: 'stale-guard', pid: process.pid, processStartedAt: 1, processFingerprint: {scheme: 'test', value: 'different-instance'}, ownerNonce: 'stale'};
  writeSignedOwner(guard, stale);
  assert.ok(recover(target, root).recovered.some((entry) => entry.operationId === 'stale-guard'));
  assert.equal(inspectLifecycleRecovery(target).status, 'clean');

  const unavailable = {schemaVersion: '1.0.0', operationId: 'unavailable-guard', pid: process.pid, processStartedAt: Date.now(), ownerNonce: 'unavailable'};
  writeSignedOwner(guard, unavailable);
  const unavailableResult = inspectLifecycleRecovery(target);
  assert.equal(unavailableResult.status, 'manual-action-required');
  assert.equal(fs.existsSync(guard), true);
  fs.rmSync(guard);

  fs.writeFileSync(guard, '{"operationId":"tampered","pid":1}\n');
  const tampered = inspectLifecycleRecovery(target);
  assert.equal(tampered.status, 'manual-action-required');
  assert.equal(tampered.manual[0].code, 'OPERATION_GUARD_UNKNOWN');
  assert.equal(fs.existsSync(guard), true);
});

test('024R3 unmanaged/legacy/skill 项目保持未启用，inventory 两次零写入', (t) => {
  const {root, installationRoot} = projectFixture('authority-inventory-');
  t.after(() => removeTempDirectory(root));
  const project = projectFixturePath(root, 'user-project');
  fs.mkdirSync(path.join(project, 'src'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src', 'index.js'), 'export const value = 1;\n');
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'unmanaged');
  const before = fileSnapshot(project);
  const first = inventoryProject(project);
  const second = inventoryProject(project);
  assert.equal(first.authorityState, 'inventory-only');
  assert.deepEqual(second, first);
  assert.deepEqual(fileSnapshot(project), before);
  assert.equal(fs.existsSync(path.join(project, '.foundation')), false);

  fs.mkdirSync(path.join(project, '.agents', 'skills', 'foundation'), {recursive: true});
  fs.writeFileSync(path.join(project, '.agents', 'skills', 'foundation', 'SKILL.md'), 'skill presence is not authority\n');
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'unmanaged');
  const aiPlanOnly = projectAuthorityFromNaturalLanguage('请启用 Foundation 管理这个项目', {project, installationRoot, now: 1000});
  assert.equal(aiPlanOnly.status, 'confirmation-required');
  assert.equal(aiPlanOnly.applies, false);
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'unmanaged');
  fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
  fs.writeFileSync(path.join(project, '.foundation', 'facts', 'legacy.json'), '{}\n');
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'unmanaged');
});

test('024R3 enable plan 零写入；错误确认、过期、篡改均保持项目与 registry 不变', (t) => {
  const {root, installationRoot} = projectFixture('authority-plan-');
  t.after(() => removeTempDirectory(root));
  const project = projectFixturePath(root, 'user-project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'README.md'), 'user project\n');
  const beforeProject = fileSnapshot(project);
  const registryFile = path.join(installationRoot, 'state', 'projects.json');
  const plan = createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: 1000});
  assert.deepEqual(fileSnapshot(project), beforeProject);
  assert.equal(fs.existsSync(registryFile), false);
  assert.throws(() => applyProjectAuthorityPlan({plan, confirmationId: 'copied-public-token', now: 1001}), (error) => error.code === 'HUMAN_AUTHORIZATION_REQUIRED');
  assert.throws(() => applyProjectAuthorityPlan({plan, now: plan.expiresAt + 1}), (error) => error.code === 'PROJECT_PLAN_EXPIRED');
  const tampered = structuredClone(plan); tampered.projectId = 'project-tampered';
  assert.throws(() => applyProjectAuthorityPlan({plan: tampered, now: 1001}), (error) => error.code === 'PROJECT_PLAN_TAMPERED');
  assert.deepEqual(fileSnapshot(project), beforeProject);
  assert.equal(fs.existsSync(registryFile), false);
});

test('024R3 enable 双记录达成 enabled；复制、移动/替换、case/Unicode 别名不会自动继承', (t) => {
  const {root, installationRoot} = projectFixture('authority-binding-');
  t.after(() => removeTempDirectory(root));
  const project = projectFixturePath(root, 'CaféProject');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'README.md'), 'portable project\n');
  const plan = createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: 1000});
  const result = applyProjectForTest(plan);
  assert.equal(result.state, 'enabled');
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'enabled');
  assert.deepEqual(listProjectAuthorities(installationRoot).map((entry) => entry.project), [project]);
  const enumerated = [];
  const originalReadDirectory = fs.readdirSync;
  fs.readdirSync = function monitoredReadDirectory(directory, ...args) { enumerated.push(path.resolve(directory)); return originalReadDirectory.call(fs, directory, ...args); };
  try { assert.deepEqual(listProjectAuthorities(installationRoot).map((entry) => entry.project), [project]); }
  finally { fs.readdirSync = originalReadDirectory; }
  assert.deepEqual(enumerated, [], 'project list 只能读取 registration 指向的确定文件，不能枚举目录');
  const portable = JSON.parse(fs.readFileSync(path.join(project, '.foundation', 'integration', 'binding.json'), 'utf8'));
  assert.equal('projectPath' in portable, false);
  assert.equal('absolutePath' in portable, false);

  const copy = projectFixturePath(root, 'Cafe\u0301Project-copy');
  fs.cpSync(project, copy, {recursive: true});
  assert.equal(inspectProjectAuthority(copy, {installationRoot}).state, 'unmanaged');
  assert.throws(() => createProjectAuthorityPlan({operation: 'enable', project: copy, installationRoot}), (error) => error.code === 'PROJECT_MOVE_REQUIRES_EXPLICIT_REBIND');

  const replacement = projectFixturePath(root, 'replacement');
  fs.mkdirSync(replacement);
  const replacementPlan = createProjectAuthorityPlan({operation: 'enable', project: replacement, installationRoot});
  fs.renameSync(replacement, `${replacement}-old`);
  fs.mkdirSync(replacement);
  authorizeProject(replacementPlan);
  assert.throws(() => applyProjectAuthorityPlan({plan: replacementPlan}), (error) => error.code === 'PROJECT_REPLACED_AFTER_PLAN');

  const caseAlias = project.toLocaleLowerCase('en-US');
  const caseStatus = inspectProjectAuthority(caseAlias, {installationRoot});
  assert.notEqual(caseStatus.state, 'enabled');
  assert.throws(() => createProjectAuthorityPlan({operation: 'enable', project: caseAlias, installationRoot}), (error) => ['PROJECT_PATH_NORMALIZATION_COLLISION', 'PROJECT_NOT_FOUND', 'PROJECT_REALPATH_UNSTABLE'].includes(error.code));
});

test('024R3 disable 只停止管理并保留 facts；扩展写入被共同 gate 拒绝', (t) => {
  const {root, installationRoot} = projectFixture('authority-disable-');
  t.after(() => removeTempDirectory(root));
  const project = projectFixturePath(root, 'user-project');
  fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
  fs.writeFileSync(path.join(project, '.foundation', 'facts', 'sentinel.json'), '{"keep":true}\n');
  const enable = createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: 1000});
  applyProjectForTest(enable);
  const disable = createProjectAuthorityPlan({operation: 'disable', project, installationRoot, now: 2000});
  assert.match(disable.semantics, /不删除项目资料，不卸载 Foundation/u);
  applyProjectForTest(disable);
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'disabled');
  assert.equal(fs.readFileSync(path.join(project, '.foundation', 'facts', 'sentinel.json'), 'utf8'), '{"keep":true}\n');
  assert.throws(() => assertProjectMutationAuthority(project, {installationRoot, capability: 'test-write'}), (error) => error.code === 'PROJECT_NOT_ENABLED');
  const target = path.join(project, 'src', 'button.jsx');
  const outside = path.join(root, 'outside-disabled.txt'); fs.writeFileSync(outside, 'unchanged\n');
  assert.throws(() => SHADCN_ADAPTER.plan({project, installationRoot, registry: {schemaVersion: '1.0.0', name: 'local', item: {name: 'button', files: [{path: 'src/button.jsx', content: 'export const Button=()=>null;'}]}}}), (error) => error.code === 'PROJECT_NOT_ENABLED');
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged\n');
});

test('024R3 management-center 在 disabled 项目第一笔 relation 写入前调用共同 gate', async (t) => {
  const {root, installationRoot} = projectFixture('authority-center-');
  t.after(() => removeTempDirectory(root));
  const project = projectFixturePath(root, 'event-project');
  copyProjectFixture(EVENTS, project);
  prepareCurrentProjectLayoutFixture(project);
  const enable = createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: 1000});
  applyProjectForTest(enable);
  const disable = createProjectAuthorityPlan({operation: 'disable', project, installationRoot, now: 2000});
  applyProjectForTest(disable);
  const relations = path.join(project, '.foundation', 'facts', 'relations.json');
  const before = fs.readFileSync(relations);
  const server = createManagementCenterServer(project, {installationRoot});
  t.after(() => server.close());
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const origin = `http://127.0.0.1:${port}`;
  const html = (await httpRequest(port)).body;
  const nonce = JSON.parse(html.match(/window\.__FOUNDATION_WRITE_NONCE__=("[^"]+")/u)[1]);
  const response = await httpRequest(port, {method: 'POST', pathname: '/__foundation/relations', headers: {'content-type': 'application/json', origin, 'x-foundation-write-nonce': nonce}, body: JSON.stringify({from: 'page_events_manage', to: 'page_events_home', trigger: 'must-not-write'})});
  assert.equal(response.status, 409);
  assert.equal(JSON.parse(response.body).code, 'PROJECT_NOT_ENABLED');
  assert.deepEqual(fs.readFileSync(relations), before);
});

test('024R3 full uninstall 不读取或改动已启用项目内容', (t) => {
  const {root, installationRoot} = projectFixture('authority-uninstall-');
  t.after(() => removeTempDirectory(root));
  const project = projectFixturePath(root, 'user-project');
  fs.mkdirSync(path.join(project, 'src'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src', 'index.js'), 'user-owned\n');
  const enable = createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: 1000});
  applyProjectForTest(enable);
  const disabledProject = projectFixturePath(root, 'disabled-project');
  fs.mkdirSync(disabledProject);
  fs.writeFileSync(path.join(disabledProject, 'data.txt'), 'disabled-user-owned\n');
  const enableDisabled = createProjectAuthorityPlan({operation: 'enable', project: disabledProject, installationRoot, now: 1100});
  applyProjectForTest(enableDisabled);
  const disable = createProjectAuthorityPlan({operation: 'disable', project: disabledProject, installationRoot, now: 1200});
  applyProjectForTest(disable);
  const before = fileSnapshot(project);
  const disabledBefore = fileSnapshot(disabledProject);
  apply(planFor({operation: 'uninstall', root, target: installationRoot, version: '0.2.0', currentVersion: '0.2.0', mode: 'full'}));
  assert.deepEqual(fileSnapshot(project), before);
  assert.deepEqual(fileSnapshot(disabledProject), disabledBefore);
});

test('024R3 source/install/runtime/template/candidate/fixture/overlap/symlink 角色全部拒绝且 fixtures 不进 list', (t) => {
  const {root, installationRoot, built} = projectFixture('authority-roles-');
  t.after(() => removeTempDirectory(root));
  const outside = path.join(root, 'outside-role.txt'); fs.writeFileSync(outside, 'unchanged\n');
  const installedTemplate = path.join(installationRoot, ...inspectInstallation(installationRoot).current.appPath.split('/'), 'templates', 'foundation-project');
  const roles = [ROOT, installationRoot, path.join(installationRoot, 'state'), path.join(installationRoot, 'versions'), path.join(ROOT, 'templates', 'foundation-project'), installedTemplate, built.root, path.join(ROOT, 'examples', 'foundation-events')];
  for (const project of roles) assert.throws(() => createProjectAuthorityPlan({operation: 'enable', project, installationRoot}), (error) => ['PROJECT_ROLE_REJECTED', 'PROJECT_INSTALLATION_OVERLAP'].includes(error.code), project);
  const parent = path.dirname(installationRoot);
  assert.throws(() => createProjectAuthorityPlan({operation: 'enable', project: parent, installationRoot}), (error) => ['PROJECT_ROLE_REJECTED', 'PROJECT_INSTALLATION_OVERLAP'].includes(error.code));
  const real = path.join(root, 'real-project'); fs.mkdirSync(real);
  const link = path.join(root, 'linked-project'); fs.symlinkSync(real, link);
  assert.throws(() => createProjectAuthorityPlan({operation: 'enable', project: link, installationRoot}), (error) => error.code === 'PROJECT_REALPATH_UNSTABLE');
  assert.deepEqual(listProjectAuthorities(installationRoot), []);
  assert.equal(fs.existsSync(path.join(ROOT, '.foundation')), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged\n');
});

test('024R3 create 同样必须 plan/可信宿主授权；自然语言只生成同源 plan，含糊关闭先澄清', (t) => {
  const {root, installationRoot} = projectFixture('authority-conversation-');
  t.after(() => removeTempDirectory(root));
  const project = projectFixturePath(root, 'created-project');
  const createPlan = createProjectAuthorityPlan({operation: 'enable', project, installationRoot, createFromTemplate: true, now: 1000});
  assert.equal(fs.existsSync(project), false);
  applyProjectForTest(createPlan);
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'enabled');
  assert.equal(fs.existsSync(path.join(project, '.foundation', 'facts')), true);
  const ambiguous = projectAuthorityFromNaturalLanguage('关闭 Foundation', {project, installationRoot});
  assert.equal(ambiguous.status, 'clarification-required');
  assert.equal(ambiguous.applies, false);
  const natural = projectAuthorityFromNaturalLanguage('请停用 Foundation 对这个项目的管理', {project, installationRoot, now: 2000});
  assert.equal(natural.status, 'confirmation-required');
  assert.equal(natural.applies, false);
  assert.equal(natural.plan.operation, 'disable');
  assert.match(natural.explanation, new RegExp(project.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(natural.explanation, /保留项/u);
});

test('026 replacement: empty-PATH project CLI plan/explain 同源且普通 apply 零写入拒绝', (t) => {
  const {root, installationRoot} = projectFixture('authority-cli-');
  t.after(() => removeTempDirectory(root));
  const project = projectFixturePath(root, 'cli-project'); fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'README.md'), 'cli smoke\n');
  const cli = path.join(ROOT, 'packages', 'cli', 'index.mjs');
  const planFile = path.join(root, 'enable-plan.json');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PATH: '', NODE_OPTIONS: `--import=${path.join(ROOT, 'tests/helpers/register-test-host.mjs')}`}});
  const planned = run(['project', 'enable', 'plan', '--project', project, '--root', installationRoot, '--format', 'json']);
  assert.equal(planned.status, 0, planned.stderr);
  const plan = JSON.parse(planned.stdout);
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  const text = run(['project', 'explain', '--plan', planFile, '--format', 'text']);
  const json = run(['project', 'explain', '--plan', planFile, '--format', 'json']);
  assert.equal(text.status, 0, text.stderr);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(text.stdout.trim(), explainProjectAuthorityPlan(plan));
  assert.deepEqual(JSON.parse(json.stdout), plan);
  const before = fileSnapshot(project);
  const enabled = run(['project', 'enable', 'apply', '--plan', planFile]);
  assert.equal(enabled.status, 1);
  assert.match(enabled.stderr, /apply 普通 CLI 入口已关闭.*manager open/u);
  assert.deepEqual(fileSnapshot(project), before);
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'unmanaged');
});
