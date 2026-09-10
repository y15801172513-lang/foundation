import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import path from 'node:path';
import {ROOT} from '../helpers/project-fixture.mjs';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://127.0.0.1:4317/', pretendToBeVisual: true});
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true});
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
  dom.window.HTMLElement.prototype.getAnimations = () => [];
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  return dom;
}

const descriptor = (inspectorId, name, role, children = []) => ({inspectorId, name, role, componentId: null, instanceId: null, registeredComponent: false, summary: role, children});
const leafA = descriptor('leaf-a', '叶节点 A', 'button');
const grandchild = descriptor('grandchild', '孙节点', 'span');
const branch = descriptor('branch', '分支节点', 'section', [grandchild]);
const leafB = descriptor('leaf-b', '叶节点 B', 'button');
const treeRoot = descriptor('root', '根节点', 'main', [leafA, branch, leafB]);

function inspectedObject(overrides = {}) {
  return {
    version: 1,
    inspectorId: 'root',
    pageId: 'page-one',
    name: '根节点',
    role: 'main',
    componentId: null,
    instanceId: null,
    registeredComponent: false,
    path: ['main'],
    ancestorIds: [],
    tree: [treeRoot],
    hierarchy: {parent: null, current: treeRoot, children: treeRoot.children},
    layout: {},
    style: {},
    relatedLogic: [],
    usageLocations: [],
    gaps: [],
    ...overrides
  };
}

test('inspector tree 使用 roving focus 并实现完整树键盘矩阵', async (t) => {
  const dom = installDom();
  const vite = await createServer({root: path.join(ROOT, 'apps/management-center'), configFile: path.join(ROOT, 'apps/management-center/vite.config.js'), optimizeDeps: {noDiscovery: true}, server: {middlewareMode: true}});
  t.after(async () => { await vite.close(); dom.window.close(); });
  const {act, createElement} = await import('react');
  const {createRoot} = await import('react-dom/client');
  const {PreviewSidebar} = await vite.ssrLoadModule('/src/features/context-panel/preview-sidebar.jsx');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); const navigations = [];
  const model = {project: {name: 'Foundation'}, pages: [{id: 'page-one', name: '页面一'}, {id: 'page-two', name: '页面二'}], relations: []};
  const render = (object) => root.render(createElement(PreviewSidebar, {view: 'object', model, inspectedObject: object, treeActive: true, onNavigate: (navigation) => navigations.push(navigation)}));
  await act(async () => render(inspectedObject()));

  const items = () => [...container.querySelectorAll('[role="treeitem"]')];
  const focusedId = () => document.activeElement?.dataset.inspectorTreeId;
  const press = async (key) => act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})));
  assert.deepEqual(items().map((item) => item.tabIndex), [0]);
  assert.equal(items()[0].getAttribute('aria-expanded'), 'false');
  assert.equal(container.querySelector('[data-inspector-tree-toggle]').tabIndex, -1);
  await act(async () => items()[0].focus());

  await press('ArrowRight');
  assert.equal(focusedId(), 'root');
  assert.equal(items()[0].getAttribute('aria-expanded'), 'true');
  assert.deepEqual(items().map((item) => [item.dataset.inspectorTreeId, item.getAttribute('aria-level'), item.getAttribute('aria-posinset'), item.getAttribute('aria-setsize')]), [
    ['root', '1', '1', '1'], ['leaf-a', '2', '1', '3'], ['branch', '2', '2', '3'], ['leaf-b', '2', '3', '3']
  ]);
  await press('ArrowRight'); assert.equal(focusedId(), 'leaf-a');
  await press('ArrowDown'); assert.equal(focusedId(), 'branch');
  await press('ArrowRight'); assert.equal(focusedId(), 'branch');
  assert.equal(document.activeElement.getAttribute('aria-expanded'), 'true');
  await press('ArrowRight'); assert.equal(focusedId(), 'grandchild');
  await press('ArrowLeft'); assert.equal(focusedId(), 'branch');
  await press('ArrowLeft'); assert.equal(focusedId(), 'branch');
  assert.equal(document.activeElement.getAttribute('aria-expanded'), 'false');
  await press('End'); assert.equal(focusedId(), 'leaf-b');
  await press('Home'); assert.equal(focusedId(), 'root');
  await press('ArrowDown'); assert.equal(focusedId(), 'leaf-a');
  await press('ArrowUp'); assert.equal(focusedId(), 'root');
  await press('Enter');
  await press(' ');
  assert.deepEqual(navigations, [{inspectorId: 'root'}, {inspectorId: 'root'}]);

  await act(async () => document.querySelector('[data-inspector-tree-id="leaf-b"]').focus());
  assert.equal(focusedId(), 'leaf-b');
  const withoutLeafB = {...treeRoot, children: [leafA, branch]};
  await act(async () => render(inspectedObject({inspectorId: 'removed-node', name: '已移除节点', tree: [withoutLeafB]})));
  assert.equal(container.querySelectorAll('[role="treeitem"][tabindex="0"]').length, 1);
  assert.ok(container.querySelector('[role="treeitem"][tabindex="0"]') === document.activeElement);
  assert.notEqual(focusedId(), 'leaf-b');

  const pageTwoRoot = descriptor('page-two-root', '页面二根节点', 'main');
  await act(async () => render(inspectedObject({inspectorId: 'page-two-root', pageId: 'page-two', name: '页面二根节点', tree: [pageTwoRoot], hierarchy: {parent: null, current: pageTwoRoot, children: []}})));
  assert.equal(focusedId(), 'page-two-root');
  assert.equal(container.querySelectorAll('[role="treeitem"][tabindex="0"]').length, 1);
  await act(async () => root.unmount());
});
