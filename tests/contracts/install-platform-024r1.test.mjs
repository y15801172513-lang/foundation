import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LIFECYCLE_PROFILES,
  createLifecyclePlan,
  deriveTrustedLifecycleAuthority,
  explainLifecyclePlan,
  inspectPlatform,
  validateLifecyclePlan,
} from '@foundation/core';
import {resolveTrustedTargetForApply} from '../../packages/core/trusted-authority.mjs';
import {ROOT, makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';

const candidate = (root, version = '0.2.0') => ({
  path: path.join(root, 'candidate'),
  manifestHash: 'a'.repeat(64),
  runtimeHash: 'b'.repeat(64),
  bytes: 1024,
  version,
  acquisition: 'local-ingestion',
});

test('024R1 trusted authority 固定到真实仓库 .tmp，调用者不能自报外部 sandbox', () => {
  const authority = deriveTrustedLifecycleAuthority();
  assert.equal(authority.repositoryRealPath, fs.realpathSync(ROOT));
  assert.equal(authority.trustedRootRealPath, fs.realpathSync(path.join(ROOT, '.tmp')));

  const outside = path.join('/private/tmp', `foundation-024r1-${process.pid}`);
  assert.equal(fs.existsSync(outside), false);
  assert.throws(() => createLifecyclePlan({
    operation: 'install',
    targetRoot: outside,
    sandboxRoot: '/private/tmp',
    targetVersion: '0.2.0',
    candidate: candidate(path.join(ROOT, '.tmp')),
  }), (error) => error.code === 'TARGET_OUTSIDE_TRUSTED_ROOT');
  assert.equal(fs.existsSync(outside), false);

  const homeTarget = path.join(os.homedir(), `foundation-024r1-${process.pid}`);
  assert.throws(() => createLifecyclePlan({
    operation: 'install',
    targetRoot: homeTarget,
    sandboxRoot: os.homedir(),
    targetVersion: '0.2.0',
    candidate: candidate(path.join(ROOT, '.tmp')),
  }), (error) => error.code === 'TARGET_OUTSIDE_TRUSTED_ROOT');
  assert.equal(fs.existsSync(homeTarget), false);
});

test('024R1 planner 拒绝 symlink ancestor、相对穿越和平台绝对路径变体', (t) => {
  const root = makeTempDirectory('024r1-authority-');
  t.after(() => removeTempDirectory(root));
  const real = path.join(root, 'real');
  fs.mkdirSync(real);
  const linked = path.join(root, 'linked');
  fs.symlinkSync(real, linked, 'dir');
  assert.throws(() => createLifecyclePlan({
    operation: 'install', targetRoot: path.join(linked, 'install'), sandboxRoot: root,
    targetVersion: '0.2.0', candidate: candidate(root),
  }), (error) => error.code === 'TARGET_SYMLINK_ANCESTOR_REJECTED');
  assert.throws(() => createLifecyclePlan({
    operation: 'install', targetRoot: path.resolve(root, '../../outside'), sandboxRoot: root,
    targetVersion: '0.2.0', candidate: candidate(root),
  }), (error) => error.code === 'TARGET_OUTSIDE_TRUSTED_ROOT');
  for (const variant of ['C:\\Users\\person\\Foundation', '\\\\server\\share\\Foundation']) {
    assert.throws(() => createLifecyclePlan({
      operation: 'install', targetRoot: variant, sandboxRoot: root,
      targetVersion: '0.2.0', candidate: candidate(root),
    }), (error) => ['TARGET_NOT_ABSOLUTE', 'TARGET_PLATFORM_PATH_REJECTED'].includes(error.code));
  }
});

test('024R1 plan 绑定 repository/target snapshot，改写后验证失败', (t) => {
  const root = makeTempDirectory('024r1-plan-');
  t.after(() => removeTempDirectory(root));
  const plan = createLifecyclePlan({
    operation: 'install', profile: 'core', targetRoot: path.join(root, 'install'), sandboxRoot: root,
    targetVersion: '0.2.0', candidate: candidate(root), now: 100,
  });
  assert.equal(plan.authority.mode, 'repository-candidate');
  assert.equal(plan.authority.repositoryRealPath, fs.realpathSync(ROOT));
  assert.equal(plan.authority.targetSnapshot.exists, false);
  assert.equal(validateLifecyclePlan({...plan, targetRoot: path.join(root, 'rewritten')}, {now: 101}).error.code, 'PLAN_TAMPERED');
});

test('024R1 apply 检测 plan 后 target directory replacement', (t) => {
  const root = makeTempDirectory('024r1-target-replacement-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'install');
  fs.mkdirSync(target);
  const plan = createLifecyclePlan({operation: 'install', targetRoot: target, sandboxRoot: root, targetVersion: '0.2.0', candidate: candidate(root), now: 1});
  fs.rmdirSync(target);
  fs.mkdirSync(target);
  assert.equal(validateLifecyclePlan(plan, {now: 2}).ok, true);
  assert.throws(() => resolveTrustedTargetForApply(plan), (error) => ['TARGET_REPLACED_AFTER_PLAN', 'TARGET_ANCESTOR_REPLACED'].includes(error.code));
});

test('024R1 custom 独立选择 AI bridge 与组件扩展，文本和 JSON 同源', (t) => {
  const root = makeTempDirectory('024r1-custom-');
  t.after(() => removeTempDirectory(root));
  const withAi = createLifecyclePlan({
    operation: 'install', profile: 'custom', aiBridge: true, extensions: [],
    targetRoot: path.join(root, 'with-ai'), sandboxRoot: root, targetVersion: '0.2.0', candidate: candidate(root), now: 1,
  });
  const withComponents = createLifecyclePlan({
    operation: 'install', profile: 'custom', aiBridge: false, extensions: ['shadcn'],
    targetRoot: path.join(root, 'with-components'), sandboxRoot: root, targetVersion: '0.2.0', candidate: candidate(root), now: 1,
  });
  assert.equal(withAi.selection.aiBridge, true);
  assert.deepEqual(withAi.extensions, []);
  assert.equal(withComponents.selection.aiBridge, false);
  assert.deepEqual(withComponents.extensions, ['shadcn']);
  assert.match(explainLifecyclePlan(withAi), /惰性 AI capability artifact/u);
  assert.match(explainLifecyclePlan(withComponents), /shadcn/u);
  assert.equal(LIFECYCLE_PROFILES.custom.aiBridge, 'selectable');
});

test('024R1 磁盘预检走到现存祖先，远程 acquisition 保持 pending', (t) => {
  const root = makeTempDirectory('024r1-disk-');
  t.after(() => removeTempDirectory(root));
  const target = path.join(root, 'missing', 'nested', 'install');
  const platform = inspectPlatform({targetRoot: target});
  assert.equal(typeof platform.diskAvailableBytes, 'number');
  assert.ok(platform.diskAvailableBytes > 0);
  assert.equal(platform.diskProbePath, fs.realpathSync(root));
  assert.equal(platform.remoteAcquisition, 'pending');
});
