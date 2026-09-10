import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {readRepositoryGitCommit, resolveRepositoryGitRoot} from '@foundation/core/git-identity';
import {isOwnedHealth} from '../../scripts/preview-control.mjs';
import {makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';

test('owner mismatch fixture 只用精确 safe.directory 读取已验证仓库 HEAD', (t) => {
  const repository = makeTempDirectory('git-owner-mismatch-021-');
  const project = path.join(repository, 'examples', 'fixture');
  fs.mkdirSync(path.join(repository, '.git'));
  fs.mkdirSync(project, {recursive: true});
  t.after(() => removeTempDirectory(repository));
  const expectedRoot = fs.realpathSync(repository);
  const expectedCommit = '0123456789abcdef0123456789abcdef01234567';
  const calls = [];
  const spawnGit = (command, args, options) => {
    calls.push({command, args, options});
    const safeDirectory = args.find((argument) => argument.startsWith('safe.directory='));
    if (safeDirectory !== `safe.directory=${expectedRoot}` || args[args.indexOf('-C') + 1] !== expectedRoot) {
      return {status: 128, stdout: '', stderr: 'fatal: detected dubious ownership'};
    }
    return {status: 0, stdout: `${expectedRoot}\n${expectedCommit}\n`, stderr: ''};
  };

  assert.equal(resolveRepositoryGitRoot(project), expectedRoot);
  assert.equal(readRepositoryGitCommit(project, {spawnGit}), expectedCommit);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'git');
  assert.deepEqual(calls[0].args, ['-c', `safe.directory=${expectedRoot}`, '-C', expectedRoot, 'rev-parse', '--show-toplevel', 'HEAD']);
  assert.equal(calls[0].options.shell, false);
});

test('控制器只接受与 live HEAD 完全一致的 40 位健康身份', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  const health = {ok: true, service: 'foundation-management-center', managedProject: 'foundation-events', port: 4317, processOwner: 'owner-021', gitCommit: commit};
  assert.equal(isOwnedHealth(health, 'owner-021', 4317, commit), true);
  assert.equal(isOwnedHealth({...health, gitCommit: null}, 'owner-021', 4317, commit), false);
  assert.equal(isOwnedHealth({...health, gitCommit: 'f'.repeat(40)}, 'owner-021', 4317, commit), false);
  assert.equal(isOwnedHealth(health, 'owner-021', 4317, null), false);
});
