import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {ROOT} from '../helpers/project-fixture.mjs';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://127.0.0.1:4317/', pretendToBeVisual: true});
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node, SVGElement: dom.window.SVGElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true});
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
  globalThis.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.open = dom.window.open.bind(dom.window);
  return dom;
}

test('关系编辑使用注册 Dialog，管理焦点、Escape、保存中策略、冲突重试和取消', async (t) => {
  const dom = installDom();
  const vite = await createServer({root: path.join(ROOT, 'apps/management-center'), configFile: path.join(ROOT, 'apps/management-center/vite.config.js'), optimizeDeps: {noDiscovery: true}, server: {middlewareMode: true}});
  t.after(async () => { await vite.close(); dom.window.close(); });
  const {act, createElement, useState} = await import('react');
  const {createRoot} = await import('react-dom/client');
  const {RelationEditor} = await vite.ssrLoadModule('/src/workspace/information-logic-workspace.jsx');
  const pages = [{id: 'page_a', name: 'A'}, {id: 'page_b', name: 'B'}];
  const events = {cancel: 0, retry: [], save: []};

  function Harness({saving = false, conflict = null}) {
    const [open, setOpen] = useState(false);
    return createElement('div', null,
      createElement('button', {id: 'relation-invoker', onClick: () => setOpen(true)}, '打开关系编辑器'),
      open && createElement(RelationEditor, {connection: {source: 'page_a', target: 'page_b', sourceHandle: 'new-source', targetHandle: 'new-target'}, pages, relations: [], saving, conflict, error: conflict ? '关系事实已更新' : '', onCancel() { events.cancel += 1; setOpen(false); }, onRetry: (draft) => events.retry.push(draft), onRefresh: () => {}, onSave: (draft) => events.save.push(draft)})
    );
  }

  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness, {conflict: {status: 'ready', retryVersion: 'latest'}})));
  const invoker = document.querySelector('#relation-invoker'); invoker.focus();
  await act(async () => invoker.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  await act(async () => Promise.resolve());
  assert.ok(document.querySelector('[data-slot="dialog-content"][role="dialog"]'));
  assert.equal(document.querySelector('.relation-editor-backdrop'), null);
  assert.equal(document.activeElement?.getAttribute('placeholder'), '例如：点击管理事件');
  assert.equal(document.querySelector('[role="alert"]')?.textContent, '关系事实已更新');
  const retry = [...document.querySelectorAll('button')].find((button) => button.textContent === '使用最新版本重试');
  await act(async () => retry.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  assert.deepEqual(events.retry[0], {from: 'page_a', to: 'page_b', trigger: null, condition: null});
  const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent === '取消本次保存');
  await act(async () => cancel.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  await act(async () => Promise.resolve());
  assert.equal(events.cancel, 1);
  assert.equal(document.activeElement, invoker);

  await act(async () => root.render(createElement(Harness, {saving: true})));
  const savingInvoker = document.querySelector('#relation-invoker'); savingInvoker.focus();
  await act(async () => savingInvoker.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  const savingButton = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('保存中'));
  assert.ok(savingButton?.disabled, '保存中按钮必须保持禁用');
  assert.equal(savingButton.querySelector('[data-slot="spinner"]')?.getAttribute('aria-label'), '正在保存关系');
  assert.equal(document.querySelector('[data-slot="dialog-content"]')?.getAttribute('aria-busy'), 'true');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
  assert.ok(document.querySelector('[data-slot="dialog-content"]'));
  assert.equal(events.cancel, 1);
  await act(async () => root.unmount());
});
