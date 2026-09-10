import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {ROOT} from '../helpers/project-fixture.mjs';

const importCore = (name) => import(new URL(`../../packages/core/${name}.mjs`, import.meta.url));

test('026R1 failing-first: package exports no manager host or mutation primitive', async () => {
  const descriptor = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'core', 'package.json'), 'utf8'));
  assert.equal('./lifecycle-manager-host' in descriptor.exports, false);
  const core = await import('@foundation/core');
  for (const name of [
    'applyLifecyclePlan',
    'applyProjectLayoutPlan',
    'applyNormalUninstallProjectPlan',
    'applyNormalUninstallCompositePlan',
    'recoverProjectTransaction',
  ]) assert.equal(name in core, false, name);
});

test('026R1 failing-first: four AI tools have non-overlapping schemas and actionable errors', async () => {
  const manager = await importCore('lifecycle-manager');
  assert.deepEqual(Object.keys(manager.LOCAL_LIFECYCLE_AI_TOOLS), ['inspect', 'request-plan', 'open-manager', 'status']);
  for (const [name, contract] of Object.entries(manager.LOCAL_LIFECYCLE_AI_TOOLS)) {
    assert.equal(contract.name, `Foundation:${name}`);
    assert.equal(typeof contract.description, 'string');
    assert.ok(contract.description.length > 30);
    assert.equal(contract.input.type, 'object');
    assert.equal(contract.output.type, 'object');
    assert.ok(Array.isArray(contract.errors));
    assert.ok(contract.errors.every((error) => error.code && error.recovery && typeof error.retryable === 'boolean'));
  }
  assert.deepEqual(manager.LOCAL_LIFECYCLE_AI_TOOLS['open-manager'].input.required, ['planRef']);
  assert.equal('plan' in manager.LOCAL_LIFECYCLE_AI_TOOLS['open-manager'].input.properties, false);
  assert.equal('path' in manager.LOCAL_LIFECYCLE_AI_TOOLS['open-manager'].input.properties, false);
  assert.equal('targetRoot' in manager.LOCAL_LIFECYCLE_AI_TOOLS['open-manager'].input.properties, false);
});

test('026R1 failing-first: request-plan returns only opaque reference and manager-state mutation truth', async () => {
  const manager = await importCore('lifecycle-manager');
  assert.equal(manager.requestLocalLifecyclePlan.length <= 1, true);
  assert.equal(typeof manager.openLocalLifecycleManagerPlan, 'function');
  assert.equal(typeof manager.readLocalLifecycleOperationStatus, 'function');
  assert.equal(manager.LOCAL_LIFECYCLE_AI_SURFACE.managerStateWrites.includes('request-plan'), true);
  assert.equal(manager.LOCAL_LIFECYCLE_AI_SURFACE.targetMutationOperations.length, 0);
});

test('026R1 failing-first: stable bridge consumes an integrity-bound runtime descriptor without version ceiling', async () => {
  const bridge = await importCore('ai-bridge');
  assert.equal(typeof bridge.validateFoundationRuntimeDescriptor, 'function');
  assert.equal(typeof bridge.readFoundationRuntimeDescriptor, 'function');
  assert.equal('supportedDataFormats' in bridge.resolveFoundationBridgeContext, false);
  const capability = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills', 'ai-product-foundation-kit', 'capability.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(capability), /<0\.3\.0/u);
});

test('026R1 failing-first: product copy states lightweight confirmation boundary exactly', () => {
  const sources = [
    path.join(ROOT, 'docs', 'architecture.md'),
    path.join(ROOT, 'docs', 'install-create-upgrade.md'),
    path.join(ROOT, 'skills', 'ai-product-foundation-kit', 'SKILL.md'),
  ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.match(sources, /不.*加密.*证明.*人在场|does not cryptographically prove human presence/iu);
  assert.match(sources, /不防御.*同一用户.*浏览器自动化|does not defend.*same-user.*browser automation/iu);
  assert.match(sources, /HTTP.*不是.*安全边界|HTTP.*not.*security boundary/iu);
});
