import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  applyLifecyclePlan,
  buildCandidate,
  canonicalStringify,
  createLifecyclePlan,
  hashDirectory,
  inspectInstallation,
  sha256,
} from '../helpers/internal-core.mjs';
import {signTrustedPayload} from '../../packages/core/trusted-authority.mjs';
import {makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest} from '../helpers/test-authorization.mjs';

function source(root, version, {entrypoint = null} = {}) {
  const directory = path.join(root, `source-${version}-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(directory, 'app'), {recursive: true});
  fs.writeFileSync(path.join(directory, 'app', 'foundation-smoke.mjs'), entrypoint ?? `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))\n`);
  fs.writeFileSync(path.join(directory, 'app', 'version.txt'), `${version}\n`);
  fs.writeFileSync(path.join(directory, 'app', 'extra.txt'), 'complete-set\n');
  fs.mkdirSync(path.join(directory, 'app', 'skills', 'ai-product-foundation-kit'), {recursive: true});
  fs.writeFileSync(path.join(directory, 'app', 'skills', 'ai-product-foundation-kit', 'SKILL.md'), '---\nname: ai-product-foundation-kit\ndescription: fixture\n---\n');
  return directory;
}

function candidate(root, version, options = {}) {
  const runtimeSource = path.join(root, `runtime-${crypto.randomUUID()}`);
  if (options.runtimeSource) {
    const built = buildCandidate({sourceRoot: source(root, version, options), outputRoot: path.join(root, `candidate-${crypto.randomUUID()}`), productVersion: version, platform: options.platform ?? process.platform, arch: options.arch ?? process.arch, runtimeSource: options.runtimeSource, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
    if (options.runtimeMode !== undefined) {
      const runtime = built.manifest.files.find((record) => record.path === built.manifest.runtime.path);
      runtime.mode = options.runtimeMode;
      fs.chmodSync(path.join(built.root, 'payload', ...runtime.path.split('/')), options.runtimeMode);
      const {candidateHash: ignored, ...base} = built.manifest;
      built.manifest.candidateHash = sha256(canonicalStringify(base));
      fs.writeFileSync(path.join(built.root, 'manifest.json'), `${JSON.stringify(built.manifest, null, 2)}\n`);
    }
    return built;
  }
  fs.copyFileSync(process.execPath, runtimeSource);
  fs.chmodSync(runtimeSource, options.runtimeMode ?? 0o755);
  return buildCandidate({sourceRoot: source(root, version, options), outputRoot: path.join(root, `candidate-${crypto.randomUUID()}`), productVersion: version, platform: options.platform ?? process.platform, arch: options.arch ?? process.arch, runtimeSource, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
}

function planFor({operation, root, target, built, version, currentVersion = null, mode = null, profile = 'core'}) {
  return createLifecyclePlan({
    operation, profile, mode, targetRoot: target, sandboxRoot: root, currentVersion,
    targetVersion: version,
    candidate: built ? {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: built.manifest.files.find((record) => record.path === built.manifest.runtime.path).sha256, bytes: built.manifest.totalBytes, version, acquisition: 'local-ingestion'} : null,
    now: 1000,
  });
}

const apply = (plan) => applyLifecycleForTest(plan);

test('024R1 已存在 app/runtime 必须完整一致，冲突不能切换 current', (t) => {
  const root = makeTempDirectory('024r1-collision-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const built = candidate(root, '0.2.0');
  const runtimeHash = built.manifest.files.find((record) => record.path === built.manifest.runtime.path).sha256;
  const runtimeId = `node-${runtimeHash.slice(0, 16)}`;
  fs.mkdirSync(path.join(target, 'versions', '0.2.0', 'app'), {recursive: true});
  fs.writeFileSync(path.join(target, 'versions', '0.2.0', 'app', 'version.txt'), 'tampered\n');
  fs.mkdirSync(path.join(target, 'runtimes', runtimeId, 'bin'), {recursive: true});
  fs.writeFileSync(path.join(target, 'runtimes', runtimeId, 'bin', 'node'), 'tampered runtime\n');
  const plan = planFor({operation: 'install', root, target, built, version: '0.2.0'});
  assert.throws(() => apply(plan), (error) => ['APP_VERSION_COLLISION', 'RUNTIME_COLLISION'].includes(error.code));
  assert.equal(inspectInstallation(target).installed, false);
});

test('024R1 tampered shared runtime、缺文件和同版本不同 manifest 均拒绝复用', (t) => {
  const root = makeTempDirectory('024r1-existing-integrity-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));
  const current = inspectInstallation(target).current;
  fs.writeFileSync(path.join(target, current.runtimePath), 'tampered runtime\n');
  const v2 = candidate(root, '0.2.1');
  assert.throws(() => apply(planFor({operation: 'update', root, target, built: v2, version: '0.2.1', currentVersion: '0.2.0'})), (error) => error.code === 'RUNTIME_COLLISION');
  assert.equal(inspectInstallation(target).current.version, '0.2.0');

  fs.copyFileSync(path.join(v1.root, 'payload', ...v1.manifest.runtime.path.split('/')), path.join(target, current.runtimePath));
  fs.chmodSync(path.join(target, current.runtimePath), 0o755);
  fs.rmSync(path.join(target, current.appPath, 'extra.txt'));
  assert.throws(() => apply(planFor({operation: 'update', root, target, built: v1, version: '0.2.0', currentVersion: '0.2.0'})), (error) => error.code === 'APP_VERSION_COLLISION');

  fs.copyFileSync(path.join(v1.root, 'payload', 'app', 'extra.txt'), path.join(target, current.appPath, 'extra.txt'));
  const different = candidate(root, '0.2.0', {entrypoint: 'console.log(JSON.stringify({ok:true,version:"0.2.0"}))\n// same version, different manifest\n'});
  assert.throws(() => apply(planFor({operation: 'update', root, target, built: different, version: '0.2.0', currentVersion: '0.2.0'})), (error) => error.code === 'APP_VERSION_COLLISION');
});

test('024R1 install identity 贯穿 current/receipt，repair 必须完全匹配当前 identity', (t) => {
  const root = makeTempDirectory('024r1-identity-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  const installed = apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));
  assert.equal(installed.current.identity.productVersion, '0.2.0');
  assert.equal(installed.current.identity.candidateManifestHash, v1.manifest.candidateHash);
  assert.equal(installed.current.identity.platform, process.platform);
  assert.equal(installed.current.identity.architecture, process.arch);
  assert.match(installed.current.identity.installId, /^install-/u);
  const receipt = JSON.parse(fs.readFileSync(path.join(target, 'state', 'receipts', '0.2.0.json'), 'utf8'));
  assert.deepEqual(receipt.identity, installed.current.identity);

  const differentContent = candidate(root, '0.2.0', {entrypoint: 'console.log(JSON.stringify({ok:true,version:"different"}))\n'});
  const repairHashMismatch = planFor({operation: 'repair', root, target, built: differentContent, version: '0.2.0', currentVersion: '0.2.0'});
  assert.throws(() => apply(repairHashMismatch), (error) => error.code === 'REPAIR_IDENTITY_MISMATCH');
  const newer = candidate(root, '0.2.1');
  const repairVersionMismatch = planFor({operation: 'repair', root, target, built: newer, version: '0.2.1', currentVersion: '0.2.0'});
  assert.throws(() => apply(repairVersionMismatch), (error) => error.code === 'REPAIR_IDENTITY_MISMATCH');
});

test('024R1 health probe 拒绝不可执行 runtime 和失败入口，旧 current 保持不变', (t) => {
  const root = makeTempDirectory('024r1-health-');
  t.after(() => removeTempDirectory(root));
  const nonExecutable = path.join(root, 'not-executable-node');
  fs.copyFileSync(process.execPath, nonExecutable);
  fs.chmodSync(nonExecutable, 0o644);
  const badRuntime = candidate(root, '0.2.0', {runtimeSource: nonExecutable, runtimeMode: 0o644});
  assert.throws(() => apply(planFor({operation: 'install', root, target: path.join(root, 'bad-runtime-install'), built: badRuntime, version: '0.2.0'})), (error) => error.code === 'EXECUTABLE_HEALTH_FAILED');

  const target = path.join(root, 'install');
  const healthy = candidate(root, '0.2.0');
  apply(planFor({operation: 'install', root, target, built: healthy, version: '0.2.0'}));
  const failing = candidate(root, '0.2.1', {entrypoint: 'process.exit(23)\n'});
  assert.throws(() => apply(planFor({operation: 'update', root, target, built: failing, version: '0.2.1', currentVersion: '0.2.0'})), (error) => error.code === 'EXECUTABLE_HEALTH_FAILED');
  assert.equal(inspectInstallation(target).current.version, '0.2.0');
  assert.equal(inspectInstallation(target).recovery.status, 'clean', '030R1: completed rollback must not leave a missing consumed-guard dead end');
});

test('024R1 rollback 验证完整 receipt/runtime/health，损坏目标不会切换', (t) => {
  const root = makeTempDirectory('024r1-rollback-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));
  apply(planFor({operation: 'update', root, target, built: v2, version: '0.2.1', currentVersion: '0.2.0'}));
  fs.writeFileSync(path.join(target, 'versions', '0.2.0', 'app', 'extra.txt'), 'damaged\n');
  const rollback = planFor({operation: 'rollback', root, target, version: '0.2.0', currentVersion: '0.2.1'});
  assert.throws(() => apply(rollback), (error) => error.code === 'ROLLBACK_TARGET_UNHEALTHY');
  assert.equal(inspectInstallation(target).current.version, '0.2.1');
});

test('024R1 full uninstall 只保留最小结果、修改与未知文件，重复执行确定', (t) => {
  const root = makeTempDirectory('024r1-full-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const built = candidate(root, '0.2.0');
  apply(planFor({operation: 'install', root, target, built, version: '0.2.0', profile: 'recommended'}));
  const modified = path.join(target, 'versions', '0.2.0', 'app', 'version.txt');
  fs.writeFileSync(modified, 'user modified\n');
  const unknown = path.join(target, 'versions', '9.9.9', 'unknown.txt');
  fs.mkdirSync(path.dirname(unknown), {recursive: true});
  fs.writeFileSync(unknown, 'unknown\n');
  const products = path.join(target, 'user-products', 'example', '.foundation', 'facts');
  fs.mkdirSync(products, {recursive: true});
  fs.writeFileSync(path.join(products, 'project.json'), '{"keep":true}\n');
  const productsHash = hashDirectory(path.join(target, 'user-products'));
  const uninstall = planFor({operation: 'uninstall', root, target, version: '0.2.0', currentVersion: '0.2.0', mode: 'full'});
  const result = apply(uninstall);
  assert.equal(result.state, 'uninstalled');
  assert.equal(inspectInstallation(target).installed, false);
  for (const relative of ['state/current.json', 'state/installations.json', 'state/receipts', 'state/journals', 'state/operations', 'cache', 'logs', 'integrations']) assert.equal(fs.existsSync(path.join(target, relative)), false, relative);
  assert.ok(fs.existsSync(path.join(target, 'uninstall-result.json')));
  assert.ok(fs.existsSync(modified));
  assert.ok(fs.existsSync(unknown));
  assert.equal(hashDirectory(path.join(target, 'user-products')), productsHash);
  const persistedResult = JSON.parse(fs.readFileSync(path.join(target, 'uninstall-result.json'), 'utf8'));
  assert.ok(persistedResult.residualPaths.includes('versions/0.2.0/app/version.txt'));
  assert.ok(persistedResult.residualPaths.includes('versions/9.9.9/unknown.txt'));
  assert.throws(() => apply(uninstall), (error) => ['NOT_INSTALLED', 'TARGET_REPLACED_AFTER_PLAN', 'HUMAN_AUTHORIZATION_REPLAYED'].includes(error.code));
});

test('024R1 三种卸载模式执行机器矩阵，并保护 symlink 外部目标', (t) => {
  const root = makeTempDirectory('024r1-uninstall-matrix-');
  t.after(() => removeTempDirectory(root));
  const built = candidate(root, '0.2.0');
  for (const mode of ['app-only', 'app-and-runtime', 'full']) {
    const target = path.join(root, mode);
    apply(planFor({operation: 'install', root, target, built, version: '0.2.0', profile: 'recommended'}));
    fs.mkdirSync(path.join(target, 'cache'), {recursive: true});
    fs.mkdirSync(path.join(target, 'logs'), {recursive: true});
    const result = apply(planFor({operation: 'uninstall', root, target, version: '0.2.0', currentVersion: '0.2.0', mode}));
    assert.equal(result.matrix.currentPointer, 'delete');
    assert.equal(result.matrix.extensionOwnedIntegrationRecords, mode === 'full' ? 'delete-owned-unmodified' : 'keep');
    assert.equal(result.matrix.finalizerInputs, mode === 'full' ? 'delete-signed-owned' : 'keep');
    assert.equal(result.matrix.modifiedOwnedFiles, 'keep-and-report');
    assert.equal(result.matrix.unknownOwnership, 'keep-and-report');
    assert.equal(inspectInstallation(target).installed, false);
    assert.equal(fs.existsSync(path.join(target, 'versions', '0.2.0', 'app')), false, `${mode}: app`);
    assert.equal(fs.existsSync(path.join(target, 'bin', process.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit')), false, `${mode}: shim`);
    assert.equal(fs.existsSync(path.join(target, 'runtimes')), mode === 'app-only', `${mode}: runtime`);
    assert.equal(fs.existsSync(path.join(target, 'integrations')), false, `${mode}: integrations are never auto-created`);
    assert.equal(fs.existsSync(path.join(target, 'cache')), mode !== 'full', `${mode}: cache`);
    assert.equal(fs.existsSync(path.join(target, 'logs')), mode !== 'full', `${mode}: logs`);
  }

  const symlinkTarget = path.join(root, 'symlink-mode');
  apply(planFor({operation: 'install', root, target: symlinkTarget, built, version: '0.2.0'}));
  const owned = path.join(symlinkTarget, 'versions', '0.2.0', 'app', 'version.txt');
  const outside = path.join(root, 'outside-preserved.txt');
  fs.writeFileSync(outside, 'outside must stay\n');
  fs.rmSync(owned);
  fs.symlinkSync(outside, owned);
  const result = apply(planFor({operation: 'uninstall', root, target: symlinkTarget, version: '0.2.0', currentVersion: '0.2.0', mode: 'full'}));
  assert.ok(result.preservedUnknown.some((entry) => entry.path.endsWith('/version.txt') && entry.reason === 'symlink-preserved'));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside must stay\n');
});

test('024R1 full 删除多个 owned 版本，但保留 foreign-install 共享 runtime', (t) => {
  const root = makeTempDirectory('024r1-shared-runtime-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));
  apply(planFor({operation: 'update', root, target, built: v2, version: '0.2.1', currentVersion: '0.2.0'}));
  const current = inspectInstallation(target).current;
  const receiptFile = path.join(target, 'state', 'receipts', '0.2.1.json');
  const currentReceipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  const {integrity: ignored, ...foreign} = structuredClone(currentReceipt);
  foreign.operationId = 'foreign-operation';
  foreign.identity.installId = 'install-foreign-shared-runtime';
  fs.writeFileSync(path.join(target, 'state', 'receipts', 'foreign.json'), `${JSON.stringify({...foreign, integrity: signTrustedPayload(foreign)}, null, 2)}\n`);
  const result = apply(planFor({operation: 'uninstall', root, target, version: '0.2.1', currentVersion: '0.2.1', mode: 'full'}));
  assert.equal(fs.existsSync(path.join(target, 'versions', '0.2.0', 'app')), false);
  assert.equal(fs.existsSync(path.join(target, 'versions', '0.2.1', 'app')), false);
  assert.ok(result.preservedSharedRuntime.includes(current.runtimePath));
  assert.ok(fs.existsSync(path.join(target, current.runtimePath)));
  assert.equal(inspectInstallation(target).installed, false);
});
