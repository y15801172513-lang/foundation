import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pathToFileURL} from 'node:url';

import {buildCandidate, LOCAL_LIFECYCLE_AI_TOOLS, validateCandidate} from '@foundation/core';
import {recoverAbandonedBootstrapState} from '../../packages/core/first-install-bootstrap.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const TEST_ROOT = path.join(ROOT, '.tmp', 'first-install-bootstrap-027-tests');

test.after(() => fs.rmSync(TEST_ROOT, {recursive: true, force: true}));

function fixture(name) {
  const root = path.join(TEST_ROOT, name);
  fs.rmSync(root, {recursive: true, force: true});
  fs.mkdirSync(path.join(root, 'source', 'app'), {recursive: true});
  fs.writeFileSync(path.join(root, 'source', 'app', 'index.mjs'), "console.log('fixture')\n");
  return root;
}

test('027 candidate has one verified self-hosted macOS launcher in complete inventory', () => {
  const root = fixture('launcher');
  const built = buildCandidate({sourceRoot: path.join(root, 'source'), outputRoot: path.join(root, 'candidate'), productVersion: '0.2.0', platform: 'darwin', arch: process.arch, runtimeSource: process.execPath, entrypoint: 'app/index.mjs'});
  assert.equal(built.manifest.launcher.path, 'foundation-kit');
  assert.equal(built.manifest.launcher.externalNodeRequired, false);
  assert.equal(built.manifest.launcher.mode, 0o755);
  assert.equal(built.manifest.totalBytes, built.manifest.files.reduce((sum, entry) => sum + entry.size, 0) + built.manifest.launcher.size);
  assert.equal(validateCandidate(built.root, {platform: 'darwin', arch: process.arch, requireRuntime: true}).ok, true);
  fs.appendFileSync(path.join(built.root, 'foundation-kit'), '# drift\n');
  const tampered = validateCandidate(built.root, {platform: 'darwin', arch: process.arch, requireRuntime: true});
  assert.equal(tampered.ok, false);
  assert.equal(tampered.error.code, 'CANDIDATE_LAUNCHER_INVALID');
});

test('027R1 centralized macOS path authority ignores caller HOME and derives roots from OS account identity', () => {
  const home = path.join(TEST_ROOT, 'platform home 用户');
  for (const directory of [home, path.join(home, 'Library'), path.join(home, 'Library', 'Application Support'), path.join(home, 'Library', 'Caches')]) fs.mkdirSync(directory, {recursive: true});
  const moduleUrl = pathToFileURL(path.join(ROOT, 'packages', 'core', 'platform-paths.mjs')).href;
  const source = `import(${JSON.stringify(moduleUrl)}).then(({resolveFoundationPlatformPaths})=>console.log(JSON.stringify(resolveFoundationPlatformPaths())))`;
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {encoding: 'utf8', env: {...process.env, HOME: home, PATH: ''}});
  assert.equal(run.status, 0, run.stderr);
  const paths = JSON.parse(run.stdout);
  const accountHome = os.userInfo().homedir;
  assert.equal(paths.homeRealPath, accountHome);
  assert.equal(paths.installRoot, path.join(accountHome, 'Library', 'Application Support', 'AI Product Foundation Kit'));
  assert.equal(paths.bootstrapStateRoot, path.join(accountHome, 'Library', 'Caches', 'AI Product Foundation Kit', 'bootstrap-manager'));
  assert.equal(paths.accountIdentity.uid, process.geteuid());
  assert.equal(paths.installRoot.startsWith(paths.bootstrapStateRoot), false);
  assert.equal(paths.bootstrapStateRoot.startsWith(paths.installRoot), false);

  const aliasHome = path.join(TEST_ROOT, 'alias-home');
  const aliasTarget = path.join(TEST_ROOT, 'alias-target');
  fs.rmSync(aliasHome, {recursive: true, force: true});
  fs.rmSync(aliasTarget, {recursive: true, force: true});
  fs.mkdirSync(aliasHome, {recursive: true});
  fs.mkdirSync(aliasTarget, {recursive: true});
  fs.symlinkSync(aliasTarget, path.join(aliasHome, 'Library'));
  const aliasRun = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {encoding: 'utf8', env: {...process.env, HOME: aliasHome, PATH: ''}});
  assert.equal(aliasRun.status, 0, aliasRun.stderr);
  assert.equal(JSON.parse(aliasRun.stdout).homeRealPath, accountHome);
});

test('027 bootstrap launcher does not add an AI operation or public approval capability', () => {
  assert.deepEqual(Object.values(LOCAL_LIFECYCLE_AI_TOOLS).map((tool) => tool.name).sort(), ['Foundation:inspect', 'Foundation:open-manager', 'Foundation:request-plan', 'Foundation:status']);
  assert.equal(Object.keys(LOCAL_LIFECYCLE_AI_TOOLS).length, 4);
  assert.equal(Object.keys(LOCAL_LIFECYCLE_AI_TOOLS).some((name) => /confirm|apply|consume|bootstrap/iu.test(name)), false);
  const bootstrapSource = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'first-install-bootstrap.mjs'), 'utf8');
  assert.equal(/--(?:state-root|target-root|install-root|yes|force|confirm)\b/u.test(bootstrapSource), false);
  assert.equal(/FOUNDATION_(?:BOOTSTRAP|INSTALL)_(?:ROOT|STATE|CONFIRM)/u.test(bootstrapSource), false);
});

test('027 bootstrap terminal state is deterministically bounded to 32 pointers', () => {
  const stateRoot = path.join(fixture('bounded-terminal-state'), 'bootstrap-state');
  const sessions = path.join(stateRoot, 'sessions');
  const plans = path.join(stateRoot, 'plans');
  fs.mkdirSync(sessions, {recursive: true});
  fs.mkdirSync(plans, {recursive: true});
  for (let index = 0; index < 35; index += 1) {
    const sessionId = `manager-session-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const session = {schemaVersion: '1.0.0', sessionId, operationId: `operation-${index}`, planHash: 'a'.repeat(64), effectHash: 'b'.repeat(64), state: 'pending', expiresAt: index};
    fs.writeFileSync(path.join(sessions, `${sessionId}.json`), `${JSON.stringify(session)}\n`);
    fs.writeFileSync(path.join(plans, `${sessionId}.json`), '{}\n');
  }
  assert.equal(recoverAbandonedBootstrapState(stateRoot, {now: 100}).length, 35);
  assert.equal(fs.readdirSync(sessions).length, 0);
  assert.equal(fs.readdirSync(plans).length, 0);
  assert.equal(fs.readdirSync(path.join(stateRoot, 'terminal')).length, 32);
});
