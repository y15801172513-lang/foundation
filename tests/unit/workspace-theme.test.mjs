import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {applyWorkspaceTheme, readWorkspaceTheme, THEME_STORAGE_KEY} from '../../apps/management-center/src/theme/workspace-theme.mjs';

test('工作台主题优先恢复持久化选择，否则跟随系统偏好', () => {
  const stored = {getItem: (key) => key === THEME_STORAGE_KEY ? 'dark' : null};
  assert.equal(readWorkspaceTheme({storage: stored, matchMedia: () => ({matches: false})}), 'dark');
  assert.equal(readWorkspaceTheme({storage: {getItem: () => null}, matchMedia: () => ({matches: true})}), 'dark');
  assert.equal(readWorkspaceTheme({storage: {getItem: () => 'invalid'}, matchMedia: () => ({matches: false})}), 'light');
});

test('应用主题会同步根节点 class、可观测状态、color-scheme 与持久化值', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const written = [];
  const storage = {setItem: (key, value) => written.push([key, value])};
  assert.equal(applyWorkspaceTheme('dark', {root: dom.window.document.documentElement, storage}), 'dark');
  assert.equal(dom.window.document.documentElement.classList.contains('dark'), true);
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
  assert.equal(dom.window.document.documentElement.style.colorScheme, 'dark');
  assert.deepEqual(written, [[THEME_STORAGE_KEY, 'dark']]);
  applyWorkspaceTheme('light', {root: dom.window.document.documentElement, storage});
  assert.equal(dom.window.document.documentElement.classList.contains('dark'), false);
  assert.equal(dom.window.document.documentElement.dataset.theme, 'light');
  assert.equal(dom.window.document.documentElement.style.colorScheme, 'light');
  dom.window.close();
});
