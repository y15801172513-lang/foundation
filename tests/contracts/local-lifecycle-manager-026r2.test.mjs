import assert from 'node:assert/strict';
import test from 'node:test';

const importCore = (name) => import(new URL(`../../packages/core/${name}.mjs`, import.meta.url));

test('026R2: Bridge input cannot accept caller-owned capability readiness', async () => {
  const bridge = await importCore('ai-bridge');
  const source = Function.prototype.toString.call(bridge.resolveFoundationBridgeContext);
  assert.doesNotMatch(source, /capabilityStatus/u);
  const fabricated = bridge.resolveFoundationBridgeContext({
    installationRoot: '/definitely/absent/foundation',
    project: '/definitely/absent/project',
    operationRequirement: 'project-skill-use',
    capabilityStatus: {code: 'CAPABILITY_READY', usable: true},
  });
  assert.equal(fabricated.state, 'inert');
  assert.equal(fabricated.usable, false);
  assert.equal(fabricated.reason, 'BRIDGE_INPUT_INVALID');
});

test('026R2: runtime descriptor requires content-bound endpoint inventory and Foundation-owned state sources', async () => {
  const descriptor = await importCore('runtime-descriptor');
  assert.equal(descriptor.FOUNDATION_RUNTIME_DESCRIPTOR_SCHEMA_VERSION, '2.0.0');
  assert.equal(typeof descriptor.verifyFoundationRuntimeEndpoint, 'function');
  assert.equal(typeof descriptor.resolveFoundationCapabilityStateSources, 'function');
});

test('026R2: Foundation inspect reports derived Bridge health without adding a fifth operation', async () => {
  const manager = await importCore('lifecycle-manager');
  assert.deepEqual(Object.keys(manager.LOCAL_LIFECYCLE_AI_TOOLS), ['inspect', 'request-plan', 'open-manager', 'status']);
  const input = manager.LOCAL_LIFECYCLE_AI_TOOLS.inspect.input.properties;
  assert.equal('capability' in input, false);
  assert.equal(input.capabilityId.type, 'string');
  assert.equal(input.operationRequirement.type, 'string');
  const codes = manager.LOCAL_LIFECYCLE_AI_TOOLS.inspect.errors.map((entry) => entry.code);
  for (const code of ['FOUNDATION_CURRENT_RECEIPT_INVALID', 'RUNTIME_ENDPOINT_MISSING', 'RUNTIME_ENDPOINT_UNSAFE', 'RUNTIME_ENDPOINT_IDENTITY_MISMATCH', 'CAPABILITY_INACTIVE']) assert.ok(codes.includes(code), code);
});
