import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {readFacts} from '@foundation/core';
import {EVENTS, ROOT} from '../helpers/project-fixture.mjs';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://127.0.0.1:4317/', pretendToBeVisual: true});
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, SVGElement: dom.window.SVGElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true});
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON() { return this; }});
  globalThis.ResizeObserver = class {constructor(callback) { this.callback = callback; } observe(target) { this.callback([{target, contentRect: target.getBoundingClientRect()}]); } unobserve() {} disconnect() {}};
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  dom.window.DOMMatrixReadOnly = class { constructor() { this.m22 = 1; } };
  globalThis.DOMMatrixReadOnly = dom.window.DOMMatrixReadOnly;
  globalThis.open = dom.window.open.bind(dom.window);
  return dom;
}

test('React Flow 仅让当前页面卡运行 live iframe，大量页面保持静态摘要且关系编辑器提交规范 draft', async (t) => {
  const dom = installDom();
  const vite = await createServer({root: path.join(ROOT, 'apps/management-center'), configFile: path.join(ROOT, 'apps/management-center/vite.config.js'), optimizeDeps: {noDiscovery: true}, server: {middlewareMode: true}});
  t.after(async () => { await vite.close(); dom.window.close(); });
  const {act, createElement} = await import('react');
  const {createRoot} = await import('react-dom/client');
  const {InformationLogicWorkspace, RelationEditor} = await vite.ssrLoadModule('/src/workspace/information-logic-workspace.jsx');
  const facts = readFacts(EVENTS);
  const pages = facts.pages.items.map((page) => ({...page, route: page.preview}));
  const container = document.createElement('div'); container.style.cssText = 'width:1200px;height:800px'; document.body.append(container);
  const root = createRoot(container); const opened = [];
  await act(async () => root.render(createElement(InformationLogicWorkspace, {model: {pages, relations: facts.relations.items, relationsVersion: 'version'}, pageId: 'page_events_home', theme: 'dark', onSelectPage() {}, onOpenPage: (id) => opened.push(id), onRelationSaved() {}})));
  assert.equal(container.querySelectorAll('.page-flow-node').length, 3);
  assert.equal(container.querySelectorAll('.page-thumbnail iframe').length, 1);
  assert.equal(container.querySelectorAll('.page-thumbnail[data-preview-mode="summary"]').length, 2);
  assert.ok(container.querySelector('.react-flow.dark'), '暗模式必须同步给 React Flow 引擎根节点');
  const livePreview = container.querySelector('.page-thumbnail iframe');
  assert.equal(new URL(livePreview.src).searchParams.get('foundationTheme'), 'dark', '不透明 sandbox 缩略预览必须从只读 URL 参数初始化暗模式');
  const thumbnailLoading = container.querySelector('.page-thumbnail-loading');
  assert.ok(thumbnailLoading, '实时缩略预览加载时必须保留卡片并显示加载层');
  assert.equal(thumbnailLoading.querySelector('[data-slot="spinner"]')?.getAttribute('aria-label'), '当前事件 页面缩略预览正在载入');
  assert.equal(livePreview.closest('.page-thumbnail')?.getAttribute('aria-busy'), 'true');
  await act(async () => livePreview.dispatchEvent(new Event('load')));
  assert.equal(container.querySelector('.page-thumbnail-loading'), null, 'iframe 完成后应移除缩略预览加载层');
  assert.equal(livePreview.closest('.page-thumbnail')?.getAttribute('aria-busy'), 'false');
  assert.ok(container.querySelectorAll('.react-flow__handle').length >= 6);
  const controls = container.querySelector('[data-testid="rf__controls"]');
  assert.ok(controls, '应显示 React Flow 画布控制区');
  assert.equal(controls.querySelectorAll('button').length, 4);
  assert.equal(controls.querySelectorAll('svg.lucide').length, 4, '所有画布控制图标都应使用 Lucide');
  for (const icon of controls.querySelectorAll('svg.lucide')) assert.equal(icon.getAttribute('stroke-width'), '2');
  assert.ok(controls.querySelector('button[aria-label="放大画布"] .lucide-zoom-in'));
  assert.ok(controls.querySelector('button[aria-label="缩小画布"] .lucide-zoom-out'));
  assert.ok(controls.querySelector('button[aria-label="适应视图"] .lucide-maximize2'));
  const lock = controls.querySelector('button[aria-label="锁定画布"]');
  assert.ok(lock, '画布可交互时应提供锁定操作');
  assert.ok(lock.querySelector('.lucide-lock'));
  await act(async () => lock.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  const unlock = controls.querySelector('button[aria-label="解锁画布"]');
  assert.ok(unlock, '锁定后应提供解锁操作');
  assert.ok(unlock.querySelector('.lucide-lock-open'));
  for (const node of container.querySelectorAll('.page-flow-node')) {
    for (const type of ['source', 'target']) {
      const positions = [...node.querySelectorAll(`.react-flow__handle-${type}`)].map((handle) => handle.style.top);
      assert.equal(new Set(positions).size, positions.length, `${node.dataset.pageId} 的 ${type} Handle 不得重叠`);
    }
  }
  const open = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('在预览中打开'));
  await act(async () => open.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  assert.equal(opened.length, 1);

  const manyPages = Array.from({length: 30}, (_, index) => ({id: `page_scale_${index}`, name: `规模页面 ${index}`, route: `/events?scale=${index}`, preview: `/events?scale=${index}`, verificationStatus: 'verified'}));
  await act(async () => root.render(createElement(InformationLogicWorkspace, {model: {pages: manyPages, relations: [], relationsVersion: 'version'}, pageId: 'page_scale_0', theme: 'light', onSelectPage() {}, onOpenPage() {}, onRelationSaved() {}})));
  assert.equal(container.querySelectorAll('.page-flow-node').length, 30);
  assert.equal(container.querySelectorAll('.page-thumbnail iframe').length, 1);
  assert.equal(container.querySelectorAll('.page-thumbnail[data-preview-mode="summary"]').length, 29);
  assert.ok(container.querySelector('.react-flow.light'), '亮模式必须同步给 React Flow 引擎根节点');
  assert.equal(new URL(container.querySelector('.page-thumbnail iframe').src).searchParams.get('foundationTheme'), 'light');

  let saved = null;
  await act(async () => root.render(createElement(RelationEditor, {connection: {source: 'page_events_manage', target: 'page_events_home', sourceHandle: 'new-source', targetHandle: 'new-target'}, pages, relations: [], onCancel() {}, onSave: (draft) => { saved = draft; }})));
  assert.match(document.body.textContent, /保存关系不等于运行跳转已实现/);
  const save = [...document.querySelectorAll('button')].find((button) => button.textContent === '保存关系');
  await act(async () => save.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  assert.deepEqual(saved, {from: 'page_events_manage', to: 'page_events_home', trigger: null, condition: null});
  await act(async () => root.unmount());
});
