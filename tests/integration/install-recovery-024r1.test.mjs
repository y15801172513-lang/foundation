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
  hashDirectory,
  inspectInstallation,
  inspectLifecycleRecovery,
  recoverLifecycleState,
} from '../helpers/internal-core.mjs';
import {loadTrustedAuthorityKey, signTrustedPayload, verifyTrustedPayload} from '../../packages/core/trusted-authority.mjs';
import {ROOT, makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest, authorizeLifecycle} from '../helpers/test-authorization.mjs';

const CHILD = path.join(ROOT, 'tests', 'fixtures', 'lifecycle-child.mjs');

function makeCandidate(root, version = '0.2.0') {
  const source = path.join(root, `source-${version}-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(source, 'app'), {recursive: true});
  fs.writeFileSync(path.join(source, 'app', 'foundation-smoke.mjs'), `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))\n`);
  fs.writeFileSync(path.join(source, 'app', 'version.txt'), `${version}\n`);
  fs.mkdirSync(path.join(source, 'app', 'skills', 'ai-product-foundation-kit'), {recursive: true});
  fs.writeFileSync(path.join(source, 'app', 'skills', 'ai-product-foundation-kit', 'SKILL.md'), '---\nname: ai-product-foundation-kit\ndescription: fixture\n---\n');
  const runtime = path.join(root, 'private-node');
  if (!fs.existsSync(runtime)) { fs.copyFileSync(process.execPath, runtime); fs.chmodSync(runtime, 0o755); }
  return buildCandidate({sourceRoot: source, outputRoot: path.join(root, `candidate-${version}-${crypto.randomUUID()}`), productVersion: version, platform: process.platform, arch: process.arch, runtimeSource: runtime, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
}

function planFor({operation, root, target, built = null, version = '0.2.0', currentVersion = null, mode = null}) {
  const runtime = built?.manifest.files.find((record) => record.path === built.manifest.runtime.path);
  return createLifecyclePlan({
    operation, mode, profile: 'core', targetRoot: target, sandboxRoot: root, currentVersion, targetVersion: version,
    candidate: built ? {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: runtime.sha256, bytes: built.manifest.totalBytes, version, acquisition: 'local-ingestion'} : null,
    now: 1000,
  });
}

const apply = (plan) => applyLifecycleForTest(plan);

function recover(root, sandboxRoot, now = Date.now()) {
  const recoverySnapshot = inspectLifecycleRecovery(root);
  const currentVersion = inspectInstallation(root).current?.version || null;
  const plan = createLifecyclePlan({operation: 'recover', profile: 'core', targetRoot: root, sandboxRoot, currentVersion, targetVersion: currentVersion, recoverySnapshot, now});
  return applyLifecycleForTest(plan);
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

function spawnPaused(planFile, kind, stage, marker) {
  authorizeLifecycle(JSON.parse(fs.readFileSync(planFile, 'utf8')));
  return spawn(process.execPath, [CHILD, planFile, kind, stage, marker], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
}

test('024R1 real SIGKILL matrix 在 durable 阶段确定 rollback 或 commit recovery', async (t) => {
  const root = makeTempDirectory('024r1-kill-matrix-');
  t.after(() => removeTempDirectory(root));
  const built = makeCandidate(root);
  const rows = [];
  for (const stage of ['before-staging', 'after-staging', 'after-shim-switch', 'after-current-switch', 'after-receipt-commit']) {
    const target = path.join(root, stage);
    const plan = planFor({operation: 'install', root, target, built});
    const planFile = path.join(root, `${stage}.plan.json`);
    const marker = path.join(root, `${stage}.marker.json`);
    fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
    const child = spawnPaused(planFile, 'operation', stage, marker);
    const markerValue = await waitForFile(marker);
    assert.equal(markerValue.pid, child.pid);
    child.kill('SIGKILL');
    const exit = await childResult(child);
    assert.equal(exit.signal, 'SIGKILL', `${stage}: ${exit.stderr}`);
    const recovery = recover(target, root);
    const installation = inspectInstallation(target);
    const expectedInstalled = stage === 'after-receipt-commit';
    assert.equal(installation.installed, expectedInstalled, stage);
    assert.equal(recovery.manual.length, 0, stage);
    rows.push({stage, signal: exit.signal, recoveredState: recovery.recovered.at(-1)?.recoveredState, installed: installation.installed});
  }
  assert.deepEqual(rows.map((row) => row.installed), [false, false, false, false, true]);
});

test('024R1 live lock 不接管，stale lock 恢复且 repeated recovery 幂等', async (t) => {
  const root = makeTempDirectory('024r1-lock-recovery-');
  t.after(() => removeTempDirectory(root));
  const built = makeCandidate(root);
  const target = path.join(root, 'install');
  const plan = planFor({operation: 'install', root, target, built});
  const planFile = path.join(root, 'plan.json');
  const marker = path.join(root, 'marker.json');
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  const child = spawnPaused(planFile, 'operation', 'after-staging', marker);
  await waitForFile(marker);
  const live = inspectLifecycleRecovery(target);
  assert.equal(live.status, 'live-operation');
  assert.equal(live.pid, child.pid);
  child.kill('SIGKILL');
  const exit = await childResult(child);
  assert.equal(exit.signal, 'SIGKILL');
  const first = recover(target, root);
  assert.equal(first.status, 'recovered');
  assert.ok(first.recovered.some((entry) => entry.recoveredState === 'stale-lock-removed'));
  assert.ok(first.recovered.some((entry) => entry.recoveredState === 'rolled-back'));
  const second = inspectLifecycleRecovery(target);
  assert.equal(second.status, 'clean');
  assert.deepEqual(second.recovered, []);
});

test('024R1 malformed/unknown journal 进入稳定 manual-action，不猜测成功', (t) => {
  const root = makeTempDirectory('024r1-manual-recovery-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  fs.mkdirSync(path.join(target, 'state', 'journals'), {recursive: true});
  fs.writeFileSync(path.join(target, 'state', 'journals', 'malformed.json'), '{not json');
  const malformed = inspectLifecycleRecovery(target);
  assert.equal(malformed.status, 'manual-action-required');
  assert.ok(malformed.manual.some((entry) => entry.path.endsWith('malformed.json')));

  fs.rmSync(path.join(target, 'state', 'journals', 'malformed.json'));
  loadTrustedAuthorityKey({create: true});
  const payload = {schemaVersion: '1.0.0', operationId: 'unknown-operation', operation: 'update', status: 'unknown', steps: []};
  fs.writeFileSync(path.join(target, 'state', 'journals', 'unknown-operation.json'), `${JSON.stringify({...payload, integrity: signTrustedPayload(payload)}, null, 2)}\n`);
  const unknown1 = inspectLifecycleRecovery(target);
  const unknown2 = inspectLifecycleRecovery(target);
  assert.equal(unknown1.status, 'manual-action-required');
  assert.equal(unknown2.status, 'manual-action-required');
  assert.deepEqual(unknown2.manual, unknown1.manual);
});

test('024R1 独立 finalizer 在三种卸载模式 mid-delete 被 kill 后可重启', async (t) => {
  const root = makeTempDirectory('024r1-finalizer-restart-');
  t.after(() => removeTempDirectory(root));
  const built = makeCandidate(root);
  for (const mode of ['app-only', 'app-and-runtime', 'full']) {
    const target = path.join(root, mode);
    apply(planFor({operation: 'install', root, target, built}));
    assert.equal(inspectLifecycleRecovery(target).manual.length, 0, `${mode}: install journal must begin valid`);
    const facts = path.join(target, 'user-products', 'project', '.foundation', 'facts');
    fs.mkdirSync(facts, {recursive: true});
    fs.writeFileSync(path.join(facts, 'project.json'), '{"preserve":true}\n');
    const before = hashDirectory(path.join(target, 'user-products'));
    const plan = planFor({operation: 'uninstall', root, target, version: '0.2.0', currentVersion: '0.2.0', mode});
    const planFile = path.join(root, `${mode}.plan.json`);
    const marker = path.join(root, `${mode}.finalizer-marker.json`);
    fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
    const outer = spawnPaused(planFile, 'finalizer', 'mid-delete', marker);
    const finalizerMarker = await waitForFile(marker);
    assert.notEqual(finalizerMarker.pid, outer.pid);
    process.kill(finalizerMarker.pid, 'SIGKILL');
    const exit = await childResult(outer);
    assert.equal(exit.code, 1, `${mode}: ${exit.stderr}`);
    for (const name of fs.readdirSync(path.join(target, 'state', 'journals')).filter((entry) => entry.endsWith('.json'))) {
      const document = JSON.parse(fs.readFileSync(path.join(target, 'state', 'journals', name), 'utf8'));
      const {integrity, ...payload} = document;
      assert.equal(verifyTrustedPayload(payload, integrity), true, `${mode}: journal changed before recovery: ${name}`);
    }
    const recovery = recover(target, root);
    assert.equal(recovery.manual.length, 0, `${mode}: ${JSON.stringify(recovery)}`);
    assert.equal(inspectInstallation(target).installed, false, mode);
    assert.equal(hashDirectory(path.join(target, 'user-products')), before, mode);
    assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'uninstall-result.json'), 'utf8')).mode, mode);
  }
});
