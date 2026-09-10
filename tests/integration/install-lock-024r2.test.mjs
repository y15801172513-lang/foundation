import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  createLifecyclePlan,
  inspectInstallation,
  inspectLifecycleRecovery,
  recoverLifecycleState,
} from '../helpers/internal-core.mjs';
import {loadTrustedAuthorityKey, signTrustedPayload} from '../../packages/core/trusted-authority.mjs';
import {makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest} from '../helpers/test-authorization.mjs';

function recover(target, root) {
  const recoverySnapshot = inspectLifecycleRecovery(target);
  return applyLifecycleForTest(createLifecyclePlan({operation: 'recover', profile: 'core', targetRoot: target, sandboxRoot: root, currentVersion: null, targetVersion: null, recoverySnapshot, now: Date.now()}));
}

test('024R2 failing-first: 同 PID 但 start fingerprint 不匹配不得报告 live', (t) => {
  const root = makeTempDirectory('024r2-lock-first-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  fs.mkdirSync(target, {recursive: true});
  loadTrustedAuthorityKey({create: true});
  const payload = {
    schemaVersion: '1.0.0',
    operationId: 'pid-reused-operation',
    pid: process.pid,
    processStartedAt: 1,
    processFingerprint: {scheme: 'deterministic-test', value: 'different-process-instance'},
    ownerNonce: 'signed-stale-owner',
  };
  fs.writeFileSync(path.join(target, '.foundation-operation.lock'), `${JSON.stringify({...payload, integrity: signTrustedPayload(payload)}, null, 2)}\n`);
  const recovery = recover(target, root);
  assert.notEqual(recovery.status, 'live-operation');
  assert.ok(recovery.recovered.some((entry) => entry.recoveredState === 'stale-instance-lock-removed'));
  const repeated = inspectLifecycleRecovery(target);
  assert.equal(repeated.status, 'clean');
  assert.deepEqual(repeated.recovered, []);
});

test('024R2 dead owner 只回收一次，之后 recovery 幂等 clean', (t) => {
  const root = makeTempDirectory('024r2-dead-lock-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  fs.mkdirSync(target, {recursive: true});
  loadTrustedAuthorityKey({create: true});
  const payload = {schemaVersion: '1.0.0', operationId: 'dead-operation', pid: 2147483647, processStartedAt: 1, processFingerprint: {scheme: 'dead-fixture', value: 'dead'}, ownerNonce: 'dead-owner'};
  fs.writeFileSync(path.join(target, '.foundation-operation.lock'), `${JSON.stringify({...payload, integrity: signTrustedPayload(payload)}, null, 2)}\n`);
  const first = recover(target, root);
  assert.equal(first.status, 'recovered');
  assert.ok(first.recovered.some((entry) => entry.recoveredState === 'stale-lock-removed'));
  assert.equal(inspectLifecycleRecovery(target).status, 'clean');
});

test('024R2 live PID 缺少可验证实例证据时稳定 manual 且不接管', (t) => {
  const root = makeTempDirectory('024r2-unavailable-lock-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  fs.mkdirSync(target, {recursive: true});
  loadTrustedAuthorityKey({create: true});
  const payload = {schemaVersion: '1.0.0', operationId: 'unverifiable-operation', pid: process.pid, processStartedAt: Date.now(), ownerNonce: 'unverifiable-owner'};
  const lock = path.join(target, '.foundation-operation.lock');
  fs.writeFileSync(lock, `${JSON.stringify({...payload, integrity: signTrustedPayload(payload)}, null, 2)}\n`);
  const first = inspectLifecycleRecovery(target);
  const second = inspectLifecycleRecovery(target);
  const statusView = inspectInstallation(target);
  assert.equal(first.status, 'manual-action-required');
  assert.equal(second.status, 'manual-action-required');
  assert.deepEqual(second.manual, first.manual);
  assert.equal(first.manual[0].code, 'PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE');
  assert.equal(statusView.recovery.status, 'manual-action-required');
  assert.equal(fs.existsSync(lock), true);
});

test('024R2 tampered lock repeated recovery 保持 manual 且不删除证据', (t) => {
  const root = makeTempDirectory('024r2-tampered-lock-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  fs.mkdirSync(target, {recursive: true});
  const lock = path.join(target, '.foundation-operation.lock');
  fs.writeFileSync(lock, '{"operationId":"tampered","pid":1}\n');
  const first = inspectLifecycleRecovery(target);
  const second = inspectLifecycleRecovery(target);
  assert.equal(first.status, 'manual-action-required');
  assert.equal(second.status, 'manual-action-required');
  assert.deepEqual(second.manual, first.manual);
  assert.equal(fs.existsSync(lock), true);
});
