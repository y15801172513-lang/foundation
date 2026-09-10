import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import test from 'node:test';

import {createManagementCenterServer} from '@foundation/management-center';
import {
  SHADCN_ADAPTER,
  applyLifecyclePlan,
  applyProjectAuthorityPlan,
  authorizationEffectForLifecyclePlan,
  buildCandidate,
  createCapabilityPlan,
  createLifecyclePlan,
  createProjectAuthorityPlan,
  createProjectAuthorityRecoveryPlan,
  createProjectMutationPlan,
  evaluateFoundationOffer,
  inspectCapabilityStatus,
  inspectFoundationOfferPreference,
  inspectInstallation,
  inspectLifecycleRecovery,
  inspectProjectAuthority,
  inspectProjectAuthorityRecovery,
  inventoryProject,
  listProjectAuthorities,
  markFoundationOfferPresented,
  recordFoundationOfferDecision,
  sha256,
} from '../helpers/internal-core.mjs';
import {signTrustedPayload} from '../../packages/core/trusted-authority.mjs';
import {EVENTS, ROOT, copyProjectFixture, makeScopedTempDirectory, makeTempDirectory, projectFixturePath, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {prepareCurrentProjectLayoutFixture} from '../helpers/authorized-project-fixture.mjs';
import {
  applyCapabilityForTest,
  applyLifecycleForTest,
  applyProjectForTest,
  applyProjectRecoveryForTest,
  authorizeLifecycle,
  authorizeProject,
} from '../helpers/test-authorization.mjs';
import {
  issueTestHumanAuthorization,
  recordTestDirectOfferDecision,
  resetTestAuthorizationHost,
} from '../fixtures/test-protected-host-adapter.mjs';

const LIFECYCLE_CHILD = path.join(ROOT, 'tests', 'fixtures', 'lifecycle-child.mjs');
const PROJECT_CHILD = path.join(ROOT, 'tests', 'fixtures', 'project-authority-child.mjs');

function candidate(root, version = '0.2.0') {
  const source = path.join(root, `source-${version}-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(source, 'app'), {recursive: true});
  fs.writeFileSync(path.join(source, 'app', 'foundation-smoke.mjs'), `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))\n`);
  fs.cpSync(path.join(ROOT, 'templates'), path.join(source, 'app', 'templates'), {recursive: true});
  fs.cpSync(path.join(ROOT, 'skills'), path.join(source, 'app', 'artifacts', 'skills'), {recursive: true});
  const runtime = path.join(root, 'private-node');
  if (!fs.existsSync(runtime)) { fs.copyFileSync(process.execPath, runtime); fs.chmodSync(runtime, 0o755); }
  return buildCandidate({sourceRoot: source, outputRoot: path.join(root, `candidate-${version}-${crypto.randomUUID()}`), productVersion: version, platform: process.platform, arch: process.arch, runtimeSource: runtime, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
}

function lifecyclePlan({operation, root, target, built = null, version = '0.2.0', currentVersion = null, mode = null, recoverySnapshot = null, now = 1000}) {
  const runtime = built?.manifest.files.find((record) => record.path === built.manifest.runtime.path);
  return createLifecyclePlan({operation, profile: 'core', mode, targetRoot: target, sandboxRoot: root, currentVersion, targetVersion: version, candidate: built ? {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: runtime.sha256, bytes: built.manifest.totalBytes, version} : null, recoverySnapshot, now});
}

function treeHash(root) {
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

function waitForFile(file, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (fs.existsSync(file)) return resolve(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${file}`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function childResult(child) {
  return new Promise((resolve) => {
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => resolve({code, signal, stderr}));
  });
}

function httpRequest(port, {method = 'GET', pathname = '/', headers = {}, body = ''} = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({host: '127.0.0.1', port, method, path: pathname, headers}, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('024R7 same receipt 并发只允许一个 reservation；crash 后 replay 拒绝，explicit recover 有界恢复', async (t) => {
  const root = makeTempDirectory('024r7-receipt-race-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  fs.mkdirSync(target);
  const plan = lifecyclePlan({operation: 'install', root, target, built: candidate(root)});
  const planFile = path.join(root, 'plan.json');
  const marker = path.join(root, 'marker.json');
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  authorizeLifecycle(plan);
  const child = spawn(process.execPath, [LIFECYCLE_CHILD, planFile, 'operation', 'after-exclusive-acquire', marker], {cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe']});
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await waitForFile(marker);
  const beforeRace = treeHash(target);
  assert.throws(() => applyLifecyclePlan({plan, now: 1001}), (error) => error.code === 'HUMAN_AUTHORIZATION_REPLAYED');
  assert.equal(treeHash(target), beforeRace);
  child.kill('SIGKILL');
  assert.equal((await childResult(child)).signal, 'SIGKILL');
  assert.throws(() => applyLifecyclePlan({plan, now: 1001}), (error) => error.code === 'HUMAN_AUTHORIZATION_REPLAYED');
  const snapshot = inspectLifecycleRecovery(target);
  assert.equal(snapshot.status, 'recovery-required');
  const recover = lifecyclePlan({operation: 'recover', root, target, recoverySnapshot: snapshot, version: null, currentVersion: null, now: 2000});
  const recovered = applyLifecycleForTest(recover);
  assert.equal(recovered.mutationPerformed, true);
  assert.equal(inspectLifecycleRecovery(target).status, 'clean');
  assert.equal(inspectInstallation(target).installed, false);
});

test('024R7 receipt substitution、expired、revoked 与 CLI/direct bypass 全部零写入', (t) => {
  const root = makeTempDirectory('024r7-receipt-negative-');
  t.after(() => removeTempDirectory(root));
  const built = candidate(root);
  const a = lifecyclePlan({operation: 'install', root, target: path.join(root, 'a'), built});
  const b = lifecyclePlan({operation: 'install', root, target: path.join(root, 'b'), built});
  issueTestHumanAuthorization(authorizationEffectForLifecyclePlan(a));
  assert.throws(() => applyLifecyclePlan({plan: b, now: 1001}), (error) => error.code === 'HUMAN_AUTHORIZATION_REQUIRED');
  assert.equal(fs.existsSync(b.targetRoot), false);

  for (const [state, expected] of [['revoked', 'HUMAN_AUTHORIZATION_REVOKED'], ['expired', 'HUMAN_AUTHORIZATION_EXPIRED']]) {
    const plan = lifecyclePlan({operation: 'install', root, target: path.join(root, state), built, now: state === 'expired' ? Date.now() - 10_000 : 1000});
    issueTestHumanAuthorization(authorizationEffectForLifecyclePlan(plan), state === 'expired' ? {now: Date.now() - 10_000, ttlMs: 1} : {state});
    assert.throws(() => applyLifecyclePlan({plan, now: plan.createdAt + 1}), (error) => error.code === expected);
    assert.equal(fs.existsSync(plan.targetRoot), false);
  }

  const cliPlan = lifecyclePlan({operation: 'install', root, target: path.join(root, 'cli'), built, now: Date.now()});
  const file = path.join(root, 'cli-plan.json');
  fs.writeFileSync(file, `${JSON.stringify(cliPlan, null, 2)}\n`);
  const cli = path.join(ROOT, 'packages', 'cli', 'index.mjs');
  const productionEnv = {PATH: process.env.PATH || ''};
  const direct = spawnSync(process.execPath, [cli, 'install', 'apply', '--plan', file], {cwd: ROOT, encoding: 'utf8', env: productionEnv});
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /apply 普通 CLI 入口已关闭.*manager open/u);
  const copied = spawnSync(process.execPath, [cli, 'install', 'apply', '--plan', file, '--confirm', cliPlan.integrity.hash], {cwd: ROOT, encoding: 'utf8', env: productionEnv});
  assert.equal(copied.status, 1);
  assert.match(copied.stderr, /apply 普通 CLI 入口已关闭.*manager open/u);
  assert.equal(fs.existsSync(cliPlan.targetRoot), false);
});

test('024R7 lifecycle status/doctor 对 stale evidence byte-for-byte 零写入', (t) => {
  const root = makeTempDirectory('024r7-read-zero-write-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  applyLifecycleForTest(lifecyclePlan({operation: 'install', root, target, built: candidate(root)}));
  const guard = path.join(target, '.foundation-operation.guard');
  const current = JSON.parse(fs.readFileSync(path.join(target, 'state', 'current.json'), 'utf8'));
  fs.copyFileSync(path.join(target, 'state', 'current.json'), guard);
  const guardDoc = JSON.parse(fs.readFileSync(guard, 'utf8'));
  guardDoc.operationId = 'tampered-shape';
  fs.writeFileSync(guard, `${JSON.stringify(guardDoc, null, 2)}\n`);
  const before = treeHash(target);
  assert.equal(inspectInstallation(target).recovery.status, 'manual-action-required');
  const cli = path.join(ROOT, 'packages', 'cli', 'index.mjs');
  const status = spawnSync(process.execPath, [cli, 'status', '--root', target], {cwd: ROOT, encoding: 'utf8'});
  const doctor = spawnSync(process.execPath, [cli, 'doctor', '--root', target], {cwd: ROOT, encoding: 'utf8'});
  assert.equal(status.status, 0, status.stderr);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(treeHash(target), before);
  assert.equal(current.identity.installId, inspectInstallation(target).current.identity.installId);
});

test('024R7 project enable/disable SIGKILL windows require separately authorized exact recovery', async (t) => {
  const root = makeScopedTempDirectory('project-authority-sandboxes', '024r7-project-crash-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = path.join(root, 'foundation-install');
  applyLifecycleForTest(lifecyclePlan({operation: 'install', root, target: installationRoot, built: candidate(root)}));
  const createdProject = projectFixturePath(root, 'created-from-template');
  const createPlan = createProjectAuthorityPlan({operation: 'enable', project: createdProject, installationRoot, createFromTemplate: true, now: 900});
  assert.throws(() => applyProjectForTest(createPlan, {faultAt: 'after-portable-binding'}), (error) => error.code === 'FAULT_INJECTED');
  assert.equal(fs.existsSync(createdProject), false, 'failed create must restore an originally absent target exactly');
  assert.equal(inspectProjectAuthorityRecovery(installationRoot).status, 'clean');
  const project = projectFixturePath(root, 'product-project');
  fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
  fs.writeFileSync(path.join(project, '.foundation', 'facts', 'sentinel.json'), '{"keep":true}\n');
  const factsHash = treeHash(path.join(project, '.foundation', 'facts'));

  const crash = async (plan, stage, label) => {
    const file = path.join(root, `${label}.plan.json`);
    const marker = path.join(root, `${label}.marker.json`);
    fs.writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
    authorizeProject(plan);
    const child = spawn(process.execPath, [PROJECT_CHILD, file, stage, marker], {cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe']});
    await waitForFile(marker);
    child.kill('SIGKILL');
    assert.equal((await childResult(child)).signal, 'SIGKILL');
  };

  await crash(createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: 1000}), 'after-portable-binding', 'enable-crash');
  assert.equal(inspectProjectAuthorityRecovery(installationRoot).status, 'recovery-required');
  applyProjectRecoveryForTest(createProjectAuthorityRecoveryPlan({installationRoot, now: 2000}));
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'unmanaged');
  applyProjectForTest(createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: 3000}));
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'enabled');

  await crash(createProjectAuthorityPlan({operation: 'disable', project, installationRoot, now: 4000}), 'after-machine-registration', 'disable-crash');
  assert.equal(inspectProjectAuthorityRecovery(installationRoot).status, 'recovery-required');
  applyProjectRecoveryForTest(createProjectAuthorityRecoveryPlan({installationRoot, now: 5000}));
  assert.equal(inspectProjectAuthority(project, {installationRoot}).state, 'enabled');
  assert.equal(treeHash(path.join(project, '.foundation', 'facts')), factsHash);
});

test('026 replacement: enabled 不是 mutation 授权；HTTP 只能打开 exact manager plan 且尚未写项目', async (t) => {
  const root = makeScopedTempDirectory('project-authority-sandboxes', '024r7-entrypoints-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = path.join(root, 'foundation-install');
  applyLifecycleForTest(lifecyclePlan({operation: 'install', root, target: installationRoot, built: candidate(root)}));
  const project = projectFixturePath(root, 'events');
  copyProjectFixture(EVENTS, project);
  prepareCurrentProjectLayoutFixture(project);
  applyProjectForTest(createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: 1000}));

  const extension = SHADCN_ADAPTER.plan({project, installationRoot, registry: {schemaVersion: '1.0.0', name: 'local', item: {name: 'x', files: [{path: 'src/no-receipt.jsx', content: 'export const X=1;\n'}]}}});
  const before = treeHash(project);
  assert.throws(() => SHADCN_ADAPTER.apply(extension), (error) => error.code === 'HUMAN_AUTHORIZATION_REQUIRED');
  assert.equal(treeHash(project), before);

  const draft = {from: 'page_events_manage', to: 'page_events_home', trigger: 'no-receipt'};
  const semantics = {...draft, condition: null, targetState: null, targetEntity: null};
  const mutationPlan = createProjectMutationPlan({operation: 'relation-facts-write', project, installationRoot, handlerPayload: {draft: semantics, generatedAt: new Date().toISOString()}});
  const server = createManagementCenterServer(project, {installationRoot});
  t.after(() => server.close());
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const origin = `http://127.0.0.1:${port}`;
  const html = (await httpRequest(port)).body;
  const nonce = JSON.parse(html.match(/window\.__FOUNDATION_WRITE_NONCE__=("[^"]+")/u)[1]);
  const response = await httpRequest(port, {method: 'POST', pathname: '/__foundation/relations', headers: {'content-type': 'application/json', origin, 'x-foundation-write-nonce': nonce}, body: JSON.stringify({draft, mutationPlan})});
  assert.equal(response.status, 202);
  assert.equal(JSON.parse(response.body).state, 'pending-manager-confirmation');
  assert.equal(treeHash(project), before);
});

test('024R7 capability artifact/receipt/registration/activation predicate 与 uninstall invalidation', (t) => {
  const root = makeScopedTempDirectory('project-authority-sandboxes', '024r7-capability-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = path.join(root, 'foundation-install');
  const built = candidate(root);
  applyLifecycleForTest(createLifecyclePlan({operation: 'install', profile: 'recommended', targetRoot: installationRoot, sandboxRoot: root, targetVersion: '0.2.0', candidate: {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: built.manifest.files.find((record) => record.path === built.manifest.runtime.path).sha256, bytes: built.manifest.totalBytes, version: '0.2.0'}, now: 1000}));
  const current = inspectInstallation(installationRoot).current;
  const manifestFile = path.join(installationRoot, ...current.appPath.split('/'), 'artifacts', 'skills', 'ai-product-foundation-kit', 'capability.json');
  const status = (mutating = false) => inspectCapabilityStatus({installationRoot, manifestFile, hostRegistrationIdentity: 'codex-test-host-registration', mutating});
  const assertReadOnlyStatus = (expected, mutating = false) => {
    const before = treeHash(installationRoot);
    const result = status(mutating);
    assert.equal(result.code, expected);
    assert.equal(treeHash(installationRoot), before, `capability status ${expected} must be byte-for-byte read-only`);
    return result;
  };
  assertReadOnlyStatus('CAPABILITY_NOT_INSTALLED');
  assert.equal(inspectCapabilityStatus({installationRoot: path.join(root, 'absent'), manifestFile: path.join(ROOT, 'skills', 'ai-product-foundation-kit', 'capability.json')}).code, 'FOUNDATION_NOT_INSTALLED');
  assert.equal(inspectCapabilityStatus({installationRoot, manifestFile: path.join(ROOT, 'skills', 'ai-product-foundation-kit', 'capability.json')}).code, 'CAPABILITY_IDENTITY_MISMATCH');

  applyCapabilityForTest(createCapabilityPlan({operation: 'install', installationRoot, manifestFile, now: 2000}));
  assertReadOnlyStatus('CAPABILITY_NOT_REGISTERED');
  applyCapabilityForTest(createCapabilityPlan({operation: 'register', installationRoot, manifestFile, hostRegistrationIdentity: 'codex-test-host-registration', now: 3000}));
  assertReadOnlyStatus('CAPABILITY_INACTIVE');
  applyCapabilityForTest(createCapabilityPlan({operation: 'activate', installationRoot, manifestFile, hostRegistrationIdentity: 'codex-test-host-registration', now: 4000}));
  assertReadOnlyStatus('CAPABILITY_READY');
  assertReadOnlyStatus('MANAGER_CONFIRMATION_REQUIRED', true);

  const capabilityGuard = path.join(installationRoot, 'state', '.capability-authority.guard');
  const staleOwner = {schemaVersion: '1.0.0', operationId: 'capability-crash-evidence', capabilityId: 'ai-product-foundation-kit', pid: 2_147_483_647, processFingerprint: {scheme: 'test-dead-owner-v1', value: 'dead'}, ownerNonce: crypto.randomUUID(), authorization: {authorizationId: 'consumed-before-crash'}, createdAt: Date.now()};
  fs.writeFileSync(capabilityGuard, `${JSON.stringify({...staleOwner, integrity: signTrustedPayload(staleOwner)}, null, 2)}\n`);
  const crashedBefore = treeHash(installationRoot);
  assert.equal(status().code, 'CAPABILITY_MANUAL_ACTION_REQUIRED');
  assert.equal(treeHash(installationRoot), crashedBefore, 'capability status must not repair or delete crash evidence');
  assert.throws(() => createCapabilityPlan({operation: 'deactivate', installationRoot, manifestFile, hostRegistrationIdentity: 'codex-test-host-registration'}), (error) => error.code === 'CAPABILITY_MANUAL_ACTION_REQUIRED');
  assert.equal(treeHash(installationRoot), crashedBefore);
  fs.rmSync(capabilityGuard);

  const inventoryOnly = path.join(root, 'inventory-only-project');
  fs.mkdirSync(inventoryOnly);
  fs.writeFileSync(path.join(inventoryOnly, 'README.md'), 'read-only inventory sentinel\n');
  const inventoryBefore = treeHash(inventoryOnly);
  assert.equal(inventoryProject(inventoryOnly).authorityState, 'inventory-only');
  assert.equal(inventoryProject(inventoryOnly).authorityState, 'inventory-only');
  assert.equal(treeHash(inventoryOnly), inventoryBefore);
  const installationBeforeListings = treeHash(installationRoot);
  assert.deepEqual(listProjectAuthorities(installationRoot), []);
  assert.equal(treeHash(installationRoot), installationBeforeListings);

  const product = path.join(root, 'product');
  fs.mkdirSync(path.join(product, '.foundation', 'facts'), {recursive: true});
  fs.writeFileSync(path.join(product, '.foundation', 'facts', 'sentinel.json'), '{"keep":true}\n');
  const productHash = treeHash(product);
  applyLifecycleForTest(lifecyclePlan({operation: 'uninstall', root, target: installationRoot, version: '0.2.0', currentVersion: '0.2.0', mode: 'app-only', now: 5000}));
  const capabilityState = JSON.parse(fs.readFileSync(path.join(installationRoot, 'state', 'capabilities.json'), 'utf8'));
  assert.equal(capabilityState.capabilities['ai-product-foundation-kit'].active, false);
  assert.equal(capabilityState.capabilities['ai-product-foundation-kit'].invalidatedByFoundationUninstall, true);
  assert.equal(treeHash(product), productHash);
});

test('026 replacement: ordinary offer API is session-only and AI cannot durable reopen', () => {
  resetTestAuthorizationHost();
  assert.equal(evaluateFoundationOffer({explicitGoal: true, materiallyNeedsFoundation: false, discoveryOnly: true}).decision, 'do-not-offer');
  assert.equal(evaluateFoundationOffer({explicitGoal: true, materiallyNeedsFoundation: true}).decision, 'offer-once');
  markFoundationOfferPresented();
  assert.equal(evaluateFoundationOffer({explicitGoal: true, materiallyNeedsFoundation: true}).decision, 'suppress');
  const declined = recordFoundationOfferDecision({decision: 'decline'});
  assert.equal(declined.state, 'declined');
  assert.equal(declined.durableDecisionRecorded, false);
  assert.equal(evaluateFoundationOffer({explicitGoal: true, materiallyNeedsFoundation: true, capabilityId: 'future-plugin-v99'}).decision, 'suppress');
  const reopened = recordFoundationOfferDecision({decision: 'reopen'});
  assert.equal(reopened.code, 'OFFER_REOPEN_AUTHORITY_UNAVAILABLE');
  assert.equal(reopened.applyAuthorized, false);
  assert.equal(evaluateFoundationOffer({explicitGoal: true, materiallyNeedsFoundation: true}).decision, 'suppress');
  assert.equal(inspectFoundationOfferPreference().state, 'offered-awaiting-response');
});
