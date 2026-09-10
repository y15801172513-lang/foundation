import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {inspectPreviewConfig, readPreviewConfig} from '@foundation/core';
import {copyDemo, makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';

test('Button 演示只通过自己的 preview 配置声明页面与资源', (t) => {
  const project = copyDemo();
  t.after(() => removeTempDirectory(project));
  const preview = readPreviewConfig(project);
  assert.deepEqual(preview.routes.map((entry) => entry.path), ['/home', '/detail']);
  assert.deepEqual(preview.assets.map((entry) => entry.path), ['/preview.css', '/src/preview.css', '/src/app.mjs', '/src/pages.mjs', '/src/button.mjs']);
});

test('preview 配置拒绝路径穿越、绝对文件与缺失文件', (t) => {
  const project = copyDemo();
  t.after(() => removeTempDirectory(project));
  const file = path.join(project, '.foundation', 'preview.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.assets[0].file = '../outside.css';
  config.assets[1].file = '/tmp/outside.css';
  config.assets[2].file = 'src/missing.mjs';
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  const result = inspectPreviewConfig(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('必须是项目内相对文件路径')));
  assert.ok(result.errors.some((error) => error.includes('引用的文件不存在')));
});

test('preview 配置拒绝通过 symlink 逃出项目根', (t) => {
  const project = copyDemo();
  const outsideRoot = makeTempDirectory('prompt010-outside-');
  t.after(() => { removeTempDirectory(project); removeTempDirectory(outsideRoot); });
  const outside = path.join(outsideRoot, 'outside.mjs');
  fs.writeFileSync(outside, 'export const escaped = true;');
  try { fs.symlinkSync(outside, path.join(project, 'src', 'linked.mjs')); } catch (error) { if (error.code === 'EPERM') return t.skip('当前 Windows 权限不允许创建符号链接'); throw error; }
  const file = path.join(project, '.foundation', 'preview.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.assets[0] = {path: '/src/linked.mjs', file: 'src/linked.mjs'};
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  const result = inspectPreviewConfig(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('通过符号链接逃出项目根目录')));
});

test('缺失 preview 配置时返回诚实错误', (t) => {
  const project = copyDemo();
  t.after(() => removeTempDirectory(project));
  fs.rmSync(path.join(project, '.foundation', 'preview.json'));
  assert.deepEqual(inspectPreviewConfig(project), {ok: false, errors: ['缺少 .foundation/preview.json'], config: null});
});
