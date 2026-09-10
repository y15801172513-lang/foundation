import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

import {
  authorizationEffectForCapabilityPlan,
  authorizationEffectForLifecyclePlan,
  authorizationEffectForProjectPlan,
  hashDirectory,
  sha256,
} from '@foundation/core';
import {loadTrustedAuthorityKey} from '../packages/core/trusted-authority.mjs';
import {issueTestHumanAuthorization, resetTestAuthorizationHost} from '../tests/fixtures/test-protected-host-adapter.mjs';

// Repository-only acceptance harness. The signer/loader below are test fixtures and are
// deliberately excluded from every candidate. Production protected-host authorization
// remains fail-closed until a real host broker is connected.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidate = path.join(ROOT, '.tmp', 'candidates', `foundation-0.2.0-${process.platform}-${process.arch}`);
const scope = path.join(ROOT, '.tmp', 'project-authority-sandboxes');
fs.mkdirSync(scope, {recursive: true});
const evidenceRoot = fs.mkdtempSync(path.join(scope, '024r7-final-empty-path-'));
const cli = path.join(candidate, 'payload', 'app', 'packages', 'cli', 'index.mjs');
const testLoader = pathToFileURL(path.join(ROOT, 'tests', 'helpers', 'register-test-host.mjs')).href;
const environment = {...process.env, PATH: '', NODE_OPTIONS: `--import=${testLoader}`};

resetTestAuthorizationHost();
loadTrustedAuthorityKey({create: true});

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {cwd: ROOT, encoding: 'utf8', env: environment});
  if (result.status !== 0) throw new Error(`${args.join(' ')}\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function trustedHostSaveAndAuthorize(plan, file, effect) {
  fs.writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`, {mode: 0o600});
  issueTestHumanAuthorization(effect(plan));
}

function operation(target, name, {candidateRequired = false, mode = null, targetVersion = null} = {}) {
  const planFile = path.join(evidenceRoot, `${path.basename(target)}-${name}${mode ? `-${mode}` : ''}.plan.json`);
  const args = [name, 'plan', '--root', target, '--sandbox-root', evidenceRoot, '--format', 'json'];
  if (candidateRequired) args.push('--candidate', candidate);
  if (mode) args.push('--mode', mode);
  if (targetVersion) args.push('--target-version', targetVersion);
  const plan = JSON.parse(run(args));
  trustedHostSaveAndAuthorize(plan, planFile, authorizationEffectForLifecyclePlan);
  const result = JSON.parse(run([name, 'apply', '--plan', planFile]));
  return {planId: plan.planId, state: result.result?.state || result.state, verification: result.verification || null};
}

function installAndUninstall(label, mode) {
  const target = path.join(evidenceRoot, label);
  const installed = operation(target, 'install', {candidateRequired: true});
  const uninstalled = operation(target, 'uninstall', {mode});
  return {target, installed, uninstalled};
}

const main = path.join(evidenceRoot, 'install-core');
const install = operation(main, 'install', {candidateRequired: true});
const shim = path.join(main, 'bin', process.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit');
const healthRun = spawnSync(shim, ['--foundation-health'], {cwd: ROOT, encoding: 'utf8', env: environment});
if (healthRun.status !== 0) throw new Error(`private shim health failed\n${healthRun.stderr || healthRun.stdout}`);
const health = JSON.parse(healthRun.stdout);
const update = operation(main, 'update', {candidateRequired: true});
const repair = operation(main, 'repair', {candidateRequired: true});
const rollback = operation(main, 'rollback', {targetVersion: '0.2.0'});

const current = JSON.parse(fs.readFileSync(path.join(main, 'state', 'current.json'), 'utf8'));
const capabilityManifest = path.join(main, ...current.appPath.split('/'), 'artifacts', 'skills', 'ai-product-foundation-kit', 'capability.json');
const capabilityOperation = (name) => {
  const planFile = path.join(evidenceRoot, `capability-${name}.plan.json`);
  const plan = JSON.parse(run(['capability', name, 'plan', '--root', main, '--manifest', capabilityManifest]));
  trustedHostSaveAndAuthorize(plan, planFile, authorizationEffectForCapabilityPlan);
  return JSON.parse(run(['capability', name, 'apply', '--plan', planFile]));
};
const capability = {
  install: capabilityOperation('install'),
  register: capabilityOperation('register'),
  activate: capabilityOperation('activate'),
};
capability.ready = JSON.parse(run(['capability', 'status', '--root', main, '--manifest', capabilityManifest]));
if (capability.ready.code !== 'CAPABILITY_READY') throw new Error(`capability did not become ready: ${capability.ready.code}`);
capability.mutating = JSON.parse(run(['capability', 'status', '--root', main, '--manifest', capabilityManifest, '--mutating']));
if (capability.mutating.code !== 'HUMAN_AUTHORIZATION_REQUIRED') throw new Error(`mutating capability predicate did not require exact authorization: ${capability.mutating.code}`);
capability.deactivate = capabilityOperation('deactivate');
capability.uninstall = capabilityOperation('uninstall');

const project = path.join(evidenceRoot, 'product-project');
const createPlanFile = path.join(evidenceRoot, 'project-create.plan.json');
const createPlan = JSON.parse(run(['create', 'plan', '--project', project, '--root', main, '--format', 'json']));
trustedHostSaveAndAuthorize(createPlan, createPlanFile, authorizationEffectForProjectPlan);
const enabled = JSON.parse(run(['create', 'apply', '--plan', createPlanFile]));
const disablePlanFile = path.join(evidenceRoot, 'project-disable.plan.json');
const disablePlan = JSON.parse(run(['project', 'disable', 'plan', '--project', project, '--root', main, '--format', 'json']));
trustedHostSaveAndAuthorize(disablePlan, disablePlanFile, authorizationEffectForProjectPlan);
const disabled = JSON.parse(run(['project', 'disable', 'apply', '--plan', disablePlanFile]));

const projectBefore = hashDirectory(project);
const factsBefore = hashDirectory(path.join(project, '.foundation', 'facts'));
const outside = path.join(evidenceRoot, 'outside-sentinel.txt');
fs.writeFileSync(outside, 'outside-unchanged\n');
const outsideBefore = sha256(fs.readFileSync(outside));
const full = operation(main, 'uninstall', {mode: 'full'});
const projectAfter = hashDirectory(project);
const factsAfter = hashDirectory(path.join(project, '.foundation', 'facts'));
const outsideAfter = sha256(fs.readFileSync(outside));
if (projectBefore !== projectAfter || factsBefore !== factsAfter || outsideBefore !== outsideAfter) throw new Error('full uninstall modified project/facts/outside sentinel');

const appOnly = installAndUninstall('install-app-only', 'app-only');
const appRuntime = installAndUninstall('install-app-runtime', 'app-and-runtime');

process.stdout.write(`${JSON.stringify({
  ok: true,
  harness: 'repository-test-only-protected-host',
  evidenceRoot,
  candidate,
  candidateHash: JSON.parse(fs.readFileSync(path.join(candidate, 'manifest.json'), 'utf8')).candidateHash,
  emptyPath: true,
  lifecycle: {install, update, repair, rollback, full, appOnly, appRuntime},
  capability,
  privateShimHealth: health,
  project: {path: project, enabled: enabled.state, disabled: disabled.state, portableState: JSON.parse(fs.readFileSync(path.join(project, '.foundation', 'project-binding.json'), 'utf8')).state},
  hashes: {projectBefore, projectAfter, factsBefore, factsAfter, outsideBefore, outsideAfter},
}, null, 2)}\n`);
