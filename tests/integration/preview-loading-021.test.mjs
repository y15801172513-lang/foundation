import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {ROOT} from '../helpers/project-fixture.mjs';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://127.0.0.1:4317/', pretendToBeVisual: true});
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true});
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
  globalThis.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  return dom;
}

test('主产品预览在 iframe 加载期间保留画布结构并在区域中央显示 Spinner', async (t) => {
  const dom = installDom();
  const vite = await createServer({root: path.join(ROOT, 'apps/management-center'), configFile: path.join(ROOT, 'apps/management-center/vite.config.js'), optimizeDeps: {noDiscovery: true}, server: {middlewareMode: true}});
  t.after(async () => { await vite.close(); dom.window.close(); });
  const {act, createElement} = await import('react');
  const {createRoot} = await import('react-dom/client');
  const {PreviewCanvas} = await vite.ssrLoadModule('/src/features/preview/preview-canvas.jsx');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); const loaded = [];
  const model = {pages: [{id: 'page_a', name: 'A', route: '/events'}]};
  const props = {model, state: {pageId: 'page_a', iframeRoute: '/events', viewportPresetId: 'adaptive'}, dispatch() {}, iframeRef: {current: null}, onPreviewLoad: (route) => loaded.push(route)};

  await act(async () => root.render(createElement(PreviewCanvas, props)));
  const frame = container.querySelector('.canvas-frame');
  const iframe = frame.querySelector('#preview-frame');
  const loading = frame.querySelector('.preview-frame-loading');
  assert.ok(frame && iframe && loading, '加载时画布外壳、iframe 与加载层必须同时存在');
  assert.equal(frame.getAttribute('aria-busy'), 'true');
  assert.equal(loading.querySelector('[data-slot="spinner"]')?.getAttribute('aria-label'), '正在载入产品预览');
  await act(async () => iframe.dispatchEvent(new Event('load')));
  assert.equal(frame.querySelector('.preview-frame-loading'), null);
  assert.equal(frame.getAttribute('aria-busy'), 'false');
  assert.deepEqual(loaded, ['/events']);

  await act(async () => root.render(createElement(PreviewCanvas, {...props, state: {...props.state, iframeRoute: '/events/manage'}})));
  const nextFrame = container.querySelector('.canvas-frame');
  assert.equal(nextFrame, frame, '切换页面时不得卸载预览区域外壳');
  assert.ok(nextFrame.querySelector('#preview-frame'));
  assert.ok(nextFrame.querySelector('.preview-frame-loading'), '切换页面后应在原预览区域内重新显示加载层');
  await act(async () => root.unmount());
});
