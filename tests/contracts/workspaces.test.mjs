import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as core from '@foundation/core';
import * as managementCenter from '@foundation/management-center';
import * as cli from '@foundation/cli';
import {ROOT} from '../helpers/project-fixture.mjs';

function sourceFiles(directory) {
  return fs.readdirSync(directory, {recursive: true}).filter((name) => /\.(?:mjs|js|jsx)$/.test(name)).map((name) => path.join(directory, name));
}

test('三个真实 workspace 通过公开 exports 暴露职责', () => {
  assert.equal(typeof core.verify, 'function');
  assert.equal(typeof core.readPreviewConfig, 'function');
  assert.equal(typeof managementCenter.createManagementCenterServer, 'function');
  assert.equal(typeof managementCenter.workspaceDocument, 'function');
  assert.equal(typeof cli.runCli, 'function');
  for (const workspace of ['packages/core', 'packages/cli', 'apps/management-center']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, workspace, 'package.json')));
    assert.ok(manifest.name.startsWith('@foundation/'));
    assert.ok(manifest.exports);
  }
});

test('workspace 间没有相对路径穿透，CLI 没有 Button 演示硬编码', () => {
  const workspaceFiles = [...sourceFiles(path.join(ROOT, 'packages')), ...sourceFiles(path.join(ROOT, 'apps/management-center/src'))];
  for (const file of workspaceFiles) {
    const source = fs.readFileSync(file, 'utf8')
      .replace("'../core/lifecycle-manager-host.mjs'", "'internal-manager-host'")
      .replace("'../../../../packages/core/lifecycle-manager-host.mjs'", "'internal-manager-host'");
    assert.ok(!source.includes('../../packages/') && !source.includes('../core/index.mjs') && !source.includes('../../apps/management-center'), file);
  }
  const cliSource = fs.readFileSync(path.join(ROOT, 'packages/cli/index.mjs'), 'utf8');
  for (const forbidden of ["'/home'", "'/detail'", 'src/app.mjs', 'src/pages.mjs', 'src/button.mjs']) assert.ok(!cliSource.includes(forbidden), forbidden);
});

test('registry 层不承载 Foundation feature 定制，源码不新增危险执行入口', () => {
  const uiDirectory = path.join(ROOT, 'apps/management-center/src/components/ui');
  for (const file of sourceFiles(uiDirectory)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!source.includes('context-panel') && !source.includes('floating-panel') && !source.includes('workspace-'), file);
  }
  const checked = [...sourceFiles(path.join(ROOT, 'apps/management-center/src')), ...sourceFiles(path.join(ROOT, 'examples/button-two-page/src'))];
  for (const file of checked) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!source.includes('innerHTML') && !source.includes('eval(') && !source.includes('new Function('), file);
  }
});

test('管理中心目录职责清晰且状态只有一个源码权威', () => {
  for (const required of ['components/foundation/icon-button.jsx', 'features/preview/preview-canvas.jsx', 'features/context-panel/context-panel.jsx', 'state/workspace-state.mjs', 'server/center-server.mjs', 'workspace/workspace-app.jsx']) assert.ok(fs.existsSync(path.join(ROOT, 'apps/management-center/src', required)), required);
  const stateFiles = fs.readdirSync(path.join(ROOT, 'apps/management-center'), {recursive: true}).filter((name) => name.endsWith('workspace-state.mjs')).map((name) => name.replaceAll(path.sep, '/'));
  assert.deepEqual(stateFiles, ['src/state/workspace-state.mjs']);
});
