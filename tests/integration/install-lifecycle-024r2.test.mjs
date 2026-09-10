import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import test from 'node:test';

import {
  applyLifecyclePlan,
  buildCandidate,
  createLifecyclePlan,
  inspectInstallation,
  inspectLifecycleRecovery,
  recoverLifecycleState,
  sha256,
} from '../helpers/internal-core.mjs';
import {signTrustedPayload, verifyTrustedPayload} from '../../packages/core/trusted-authority.mjs';
import {ROOT, makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest, authorizeLifecycle} from '../helpers/test-authorization.mjs';

const CHILD = path.join(ROOT, 'tests', 'fixtures', 'lifecycle-child.mjs');

function source(root, version, healthSource = `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))\n`) {
  const directory = path.join(root, `source-${version}-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(directory, 'app'), {recursive: true});
  fs.writeFileSync(path.join(directory, 'app', 'foundation-smoke.mjs'), healthSource);
  fs.writeFileSync(path.join(directory, 'app', 'version.txt'), `${version}\n`);
  fs.writeFileSync(path.join(directory, 'app', 'expected.txt'), 'expected\n');
  return directory;
}

function candidate(root, version, healthSource) {
  const runtime = path.join(root, 'private-node');
  if (!fs.existsSync(runtime)) {
    fs.copyFileSync(process.execPath, runtime);
    fs.chmodSync(runtime, 0o755);
  }
  return buildCandidate({
    sourceRoot: source(root, version, healthSource),
    outputRoot: path.join(root, `candidate-${version}-${crypto.randomUUID()}`),
    productVersion: version,
    platform: process.platform,
    arch: process.arch,
    runtimeSource: runtime,
    entrypoint: 'app/foundation-smoke.mjs',
    sourceKind: 'local-test',
  });
}

function planFor({operation, root, target, built = null, version, currentVersion = null, mode = null}) {
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
    now: 1000,
  });
}

const apply = (plan, options = {}) => applyLifecycleForTest(plan, options);

function recover(root, sandboxRoot, now = Date.now()) {
  const recoverySnapshot = inspectLifecycleRecovery(root);
  const currentVersion = inspectInstallation(root).current?.version || null;
  return applyLifecycleForTest(createLifecyclePlan({operation: 'recover', profile: 'core', targetRoot: root, sandboxRoot, currentVersion, targetVersion: currentVersion, recoverySnapshot, now}));
}

function waitForFile(file, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (fs.existsSync(file)) return resolve(JSON.parse(fs.readFileSync(file, 'utf8')));
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

function spawnFinalizerPause(plan, root, stage, label) {
  const planFile = path.join(root, `${label}.plan.json`);
  const marker = path.join(root, `${label}.marker.json`);
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  authorizeLifecycle(plan);
  return {marker, child: spawn(process.execPath, [CHILD, planFile, 'finalizer', stage, marker], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']})};
}

function signedDocument(file) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const {integrity, ...payload} = document;
  return {document, payload, integrity};
}

function writeSigned(file, payload) {
  fs.writeFileSync(file, `${JSON.stringify({...payload, integrity: signTrustedPayload(payload)}, null, 2)}\n`);
}

test('024R2 strict health schema 拒绝缺失/非法 version、损坏/空/歧义输出且不切换', (t) => {
  const root = makeTempDirectory('024r2-health-first-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const healthy = candidate(root, '0.2.0');
  apply(planFor({operation: 'install', root, target, built: healthy, version: '0.2.0'}));
  const shim = path.join(target, 'bin', process.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit');
  const beforeShim = fs.readFileSync(shim, 'utf8');
  const beforeCurrent = fs.readFileSync(path.join(target, 'state', 'current.json'), 'utf8');
  const beforeIndex = fs.readFileSync(path.join(target, 'state', 'installations.json'), 'utf8');
  const cases = [
    ['missing', 'console.log(JSON.stringify({ok:true}))\n'],
    ['null', 'console.log(JSON.stringify({ok:true,version:null}))\n'],
    ['empty', 'console.log(JSON.stringify({ok:true,version:""}))\n'],
    ['numeric', 'console.log(JSON.stringify({ok:true,version:123}))\n'],
    ['boolean', 'console.log(JSON.stringify({ok:true,version:true}))\n'],
    ['array', 'console.log(JSON.stringify({ok:true,version:["0.2.1"]}))\n'],
    ['object', 'console.log(JSON.stringify({ok:true,version:{value:"0.2.1"}}))\n'],
    ['wrong', 'console.log(JSON.stringify({ok:true,version:"wrong"}))\n'],
    ['malformed', 'console.log("{not-json")\n'],
    ['no-output', '// deliberately no output\n'],
    ['multiple-results', 'console.log(JSON.stringify({ok:true,version:"0.2.1"})); console.log(JSON.stringify({ok:true,version:"0.2.1"}))\n'],
    ['final-non-result', 'console.log(JSON.stringify({ok:true,version:"0.2.1"})); console.log("done")\n'],
  ];
  for (const [label, healthSource] of cases) {
    const bad = candidate(root, '0.2.1', healthSource);
    assert.throws(() => apply(planFor({operation: 'update', root, target, built: bad, version: '0.2.1', currentVersion: '0.2.0'})), (error) => error.code === 'EXECUTABLE_HEALTH_FAILED', label);
    assert.equal(inspectInstallation(target).current.version, '0.2.0', label);
    assert.equal(fs.readFileSync(shim, 'utf8'), beforeShim, label);
    assert.equal(fs.readFileSync(path.join(target, 'state', 'current.json'), 'utf8'), beforeCurrent, label);
    assert.equal(fs.readFileSync(path.join(target, 'state', 'installations.json'), 'utf8'), beforeIndex, label);
    assert.equal(fs.existsSync(path.join(target, 'versions', '0.2.1', 'app')), false, label);
  }
});

test('024R2 failing-first: rollback 必须拒绝 retained app 额外文件', (t) => {
  const root = makeTempDirectory('024r2-rollback-first-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));
  apply(planFor({operation: 'update', root, target, built: v2, version: '0.2.1', currentVersion: '0.2.0'}));
  const shim = path.join(target, 'bin', process.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit');
  const beforeShim = fs.readFileSync(shim, 'utf8');
  fs.writeFileSync(path.join(target, 'versions', '0.2.0', 'app', 'unexpected.mjs'), 'export default true;\n');
  assert.throws(() => apply(planFor({operation: 'rollback', root, target, version: '0.2.0', currentVersion: '0.2.1'})), (error) => error.code === 'ROLLBACK_TARGET_UNHEALTHY');
  assert.equal(inspectInstallation(target).current.version, '0.2.1');
  assert.equal(fs.readFileSync(shim, 'utf8'), beforeShim);
});

test('024R2 rollback 完整树矩阵在任何失败时保持 newer current/shim/index/receipts', (t) => {
  const root = makeTempDirectory('024r2-rollback-matrix-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));
  apply(planFor({operation: 'update', root, target, built: v2, version: '0.2.1', currentVersion: '0.2.0'}));
  const currentFile = path.join(target, 'state', 'current.json');
  const indexFile = path.join(target, 'state', 'installations.json');
  const receiptFile = path.join(target, 'state', 'receipts', '0.2.0.json');
  const shim = path.join(target, 'bin', process.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit');
  const app = path.join(target, 'versions', '0.2.0', 'app');
  const runtime = inspectInstallation(target).current.runtimeRoot;
  const outside = path.join(root, 'outside-sentinel.txt');
  fs.writeFileSync(outside, 'outside-unchanged\n');
  const restore = (relative) => {
    const destination = path.join(app, ...relative.split('/'));
    fs.rmSync(destination, {recursive: true, force: true});
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(path.join(v1.root, 'payload', 'app', ...relative.split('/')), destination);
    fs.chmodSync(destination, fs.statSync(path.join(v1.root, 'payload', 'app', ...relative.split('/'))).mode & 0o777);
  };
  const rows = [
    {label: 'extra-app-mjs', setup: () => fs.writeFileSync(path.join(app, 'unexpected.mjs'), 'export default true;\n'), cleanup: () => fs.rmSync(path.join(app, 'unexpected.mjs'))},
    {label: 'nested-module', setup: () => { fs.mkdirSync(path.join(app, 'node_modules', 'ghost'), {recursive: true}); fs.writeFileSync(path.join(app, 'node_modules', 'ghost', 'index.mjs'), 'export {};\n'); }, cleanup: () => fs.rmSync(path.join(app, 'node_modules'), {recursive: true})},
    {label: 'extra-runtime', setup: () => fs.writeFileSync(path.join(target, runtime, 'unexpected-runtime.txt'), 'unexpected\n'), cleanup: () => fs.rmSync(path.join(target, runtime, 'unexpected-runtime.txt'))},
    {label: 'symlink-app', setup: () => { fs.rmSync(path.join(app, 'expected.txt')); fs.symlinkSync(outside, path.join(app, 'expected.txt')); }, cleanup: () => restore('expected.txt')},
    {label: 'unexpected-empty-directory', setup: () => fs.mkdirSync(path.join(app, 'empty-extra')), cleanup: () => fs.rmdirSync(path.join(app, 'empty-extra'))},
    {label: 'missing-expected', setup: () => fs.rmSync(path.join(app, 'expected.txt')), cleanup: () => restore('expected.txt')},
    {label: 'modified-expected', setup: () => fs.writeFileSync(path.join(app, 'expected.txt'), 'modified\n'), cleanup: () => restore('expected.txt')},
    {label: 'entrypoint-mode', setup: () => fs.chmodSync(path.join(app, 'foundation-smoke.mjs'), 0o600), cleanup: () => restore('foundation-smoke.mjs')},
  ];
  for (const row of rows) {
    row.setup();
    const before = {current: fs.readFileSync(currentFile, 'utf8'), index: fs.readFileSync(indexFile, 'utf8'), receipt: fs.readFileSync(receiptFile, 'utf8'), shim: fs.readFileSync(shim, 'utf8')};
    assert.throws(() => apply(planFor({operation: 'rollback', root, target, version: '0.2.0', currentVersion: '0.2.1'})), (error) => error.code === 'ROLLBACK_TARGET_UNHEALTHY', row.label);
    assert.equal(fs.readFileSync(currentFile, 'utf8'), before.current, row.label);
    assert.equal(fs.readFileSync(indexFile, 'utf8'), before.index, row.label);
    assert.equal(fs.readFileSync(receiptFile, 'utf8'), before.receipt, row.label);
    assert.equal(fs.readFileSync(shim, 'utf8'), before.shim, row.label);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside-unchanged\n', row.label);
    row.cleanup();
  }

  fs.writeFileSync(path.join(app, 'foundation-smoke.mjs'), 'console.log(JSON.stringify({ok:true}))\n');
  const {payload: receiptPayload} = signedDocument(receiptFile);
  const entry = receiptPayload.files.find((record) => record.path.endsWith('/foundation-smoke.mjs'));
  entry.size = fs.statSync(path.join(app, 'foundation-smoke.mjs')).size;
  entry.sha256 = sha256(fs.readFileSync(path.join(app, 'foundation-smoke.mjs')));
  entry.mode = fs.statSync(path.join(app, 'foundation-smoke.mjs')).mode & 0o777;
  writeSigned(receiptFile, receiptPayload);
  const beforeStrict = {current: fs.readFileSync(currentFile, 'utf8'), index: fs.readFileSync(indexFile, 'utf8'), receipt: fs.readFileSync(receiptFile, 'utf8'), shim: fs.readFileSync(shim, 'utf8')};
  assert.throws(() => apply(planFor({operation: 'rollback', root, target, version: '0.2.0', currentVersion: '0.2.1'})), (error) => error.code === 'ROLLBACK_TARGET_UNHEALTHY');
  assert.equal(fs.readFileSync(currentFile, 'utf8'), beforeStrict.current);
  assert.equal(fs.readFileSync(indexFile, 'utf8'), beforeStrict.index);
  assert.equal(fs.readFileSync(receiptFile, 'utf8'), beforeStrict.receipt);
  assert.equal(fs.readFileSync(shim, 'utf8'), beforeStrict.shim);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside-unchanged\n');
});

test('024R2 failing-first: full 不得删除 apply 前已篡改的 previous state', (t) => {
  const root = makeTempDirectory('024r2-state-first-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const v1 = candidate(root, '0.2.0');
  const v2 = candidate(root, '0.2.1');
  apply(planFor({operation: 'install', root, target, built: v1, version: '0.2.0'}));
  apply(planFor({operation: 'update', root, target, built: v2, version: '0.2.1', currentVersion: '0.2.0'}));
  const previous = path.join(target, 'state', 'previous.json');
  fs.appendFileSync(previous, '\nchanged-before-apply\n');
  const result = apply(planFor({operation: 'uninstall', root, target, version: '0.2.1', currentVersion: '0.2.1', mode: 'full'}));
  assert.equal(fs.existsSync(previous), true);
  assert.ok(result.preservedUnknown.some((entry) => entry.path === 'state/previous.json' && entry.reason === 'state-signature-invalid'));
  assert.ok(result.residualPaths.includes('state/previous.json'));
  assert.throws(() => apply(planFor({operation: 'uninstall', root, target, version: '0.2.1', currentVersion: '0.2.1', mode: 'full'})), (error) => error.code === 'NOT_INSTALLED');
});

test('024R2 full 保留并精确报告 foreign/mixed-install 与 symlink/directory core state', (t) => {
  const root = makeTempDirectory('024r2-state-preserve-');
  t.after(() => removeTempDirectory(root));
  const built = candidate(root, '0.2.0');
  const scenarios = ['foreign-previous', 'mixed-installations', 'symlink-previous', 'directory-previous'];
  for (const scenario of scenarios) {
    const target = path.join(root, scenario);
    apply(planFor({operation: 'install', root, target, built, version: '0.2.0'}));
    const currentFile = path.join(target, 'state', 'current.json');
    const previous = path.join(target, 'state', 'previous.json');
    const installations = path.join(target, 'state', 'installations.json');
    const outside = path.join(root, `${scenario}-outside.txt`);
    fs.writeFileSync(outside, `${scenario}-outside-unchanged\n`);
    let expectedPath;
    let expectedReason;
    if (scenario === 'foreign-previous') {
      const {payload} = signedDocument(currentFile);
      payload.identity.installId = 'install-foreign-state';
      writeSigned(previous, payload);
      expectedPath = 'state/previous.json'; expectedReason = 'foreign-install-state-preserved';
    } else if (scenario === 'mixed-installations') {
      const {payload} = signedDocument(installations);
      const foreign = structuredClone(Object.values(payload.versions)[0]);
      foreign.version = '9.9.9'; foreign.identity.productVersion = '9.9.9'; foreign.identity.installId = 'install-foreign-state';
      payload.versions['9.9.9'] = foreign;
      writeSigned(installations, payload);
      expectedPath = 'state/installations.json'; expectedReason = 'foreign-install-state-preserved';
    } else if (scenario === 'symlink-previous') {
      fs.symlinkSync(outside, previous);
      expectedPath = 'state/previous.json'; expectedReason = 'symlink-preserved';
    } else {
      fs.mkdirSync(previous);
      expectedPath = 'state/previous.json'; expectedReason = 'unexpected-type-preserved';
    }
    const result = apply(planFor({operation: 'uninstall', root, target, version: '0.2.0', currentVersion: '0.2.0', mode: 'full'}));
    assert.ok(result.preservedUnknown.some((entry) => entry.path === expectedPath && entry.reason === expectedReason), scenario);
    assert.ok(result.residualPaths.includes(expectedPath), scenario);
    assert.equal(fs.existsSync(path.join(target, ...expectedPath.split('/'))), true, scenario);
    assert.equal(fs.readFileSync(outside, 'utf8'), `${scenario}-outside-unchanged\n`, scenario);
  }
});

test('024R2 finalizer inventory 后 core state 变更会在 kill/restart 后 preserveModified', async (t) => {
  const root = makeTempDirectory('024r2-state-race-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const built = candidate(root, '0.2.0');
  apply(planFor({operation: 'install', root, target, built, version: '0.2.0'}));
  const outside = path.join(root, 'outside-race.txt');
  fs.writeFileSync(outside, 'outside-race-unchanged\n');
  const plan = planFor({operation: 'uninstall', root, target, version: '0.2.0', currentVersion: '0.2.0', mode: 'full'});
  const {marker, child} = spawnFinalizerPause(plan, root, 'before-core-state', 'state-race');
  const markerValue = await waitForFile(marker);
  assert.notEqual(markerValue.pid, child.pid);
  const installations = path.join(target, 'state', 'installations.json');
  fs.appendFileSync(installations, '\nchanged-after-inventory\n');
  process.kill(markerValue.pid, 'SIGKILL');
  const exit = await childResult(child);
  assert.equal(exit.code, 1, exit.stderr);
  const recovery = recover(target, root);
  assert.equal(recovery.manual.length, 0, JSON.stringify(recovery));
  const result = JSON.parse(fs.readFileSync(path.join(target, 'uninstall-result.json'), 'utf8'));
  assert.ok(result.preservedModified.includes('state/installations.json'));
  assert.ok(result.preservedModifiedDetails.some((entry) => entry.path === 'state/installations.json' && entry.reason === 'state-changed-after-inventory'));
  assert.ok(result.residualPaths.includes('state/installations.json'));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside-race-unchanged\n');
});

test('024R2 finalizer 在部分 core state 已删除后 SIGKILL，重启仍幂等完成', async (t) => {
  const root = makeTempDirectory('024r2-core-restart-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const built = candidate(root, '0.2.0');
  apply(planFor({operation: 'install', root, target, built, version: '0.2.0'}));
  const outside = path.join(root, 'outside-restart.txt');
  fs.writeFileSync(outside, 'outside-restart-unchanged\n');
  const plan = planFor({operation: 'uninstall', root, target, version: '0.2.0', currentVersion: '0.2.0', mode: 'full'});
  const {marker, child} = spawnFinalizerPause(plan, root, 'mid-core-state', 'core-restart');
  const markerValue = await waitForFile(marker);
  assert.equal(fs.existsSync(path.join(target, 'state', 'current.json')), false);
  process.kill(markerValue.pid, 'SIGKILL');
  const exit = await childResult(child);
  assert.equal(exit.code, 1, exit.stderr);
  const first = recover(target, root);
  assert.equal(first.manual.length, 0, JSON.stringify(first));
  const resultFile = path.join(target, 'uninstall-result.json');
  const result = signedDocument(resultFile);
  assert.equal(verifyTrustedPayload(result.payload, result.integrity), true);
  assert.equal(result.payload.state, 'uninstalled');
  assert.ok(result.payload.removed.includes('state/current.json'));
  assert.equal(inspectLifecycleRecovery(target).manual.length, 0);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside-restart-unchanged\n');
});
