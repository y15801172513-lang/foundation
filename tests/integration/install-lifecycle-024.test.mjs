import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

import {
  SHADCN_ADAPTER,
  applyLifecyclePlan,
  applyProjectAuthorityPlan,
  buildCandidate,
  canonicalStringify,
  createLifecyclePlan,
  createProjectAuthorityPlan,
  hashDirectory,
  inspectInstallation,
  validateCandidate,
  sha256,
} from '../helpers/internal-core.mjs';
import {ROOT, makeScopedTempDirectory, makeTempDirectory, projectFixturePath, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest, applyProjectForTest, authorizeLifecycle, authorizeProjectMutation} from '../helpers/test-authorization.mjs';

function fixtureSource(root, version, runtimeSource = null) {
  const source = path.join(root, `source-${version}`);
  fs.mkdirSync(path.join(source, 'app'), {recursive: true});
  fs.writeFileSync(path.join(source, 'app', 'foundation-smoke.mjs'), `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)},runtime:process.execPath}))\n`);
  fs.writeFileSync(path.join(source, 'app', 'version.txt'), `${version}\n`);
  fs.mkdirSync(path.join(source, 'app', 'artifacts', 'skills', 'ai-product-foundation-kit'), {recursive: true});
  fs.writeFileSync(path.join(source, 'app', 'artifacts', 'skills', 'ai-product-foundation-kit', 'SKILL.md'), '---\nname: ai-product-foundation-kit\ndescription: fixture\n---\n');
  return {source, runtimeSource};
}

function candidate(root, version, {platform = process.platform, arch = process.arch, runtimeSource = null} = {}) {
  const fixture = fixtureSource(root, version, runtimeSource);
  if (!runtimeSource) {
    runtimeSource = path.join(root, 'fixture-private-node');
    if (!fs.existsSync(runtimeSource)) {
      fs.copyFileSync(process.execPath, runtimeSource);
      fs.chmodSync(runtimeSource, 0o755);
    }
  }
  const outputRoot = path.join(root, `candidate-${version}-${crypto.randomUUID()}`);
  return buildCandidate({sourceRoot: fixture.source, outputRoot, productVersion: version, platform, arch, runtimeSource, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
}

function planFor({operation, installRoot, sandboxRoot, candidateInfo, version, currentVersion = null, mode, now = 1000, profile = 'core', networkRequired = false}) {
  return createLifecyclePlan({operation, profile, mode, targetRoot: installRoot, sandboxRoot, currentVersion, targetVersion: version, candidate: candidateInfo ? {path: candidateInfo.root, manifestHash: candidateInfo.manifest.candidateHash, bytes: candidateInfo.manifest.totalBytes, networkRequired} : null, now});
}

function apply(plan, options = {}) {
  return applyLifecycleForTest(plan, options);
}

test('候选包同输入内容稳定，损坏哈希和路径穿越被拒绝', (t) => {
  const root = makeTempDirectory('024-candidate-');
  t.after(() => removeTempDirectory(root));
  const source = fixtureSource(root, '0.2.0').source;
  const first = buildCandidate({sourceRoot: source, outputRoot: path.join(root, 'a'), productVersion: '0.2.0', platform: process.platform, arch: process.arch, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
  const second = buildCandidate({sourceRoot: source, outputRoot: path.join(root, 'b'), productVersion: '0.2.0', platform: process.platform, arch: process.arch, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
  assert.equal(first.manifest.candidateHash, second.manifest.candidateHash);
  assert.equal(hashDirectory(first.root), hashDirectory(second.root));
  assert.equal(validateCandidate(first.root, {platform: process.platform, arch: process.arch}).ok, true);
  fs.appendFileSync(path.join(first.root, 'payload', 'app', 'version.txt'), 'tamper');
  assert.equal(validateCandidate(first.root, {platform: process.platform, arch: process.arch}).error.code, 'CANDIDATE_HASH_MISMATCH');
  const manifestFile = path.join(second.root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.files[0].path = '../escape';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  assert.equal(validateCandidate(second.root, {platform: process.platform, arch: process.arch}).error.code, 'MANIFEST_PATH_INVALID');
});

test('错误签名和非 HTTPS 远程来源被候选验证拒绝', (t) => {
  const root = makeTempDirectory('024-candidate-trust-');
  t.after(() => removeTempDirectory(root));
  const invalidSignature = candidate(root, '0.2.0');
  const signatureFile = path.join(invalidSignature.root, 'manifest.json');
  const signatureManifest = JSON.parse(fs.readFileSync(signatureFile, 'utf8'));
  signatureManifest.signature = {status: 'invalid'};
  const {candidateHash: ignoredSignatureHash, ...signatureBase} = signatureManifest;
  signatureManifest.candidateHash = sha256(canonicalStringify(signatureBase));
  fs.writeFileSync(signatureFile, JSON.stringify(signatureManifest, null, 2));
  assert.equal(validateCandidate(invalidSignature.root).error.code, 'CANDIDATE_SIGNATURE_INVALID');

  const claimedVerified = candidate(root, '0.2.2');
  const verifiedFile = path.join(claimedVerified.root, 'manifest.json');
  const verifiedManifest = JSON.parse(fs.readFileSync(verifiedFile, 'utf8'));
  verifiedManifest.signature = {status: 'verified', productionDistribution: false, signer: 'fixture'};
  const {candidateHash: ignoredVerifiedHash, ...verifiedBase} = verifiedManifest;
  verifiedManifest.candidateHash = sha256(canonicalStringify(verifiedBase));
  fs.writeFileSync(verifiedFile, JSON.stringify(verifiedManifest, null, 2));
  assert.equal(validateCandidate(claimedVerified.root).error.code, 'SIGNATURE_VERIFIER_REQUIRED');
  assert.equal(validateCandidate(claimedVerified.root, {signatureVerifier: () => false}).error.code, 'CANDIDATE_SIGNATURE_INVALID');

  const source = fixtureSource(root, '0.2.1').source;
  const remote = buildCandidate({sourceRoot: source, outputRoot: path.join(root, 'remote'), productVersion: '0.2.1', platform: process.platform, arch: process.arch, runtimeSource: process.execPath, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'remote', sourceUrl: 'http://example.invalid/candidate'});
  assert.equal(validateCandidate(remote.root).error.code, 'CANDIDATE_SOURCE_NOT_HTTPS');
  const httpsRemote = buildCandidate({sourceRoot: source, outputRoot: path.join(root, 'https-remote'), productVersion: '0.2.1', platform: process.platform, arch: process.arch, runtimeSource: process.execPath, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'remote', sourceUrl: 'https://downloads.example.invalid/candidate'});
  assert.equal(validateCandidate(httpsRemote.root).error.code, 'CANDIDATE_SOURCE_NOT_ALLOWED');
  assert.equal(validateCandidate(httpsRemote.root, {allowedSources: ['https://downloads.example.invalid']}).ok, true);
});

test('私有 runtime 候选在空 PATH 下运行，不依赖全局 node/npm', (t) => {
  const root = makeTempDirectory('024-private-runtime-');
  t.after(() => removeTempDirectory(root));
  const built = candidate(root, '0.2.0', {runtimeSource: process.execPath});
  const installed = path.join(root, 'user-root');
  const plan = planFor({operation: 'install', installRoot: installed, sandboxRoot: root, candidateInfo: built, version: '0.2.0'});
  assert.equal(apply(plan).ok, true);
  const status = inspectInstallation(installed);
  const runtime = path.join(installed, status.current.runtimePath);
  const entry = path.join(installed, status.current.entrypoint);
  const run = spawnSync(runtime, [entry], {encoding: 'utf8', env: {PATH: ''}});
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {ok: true, version: '0.2.0', runtime});
  const shim = path.join(installed, 'bin', process.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit');
  if (process.platform !== 'win32') {
    const shimRun = spawnSync('/bin/sh', [shim], {encoding: 'utf8', env: {PATH: ''}});
    assert.equal(shimRun.status, 0, shimRun.stderr);
    assert.deepEqual(JSON.parse(shimRun.stdout), {ok: true, version: '0.2.0', runtime});
  }
});

test('install/update/失败恢复/rollback/repair 与三种卸载模式形成闭环', (t) => {
  const root = makeTempDirectory('024-lifecycle-');
  t.after(() => removeTempDirectory(root));
  const installRoot = path.join(root, 'user-root');
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  const install = planFor({operation: 'install', installRoot, sandboxRoot: root, candidateInfo: v1, version: '0.2.0'});
  assert.equal(apply(install).state, 'installed');
  const interrupted = planFor({operation: 'update', installRoot, sandboxRoot: root, candidateInfo: v2, version: '0.2.1', currentVersion: '0.2.0'});
  assert.throws(() => apply(interrupted, {faultAt: 'before-current-switch'}), (error) => error.code === 'FAULT_INJECTED');
  assert.equal(inspectInstallation(installRoot).current.version, '0.2.0');
  assert.equal(apply(interrupted).state, 'updated');
  assert.equal(inspectInstallation(installRoot).current.version, '0.2.1');
  const rollback = planFor({operation: 'rollback', installRoot, sandboxRoot: root, version: '0.2.0', currentVersion: '0.2.1'});
  assert.equal(apply(rollback).state, 'rolled-back');
  const appFile = path.join(installRoot, inspectInstallation(installRoot).current.appPath, 'version.txt');
  fs.writeFileSync(appFile, 'user-modified\n');
  const repair = planFor({operation: 'repair', installRoot, sandboxRoot: root, candidateInfo: v1, version: '0.2.0', currentVersion: '0.2.0'});
  const repaired = apply(repair);
  assert.equal(repaired.state, 'repaired');
  assert.equal(fs.readFileSync(appFile, 'utf8'), '0.2.0\n');
  assert.ok(repaired.quarantined.length > 0);

  for (const mode of ['app-only', 'app-and-runtime', 'full']) {
    const isolated = path.join(root, `uninstall-${mode}`);
    const fresh = planFor({operation: 'install', installRoot: isolated, sandboxRoot: root, candidateInfo: v1, version: '0.2.0'});
    apply(fresh);
    fs.mkdirSync(path.join(isolated, 'user-products', 'example', '.foundation', 'facts'), {recursive: true});
    fs.writeFileSync(path.join(isolated, 'user-products', 'example', '.foundation', 'facts', 'project.json'), '{"preserve":true}\n');
    const factsHash = hashDirectory(path.join(isolated, 'user-products'));
    const uninstall = planFor({operation: 'uninstall', installRoot: isolated, sandboxRoot: root, version: '0.2.0', currentVersion: '0.2.0', mode});
    assert.equal(apply(uninstall).state, 'uninstalled');
    assert.equal(hashDirectory(path.join(isolated, 'user-products')), factsHash);
    assert.ok(fs.existsSync(path.join(isolated, 'uninstall-result.json')));
    if (mode === 'app-only') assert.ok(fs.existsSync(path.join(isolated, 'runtimes')));
    if (mode === 'full') assert.equal(fs.existsSync(path.join(isolated, 'integrations')), false);
  }
});

test('安装、更新、回退、修复和卸载均不改产品 facts 或模拟全局环境', (t) => {
  const root = makeTempDirectory('024-data-independence-');
  t.after(() => removeTempDirectory(root));
  const installRoot = path.join(root, 'foundation-install');
  const project = path.join(root, 'user-product');
  const externalEnvironment = path.join(root, 'existing-global-tools');
  fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
  fs.writeFileSync(path.join(project, '.foundation', 'facts', 'project.json'), '{"preserve":true}\n');
  fs.mkdirSync(externalEnvironment, {recursive: true});
  fs.writeFileSync(path.join(externalEnvironment, 'node-version.txt'), 'v16-old-or-v99-new-must-remain\n');
  const factsHash = hashDirectory(path.join(project, '.foundation', 'facts'));
  const environmentHash = hashDirectory(externalEnvironment);
  const assertIndependent = () => {
    assert.equal(hashDirectory(path.join(project, '.foundation', 'facts')), factsHash);
    assert.equal(hashDirectory(externalEnvironment), environmentHash);
  };
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  apply(planFor({operation: 'install', installRoot, sandboxRoot: root, candidateInfo: v1, version: '0.2.0'}));
  assertIndependent();
  apply(planFor({operation: 'update', installRoot, sandboxRoot: root, candidateInfo: v2, version: '0.2.1', currentVersion: '0.2.0'}));
  assertIndependent();
  apply(planFor({operation: 'rollback', installRoot, sandboxRoot: root, version: '0.2.0', currentVersion: '0.2.1'}));
  assertIndependent();
  apply(planFor({operation: 'repair', installRoot, sandboxRoot: root, candidateInfo: v1, version: '0.2.0', currentVersion: '0.2.0'}));
  assertIndependent();
  apply(planFor({operation: 'uninstall', installRoot, sandboxRoot: root, version: '0.2.0', currentVersion: '0.2.0', mode: 'full'}));
  assertIndependent();
});

test('推荐安装只保留惰性 capability artifact，不自动创建 host registration', (t) => {
  const root = makeTempDirectory('024-profile-');
  t.after(() => removeTempDirectory(root));
  const built = candidate(root, '0.2.0');
  const recommendedRoot = path.join(root, 'recommended');
  apply(planFor({operation: 'install', installRoot: recommendedRoot, sandboxRoot: root, candidateInfo: built, version: '0.2.0', profile: 'recommended'}));
  assert.equal(fs.existsSync(path.join(recommendedRoot, 'integrations')), false);
  assert.ok(fs.existsSync(path.join(recommendedRoot, 'versions', '0.2.0', 'app', 'artifacts', 'skills', 'ai-product-foundation-kit', 'SKILL.md')));
  const coreRoot = path.join(root, 'core');
  apply(planFor({operation: 'install', installRoot: coreRoot, sandboxRoot: root, candidateInfo: built, version: '0.2.0', profile: 'core'}));
  assert.equal(fs.existsSync(path.join(coreRoot, 'integrations')), false);
});

test('下载、验证、staging、PATH shim、健康检查和 current 切换故障均不污染 current', (t) => {
  const root = makeTempDirectory('024-faults-');
  t.after(() => removeTempDirectory(root));
  const built = candidate(root, '0.2.0');
  for (const stage of ['download', 'after-verify', 'after-staging', 'before-path-shim', 'after-path-shim', 'health-check', 'before-current-switch', 'after-current-switch']) {
    const installRoot = path.join(root, stage);
    const plan = planFor({operation: 'install', installRoot, sandboxRoot: root, candidateInfo: built, version: '0.2.0', profile: 'recommended'});
    assert.throws(() => apply(plan, {faultAt: stage}), (error) => error.code === 'FAULT_INJECTED', stage);
    assert.equal(inspectInstallation(installRoot).installed, false, stage);
    assert.equal(fs.existsSync(path.join(installRoot, 'staging', plan.planId)), false, stage);
  }
});

test('更新在 shim 或 current 切换前后中断会恢复旧入口和旧状态', (t) => {
  const root = makeTempDirectory('024-update-atomicity-');
  t.after(() => removeTempDirectory(root));
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  for (const stage of ['after-path-shim', 'after-current-switch']) {
    const installRoot = path.join(root, stage);
    apply(planFor({operation: 'install', installRoot, sandboxRoot: root, candidateInfo: v1, version: '0.2.0'}));
    const shim = path.join(installRoot, 'bin', process.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit');
    const beforeShim = fs.readFileSync(shim);
    const update = planFor({operation: 'update', installRoot, sandboxRoot: root, candidateInfo: v2, version: '0.2.1', currentVersion: '0.2.0'});
    assert.throws(() => apply(update, {faultAt: stage}), (error) => error.code === 'FAULT_INJECTED', stage);
    assert.equal(inspectInstallation(installRoot).current.version, '0.2.0', stage);
    assert.deepEqual(fs.readFileSync(shim), beforeShim, stage);
  }
});

test('网络断开、磁盘不足和卸载 finalizer 故障提供确定恢复边界', (t) => {
  const root = makeTempDirectory('024-resource-faults-');
  t.after(() => removeTempDirectory(root));
  const built = candidate(root, '0.2.0');
  const diskRoot = path.join(root, 'disk');
  const diskPlan = planFor({operation: 'install', installRoot: diskRoot, sandboxRoot: root, candidateInfo: built, version: '0.2.0'});
  assert.throws(() => apply(diskPlan, {availableBytes: 0}), (error) => error.code === 'DISK_SPACE_INSUFFICIENT');
  assert.equal(fs.existsSync(diskRoot), false);
  const networkRoot = path.join(root, 'network');
  const networkPlan = planFor({operation: 'install', installRoot: networkRoot, sandboxRoot: root, candidateInfo: built, version: '0.2.0', networkRequired: true});
  assert.throws(() => apply(networkPlan, {networkDisconnected: true}), (error) => error.code === 'NETWORK_UNAVAILABLE');
  assert.equal(inspectInstallation(networkRoot).installed, false);
  const installed = path.join(root, 'uninstall-finalizer');
  apply(planFor({operation: 'install', installRoot: installed, sandboxRoot: root, candidateInfo: built, version: '0.2.0'}));
  const uninstall = planFor({operation: 'uninstall', installRoot: installed, sandboxRoot: root, version: '0.2.0', currentVersion: '0.2.0', mode: 'full'});
  assert.throws(() => apply(uninstall, {faultAt: 'uninstall-finalizer'}), (error) => error.code === 'FAULT_INJECTED');
  assert.equal(inspectInstallation(installed).current.version, '0.2.0');
  assert.throws(() => apply(uninstall, {faultAt: 'uninstall-delete'}), (error) => error.code === 'FAULT_INJECTED');
  assert.equal(inspectInstallation(installed).current.version, '0.2.0');
  assert.equal(apply(uninstall).state, 'uninstalled');
});

test('卸载只删除 receipt 匹配文件，保留用户修改与未知版本', (t) => {
  const root = makeTempDirectory('024-uninstall-ownership-');
  t.after(() => removeTempDirectory(root));
  const built = candidate(root, '0.2.0');
  const installed = path.join(root, 'install');
  apply(planFor({operation: 'install', installRoot: installed, sandboxRoot: root, candidateInfo: built, version: '0.2.0'}));
  const modified = path.join(installed, 'versions', '0.2.0', 'app', 'version.txt');
  fs.writeFileSync(modified, 'user-modified\n');
  const unknown = path.join(installed, 'versions', '9.9.9', 'unknown.txt');
  fs.mkdirSync(path.dirname(unknown), {recursive: true});
  fs.writeFileSync(unknown, 'unknown owner\n');
  const uninstall = planFor({operation: 'uninstall', installRoot: installed, sandboxRoot: root, version: '0.2.0', currentVersion: '0.2.0', mode: 'full'});
  const result = apply(uninstall);
  assert.ok(result.preservedModified.includes('versions/0.2.0/app/version.txt'));
  assert.ok(fs.existsSync(modified));
  assert.ok(fs.existsSync(unknown));
});

test('已完成 plan 不能作为可重放凭据，并发锁与 symlink 越界安全失败', (t) => {
  const root = makeTempDirectory('024-safety-');
  t.after(() => removeTempDirectory(root));
  const built = candidate(root, '0.2.0');
  const installRoot = path.join(root, 'user-root');
  const plan = planFor({operation: 'install', installRoot, sandboxRoot: root, candidateInfo: built, version: '0.2.0'});
  apply(plan);
  assert.throws(() => apply(plan), (error) => ['TARGET_REPLACED_AFTER_PLAN', 'HUMAN_AUTHORIZATION_REPLAYED'].includes(error.code));
  fs.writeFileSync(path.join(installRoot, '.foundation-operation.lock'), 'other');
  const secondRoot = path.join(root, 'second-root');
  fs.mkdirSync(secondRoot, {recursive: true});
  const secondPlan = planFor({operation: 'install', installRoot: secondRoot, sandboxRoot: root, candidateInfo: built, version: '0.2.0'});
  fs.writeFileSync(path.join(secondRoot, '.foundation-operation.lock'), 'other');
  assert.throws(() => apply(secondPlan), (error) => ['OPERATION_LOCKED', 'OPERATION_RECOVERY_MANUAL'].includes(error.code));
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  const linked = path.join(root, 'linked-root');
  fs.symlinkSync(outside, linked, 'dir');
  assert.throws(() => planFor({operation: 'install', installRoot: linked, sandboxRoot: root, candidateInfo: built, version: '0.2.0'}), (error) => ['TARGET_SYMLINK_REJECTED', 'TARGET_SYMLINK_ANCESTOR_REJECTED'].includes(error.code));
});

test('shadcn adapter 使用本地 registry 元数据且保持产品 facts 递归哈希不变', (t) => {
  const root = makeScopedTempDirectory('project-authority-sandboxes', '024-shadcn-');
  t.after(() => removeTempDirectory(root));
  const installRoot = path.join(root, 'foundation-install');
  const built = candidate(root, '0.2.0');
  apply(planFor({operation: 'install', installRoot, sandboxRoot: root, candidateInfo: built, version: '0.2.0'}));
  const project = projectFixturePath(root, 'project');
  fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
  fs.writeFileSync(path.join(project, '.foundation', 'facts', 'project.json'), '{"schemaVersion":"0.1.0","items":[]}\n');
  fs.writeFileSync(path.join(project, 'components.json'), JSON.stringify({aliases: {ui: '@/components/ui'}, registries: {foundation: 'local'}}, null, 2));
  const enable = createProjectAuthorityPlan({operation: 'enable', project, installationRoot: installRoot});
  applyProjectForTest(enable);
  const registry = {schemaVersion: '1.0.0', name: 'foundation-local', item: {name: 'notice', version: '1.0.0', license: 'MIT', files: [{path: 'components/ui/notice.tsx', content: 'export const Notice = () => null\n'}]}};
  const before = hashDirectory(path.join(project, '.foundation', 'facts'));
  const plan = SHADCN_ADAPTER.plan({project, installationRoot: installRoot, registry});
  authorizeProjectMutation(plan.mutationPlan);
  assert.equal(SHADCN_ADAPTER.apply(plan).ok, true);
  assert.equal(SHADCN_ADAPTER.verify(plan).ok, true);
  assert.equal(hashDirectory(path.join(project, '.foundation', 'facts')), before);
  assert.ok(fs.existsSync(path.join(project, 'components', 'ui', 'notice.tsx')));
  fs.writeFileSync(path.join(project, 'components', 'ui', 'notice.tsx'), 'user changed\n');
  const removeMutationPlan = SHADCN_ADAPTER.planRemove(plan);
  authorizeProjectMutation(removeMutationPlan);
  assert.equal(SHADCN_ADAPTER.removeOwned(plan, {mutationPlan: removeMutationPlan}).ok, false);
  assert.ok(fs.existsSync(path.join(project, 'components', 'ui', 'notice.tsx')));
});

test('026 replacement: CLI 保留白话菜单与纯读 plan，普通 apply 必须打开 manager', (t) => {
  const root = makeTempDirectory('024-cli-');
  t.after(() => removeTempDirectory(root));
  const cli = path.join(ROOT, 'packages', 'cli', 'index.mjs');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], {cwd: ROOT, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: `--import=${path.join(ROOT, 'tests/helpers/register-test-host.mjs')}`}});
  assert.match(run([]).stdout, /你想做什么/);
  const built = candidate(root, '0.2.0');
  const installRoot = path.join(root, 'install');
  const planFile = path.join(root, 'plan.json');
  const planned = run(['install', 'plan', '--profile', 'core', '--root', installRoot, '--sandbox-root', root, '--candidate', built.root, '--format', 'json']);
  assert.equal(planned.status, 0, planned.stderr);
  const plan = JSON.parse(planned.stdout);
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  const before = hashDirectory(root);
  const applied = run(['install', 'apply', '--plan', planFile]);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /apply 普通 CLI 入口已关闭.*manager open/u);
  assert.equal(fs.existsSync(installRoot), false);
  assert.equal(hashDirectory(root), before);
});
