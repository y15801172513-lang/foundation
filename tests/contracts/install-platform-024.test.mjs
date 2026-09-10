import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  AI_BRIDGE_CAPABILITY,
  ANT_ADAPTER,
  INSTALL_CONTRACT_SCHEMAS,
  LIFECYCLE_PROFILES,
  SHADCN_ADAPTER,
  SUPPORT_STATUSES,
  createLifecyclePlan,
  createSupportMatrix,
  explainLifecyclePlan,
  productVersion,
  platformShim,
  readProductManifest,
  runtimeStrategy,
  validateLifecyclePlan,
  validateVersionMirrors,
} from '@foundation/core';
import {buildViewModel} from '@foundation/management-center';
import {DEMO, ROOT, makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';

test('024 单一产品版本权威贯穿 package 镜像与管理中心模型', () => {
  const manifest = readProductManifest(ROOT);
  assert.equal(manifest.product.version, '0.2.1');
  assert.equal(productVersion(ROOT), '0.2.1');
  assert.deepEqual(validateVersionMirrors(ROOT), {ok: true, authority: '0.2.1', mismatches: []});
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, manifest.product.version);
  for (const location of ['', 'apps/management-center', 'packages/core', 'packages/cli']) {
    assert.equal(lock.packages[location].version, manifest.product.version);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, location, 'package.json'), 'utf8'));
    for (const [name, version] of Object.entries(pkg.dependencies || {})) if (name.startsWith('@foundation/')) {
      assert.equal(version, manifest.product.version);
      assert.equal(lock.packages[location].dependencies[name], version);
    }
  }
  const facts = Object.fromEntries(fs.readdirSync(path.join(DEMO, '.foundation', 'facts')).map((name) => [name.replace('.json', ''), JSON.parse(fs.readFileSync(path.join(DEMO, '.foundation', 'facts', name), 'utf8'))]));
  const preview = JSON.parse(fs.readFileSync(path.join(DEMO, '.foundation', 'preview.json'), 'utf8'));
  assert.equal(buildViewModel(facts, preview).foundationKit.productVersion, '0.2.1');
});

test('024 install-contract schema 有版本、兼容策略和未知字段策略', () => {
  for (const name of ['supportMatrix', 'releaseManifest', 'installPlan', 'operationJournal', 'ownershipReceipt', 'extensionManifest', 'structuredError', 'capabilityStatus']) {
    const schema = INSTALL_CONTRACT_SCHEMAS[name];
    assert.equal(schema.schemaVersion, '1.0.0');
    assert.equal(schema.compatibility.major, 'reject');
    assert.equal(schema.compatibility.minor, 'forward-compatible');
    assert.equal(schema.unknownFields, 'ignore-non-security-critical');
  }
  const document = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/schemas/install-contract-v1.json'), 'utf8'));
  assert.equal(document.schemaVersion, '1.0.0');
  assert.equal(document.$defs.installPlan.properties.installIdentity.const, 'current-user');
});

test('024 支持矩阵只使用三种平台状态，SEA 不成为 Mac x64 唯一方案', () => {
  assert.deepEqual(SUPPORT_STATUSES, ['verified', 'candidate-unverified', 'unsupported']);
  const matrix = createSupportMatrix();
  assert.ok(matrix.entries.every((entry) => SUPPORT_STATUSES.includes(entry.status)));
  assert.equal(matrix.entries.find((entry) => entry.platform === 'darwin' && entry.arch === 'x64').status, 'candidate-unverified');
  const macX64 = matrix.entries.find((entry) => entry.platform === 'darwin' && entry.arch === 'x64');
  assert.equal(macX64.runtime.primary, 'bundled-official-node');
  assert.equal(macX64.runtime.sea, 'unsupported');
  assert.equal(runtimeStrategy().primary, 'bundled-official-node');
  assert.match(platformShim({platform: 'darwin', runtimePath: 'runtimes/node/bin/node', entrypoint: 'versions/1/app/index.mjs'}), /^#!\/bin\/sh/u);
  assert.match(platformShim({platform: 'win32', runtimePath: 'runtimes/node/bin/node.exe', entrypoint: 'versions/1/app/index.mjs'}), /%~dp0\\\.\.\\runtimes\\node\\bin\\node\.exe/u);
});

test('recommended/core/custom 计划确定，白话与 JSON 表达同一不可变计划', () => {
  const sandboxRoot = path.join(ROOT, '.tmp');
  for (const profile of Object.keys(LIFECYCLE_PROFILES)) {
    const input = {operation: 'install', profile, targetRoot: path.join(sandboxRoot, `contract-${profile}`), sandboxRoot, targetVersion: '0.2.0', candidate: {path: path.join(sandboxRoot, 'candidate'), manifestHash: 'a'.repeat(64), bytes: 1200}, now: 1000};
    const first = createLifecyclePlan(input);
    const second = createLifecyclePlan(input);
    assert.deepEqual(first, second);
    assert.equal(validateLifecyclePlan(first, {now: 1001}).ok, true);
    const text = explainLifecyclePlan(first);
    assert.match(text, new RegExp(first.planId, 'u'));
    assert.match(text, new RegExp(first.targetRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.match(text, new RegExp(String(first.impact.diskBytes), 'u'));
  }
  assert.equal(LIFECYCLE_PROFILES.core.extensions.length, 0);
  assert.ok(LIFECYCLE_PROFILES.recommended.extensions.includes('shadcn'));
});

test('plan 被改写或过期会被稳定错误码拒绝', () => {
  const sandboxRoot = path.join(ROOT, '.tmp');
  const plan = createLifecyclePlan({operation: 'install', profile: 'core', targetRoot: path.join(sandboxRoot, 'contract-tamper'), sandboxRoot, targetVersion: '0.2.0', candidate: {path: path.join(sandboxRoot, 'candidate'), manifestHash: 'b'.repeat(64), bytes: 1}, now: 10, ttlMs: 20});
  assert.equal(validateLifecyclePlan({...plan, targetVersion: '9.9.9'}, {now: 11}).error.code, 'PLAN_TAMPERED');
  assert.equal(validateLifecyclePlan(plan, {now: 31}).error.code, 'PLAN_EXPIRED');
});

test('AI bridge 每个任务解析 current，并把 confirmation/apply 留给 Foundation 本地管理器', () => {
  assert.equal(AI_BRIDGE_CAPABILITY.schemaVersion, '1.0.0');
  assert.equal(AI_BRIDGE_CAPABILITY.requiresLocalToolPermission, true);
  assert.equal(AI_BRIDGE_CAPABILITY.distribution.skill.scope, 'candidate-artifact');
  assert.equal(AI_BRIDGE_CAPABILITY.distribution.skill.status, 'inert-unregistered-inactive');
  assert.equal(AI_BRIDGE_CAPABILITY.distribution.plugin.status, 'upgrade-interface');
  assert.equal(AI_BRIDGE_CAPABILITY.firstOperationalStep, 'resolve-current-foundation-context-read-only');
  assert.deepEqual(AI_BRIDGE_CAPABILITY.flow, ['inspect', 'request-plan', 'open-foundation-local-manager', 'read-status']);
  assert.equal(AI_BRIDGE_CAPABILITY.stateChangeContract.managerConfirmationRequired, true);
  assert.equal(AI_BRIDGE_CAPABILITY.stateChangeContract.trustedHostBrokerReceiptRequired, false);
  assert.equal(AI_BRIDGE_CAPABILITY.stateChangeContract.callerVisibleCredentialAccepted, false);
  assert.equal(JSON.stringify(AI_BRIDGE_CAPABILITY).includes('shellCommand'), false);
});

test('shadcn 与 Ant 使用相同扩展接口，Ant 仅为合同样例', () => {
  for (const adapter of [SHADCN_ADAPTER, ANT_ADAPTER]) {
    for (const method of ['detect', 'explain', 'plan', 'apply', 'verify', 'removeOwned']) assert.equal(typeof adapter[method], 'function');
  }
  assert.equal(SHADCN_ADAPTER.status, 'candidate-unverified');
  assert.equal(ANT_ADAPTER.status, 'pending');
});
