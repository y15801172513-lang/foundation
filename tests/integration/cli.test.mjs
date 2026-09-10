import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {DEMO, makeTempDirectory, removeTempDirectory, ROOT, snapshotFacts} from '../helpers/project-fixture.mjs';

function run(args) {
  const entry = path.join(ROOT, process.platform === 'win32' ? 'packages/cli/index.mjs' : 'foundation-kit');
  return process.platform === 'win32'
    ? spawnSync(process.execPath, [entry, ...args], {cwd: ROOT, encoding: 'utf8'})
    : spawnSync(entry, args, {cwd: ROOT, encoding: 'utf8'});
}

test('CLI setup、status、verify 保持兼容，create 一步写入被新 project plan 合同拒绝', (t) => {
  assert.equal(run(['setup']).status, 0);
  assert.equal(run(['status']).status, 0);
  const verified = run(['verify', DEMO]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ok, true);
  const parent = makeTempDirectory('prompt010-create-');
  t.after(() => removeTempDirectory(parent));
  const target = path.join(parent, 'created-project');
  const oneStep = run(['create', target]);
  assert.notEqual(oneStep.status, 0);
  assert.match(oneStep.stderr, /create 必须使用 create plan 或 create apply/);
  assert.equal(fs.existsSync(target), false);
});

test('CLI 六类变化判断保持完整', (t) => {
  const directory = makeTempDirectory('prompt010-classify-');
  t.after(() => removeTempDirectory(directory));
  const cases = [
    [{changeType: 'copy_or_data'}, 'same_instance'],
    [{changeType: 'repeatable_style_or_state', samePurpose: true, sameStructure: true}, 'variant'],
    [{applyToAll: true}, 'base_update'],
    [{interactionOutcome: 'different'}, 'new_component'],
    [{singleLocation: true, explicitSpecialHandling: true}, 'local_exception'],
    [{}, 'needs_user_decision']
  ];
  for (const [input, expected] of cases) {
    const file = path.join(directory, `${expected}.json`);
    fs.writeFileSync(file, JSON.stringify(input));
    const result = run(['classify-change', DEMO, '--input', file]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).label, expected);
  }
});

test('CLI upgrade 对未显式 enabled 项目在第一笔备份写入前拒绝', (t) => {
  const parent = makeTempDirectory('prompt010-upgrade-');
  t.after(() => removeTempDirectory(parent));
  const success = path.join(parent, 'success');
  fs.cpSync(DEMO, success, {recursive: true});
  const before = snapshotFacts(success);
  const failed = run(['upgrade', 'plan', '--project', success]);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /安装根|PROJECT_NOT_ENABLED|INSTALLATION_ROOT_REQUIRED|PROJECT_ROLE_REJECTED/u);
  assert.deepEqual(snapshotFacts(success), before);
  assert.equal(fs.existsSync(path.join(success, '.foundation', 'backups', 'pre-upgrade')), false);
});

test('CLI 验证流程不改写示例 facts', () => {
  const before = snapshotFacts(DEMO);
  assert.equal(run(['verify', DEMO]).status, 0);
  assert.deepEqual(snapshotFacts(DEMO), before);
});

test('CLI inventory 对已有项目只读盘点并输出迁移保护状态', (t) => {
  const temporary = makeTempDirectory('prompt014a-inventory-cli-');
  t.after(() => removeTempDirectory(temporary));
  const project = path.join(temporary, 'existing');
  fs.mkdirSync(path.join(project, 'src/components'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src/index.jsx'), 'export const App=()=> <button onClick={()=>{}}>打开</button>;');
  fs.writeFileSync(path.join(project, 'src/components/Card.jsx'), 'export const Card=()=> null;');
  const before = fs.readFileSync(path.join(project, 'src/index.jsx'));
  const result = run(['inventory', project]);
  assert.equal(result.status, 0, result.stderr);
  const inventory = JSON.parse(result.stdout);
  assert.equal(inventory.governanceMode, 'preserve-and-inventory');
  assert.deepEqual(inventory.migration, {authorized: false, performed: false});
  assert.deepEqual(fs.readFileSync(path.join(project, 'src/index.jsx')), before);
});
