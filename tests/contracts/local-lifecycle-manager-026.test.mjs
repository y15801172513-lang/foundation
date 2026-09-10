import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

import {ROOT} from '../helpers/project-fixture.mjs';

const importCore = (name) => import(new URL(`../../packages/core/${name}.mjs`, import.meta.url));

test('026 failing-first: AI lifecycle surface is inspect, request-plan, open-manager and status only', async () => {
  const manager = await importCore('lifecycle-manager');
  assert.equal(manager.LOCAL_LIFECYCLE_MANAGER_VERSION, '1.0.0');
  assert.deepEqual(manager.LOCAL_LIFECYCLE_AI_SURFACE.operations, ['inspect', 'request-plan', 'open-manager', 'status']);
  assert.deepEqual(manager.LOCAL_LIFECYCLE_AI_SURFACE.forbidden, ['confirm', 'apply', 'recover', 'purge', 'reopen-decline']);
  for (const name of ['inspectLocalLifecycle', 'requestLocalLifecyclePlan', 'readLocalLifecycleStatus']) assert.equal(typeof manager[name], 'function', name);
  for (const name of ['confirmLocalLifecycle', 'applyLocalLifecyclePlan', 'recoverLocalLifecycle', 'purgeProjectData']) assert.equal(name in manager, false, name);
});

test('026 failing-first: project layout v2 separates preserved identity/facts from owned integration/cache', async () => {
  const layout = await importCore('project-layout');
  assert.equal(layout.PROJECT_LAYOUT_VERSION, '2.0.0');
  assert.deepEqual(layout.PROJECT_LAYOUT_PATHS, {
    identity: '.foundation/identity/project.json',
    facts: '.foundation/facts',
    integration: '.foundation/integration',
    generatedCache: '.foundation/generated-cache',
    ownership: '.foundation/ownership.json',
  });
  assert.equal(typeof layout.inspectProjectLayout, 'function');
  assert.equal(typeof layout.createProjectLayoutMigrationPlan, 'function');
  assert.equal(typeof layout.createProjectDataPurgePlan, 'function');
});

test('026 failing-first: stable bridge resolves current version per task and exposes explicit stale state', async () => {
  const bridge = await importCore('ai-bridge');
  assert.equal(bridge.AI_BRIDGE_CAPABILITY.versionNeutral, true);
  assert.equal(bridge.AI_BRIDGE_CAPABILITY.stateChangeContract.managerConfirmationRequired, true);
  assert.equal(bridge.AI_BRIDGE_CAPABILITY.stateChangeContract.trustedHostBrokerReceiptRequired, false);
  assert.equal(typeof bridge.resolveFoundationBridgeContext, 'function');
  assert.equal(typeof bridge.openFoundationBridgeTask, 'function');
  assert.equal(typeof bridge.inspectFoundationBridgeTask, 'function');
});

test('026 failing-first: product states the same-user shell threat limitation plainly', () => {
  const architecture = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.md'), 'utf8');
  const install = fs.readFileSync(path.join(ROOT, 'docs', 'install-create-upgrade.md'), 'utf8');
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'ai-product-foundation-kit', 'SKILL.md'), 'utf8');
  for (const [label, value] of [['architecture', architecture], ['install', install], ['skill', skill]]) {
    assert.match(value, /不防御.*同一用户.*shell|does not defend.*same-user.*shell/iu, label);
    assert.match(value, /AI.*只能.*检查.*计划.*打开.*状态|AI.*inspect.*plan.*open.*status/iu, label);
  }
});

test('026 failing-first: ordinary CLI has no confirm/apply/recover/purge manager command', () => {
  for (const forbidden of ['confirm', 'apply', 'recover', 'purge']) {
    const run = spawnSync(process.execPath, [path.join(ROOT, 'packages', 'cli', 'index.mjs'), 'manager', forbidden], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PATH: ''}});
    assert.notEqual(run.status, 0, forbidden);
    assert.match(run.stderr, /不存在.*confirm.*apply.*recover.*purge|只支持.*inspect.*plan.*open.*status/iu, forbidden);
  }
});

test('026 failing-first: protected-host experiment is absent from main production surface', () => {
  for (const relative of [
    'packages/core/native-host-client.mjs',
    'packages/core/protected-host-broker.mjs',
    'packages/core/protected-host-protocol.mjs',
    'platform/macos/FoundationAuthorizationHost',
  ]) assert.equal(fs.existsSync(path.join(ROOT, relative)), false, relative);
  const adapter = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'protected-host-adapter.mjs'), 'utf8');
  assert.doesNotMatch(adapter, /SecureEnclave|LocalAuthentication|production-signed-host/u);
});

test('026 failing-first: manager confirmation schema binds full plan, protected hashes, expiry and single use', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'core', 'schemas', 'local-manager-confirmation-v1.json'), 'utf8'));
  for (const field of ['sessionId', 'operationId', 'operation', 'planHash', 'effectHash', 'targetRoots', 'creates', 'replacements', 'deletes', 'preserves', 'fileCount', 'byteCount', 'protectedDataHashes', 'expectedBeforeState', 'expiresAt', 'state']) assert.ok(schema.required.includes(field), field);
  assert.deepEqual(schema.properties.state.enum, ['pending', 'executing', 'consumed', 'completed', 'failed', 'cancelled']);
});
