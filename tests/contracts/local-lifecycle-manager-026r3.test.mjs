import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {makeScopedTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';

const importCore = (name) => import(new URL(`../../packages/core/${name}.mjs`, import.meta.url));

test('026R3 keeps exactly four AI operations and documents explicit project authority failures', async () => {
  const manager = await importCore('lifecycle-manager');
  assert.deepEqual(Object.keys(manager.LOCAL_LIFECYCLE_AI_TOOLS), ['inspect', 'request-plan', 'open-manager', 'status']);
  assert.deepEqual(manager.LOCAL_LIFECYCLE_AI_SURFACE.operations, ['inspect', 'request-plan', 'open-manager', 'status']);
  const inspect = manager.LOCAL_LIFECYCLE_AI_TOOLS.inspect;
  assert.match(inspect.input.properties.project.description, /project-skill-use.*必需|必需.*project-skill-use/u);
  assert.match(inspect.input.properties.operationRequirement.description, /project-skill-use/u);
  const codes = inspect.errors.map((entry) => entry.code);
  for (const code of ['PROJECT_REQUIRED', 'PROJECT_DISABLED', 'PROJECT_AUTHORITY_MISMATCH', 'CAPABILITY_STATE_SCHEMA_INVALID', 'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH']) assert.ok(codes.includes(code), code);
});

test('026R3 capability status surface publishes all structured state and registration outcomes', async () => {
  const capability = await importCore('capability-authority');
  for (const code of [
    'CAPABILITY_STATE_MALFORMED',
    'CAPABILITY_STATE_INTEGRITY_INVALID',
    'CAPABILITY_STATE_SCHEMA_INVALID',
    'CAPABILITY_STATE_UNSAFE',
    'CAPABILITY_IDENTITY_MISMATCH',
    'CAPABILITY_REGISTRATION_STATE_MALFORMED',
    'CAPABILITY_REGISTRATION_STATE_INTEGRITY_INVALID',
    'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH',
    'CAPABILITY_NOT_INSTALLED',
    'CAPABILITY_NOT_REGISTERED',
    'CAPABILITY_INACTIVE',
  ]) assert.ok(capability.CAPABILITY_STATUS_CODES.includes(code), code);
});

test('026R3 runtime descriptor declarations require an explicit projectScoped boolean', async (t) => {
  const root = makeScopedTempDirectory('026R3', 'descriptor-contract-');
  t.after(() => removeTempDirectory(root));
  const endpoint = path.join(root, 'endpoint');
  fs.mkdirSync(endpoint);
  fs.writeFileSync(path.join(endpoint, 'rule.json'), '{}\n');
  const descriptor = await importCore('runtime-descriptor');
  assert.throws(() => descriptor.createFoundationRuntimeDescriptor({
    productVersion: '0.2.0',
    platform: process.platform,
    arch: process.arch,
    buildIdentity: '026R3-contract',
    supportedProjectDataFormats: ['0.1.0'],
    ruleCapabilityEndpoint: 'artifacts',
    ruleCapabilityEndpointRoot: endpoint,
    capabilityFacts: {
      bundled: [{capabilityId: 'fixture', type: 'codex-skill', version: '1.0.0', manifestPath: 'fixture/capability.json', installed: true, active: false}],
      installedStateSource: 'state/capabilities.json',
      activeStateSource: 'state/capabilities.json',
      registrationStateSource: 'state/capability-host-registrations.json',
    },
  }), (error) => error?.code === 'RUNTIME_DESCRIPTOR_SCHEMA_INVALID');
});
