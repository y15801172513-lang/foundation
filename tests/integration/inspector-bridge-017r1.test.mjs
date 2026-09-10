import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {announcePreview, applyPreviewTheme, createInspectorBridge, PREVIEW_NAMESPACE, previewThemeFromSearch} from '../../examples/foundation-events/src/bridge.mjs';

test('预览就绪消息把最外围预览内容作为默认检查对象', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"><header>页头</header><main><button>管理事件</button></main></div></body></html>', {url: 'http://127.0.0.1:4317/events', pretendToBeVisual: true});
  const sent = [];
  const fakeParent = {postMessage(message, origin) { sent.push({message, origin}); }};
  Object.defineProperty(dom.window, 'parent', {value: fakeParent});
  announcePreview({win: dom.window});
  const ready = sent.at(-1)?.message;
  assert.equal(ready.kind, 'preview-ready');
  assert.equal(ready.object.pageId, 'page_events_home');
  assert.equal(ready.object.role, 'div');
  assert.equal(ready.object.inspectorId, 'dom:div#root');
  assert.equal(ready.object.tree[0].role, 'div');
  assert.ok(ready.object.tree[0].children.some((node) => node.role === 'main'));
  assert.ok(ready.object.tree[0].children.some((node) => node.role === 'header'));
  assert.equal('previewOverview' in ready.object, false);
  dom.window.close();
});

test('iframe 检查 bridge 高亮、锁定、阻止业务点击并按 Escape 清理', () => {
  const dom = new JSDOM('<!doctype html><html><body><main><button data-foundation-component-id="component_event_action" data-foundation-instance-id="event_action_manage">管理事件</button></main></body></html>', {url: 'http://127.0.0.1:4317/events', pretendToBeVisual: true});
  const sent = [];
  const fakeParent = {postMessage(message, origin) { sent.push({message, origin}); }};
  Object.defineProperty(dom.window, 'parent', {value: fakeParent});
  const bridge = createInspectorBridge({win: dom.window, doc: dom.window.document});
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {origin: dom.window.location.origin, source: fakeParent, data: {namespace: PREVIEW_NAMESPACE, kind: 'inspect-navigate', inspectorId: 'dom:main'}}));
  assert.equal(sent.at(-1)?.message.kind, 'inspect-selected', '文件树节点无需预先锁定即可建立选择');
  assert.equal(sent.at(-1)?.message.object.inspectorId, 'dom:main');
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {origin: dom.window.location.origin, source: fakeParent, data: {namespace: PREVIEW_NAMESPACE, kind: 'inspect-mode-changed', active: true}}));
  const button = dom.window.document.querySelector('button');
  button.dispatchEvent(new dom.window.MouseEvent('mouseover', {bubbles: true}));
  assert.ok(dom.window.document.querySelector('[data-foundation-inspector-overlay]'));
  const click = new dom.window.MouseEvent('click', {bubbles: true, cancelable: true});
  button.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  const selected = sent.find(({message}) => message.kind === 'inspect-selected' && message.object.componentId === 'component_event_action')?.message.object;
  assert.ok(selected?.inspectorId);
  assert.ok(Array.isArray(selected.tree) && selected.tree.length > 0);
  assert.ok(selected.ancestorIds.length > 0);
  assert.ok(selected.tree[0].children.length > 0);
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {origin: dom.window.location.origin, source: fakeParent, data: {namespace: PREVIEW_NAMESPACE, kind: 'inspect-navigate', inspectorId: selected.inspectorId}}));
  assert.equal(sent.at(-1).message.object.inspectorId, selected.inspectorId);
  const selectedCount = sent.filter(({message}) => message.kind === 'inspect-selected').length;
  const parentId = selected.ancestorIds.at(-1);
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {origin: dom.window.location.origin, source: fakeParent, data: {namespace: PREVIEW_NAMESPACE, kind: 'inspect-preview', inspectorId: parentId}}));
  const overlayLabel = dom.window.document.querySelector('[data-foundation-inspector-overlay] > span');
  assert.match(overlayLabel.textContent, /main$/);
  assert.equal(sent.filter(({message}) => message.kind === 'inspect-selected').length, selectedCount, '树节点悬浮预览不得改变锁定对象');
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {origin: dom.window.location.origin, source: fakeParent, data: {namespace: PREVIEW_NAMESPACE, kind: 'inspect-preview-ended'}}));
  assert.match(overlayLabel.textContent, /button$/);
  button.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
  assert.ok(sent.some(({message}) => message.kind === 'inspect-selection-invalidated'));
  bridge.destroy();
  assert.equal(dom.window.document.querySelector('[data-foundation-inspector-overlay]'), null);
  dom.window.close();
});

test('iframe bridge 只接受同源父窗口发出的合法明暗主题消息', () => {
  const dom = new JSDOM('<!doctype html><html><body><main>预览</main></body></html>', {url: 'http://127.0.0.1:4317/events', pretendToBeVisual: true});
  const fakeParent = {postMessage() {}};
  Object.defineProperty(dom.window, 'parent', {value: fakeParent});
  const bridge = createInspectorBridge({win: dom.window, doc: dom.window.document});
  const send = (theme, origin = dom.window.location.origin) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {origin, source: fakeParent, data: {namespace: PREVIEW_NAMESPACE, kind: 'theme-changed', theme}}));
  send('dark', 'https://example.invalid');
  assert.equal(dom.window.document.documentElement.classList.contains('dark'), false);
  send('dark');
  assert.equal(dom.window.document.documentElement.classList.contains('dark'), true);
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
  assert.equal(dom.window.document.documentElement.style.colorScheme, 'dark');
  send('system');
  assert.equal(dom.window.document.documentElement.classList.contains('dark'), true, '未知主题不得改变现有状态');
  send('light');
  assert.equal(dom.window.document.documentElement.classList.contains('dark'), false);
  assert.equal(dom.window.document.documentElement.dataset.theme, 'light');
  bridge.destroy();
  dom.window.close();
});

test('不透明 sandbox 缩略预览只接受显式亮暗 URL 主题', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://127.0.0.1:4317/events?foundationTheme=dark'});
  assert.equal(previewThemeFromSearch(dom.window.location.search), 'dark');
  assert.equal(previewThemeFromSearch('?foundationTheme=light'), 'light');
  assert.equal(previewThemeFromSearch('?foundationTheme=system'), null);
  assert.equal(previewThemeFromSearch('?foundationTheme=dark&foundationAssetPreview=1'), 'dark');
  assert.equal(applyPreviewTheme(previewThemeFromSearch(dom.window.location.search), dom.window.document), true);
  assert.equal(dom.window.document.documentElement.classList.contains('dark'), true);
  dom.window.close();
});

test('锁定高亮通过 rAF 跟随滚动与尺寸变化，销毁后释放 observer', async () => {
  const dom = new JSDOM('<!doctype html><html><body><main><button data-foundation-component-id="component_event_action" data-foundation-instance-id="event_action_manage">管理事件</button></main></body></html>', {url: 'http://127.0.0.1:4317/events', pretendToBeVisual: true});
  const resizeObservers = [];
  dom.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); this.disconnected = false; resizeObservers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
  };
  const sent = [];
  const fakeParent = {postMessage(message) { sent.push(message); }};
  Object.defineProperty(dom.window, 'parent', {value: fakeParent});
  const button = dom.window.document.querySelector('button');
  let rect = {left: 10, top: 20, width: 100, height: 30, right: 110, bottom: 50, x: 10, y: 20, toJSON() { return this; }};
  button.getBoundingClientRect = () => rect;
  const bridge = createInspectorBridge({win: dom.window, doc: dom.window.document});
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {origin: dom.window.location.origin, source: fakeParent, data: {namespace: PREVIEW_NAMESPACE, kind: 'inspect-mode-changed', active: true}}));
  button.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true, cancelable: true}));
  const overlay = dom.window.document.querySelector('[data-foundation-inspector-overlay]');
  assert.equal(overlay.style.left, '10px');
  rect = {...rect, left: 44, top: 62, width: 140, height: 36};
  dom.window.dispatchEvent(new dom.window.Event('scroll'));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 24));
  assert.deepEqual({left: overlay.style.left, top: overlay.style.top, width: overlay.style.width}, {left: '44px', top: '62px', width: '140px'});
  resizeObservers[0].callback([]);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 24));
  assert.equal(sent.filter((message) => message.kind === 'inspect-selected').at(-1).object.layout.width, '140px');
  button.append(dom.window.document.createElement('span'));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 24));
  assert.ok(sent.filter((message) => message.kind === 'inspect-selected').at(-1).object.tree[0].children[0].children.length > 0);
  bridge.destroy();
  assert.equal(resizeObservers[0].disconnected, true);
  assert.equal(dom.window.document.querySelector('[data-foundation-inspector-overlay]'), null);
  dom.window.dispatchEvent(new dom.window.Event('scroll'));
  dom.window.close();
});
