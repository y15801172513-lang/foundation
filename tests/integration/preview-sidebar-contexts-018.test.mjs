import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {readFacts} from '@foundation/core';
import {createWorkspaceState, transitionWorkspace} from '@foundation/management-center/state';
import {EVENTS, ROOT} from '../helpers/project-fixture.mjs';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://127.0.0.1:4317/', pretendToBeVisual: true});
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true});
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
  dom.window.HTMLElement.prototype.getAnimations = () => [];
  globalThis.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  return dom;
}

test('侧栏只有两个上下文，保留 Tab 滚动位置，检查按钮位于 Tabs 左侧且无分隔线', async (t) => {
  const dom = installDom();
  const vite = await createServer({root: path.join(ROOT, 'apps/management-center'), configFile: path.join(ROOT, 'apps/management-center/vite.config.js'), optimizeDeps: {noDiscovery: true}, server: {middlewareMode: true}});
  t.after(async () => { await vite.close(); dom.window.close(); });
  const {act, createElement} = await import('react'); const {createRoot} = await import('react-dom/client');
  const {ContextPanel} = await vite.ssrLoadModule('/src/features/context-panel/context-panel.jsx');
  const facts = readFacts(EVENTS); const toggles = []; const dispatches = [];
  let expandedInspectorNodes = new Set();
  const state = createWorkspaceState({panelPlacement: 'docked', pageId: 'page_events_home'});
  const object = {name: '管理事件', role: 'button', componentId: 'component_event_action', instanceId: 'event_action_manage', registeredComponent: true, pageId: 'page_events_home', path: ['main', 'header', 'button'], hierarchy: {parent: {name: '页头', role: 'header'}, current: {name: '管理事件', role: 'button'}, children: []}, layout: {}, style: {}, relatedLogic: [], usageLocations: [], gaps: []};
  const defaultObject = {inspectorId: 'dom:div#root', name: 'Foundation 验证项目当前事件只展示仍在进行中的事件', role: 'div', componentId: null, instanceId: null, registeredComponent: false, pageId: 'page_events_home', path: ['div#root'], ancestorIds: [], tree: [{inspectorId: 'dom:div#root', name: 'Foundation 验证项目当前事件只展示仍在进行中的事件', role: 'div', componentId: null, instanceId: null, registeredComponent: false, summary: 'div#root', children: [{inspectorId: 'dom:div#root/main', name: '当前事件', role: 'main', componentId: null, instanceId: null, registeredComponent: false, summary: 'main', children: []}]}], hierarchy: {parent: null, current: {inspectorId: 'dom:div#root', name: 'Foundation 验证项目当前事件只展示仍在进行中的事件', role: 'div', componentId: null, instanceId: null, registeredComponent: false}, children: []}, layout: {display: 'block'}, style: {fontSize: '16px'}, relatedLogic: [], usageLocations: [], gaps: ['交互验证待确认']};
  const model = {project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, interactions: facts.interactions.items};
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const dispatch = (action) => { dispatches.push(action); Object.assign(state, transitionWorkspace(state, action)); };
  const setExpandedInspectorNodes = (update) => { expandedInspectorNodes = typeof update === 'function' ? update(expandedInspectorNodes) : update; };
  const render = (inspectedObject, inspectorActive) => root.render(createElement(ContextPanel, {key: state.panelPlacement, model, state, dispatch, page: facts.pages.items[0], inspectedObject: inspectedObject || defaultObject, expandedInspectorNodes, onExpandedInspectorNodesChange: setExpandedInspectorNodes, inspectorActive, onToggleInspector: () => toggles.push(true), onNavigateInspector() {}, onCopyInspector() {}}));
  await act(async () => render(defaultObject, false));
  const tabs = [...container.querySelectorAll('[role="tab"]')];
  assert.deepEqual(tabs.map((tab) => tab.textContent), ['页面逻辑', '检查对象']);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(container.querySelector('.status'), null);
  assert.match(container.textContent, /从哪里进入/);
  const inspectorButton = container.querySelector('button[aria-label="检查预览对象"]');
  assert.ok(inspectorButton);
  assert.equal(inspectorButton.getAttribute('aria-pressed'), 'false');
  assert.equal(inspectorButton.textContent.trim(), '');
  const toolbar = inspectorButton.closest('.context-panel-toolbar');
  const leading = inspectorButton.closest('.context-panel-leading');
  assert.ok(toolbar);
  assert.ok(leading);
  assert.equal(leading.firstElementChild, inspectorButton);
  assert.equal(leading.children[1], container.querySelector('[role="tablist"]'));
  assert.equal(leading.children[1].classList.contains('context-panel-tab-list'), true);
  assert.equal(leading.children[1].getAttribute('data-variant'), 'default');
  assert.equal(inspectorButton.closest('.context-panel-actions'), null);
  assert.deepEqual([...toolbar.querySelectorAll('.context-panel-actions button')].map((button) => button.getAttribute('aria-label')), ['切换为悬浮', '最小化信息面板']);
  assert.equal(toolbar.querySelector('[data-slot="separator"]'), null);
  await act(async () => inspectorButton.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  assert.equal(toggles.length, 1);

  await act(async () => render(object, true));
  assert.equal(container.querySelector('[role="tab"][aria-selected="true"]').textContent, '页面逻辑');
  assert.equal(container.querySelector('[data-sidebar-view="object"]').closest('[data-slot="tabs-content"]').hidden, true);
  const pageViewport = container.querySelector('[data-sidebar-view="page"]')
    .closest('[data-slot="scroll-area"]')
    .querySelector('[data-slot="scroll-area-viewport"]');
  pageViewport.scrollTop = 96;
  const objectTab = [...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === '检查对象');
  await act(async () => objectTab.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  await act(async () => render(object, true));
  assert.equal(state.panelContext, 'object');
  const objectPanel = container.querySelector('[data-sidebar-view="object"]').closest('[data-slot="tabs-content"]');
  assert.equal(objectPanel.hidden, false);
  assert.match(objectPanel.textContent, /已锁定对象/);
  const pageTab = [...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === '页面逻辑');
  await act(async () => pageTab.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  await act(async () => render(object, true));
  const restoredPageViewport = container.querySelector('[data-sidebar-view="page"]')
    .closest('[data-slot="scroll-area"]')
    .querySelector('[data-slot="scroll-area-viewport"]');
  assert.ok(restoredPageViewport === pageViewport, '切换 Tab 时应保留页面逻辑的滚动容器');
  assert.equal(restoredPageViewport.scrollTop, 96, '切回页面逻辑时应恢复原滚动位置');
  await act(async () => objectTab.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  await act(async () => render(object, true));
  await act(async () => render(null, false));
  assert.equal(container.querySelector('[role="tab"][aria-selected="true"]').textContent, '检查对象');
  assert.match(container.textContent, /已锁定对象/);
  assert.match(container.textContent, /Foundation 验证项目当前事件/);
  assert.doesNotMatch(container.textContent, /尚未锁定检查对象|当前预览|展开下方分区/);
  const sectionTitles = ['页面与完整层级', '默认修改范围', '相关逻辑', '布局摘要', '样式摘要', '使用、影响与已知缺口'];
  const sectionButtons = sectionTitles.map((title) => [...container.querySelectorAll('button')].find((button) => button.textContent.includes(title)));
  assert.equal(sectionButtons.every((button) => button === undefined), true);
  assert.ok(container.querySelector('[role="tree"]'));
  const dockedRootToggle = container.querySelector('button[aria-label="展开 Foundation 验证项目当前事件只展示仍在进行中的事件"]');
  assert.ok(dockedRootToggle);
  await act(async () => dockedRootToggle.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  await act(async () => render(null, false));
  assert.equal(container.querySelector('button[aria-label="收起 Foundation 验证项目当前事件只展示仍在进行中的事件"]').getAttribute('aria-expanded'), 'true');
  assert.equal(expandedInspectorNodes.has('dom:div#root'), true);
  const dockedBodyText = container.querySelector('.panel-body').textContent;
  const floatButton = container.querySelector('button[aria-label="切换为悬浮"]');
  await act(async () => floatButton.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  await act(async () => render(null, false));
  assert.equal(state.panelPlacement, 'floating');
  assert.equal(container.querySelector('[role="tab"][aria-selected="true"]').textContent, '检查对象');
  assert.equal(container.querySelector('.floating-panel .panel-body').textContent, dockedBodyText);
  assert.equal(container.querySelector('.floating-panel .panel-header .context-panel-leading .context-panel-tab-list').getAttribute('data-variant'), 'default');
  assert.ok(container.querySelector('.floating-panel .panel-header .panel-actions'));
  assert.ok(container.querySelector('.floating-panel [data-file-tree="collapsible"]'));
  const floatingRootToggle = container.querySelector('.floating-panel button[aria-label="收起 Foundation 验证项目当前事件只展示仍在进行中的事件"]');
  assert.ok(floatingRootToggle, '切换为悬浮面板后应保留文件树展开状态');
  assert.equal(floatingRootToggle.getAttribute('aria-expanded'), 'true');
  const resizeEdges = [...container.querySelectorAll('.floating-panel > .resize-handle')].map((handle) => handle.dataset.resizeEdge);
  assert.deepEqual(resizeEdges, ['n', 'e', 's', 'w', 'nw', 'ne', 'sw', 'se']);
  for (const edge of ['n', 'e', 's', 'w']) {
    const handle = container.querySelector(`.resize-handle-${edge}`);
    assert.ok(handle);
    assert.match(handle.getAttribute('aria-label'), /调整信息面板尺寸/);
  }
  const pointer = (type, pointerId, clientX, clientY) => {
    const event = new Event(type, {bubbles: true});
    Object.defineProperties(event, {pointerId: {value: pointerId}, clientX: {value: clientX}, clientY: {value: clientY}});
    return event;
  };
  const resizeCases = [
    {edge: 'e', pointerId: 7, clientX: 140, clientY: 180, expected: {width: 400, height: 540}},
    {edge: 'w', pointerId: 8, clientX: 60, clientY: 180, expected: {width: 372, height: 540}},
    {edge: 's', pointerId: 9, clientX: 180, clientY: 140, expected: {width: 360, height: 580}},
    {edge: 'n', pointerId: 10, clientX: 180, clientY: 140, expected: {width: 360, height: 500}},
  ];
  for (const resizeCase of resizeCases) {
    await act(async () => container.querySelector(`.resize-handle-${resizeCase.edge}`).dispatchEvent(pointer('pointerdown', resizeCase.pointerId, 100, 100)));
    await act(async () => window.dispatchEvent(pointer('pointermove', resizeCase.pointerId, resizeCase.clientX, resizeCase.clientY)));
    await act(async () => window.dispatchEvent(pointer('pointerup', resizeCase.pointerId, resizeCase.clientX, resizeCase.clientY)));
    assert.deepEqual(dispatches.at(-1), {type: 'set-floating-size', size: resizeCase.expected}, `${resizeCase.edge} 边只能改变对应轴尺寸`);
  }
  await act(async () => root.unmount());
});
