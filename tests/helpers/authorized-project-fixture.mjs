import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildCandidate,
  canonicalStringify,
  createLifecyclePlan,
  createProjectAuthorityPlan,
  createProjectMutationPlan,
  registerPageRelation,
  sha256,
} from '@foundation/core';
import {ROOT} from './project-fixture.mjs';
import {applyLifecycleForTest, applyProjectForTest, authorizeProjectMutation} from './test-authorization.mjs';
import {configureRuntimeControl} from '../fixtures/test-runtime-surface.mjs';

export function installFoundationFixture(root, version = '0.2.0') {
  const source = path.join(root, `foundation-source-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(source, 'app'), {recursive: true});
  fs.writeFileSync(path.join(source, 'app', 'foundation-smoke.mjs'), `console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))\n`);
  fs.cpSync(path.join(ROOT, 'templates'), path.join(source, 'app', 'templates'), {recursive: true});
  const runtime = path.join(root, 'private-node');
  if (!fs.existsSync(runtime)) { fs.copyFileSync(process.execPath, runtime); fs.chmodSync(runtime, 0o755); }
  const built = buildCandidate({sourceRoot: source, outputRoot: path.join(root, `candidate-${crypto.randomUUID()}`), productVersion: version, platform: process.platform, arch: process.arch, runtimeSource: runtime, entrypoint: 'app/foundation-smoke.mjs', sourceKind: 'local-test'});
  const runtimeRecord = built.manifest.files.find((record) => record.path === built.manifest.runtime.path);
  const installationRoot = path.join(root, 'foundation-install');
  const plan = createLifecyclePlan({operation: 'install', profile: 'core', targetRoot: installationRoot, sandboxRoot: root, targetVersion: version, candidate: {path: built.root, manifestHash: built.manifest.candidateHash, runtimeHash: runtimeRecord.sha256, bytes: built.manifest.totalBytes, version}, now: Date.now()});
  applyLifecycleForTest(plan);
  return installationRoot;
}

export function enableProjectFixture(project, installationRoot) {
  prepareCurrentProjectLayoutFixture(project);
  const plan = createProjectAuthorityPlan({operation: 'enable', project, installationRoot, now: Date.now()});
  applyProjectForTest(plan);
  return plan;
}

export function prepareCurrentProjectLayoutFixture(project) {
  const foundation = path.join(project, '.foundation');
  if (!fs.existsSync(foundation)) return;
  const identityFile = path.join(foundation, 'identity', 'project.json');
  const ownershipFile = path.join(foundation, 'ownership.json');
  if (fs.existsSync(identityFile) && fs.existsSync(ownershipFile)) return;
  const legacyFile = path.join(foundation, 'foundation.json');
  const legacy = fs.existsSync(legacyFile) ? JSON.parse(fs.readFileSync(legacyFile, 'utf8')) : {};
  const projectId = legacy.projectId || `project-${crypto.randomUUID()}`;
  fs.mkdirSync(path.dirname(identityFile), {recursive: true});
  fs.writeFileSync(identityFile, `${JSON.stringify({...legacy, schemaVersion: '1.0.0', layoutVersion: '2.0.0', projectId, identityScheme: 'foundation-project-id-v2', name: legacy.name || path.basename(project), dataFormatVersion: legacy.dataFormatVersion || '0.1.0'}, null, 2)}\n`);
  const ownershipPayload = {schemaVersion: '2.0.0', layoutVersion: '2.0.0', projectId, ownedLeaves: [], ownedDirectories: [], preserved: ['.foundation/identity/project.json', '.foundation/facts', '.foundation/backups', 'unknown-and-user-modified-files', 'project-code']};
  fs.writeFileSync(ownershipFile, `${JSON.stringify({...ownershipPayload, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(ownershipPayload))}}, null, 2)}\n`);
}

export function relationMutationPlan(project, installationRoot, draft) {
  return createProjectMutationPlan({operation: 'relation-facts-write', project, installationRoot, handlerPayload: {draft, generatedAt: new Date().toISOString()}, preserves: ['project-source', '.foundation/facts/non-relation-documents']});
}

export function registerRelationForTest(project, draft, {installationRoot, runtimeControl = null} = {}) {
  const mutationPlan = relationMutationPlan(project, installationRoot, draft);
  authorizeProjectMutation(mutationPlan);
  configureRuntimeControl(runtimeControl);
  try { return registerPageRelation(project, draft, {mutationPlan}); }
  finally { configureRuntimeControl(null); }
}
