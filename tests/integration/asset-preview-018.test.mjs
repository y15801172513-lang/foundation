import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {ROOT} from '../helpers/project-fixture.mjs';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url: 'http://127.0.0.1:4317/events?foundationAssetPreview=1&assetId=component_event_card&variant=archived&channel=test-channel', pretendToBeVisual: true});
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true});
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
  dom.window.HTMLElement.prototype.getAnimations = () => [];
  globalThis.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  return dom;
}

test('隔离资产路由渲染真实注册组件、报告状态且不执行页面业务副作用', async (t) => {
  const dom = installDom(); const messages = [];
  Object.defineProperty(dom.window, 'parent', {value: {postMessage(message) { messages.push(message); }}});
  const vite = await createServer({root: path.join(ROOT, 'examples/foundation-events'), configFile: path.join(ROOT, 'examples/foundation-events/vite.config.js'), optimizeDeps: {noDiscovery: true}, server: {middlewareMode: true}});
  t.after(async () => { await vite.close(); dom.window.close(); });
  const requireFromExample = createRequire(path.join(ROOT, 'examples/foundation-events/package.json'));
  const {act, createElement} = requireFromExample('react'); const {createRoot} = requireFromExample('react-dom/client');
  const {AssetPreviewApp} = await vite.ssrLoadModule('/src/asset-preview.jsx');
  const container = document.getElementById('root'); const root = createRoot(container);
  await act(async () => root.render(createElement(AssetPreviewApp)));
  const card = container.querySelector('[data-foundation-component-id="component_event_card"]');
  assert.ok(card);
  assert.equal(card.getAttribute('data-foundation-variant'), 'archived');
  assert.equal(card.getAttribute('data-foundation-event-state'), 'archived');
  assert.ok(messages.some((message) => message.namespace === 'ai-product-foundation-asset-preview' && message.status === 'ready' && message.assetId === 'component_event_card'));
  const before = dom.window.location.href;
  await act(async () => card.querySelector('button').dispatchEvent(new MouseEvent('click', {bubbles: true})));
  assert.equal(dom.window.location.href, before);
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(messages.filter((message) => message.kind === 'component-selected').length, 0);
  await act(async () => root.render(createElement(AssetPreviewApp, {search: '?assetId=component_unknown&variant=default&channel=other-channel'})));
  assert.match(container.textContent, /暂不支持此资产预览/);
  assert.ok(messages.some((message) => message.status === 'unsupported' && message.assetId === 'component_unknown'));
  await act(async () => root.unmount());
});
