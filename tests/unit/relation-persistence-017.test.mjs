import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {readFacts, registerPageRelation, relationsVersion} from '@foundation/core';
import {EVENTS, ROOT, copyProjectFixture, makeScopedTempDirectory, projectFixturePath, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {enableProjectFixture, installFoundationFixture, registerRelationForTest, relationMutationPlan} from '../helpers/authorized-project-fixture.mjs';
import {authorizeProjectMutation} from '../helpers/test-authorization.mjs';

function runIndependentWriter(project, expectedVersion, trigger, mutationPlan) {
  const factsModule = pathToFileURL(path.join(ROOT, 'packages/core/facts.mjs')).href;
  const loader = path.join(ROOT, 'tests/fixtures/test-host-loader.mjs');
  const source = `import {registerPageRelation} from ${JSON.stringify(factsModule)};\ntry { const relation = registerPageRelation(process.env.FOUNDATION_TEST_PROJECT, {from:'page_events_manage',to:'page_events_home',trigger:process.env.FOUNDATION_TEST_TRIGGER,expectedVersion:process.env.FOUNDATION_TEST_VERSION}, {mutationPlan:JSON.parse(process.env.FOUNDATION_TEST_MUTATION_PLAN)}); console.log(JSON.stringify({ok:true,id:relation.id})); } catch (error) { console.log(JSON.stringify({ok:false,code:error.code,currentVersion:error.currentVersion || null})); process.exitCode = 3; }`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-loader', loader, '--input-type=module', '--eval', source], {env: {...process.env, FOUNDATION_TEST_PROJECT: project, FOUNDATION_TEST_TRIGGER: trigger, FOUNDATION_TEST_VERSION: expectedVersion, FOUNDATION_TEST_MUTATION_PLAN: JSON.stringify(mutationPlan)}, windowsHide: true});
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({code, payload: JSON.parse(stdout.trim()), stderr}));
  });
}

function setupProject(t, prefix) {
  const temporary = makeScopedTempDirectory('project-authority-sandboxes', prefix); t.after(() => removeTempDirectory(temporary));
  const installationRoot = installFoundationFixture(temporary);
  const project = projectFixturePath(temporary, 'project');
  copyProjectFixture(EVENTS, project);
  enableProjectFixture(project, installationRoot);
  return {temporary, project, installationRoot};
}

test('页面关系以原子 facts 写入保存，生命周期与运行绑定正交', (t) => {
  const {project, installationRoot} = setupProject(t, 'relation-017-');
  const before = readFacts(project).relations;
  const relation = registerRelationForTest(project, {from: 'page_events_manage', to: 'page_events_home', trigger: '返回首页', condition: null, sourceHandle: 'new-source', targetHandle: 'new-target', expectedVersion: relationsVersion(before)}, {installationRoot});
  const reloaded = readFacts(project).relations.items.at(-1);
  assert.equal(reloaded.id, relation.id);
  assert.equal(relation.sourceHandle, `relation:${relation.id}:source`);
  assert.equal(relation.targetHandle, `relation:${relation.id}:target`);
  assert.equal(reloaded.sourceHandle, relation.sourceHandle);
  assert.equal(reloaded.targetHandle, relation.targetHandle);
  assert.notEqual(reloaded.sourceHandle, 'new-source');
  assert.notEqual(reloaded.targetHandle, 'new-target');
  assert.equal(relation.status, 'registered');
  assert.equal(relation.runtimeBinding, 'pending');
  assert.equal(relation.condition, null);
  assert.equal(readFacts(project).relations.items[0].verificationStatus, 'verified');
  assert.throws(() => registerRelationForTest(project, {from: 'page_events_manage', to: 'page_events_home', trigger: '返回首页', condition: null}, {installationRoot}), (error) => error.code === 'duplicate');
  assert.throws(() => registerPageRelation(project, {from: 'page_events_home', to: 'page_events_home'}), (error) => error.code === 'schema');
  const selfLink = registerRelationForTest(project, {from: 'page_events_home', to: 'page_events_home', trigger: '切换筛选', targetState: 'archived'}, {installationRoot});
  assert.equal(selfLink.targetState, 'archived');
  assert.notEqual(selfLink.sourceHandle, relation.sourceHandle);
  assert.notEqual(selfLink.targetHandle, relation.targetHandle);
});

test('关系写入拒绝未知字段、控制字符与过期版本', (t) => {
  const {project, installationRoot} = setupProject(t, 'relation-017-security-');
  assert.throws(() => registerPageRelation(project, {from: 'page_events_manage', to: 'page_events_home', surprise: true}), (error) => error.code === 'schema');
  assert.throws(() => registerPageRelation(project, {from: 'page_events_manage', to: 'page_events_home', trigger: 'bad\u0000value'}), (error) => error.code === 'schema');
  assert.throws(() => registerRelationForTest(project, {from: 'page_events_manage', to: 'page_events_home', expectedVersion: 'stale'}, {installationRoot}), (error) => error.code === 'version_conflict');
});

test('test-only handler 后故障保持原 facts 且事务回滚', (t) => {
  const {project, installationRoot} = setupProject(t, 'relation-017-io-');
  const relationFile = path.join(project, '.foundation', 'facts', 'relations.json');
  const before = fs.readFileSync(relationFile, 'utf8');
  assert.throws(() => registerRelationForTest(project, {from: 'page_events_manage', to: 'page_events_home', trigger: 'I/O 测试'}, {installationRoot, runtimeControl: {faultAt: 'after-project-handler-execute'}}), (error) => error.code === 'FAULT_INJECTED');
  assert.equal(fs.readFileSync(relationFile, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(relationFile)).filter((name) => name.includes('.tmp')), []);
});

test('两个独立 Node 写者由项目事务串行化，过期写者必须重新计划且不丢更新', async (t) => {
  const {project, installationRoot} = setupProject(t, 'relation-018-process-');
  const expectedVersion = relationsVersion(readFacts(project).relations);
  const draftA = {from: 'page_events_manage', to: 'page_events_home', trigger: '独立写者 A', expectedVersion};
  const draftB = {from: 'page_events_manage', to: 'page_events_home', trigger: '独立写者 B', expectedVersion};
  const planA = relationMutationPlan(project, installationRoot, draftA);
  const planB = relationMutationPlan(project, installationRoot, draftB);
  authorizeProjectMutation(planA); authorizeProjectMutation(planB);
  const results = await Promise.all([runIndependentWriter(project, expectedVersion, '独立写者 A', planA), runIndependentWriter(project, expectedVersion, '独立写者 B', planB)]);
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 3]);
  const conflict = results.find((result) => ['version_conflict', 'PROJECT_HANDLER_BINDING_MISMATCH'].includes(result.payload.code));
  assert.ok(conflict, results.map((result) => result.stderr).join('\n'));
  if (conflict.payload.code === 'version_conflict') assert.equal(conflict.payload.currentVersion, relationsVersion(readFacts(project).relations));
  assert.equal(readFacts(project).relations.items.filter((relation) => relation.trigger?.startsWith('独立写者')).length, 1);
  assert.equal(fs.existsSync(path.join(project, '.foundation', 'locks', 'relations-write.lock')), false);
});
