import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {inspectInstallDestination, revalidateInstallDestination} from '../../packages/core/install-destination.mjs';
import {resolveFoundationPlatformPaths} from '../../packages/core/platform-paths.mjs';
import {prepareCodexSkillRegistration} from '../../packages/core/codex-skill-registration.mjs';
import {parseCliInvocation} from '../../packages/cli/command-contract.mjs';
import {deriveClosedHandlerBinding} from '../../packages/core/project-mutation-handlers.mjs';
import {contextPlainText, buildContextText} from '../../packages/core/context.mjs';
import {humanLabel} from '../../packages/core/human-labels.mjs';
import {installFoundationFixture} from '../helpers/authorized-project-fixture.mjs';
import {inspectCurrentInstallationAuthority, verifyCurrentInstallationAppAuthority} from '../../packages/core/transaction-engine.mjs';
import {routeToInstalledAuthority} from '../../packages/core/first-install-bootstrap.mjs';
import {readCodexInstallationHint, inspectConversationalInstall} from '../../packages/core/conversational-install.mjs';

const parent = fs.realpathSync(path.resolve(import.meta.dirname, '../../.tmp'));
test('030R1 Skill location discovery is read-only, rejects drift and never becomes execution authority', () => {
  const root = fs.mkdtempSync(path.join(parent, '030R1-discovery-'));
  try {
    assert.equal(readCodexInstallationHint(root).status, 'absent-or-moved');
    assert.deepEqual(fs.readdirSync(root), []);
    const directory = path.join(root, '.agents/skills/ai-product-foundation-kit');
    fs.mkdirSync(directory, {recursive:true});
    const destination = path.join(root, '用户 Foundation');
    fs.mkdirSync(destination);
    const file = path.join(directory, 'foundation-installation.json');
    const hint = {schemaVersion:'1.0.0', installationRoot:destination, installId:'install-123abc', resolver:'installed-current', authority:'discovery-hint-only'};
    fs.writeFileSync(file, JSON.stringify(hint));
    assert.equal(readCodexInstallationHint(root).installationRoot, destination);
    assert.equal(readCodexInstallationHint(root).verifiedInstallation, false);
    assert.equal(readCodexInstallationHint(root).executionPerformed, false);
    fs.writeFileSync(file, JSON.stringify({...hint, command:'do-not-execute'}));
    assert.equal(readCodexInstallationHint(root).status, 'invalid');
    fs.unlinkSync(file);
    const target = path.join(root, 'foreign.json');
    fs.writeFileSync(target, JSON.stringify(hint));
    fs.symlinkSync(target, file);
    assert.equal(readCodexInstallationHint(root).status, 'invalid');
    assert.equal(fs.readFileSync(target,'utf8'), JSON.stringify(hint));
  } finally { fs.rmSync(root,{recursive:true}); }
});
test('030R1 existing installation never executes an unverified app or launcher during handoff', () => {
  const root = fs.mkdtempSync(path.join(parent, '030R1-handoff-bytes-'));
  try {
    const installationRoot = installFoundationFixture(root);
    const candidateRoot = path.join(root, fs.readdirSync(root).find(name => name.startsWith('candidate-')));
    const local = inspectConversationalInstall({destination: path.join(root, 'absent'), candidateRoot, remoteAcquisitionVerified: true});
    assert.equal(local.candidate.signature.status, 'unsigned');
    assert.deepEqual(local.availableVersions, []);
    assert.equal(local.release.publication, 'unknown');
    assert.equal(local.release.remoteAcquisition, 'not-checked');
    assert.equal(local.remoteExistenceVerified, false, 'caller boolean is never evidence');
    assert.equal(local.localInstallationStatus, 'not-installed');
    assert.equal(fs.existsSync(path.join(root, 'absent')), false);
    assert.ok(!local.blockers.some(item => item.code === 'RELEASE_CHANNEL_UNPUBLISHED'));
    const installed = inspectConversationalInstall({destination: installationRoot});
    assert.equal(installed.installation.installed, true);
    assert.equal(installed.localInstallationStatus, 'installed-see-health');
    assert.equal(installed.release.remoteQuery, 'not-checked');
    assert.equal(installed.status, 'INSPECTION_COMPLETE');
    const valid = inspectCurrentInstallationAuthority(installationRoot);
    assert.equal(verifyCurrentInstallationAppAuthority(valid).verified, true);
    const entry = path.join(installationRoot, valid.current.entrypoint);
    const marker = path.join(root, 'must-not-execute');
    const original = fs.readFileSync(entry);
    fs.writeFileSync(entry, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected'); console.log(JSON.stringify({ok:true,version:'0.2.0'}));`);
    const context = inspectCurrentInstallationAuthority(installationRoot);
    assert.equal(fs.existsSync(marker), false, 'partial runtime verification must not execute unchecked app');
    assert.throws(() => verifyCurrentInstallationAppAuthority(context), {code: 'FOUNDATION_CURRENT_RECEIPT_INVALID'});
    assert.throws(() => routeToInstalledAuthority({installRoot: installationRoot}, {log() { assert.fail('must not route'); }}));
    assert.equal(fs.existsSync(marker), false);
    fs.writeFileSync(entry, original);
    const launcher = path.join(installationRoot, 'bin/foundation-kit');
    fs.writeFileSync(launcher, `#!/bin/sh\n/usr/bin/touch '${marker}'\n`);
    assert.throws(() => routeToInstalledAuthority({installRoot: installationRoot}, {log() { assert.fail('must not route'); }}));
    assert.equal(fs.existsSync(marker), false, 'tampered launcher must not run');
  } finally { fs.rmSync(root, {recursive:true}); }
});
test('030R1 capability recovery is plan-only through the exact manager parser', () => {
  assert.doesNotThrow(() => parseCliInvocation(['manager', 'request-plan', '--operation', 'capability-recover', '--parameters-json', JSON.stringify({installationRoot: '/example/Foundation'})]));
  assert.throws(() => parseCliInvocation(['manager', 'recover']));
  assert.throws(() => parseCliInvocation(['capability', 'recover', 'apply']));
});
test('030R1 context distinguishes declared business route from generated preview and honest registration status', () => {
  const page = {id: 'page_x', name: '首页', route: '/start', preview: '/__foundation/declarations/page_x', status: 'registered'};
  const plain = contextPlainText({page, scope: 'page'});
  assert.match(plain, /\nroute: \/start\npreview route: \/__foundation\/declarations\/page_x\n/u);
  assert.match(buildContextText({project: {}, pages: [page], relations: [], pageId: page.id}), /real route: \/start\npreview route:/u);
  assert.equal(humanLabel('status', 'registered'), '已登记（不代表已实现或验证）');
});
test('030R1 page plan binds exact facts and owned declaration preview; rejects unknown writes and remote routes', () => {
  const root = fs.mkdtempSync(path.join(parent, '030R1-page-plan-'));
  try {
    fs.mkdirSync(path.join(root, '.foundation/facts'), {recursive: true});
    const file = path.join(root, '.foundation/facts/pages.json');
    const before = JSON.stringify({schemaVersion: '0.1.0', items: [], kind: 'pages', userField: 'keep'});
    fs.writeFileSync(file, before);
    const plan = (draft) => deriveClosedHandlerBinding({operation: 'page-facts-write', project: root, handlerPayload: {draft, generatedAt: '2026-09-08T00:00:00.000Z'}});
    const binding = plan({name: '首页', route: '/home'});
    assert.equal(binding.allowedWriteSet.length, 3);
    assert.ok(binding.allowedWriteSet.includes('.foundation/facts/pages.json'));
    assert.ok(binding.allowedWriteSet.includes('.foundation/preview.json'));
    assert.match(binding.allowedWriteSet.find((item) => item.endsWith('.html')), /^\.foundation\/generated-cache\/page-declarations\/page_[a-f0-9]{12}\.html$/u);
    assert.deepEqual(binding.deletes, []);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    for (const draft of [{name: '首页', route: 'https://example.invalid'}, {name: '首页', route: '/home', path: '../unknown'}, {name: '', route: '/home'}]) assert.throws(() => plan(draft));
  } finally { fs.rmSync(root, {recursive: true}); }
});
test('030R1 destination proposal is read-only and detects directory replacement and unknown files', () => {
  const root = fs.mkdtempSync(path.join(parent, '030R1-destination-'));
  try {
    const target = path.join(root, '我的 Foundation');
    const absent = inspectInstallDestination(target);
    assert.equal(absent.exists, false);
    assert.equal(fs.existsSync(target), false);
    assert.equal(absent.mutationAuthority, false);
    fs.mkdirSync(target);
    assert.throws(() => revalidateInstallDestination(absent), {code: 'INSTALL_DESTINATION_DRIFT'});
    const empty = inspectInstallDestination(target);
    fs.writeFileSync(path.join(target, 'keep.txt'), 'user data');
    assert.throws(() => revalidateInstallDestination(empty), {code: 'INSTALL_DESTINATION_DRIFT'});
    assert.equal(inspectInstallDestination(target).empty, false);
    assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'user data');
    fs.symlinkSync(target, path.join(root, 'link'));
    assert.throws(() => inspectInstallDestination(path.join(root, 'link', 'child')), {code: 'INSTALL_DESTINATION_SYMLINK'});
    assert.throws(() => inspectInstallDestination(path.join(target, 'keep.txt', 'child')), {code: 'INSTALL_DESTINATION_NOT_DIRECTORY'});
    assert.throws(() => inspectInstallDestination('/'), {code: 'INSTALL_DESTINATION_INVALID'});
    assert.throws(() => inspectInstallDestination(target, {requiredBytes: -1}), {code: 'INSTALL_SPACE_INVALID'});
  } finally { fs.rmSync(root, {recursive: true}); }
});

test('030R1 source-only cannot register a user Skill; CLI choices are not confirmation', () => {
  assert.throws(() => prepareCodexSkillRegistration({installationRoot: parent, installId: 'not-installed', manifestFile: '/not-read'}), {code: 'CODEX_SKILL_SOURCE_ONLY'});
  assert.equal(parseCliInvocation(['install', '--destination', path.join(parent, 'Foundation 用户'), '--browser', 'codex']).options['--browser'], 'codex');
  for (const args of [['install', '--yes'], ['install', '--browser', 'fake'], ['install', '--destination', parent, '--destination', parent], ['onboarding', 'status', '--session-id']]) assert.throws(() => parseCliInvocation(args), {code: 'CLI_INVOCATION_INVALID'});
});

test('030R1 selected directory is reflected in paths without creating it or changing account home', {skip: process.platform !== 'darwin'}, () => {
  const destination = path.join(parent, '030R1-not-created 用户');
  assert.equal(fs.existsSync(destination), false);
  const defaults = resolveFoundationPlatformPaths();
  const selected = resolveFoundationPlatformPaths({destination});
  assert.equal(selected.installRoot, destination);
  assert.equal(selected.trustedRootRealPath, parent);
  assert.equal(selected.homeRealPath, defaults.homeRealPath);
  assert.equal(selected.bootstrapStateRoot, defaults.bootstrapStateRoot);
  assert.equal(fs.existsSync(destination), false);
});
