import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pathToFileURL} from 'node:url';

import {canonicalStringify, LOCAL_LIFECYCLE_AI_TOOLS, sha256} from '@foundation/core';
import {classifyFirstInstallCandidateTrust} from '../../packages/core/first-install-bootstrap.mjs';
import {createLocalLifecycleManagerServer} from '../../packages/core/lifecycle-manager-host.mjs';
import {createProjectLayoutMigrationPlan} from '../../packages/core/project-layout.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const TEST_ROOT = path.join(ROOT, '.tmp', '027R1', 'focused');
const HARNESS_ROOT = path.join(ROOT, '.tmp', '027R1', 'harness');
const REGISTER = pathToFileURL(path.join(HARNESS_ROOT, 'register.mjs')).href;
const PLATFORM_MODULE = pathToFileURL(path.join(ROOT, 'packages', 'core', 'platform-paths.mjs')).href;

function prepareExternalHarness() {
  const moduleMap = {
    schemaVersion: '1.0.0',
    purpose: '027R1 normal exact-candidate sandbox acceptance',
    replacements: [
      {productionSuffix: '/packages/core/platform-account.mjs', fixture: 'platform-account.mjs', capability: 'sandbox path identity only'},
      {productionSuffix: '/packages/cli/platform-account.mjs', fixture: 'platform-account.mjs', capability: 'sandbox path identity only'},
      {productionSuffix: '/packages/core/browser-launch.mjs', fixture: 'browser-launch.mjs', capability: 'record loopback URL only'},
      {productionSuffix: '/packages/cli/browser-launch.mjs', fixture: 'browser-launch.mjs', capability: 'record loopback URL only'},
    ],
    forbiddenReplacements: ['manager-confirmation.mjs', 'runtime-surface.mjs', 'human-authorization.mjs', 'trusted-authority.mjs', 'lifecycle-manager-host.mjs', 'transaction-engine.mjs'],
    approvalAuthority: false,
    mutationAuthority: false,
  };
  const files = {
    'browser-launch.mjs': `import fs from 'node:fs';

export function openFoundationManagerUrl(url) {
  const record = process.env.FOUNDATION_027R1_BROWSER_RECORD;
  if (record) fs.appendFileSync(record, \`${'${JSON.stringify({url, recordedAt: Date.now(), approvalAuthority: false, mutationAuthority: false})}'}\\n\`);
  return {opened: false, reason: '027R1 external record-only browser fixture'};
}
`,
    'loader.mjs': `const platformFixture = new URL('./platform-account.mjs', import.meta.url).href;
const browserFixture = new URL('./browser-launch.mjs', import.meta.url).href;
const map = [
  {suffix: '/packages/core/platform-account.mjs', fixture: platformFixture},
  {suffix: '/packages/cli/platform-account.mjs', fixture: platformFixture},
  {suffix: '/packages/core/browser-launch.mjs', fixture: browserFixture},
  {suffix: '/packages/cli/browser-launch.mjs', fixture: browserFixture},
];
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  const replacement = map.find((entry) => resolved.url.endsWith(entry.suffix));
  return replacement ? {url: replacement.fixture, shortCircuit: true} : resolved;
}
`,
    'platform-account.mjs': `import path from 'node:path';
const repository = path.resolve(import.meta.dirname, '../../..');
const allowedRoot = path.join(repository, '.tmp', '027R1');
export function readCurrentPlatformAccount() {
  const mode = process.env.FOUNDATION_027R1_ACCOUNT_MODE || 'sandbox';
  if (mode === 'uid-mismatch') return {schemaVersion: '1.0.0', authority: 'external-027R1-fixture', platform: process.platform, uid: process.geteuid() + 1, gid: process.getegid(), username: 'fixture', homedir: process.env.FOUNDATION_027R1_PLATFORM_HOME};
  if (mode === 'malformed') return {schemaVersion: '1.0.0', authority: 'external-027R1-fixture', platform: process.platform, uid: process.geteuid(), gid: process.getegid(), username: '', homedir: 'relative'};
  const homedir = path.resolve(process.env.FOUNDATION_027R1_PLATFORM_HOME || '');
  if (homedir !== allowedRoot && !homedir.startsWith(\`${'${allowedRoot}'}${'${path.sep}'}\`)) throw new Error('027R1 external platform fixture refuses paths outside .tmp/027R1');
  return Object.freeze({schemaVersion: '1.0.0', authority: 'external-027R1-sandbox-account-fixture', platform: process.platform, uid: process.geteuid(), gid: process.getegid(), username: 'foundation-027r1-fixture', homedir});
}
`,
    'register.mjs': `import {register} from 'node:module';
register(new URL('./loader.mjs', import.meta.url), {parentURL: import.meta.url});
`,
    'module-map.json': `${JSON.stringify(moduleMap, null, 2)}\n`,
  };
  fs.rmSync(HARNESS_ROOT, {recursive: true, force: true});
  fs.mkdirSync(HARNESS_ROOT, {recursive: true});
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(HARNESS_ROOT, name), text);
}

test.before(() => {
  fs.mkdirSync(TEST_ROOT, {recursive: true});
  prepareExternalHarness();
});
test.after(() => {
  fs.rmSync(TEST_ROOT, {recursive: true, force: true});
  fs.rmSync(HARNESS_ROOT, {recursive: true, force: true});
});

function runPlatform(environment = {}) {
  const source = `import(${JSON.stringify(PLATFORM_MODULE)}).then(({resolveFoundationPlatformPaths})=>console.log(JSON.stringify(resolveFoundationPlatformPaths())))`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PATH: '', ...environment}});
}

function bootstrapProjectPlan(name, ttlMs) {
  const project = path.join(TEST_ROOT, name, 'project');
  const stateRoot = path.join(TEST_ROOT, name, 'bootstrap-state');
  fs.mkdirSync(path.join(project, '.foundation', 'facts'), {recursive: true});
  fs.mkdirSync(path.join(project, 'src'), {recursive: true});
  fs.writeFileSync(path.join(project, '.foundation', 'foundation.json'), `${JSON.stringify({projectId: name, dataFormatVersion: '0.1.0'})}\n`);
  fs.writeFileSync(path.join(project, '.foundation', 'facts', 'keep.json'), '{"keep":true}\n');
  fs.writeFileSync(path.join(project, 'src', 'keep.js'), 'export const keep = true;\n');
  const base = createProjectLayoutMigrationPlan({project, now: Date.now()});
  const {integrity: _integrity, ...unsignedBase} = base;
  const unsigned = {...unsignedBase, expiresAt: Date.now() + ttlMs, bootstrap: {managerState: {path: stateRoot}, projects: {scanCount: 0, modifications: 'none'}}};
  return {project, stateRoot, plan: {...unsigned, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(unsigned))}}};
}

async function listen(plan, stateRoot) {
  const server = createLocalLifecycleManagerServer({plan, stateRoot});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {server, url: `http://127.0.0.1:${server.address().port}/`};
}

test('027R1 production source path authority ignores poisoned HOME variants and writes none of them', () => {
  const absolute = path.join(TEST_ROOT, 'absolute fake 用户');
  const unicode = path.join(TEST_ROOT, '伪造 HOME 空格');
  const projectInternal = path.join(ROOT, '.tmp', '027R1', 'focused', 'project-internal-home');
  const aliasTarget = path.join(TEST_ROOT, 'alias-target');
  const alias = path.join(TEST_ROOT, 'alias-home');
  for (const directory of [absolute, unicode, projectInternal, aliasTarget]) fs.mkdirSync(directory, {recursive: true});
  fs.symlinkSync(aliasTarget, alias);
  const variants = [absolute, '', 'relative-home', unicode, projectInternal, alias];
  const expectedHome = os.userInfo().homedir;
  for (const HOME of variants) {
    const before = fs.readdirSync(TEST_ROOT, {recursive: true}).sort();
    const run = runPlatform({HOME, USER: 'poisoned-user', LOGNAME: 'poisoned-logname'});
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.homeRealPath, expectedHome);
    assert.equal(result.installRoot, path.join(expectedHome, 'Library', 'Application Support', 'AI Product Foundation Kit'));
    assert.deepEqual(fs.readdirSync(TEST_ROOT, {recursive: true}).sort(), before);
  }
});

test('027R1 lowest path reader rejects malformed and uid-inconsistent external account evidence', () => {
  const platformHome = path.join(TEST_ROOT, 'sandbox-account');
  for (const directory of [platformHome, path.join(platformHome, 'Library'), path.join(platformHome, 'Library', 'Application Support'), path.join(platformHome, 'Library', 'Caches')]) fs.mkdirSync(directory, {recursive: true});
  for (const mode of ['uid-mismatch', 'malformed']) {
    const run = runPlatform({NODE_OPTIONS: `--import=${REGISTER}`, FOUNDATION_027R1_PLATFORM_HOME: platformHome, FOUNDATION_027R1_ACCOUNT_MODE: mode});
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /PLATFORM_USER_HOME_UNTRUSTED/);
  }
});

test('027R1 trust policy separates local development, future verified distribution and contradictions', () => {
  const local = classifyFirstInstallCandidateTrust({signature: {status: 'unsigned', productionDistribution: false}, provenance: {status: 'local-candidate', immutableRelease: false}, source: {kind: 'repository-local-build'}});
  assert.deepEqual(local, {policy: 'local-development', accepted: true, status: 'accepted-local-development', label: 'unsigned / local-only / not a production release'});
  const verified = classifyFirstInstallCandidateTrust({signature: {status: 'verified', productionDistribution: true, signer: 'future-developer-id'}, provenance: {status: 'release-candidate', immutableRelease: true}, source: {kind: 'remote'}});
  assert.equal(verified.accepted, false);
  assert.equal(verified.code, 'VERIFIED_DISTRIBUTION_UNAVAILABLE');
  assert.throws(() => classifyFirstInstallCandidateTrust({signature: {status: 'unsigned', productionDistribution: true}, provenance: {status: 'local-candidate', immutableRelease: false}, source: {kind: 'repository-local-build'}}), {code: 'CANDIDATE_TRUST_POLICY_INVALID'});
});

test('027R1 external normal-path loader is allowlisted and cannot replace authority or mutation modules', () => {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, '.tmp', '027R1', 'harness', 'module-map.json'), 'utf8'));
  assert.deepEqual(map.replacements.map((entry) => entry.productionSuffix).sort(), ['/packages/cli/browser-launch.mjs', '/packages/cli/platform-account.mjs', '/packages/core/browser-launch.mjs', '/packages/core/platform-account.mjs']);
  assert.equal(map.approvalAuthority, false);
  assert.equal(map.mutationAuthority, false);
  const loader = fs.readFileSync(path.join(ROOT, '.tmp', '027R1', 'harness', 'loader.mjs'), 'utf8');
  for (const forbidden of map.forbiddenReplacements) assert.equal(loader.includes(forbidden), false);
  assert.deepEqual(Object.values(LOCAL_LIFECYCLE_AI_TOOLS).map((tool) => tool.name).sort(), ['Foundation:inspect', 'Foundation:open-manager', 'Foundation:request-plan', 'Foundation:status']);
});

test('027R1 production platform account reader contains no environment or caller root input', () => {
  const account = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'platform-account.mjs'), 'utf8');
  const paths = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'platform-paths.mjs'), 'utf8');
  assert.equal(/process\.env|os\.homedir/u.test(account), false);
  assert.equal(/process\.env|os\.homedir/u.test(paths), false);
  assert.equal(/--(?:home|root|target|state)/u.test(`${account}\n${paths}`), false);
});

test('027R1 source bootstrap deadline terminalizes no-install and closes the server', async () => {
  const fixture = bootstrapProjectPlan('deadline', 120);
  const opened = await listen(fixture.plan, fixture.stateRoot);
  const html = await (await fetch(opened.url)).text();
  assert.match(html, /关闭此页面不会安装或更改任何内容/u);
  await new Promise((resolve) => opened.server.once('close', resolve));
  const terminals = fs.readdirSync(path.join(fixture.stateRoot, 'terminal'));
  assert.equal(terminals.length, 1);
  const terminal = JSON.parse(fs.readFileSync(path.join(fixture.stateRoot, 'terminal', terminals[0]), 'utf8'));
  assert.equal(terminal.state, 'expired');
  assert.equal(terminal.mutationPerformed, false);
  assert.equal(fs.existsSync(path.join(fixture.project, '.foundation', 'identity')), false);
});

test('027R1 confirm racing with cancel has exactly one terminal winner and no half migration', async () => {
  const fixture = bootstrapProjectPlan('confirm-cancel-race', 5_000);
  const opened = await listen(fixture.plan, fixture.stateRoot);
  const html = await (await fetch(opened.url)).text();
  const nonce = html.match(/name="managerNonce" value="([0-9a-f]+)"/u)?.[1];
  const request = (action) => fetch(`${opened.url}__foundation/manager/confirm`, {method: 'POST', headers: {'content-type': 'application/json', origin: opened.url.slice(0, -1)}, body: JSON.stringify({managerNonce: nonce, action})}).then(async (response) => ({status: response.status, body: await response.json()})).catch(() => ({status: 0, body: null}));
  const outcomes = await Promise.all([request('confirm-exact-operation'), request('cancel-no-change')]);
  await new Promise((resolve) => opened.server.listening ? opened.server.once('close', resolve) : resolve());
  assert.equal(outcomes.filter((entry) => entry.status === 200).length, 1);
  const terminals = fs.readdirSync(path.join(fixture.stateRoot, 'terminal')).map((name) => JSON.parse(fs.readFileSync(path.join(fixture.stateRoot, 'terminal', name), 'utf8')));
  assert.equal(terminals.length, 1);
  const identity = fs.existsSync(path.join(fixture.project, '.foundation', 'identity', 'project.json'));
  const ownership = fs.existsSync(path.join(fixture.project, '.foundation', 'ownership.json'));
  assert.equal(identity, ownership);
});

test('027R1 confirm racing with normal shutdown has one winner and releases server authority', async () => {
  const fixture = bootstrapProjectPlan('confirm-shutdown-race', 5_000);
  const opened = await listen(fixture.plan, fixture.stateRoot);
  const html = await (await fetch(opened.url)).text();
  const nonce = html.match(/name="managerNonce" value="([0-9a-f]+)"/u)?.[1];
  const confirm = fetch(`${opened.url}__foundation/manager/confirm`, {method: 'POST', headers: {'content-type': 'application/json', origin: opened.url.slice(0, -1)}, body: JSON.stringify({managerNonce: nonce, action: 'confirm-exact-operation'})}).catch(() => null);
  const shutdown = opened.server.terminalizeBootstrapNoInstall({state: 'shutdown-no-install', status: 'SHUTDOWN_NO_INSTALL', reason: 'source-race-test'});
  await confirm;
  await new Promise((resolve) => opened.server.listening ? opened.server.once('close', resolve) : resolve());
  const terminals = fs.readdirSync(path.join(fixture.stateRoot, 'terminal')).map((name) => JSON.parse(fs.readFileSync(path.join(fixture.stateRoot, 'terminal', name), 'utf8')));
  assert.equal(terminals.length, 1);
  assert.equal(['shutdown-no-install', 'completed'].includes(terminals[0].state), true);
  assert.equal(shutdown.won || terminals[0].state === 'completed', true);
});
