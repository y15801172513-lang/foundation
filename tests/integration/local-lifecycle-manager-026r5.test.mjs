import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';

import {
  LOCAL_LIFECYCLE_AI_TOOLS,
  createCapabilityPlan,
  createLifecyclePlan,
  createProjectAuthorityPlan,
  hashDirectory,
  inspectInstallation,
  inspectLocalLifecycle,
} from '@foundation/core';
import {applyCapabilityForTest, applyLifecycleForTest, applyProjectForTest} from '../helpers/test-authorization.mjs';
import {prepareCurrentProjectLayoutFixture} from '../helpers/authorized-project-fixture.mjs';
import {EVENTS, ROOT, copyProjectFixture, makeScopedTempDirectory, projectFixturePath, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {snapshotScopes} from '../helpers/scoped-tree-snapshot.mjs';

const CAPABILITY_ID = 'ai-product-foundation-kit';
const SOURCE_TMP = path.join(ROOT, '.tmp');
let sharedRoot;
let sharedInstallationRoot;

function actualCandidate() {
  const root = path.join(SOURCE_TMP, 'candidates', `foundation-0.2.0-${process.platform}-${process.arch}`);
  assert.equal(fs.existsSync(root), true, 'run npm run candidate in the isolated nested source before 026R5 tests');
  return {root, manifest: JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))};
}

async function candidateCli() {
  const entry = path.join(actualCandidate().root, 'payload', 'app', 'packages', 'cli', 'index.mjs');
  return import(`${pathToFileURL(entry).href}?026r5=${Date.now()}-${Math.random()}`);
}

function invokeCandidate(cli, args) {
  const lines = [];
  try {
    cli.runCli(args, {log(value) { lines.push(String(value)); }});
    return {code: null, lines};
  } catch (error) {
    return {code: error?.code || 'UNSTRUCTURED_ERROR', error, lines};
  }
}

function install(root) {
  const candidate = actualCandidate();
  const runtime = candidate.manifest.files.find((record) => record.path === candidate.manifest.runtime.path);
  const installationRoot = path.join(root, 'foundation-install');
  const plan = createLifecyclePlan({
    operation: 'install',
    profile: 'core',
    targetRoot: installationRoot,
    sandboxRoot: root,
    targetVersion: candidate.manifest.productVersion,
    candidate: {path: candidate.root, manifestHash: candidate.manifest.candidateHash, runtimeHash: runtime.sha256, bytes: candidate.manifest.totalBytes, version: candidate.manifest.productVersion},
    now: Date.now(),
  });
  applyLifecycleForTest(plan);
  return installationRoot;
}

function capabilityManifest(installationRoot) {
  const current = inspectInstallation(installationRoot).current;
  const app = path.join(installationRoot, ...current.appPath.split('/'));
  const descriptor = JSON.parse(fs.readFileSync(path.join(app, 'foundation-runtime-descriptor.json'), 'utf8'));
  return path.join(app, ...descriptor.ruleCapabilityEndpoint.path.split('/'), 'skills', CAPABILITY_ID, 'capability.json');
}

function activateCapability(installationRoot) {
  const manifestFile = capabilityManifest(installationRoot);
  for (const operation of ['install', 'register', 'activate']) applyCapabilityForTest(createCapabilityPlan({operation, installationRoot, manifestFile, now: Date.now()}));
}

function internalPaths(root, t) {
  const paths = [
    ROOT,
    SOURCE_TMP,
    path.join(root, 'project-authority-sandboxes', 'legacy-fixture'),
    ...['026', '026R1', '026R2', '026R3', '026R4', '026R5', '026R99'].map((round) => path.join(root, round, 'project-authority-sandboxes', 'project')),
    path.join(root, 'future-round-731', 'random-project'),
    ...['candidates', 'candidate-build', '.foundation-lifecycle-authority', 'npm-cache', 'manager-state', 'smoke', 'evidence'].map((kind) => {
      const target = path.join(SOURCE_TMP, kind, path.basename(root));
      assert.equal(fs.existsSync(target), false, 'only create a fresh task-owned role scope');
      t.after(() => removeTempDirectory(target));
      return target;
    }),
    path.join(root, 'arbitrary-descendant'),
  ];
  for (const target of paths.slice(1)) fs.mkdirSync(target, {recursive: true});
  return paths;
}

test.before(() => {
  sharedRoot = makeScopedTempDirectory('026R5', 'shared-authority-');
  sharedInstallationRoot = install(sharedRoot);
  activateCapability(sharedInstallationRoot);
});

test.after(() => removeTempDirectory(sharedRoot));

test('026R5 source and exact candidate reject every source-temporary role without round or fixture bypasses', async (t) => {
  const root = makeScopedTempDirectory('026R5', 'internal-role-matrix-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = sharedInstallationRoot;
  const paths = internalPaths(root, t);
  const cli = await candidateCli();
  const scopes = [...paths.slice(2), root, sharedRoot, path.join(ROOT, 'foundation-kit.json')];
  const before = snapshotScopes(scopes);

  for (const project of paths) {
    assert.throws(
      () => createProjectAuthorityPlan({operation: 'enable', project, installationRoot}),
      (error) => error?.code === 'PROJECT_ROLE_REJECTED',
      `source must reject ${project}`,
    );
    const candidate = invokeCandidate(cli, ['project', 'enable', 'plan', '--project', project, '--root', installationRoot, '--format', 'json']);
    assert.equal(candidate.code, 'PROJECT_ROLE_REJECTED', `candidate must reject ${project}`);
  }
  assert.deepEqual(snapshotScopes(scopes), before, 'all exact source/candidate rejection scopes must be byte-for-byte zero-write');

  const sourceText = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'project-authority.mjs'), 'utf8');
  const candidateText = fs.readFileSync(path.join(actualCandidate().root, 'payload', 'app', 'packages', 'cli', 'index.mjs'), 'utf8');
  for (const [label, text] of [['source', sourceText], ['candidate', candidateText]]) {
    for (const marker of ['projectSandboxes', 'scoped026ProjectSandbox', 'project-authority-sandboxes']) assert.equal(text.includes(marker), false, `${label}: ${marker}`);
    assert.equal(/\[['"]026['"]|['"]026R\d+['"]\]/u.test(text), false, `${label}: round-name allowlist regression`);
  }
});

test('026R5 realpath aliases into source internals are structured zero-write rejections', async (t) => {
  const root = makeScopedTempDirectory('026R5', 'symlink-role-matrix-');
  t.after(() => removeTempDirectory(root));
  const alias = projectFixturePath(root, 'internal-alias');
  const target = path.join(root, 'evidence'); fs.mkdirSync(target);
  fs.symlinkSync(target, alias, 'dir');
  const scopes = [root, sharedRoot, path.dirname(alias), path.join(ROOT, 'foundation-kit.json')];
  const sourceBefore = snapshotScopes(scopes);
  const productBefore = fs.readlinkSync(alias);
  assert.throws(() => createProjectAuthorityPlan({operation: 'enable', project: alias, installationRoot: sharedInstallationRoot}), (error) => error?.code === 'PROJECT_REALPATH_UNSTABLE');
  const candidate = invokeCandidate(await candidateCli(), ['project', 'enable', 'plan', '--project', alias, '--root', sharedInstallationRoot, '--format', 'json']);
  assert.equal(candidate.code, 'PROJECT_REALPATH_UNSTABLE');
  assert.deepEqual(snapshotScopes(scopes), sourceBefore);
  assert.equal(fs.readlinkSync(alias), productBefore);
});

test('026R5 sibling product becomes ready only by exact project and capability agreement in source and candidate', async (t) => {
  const root = makeScopedTempDirectory('026R5', 'sibling-ready-matrix-');
  t.after(() => removeTempDirectory(root));
  const installationRoot = sharedInstallationRoot;
  const project = projectFixturePath(root, 'legitimate-product');
  copyProjectFixture(EVENTS, project);
  prepareCurrentProjectLayoutFixture(project);
  const identityFile = path.join(project, '.foundation', 'identity', 'project.json');
  const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
  identity.dataFormatVersion = '0.1.0';
  fs.writeFileSync(identityFile, `${JSON.stringify(identity, null, 2)}\n`);

  const portableOnlyPlan = createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: Date.now()});
  const beforeEnable = hashDirectory(project);
  const candidateModule = await candidateCli();
  const candidatePlan = invokeCandidate(candidateModule, ['project', 'enable', 'plan', '--project', project, '--root', installationRoot, '--format', 'json']);
  assert.equal(candidatePlan.code, null);
  assert.equal(hashDirectory(project), beforeEnable, 'source/candidate plan generation must be zero-write');
  assert.equal(inspectLocalLifecycle({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID}).bridge.state, 'inert');

  applyProjectForTest(portableOnlyPlan);
  const readyBefore = hashDirectory(project);
  const sourceReady = inspectLocalLifecycle({installationRoot, project, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.equal(sourceReady.project.state, 'enabled');
  assert.equal(sourceReady.project.agreement, true);
  assert.equal(sourceReady.bridge.state, 'ready', JSON.stringify(sourceReady.bridge));
  const candidateReady = invokeCandidate(candidateModule, ['manager', 'inspect', '--root', installationRoot, '--project', project]);
  assert.equal(candidateReady.code, null);
  const candidateInspection = JSON.parse(candidateReady.lines.at(-1));
  assert.equal(candidateInspection.project.state, 'enabled');
  assert.equal(candidateInspection.project.agreement, true);
  assert.equal(candidateInspection.bridge.state, 'ready');

  const missing = inspectLocalLifecycle({installationRoot, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
  assert.equal(missing.bridge.state, 'inert');
  assert.equal(missing.bridge.reason, 'PROJECT_REQUIRED');
  for (const internal of [ROOT, SOURCE_TMP, path.join(SOURCE_TMP, '026R5')]) {
    const sourceInternal = inspectLocalLifecycle({installationRoot, project: internal, operationRequirement: 'project-skill-use', capabilityId: CAPABILITY_ID});
    assert.equal(sourceInternal.bridge.state, 'inert');
    const candidateInternal = invokeCandidate(candidateModule, ['manager', 'inspect', '--root', installationRoot, '--project', internal]);
    assert.equal(candidateInternal.code, null);
    assert.equal(JSON.parse(candidateInternal.lines.at(-1)).bridge.state, 'inert');
  }
  assert.equal(hashDirectory(project), readyBefore, 'all source/candidate ready and inert inspections must be byte-for-byte zero-write');
  assert.deepEqual(Object.values(LOCAL_LIFECYCLE_AI_TOOLS).map((tool) => tool.name).sort(), ['Foundation:inspect', 'Foundation:open-manager', 'Foundation:request-plan', 'Foundation:status'].sort());
});
