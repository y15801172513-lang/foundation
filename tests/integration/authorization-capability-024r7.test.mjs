import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

import {
  applyLifecyclePlan,
  buildCandidate,
  createLifecyclePlan,
  inspectInstallation,
  sha256,
} from '../helpers/internal-core.mjs';
import {signTrustedPayload} from '../../packages/core/trusted-authority.mjs';
import {ROOT, makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest} from '../helpers/test-authorization.mjs';

const PRODUCTION_APPLY_CHILD = path.join(ROOT, 'tests', 'fixtures', 'production-lifecycle-apply-child.mjs');

function candidate(root, version = '0.2.0') {
  const source = path.join(root, `source-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(source, 'app'), {recursive: true});
  fs.writeFileSync(path.join(source, 'app', 'foundation-smoke.mjs'), `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))\n`);
  fs.cpSync(path.join(ROOT, 'templates'), path.join(source, 'app', 'templates'), {recursive: true});
  const runtime = path.join(root, 'private-node');
  fs.copyFileSync(process.execPath, runtime);
  fs.chmodSync(runtime, 0o755);
  return buildCandidate({sourceRoot: source, outputRoot: path.join(root, 'candidate'), productVersion: version, platform: process.platform, arch: process.arch, runtimeSource: runtime, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
}

function installPlan(root, target, built) {
  const runtime = built.manifest.files.find((record) => record.path === built.manifest.runtime.path);
  return createLifecyclePlan({
    operation: 'install',
    profile: 'core',
    targetRoot: target,
    sandboxRoot: root,
    targetVersion: built.manifest.productVersion,
    candidate: {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: runtime.sha256, bytes: built.manifest.totalBytes, version: built.manifest.productVersion},
    now: 1000,
  });
}

function directoryHash(root) {
  if (!fs.existsSync(root)) return null;
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).replaceAll(path.sep, '/');
      if (entry.isDirectory()) visit(file);
      else if (entry.isSymbolicLink()) records.push(`${relative}:symlink:${fs.readlinkSync(file)}`);
      else records.push(`${relative}:${sha256(fs.readFileSync(file))}`);
    }
  };
  visit(root);
  return sha256(records.join('\n'));
}

test('024R7 failing-first: caller-visible confirmationId 不能授权 lifecycle apply', (t) => {
  const root = makeTempDirectory('024r7-confirmation-bypass-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const plan = installPlan(root, target, candidate(root));
  const planFile = path.join(root, 'copied-public-plan.json');
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  const child = spawnSync(process.execPath, [PRODUCTION_APPLY_CHILD, planFile], {cwd: ROOT, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
  assert.equal(child.status, 1, child.stdout);
  assert.equal(JSON.parse(child.stderr.trim()).code, 'MANAGER_CONFIRMATION_REQUIRED');
  assert.equal(fs.existsSync(target), false);
});

test('024R7 failing-first: direct Node apply 不能绕过 AI bridge', (t) => {
  const root = makeTempDirectory('024r7-direct-api-bypass-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const plan = installPlan(root, target, candidate(root));
  const copied = structuredClone(plan);
  const calculatedConfirmation = `confirm-${copied.integrity.hash.slice(0, 24)}`;
  assert.throws(() => applyLifecyclePlan({plan: copied, confirmationId: calculatedConfirmation, now: 1001}), (error) => error.code === 'HUMAN_AUTHORIZATION_REQUIRED');
  assert.equal(fs.existsSync(target), false);
});

test('024R7 failing-first: inspectInstallation 对 stale guard 必须 byte-for-byte 零写入', (t) => {
  const root = makeTempDirectory('024r7-read-only-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  const plan = installPlan(root, target, candidate(root));
  applyLifecycleForTest(plan);
  const guard = path.join(target, '.foundation-operation.guard');
  const payload = {schemaVersion: '1.0.0', operationId: 'stale-inspection', pid: process.pid, processStartedAt: 1, processFingerprint: {scheme: 'test', value: 'not-this-process'}, ownerNonce: 'stale'};
  fs.writeFileSync(guard, `${JSON.stringify({...payload, integrity: signTrustedPayload(payload)}, null, 2)}\n`);
  const before = directoryHash(target);
  const result = inspectInstallation(target);
  const after = directoryHash(target);
  assert.equal(after, before);
  assert.equal(result.recovery.status, 'recovery-required');
  assert.equal(fs.existsSync(guard), true);
});
