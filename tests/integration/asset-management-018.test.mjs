import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {buildContextRecord, contextPlainText, projectAssets, projectGovernance, readFacts} from '@foundation/core';
import {EVENTS, ROOT} from '../helpers/project-fixture.mjs';

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

test('资产列表保持内部滚动并隐藏滚动条', () => {
  const styles = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/styles.css'), 'utf8');
  assert.match(styles, /\.logic-navigation,\.asset-list-pane\s*\{[^}]*overflow:auto/);
  assert.match(styles, /\.asset-list-pane\s*\{[^}]*scrollbar-width:none[^}]*\}/);
  assert.match(styles, /\.asset-list-pane::\-webkit-scrollbar\s*\{\s*display:none/);
  assert.match(styles, /\.asset-preview > header\s*\{[^}]*align-items:center/);
  assert.match(styles, /\.asset-preview-viewport\s*\{[^}]*position:relative[^}]*height:320px[^}]*overflow:hidden/);
  assert.match(styles, /\.asset-preview-loading\s*\{[^}]*position:absolute[^}]*inset:0[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center[^}]*flex-direction:column/);
});

test('资产详情顺序、真实预览、能力筛选和 selection 暂停策略保持一致', async (t) => {
  const dom = installDom();
  const vite = await createServer({root: path.join(ROOT, 'apps/management-center'), configFile: path.join(ROOT, 'apps/management-center/vite.config.js'), optimizeDeps: {noDiscovery: true}, server: {middlewareMode: true}});
  t.after(async () => { await vite.close(); dom.window.close(); });
  const {act, createElement} = await import('react'); const {createRoot} = await import('react-dom/client');
  const {AssetManagementWorkspace} = await vite.ssrLoadModule('/src/workspace/asset-management-workspace.jsx');
  const facts = readFacts(EVENTS); const assets = projectAssets(facts); const selectedAsset = assets.find((asset) => asset.assetId === 'component_event_card');
  const model = {project: facts.foundation, pages: facts.pages.items, assets, governance: projectGovernance(facts.foundation)};
  const assetRecord = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets, pageId: 'page_events_home', scope: 'asset', selection: {asset: selectedAsset}});
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(AssetManagementWorkspace, {model, selectedAsset, assetRecord, assetRawText: contextPlainText(assetRecord), onSelectAsset() {}, onCopyAsset() {}})));
  const detail = container.querySelector('.asset-detail-pane');
  const ordered = ['.mode-heading', '.asset-preview', '.context-data-view', '.asset-technical'].map((selector) => [...detail.children].indexOf(detail.querySelector(selector)));
  assert.deepEqual(ordered, [0, 1, 2, 3]);
  assert.equal(detail.querySelector('[data-slot="tabs-list"]').getAttribute('data-variant'), 'default');
  assert.equal(detail.querySelector('details'), null);
  assert.equal(detail.querySelector('.asset-usage'), null);
  assert.match(detail.querySelector('.asset-technical').textContent, /稳定 ID.*component_event_card.*实现路径.*src\/components\/event-card\.jsx.*facts 版本.*验证状态/s);
  const iframe = detail.querySelector('iframe[title="EventCard 真实资产预览"]');
  const previewViewport = detail.querySelector('.asset-preview-viewport');
  assert.ok(previewViewport, '加载期间也必须保留固定的预览内容区域');
  assert.equal(previewViewport.querySelector('iframe'), iframe);
  const loading = previewViewport.querySelector('.asset-preview-loading');
  const spinner = loading?.querySelector('[data-slot="spinner"]');
  assert.equal(spinner?.tagName, 'svg', '加载状态必须使用 shadcn/ui Spinner');
  assert.equal(spinner?.getAttribute('aria-label'), '正在载入真实组件');
  assert.match(loading?.textContent || '', /正在载入真实组件/);
  const previewUrl = new URL(iframe.src);
  assert.equal(previewUrl.pathname, '/events');
  assert.equal(previewUrl.searchParams.get('foundationAssetPreview'), '1');
  assert.equal(previewUrl.searchParams.get('variant'), 'current');
  await act(async () => window.dispatchEvent(new dom.window.MessageEvent('message', {source: iframe.contentWindow, origin: 'null', data: {namespace: 'ai-product-foundation-asset-preview', kind: 'status', assetId: 'component_event_card', channel: previewUrl.searchParams.get('channel'), status: 'ready', message: ''}})));
  assert.equal(detail.querySelector('.asset-preview').getAttribute('data-preview-status'), 'ready');

  const typeTrigger = container.querySelector('button[aria-label="资产类型"]');
  await act(async () => typeTrigger.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  const typeItems = [...document.querySelectorAll('[data-slot="select-item"]')];
  assert.ok(typeItems.some((item) => item.textContent === '设计变量（颜色、间距等）（0，暂无登记）' && item.getAttribute('data-disabled') !== null));
  assert.ok(!typeItems.some((item) => item.textContent.includes('交互逻辑')));
  const pageItem = typeItems.find((item) => item.textContent === '页面（3）');
  await act(async () => { pageItem.dispatchEvent(new MouseEvent('mousemove', {bubbles: true})); });
  await act(async () => pageItem.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  assert.match(detail.textContent, /当前筛选不包含所选资产/);
  assert.equal(container.querySelector('button[aria-label="资产状态"]'), null);
  assert.equal(container.querySelector('button[aria-label="验证状态"]'), null);
  const reset = [...container.querySelectorAll('button')].find((button) => button.textContent === '重置筛选');
  await act(async () => reset.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  assert.match(detail.textContent, /真实资产预览/);

  const currentIframe = detail.querySelector('iframe'); const currentUrl = new URL(currentIframe.src);
  await act(async () => window.dispatchEvent(new dom.window.MessageEvent('message', {source: currentIframe.contentWindow, origin: 'null', data: {namespace: 'ai-product-foundation-asset-preview', kind: 'status', assetId: 'component_event_card', channel: currentUrl.searchParams.get('channel'), status: 'error', message: '受控渲染错误'}})));
  assert.match(detail.textContent, /真实组件预览失败.*受控渲染错误/s);

  const pageAsset = assets.find((asset) => asset.assetId === 'page_events_home');
  const pageRecord = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets, pageId: 'page_events_home', scope: 'asset', selection: {asset: pageAsset}});
  await act(async () => root.render(createElement(AssetManagementWorkspace, {model, selectedAsset: pageAsset, assetRecord: pageRecord, assetRawText: contextPlainText(pageRecord), onSelectAsset() {}, onCopyAsset() {}})));
  assert.match(detail.textContent, /此类资产暂不提供运行预览/);
  assert.ok(detail.querySelector('.asset-preview > .asset-preview-viewport'), '不支持预览时也必须保留相同的预览外壳');
  assert.equal(detail.querySelector('iframe'), null);
  const actionAsset = assets.find((asset) => asset.assetId === 'component_event_action');
  const actionRecord = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets, pageId: 'page_events_home', scope: 'asset', selection: {asset: actionAsset}});
  await act(async () => root.render(createElement(AssetManagementWorkspace, {model, selectedAsset: actionAsset, assetRecord: actionRecord, assetRawText: contextPlainText(actionRecord), onSelectAsset() {}, onCopyAsset() {}})));
  const actionPreview = detail.querySelector('.asset-preview');
  assert.doesNotMatch(actionPreview.textContent, /预览变体|默认：new/);
  assert.ok(actionPreview.querySelector('button[aria-label="预览变体"]'));
  assert.equal(new URL(detail.querySelector('iframe').src).searchParams.get('variant'), 'new');
  await act(async () => root.render(createElement(AssetManagementWorkspace, {model: {...model, assets: assets.filter((asset) => asset.assetType === 'interaction')}, selectedAsset: null, assetRecord: null, assetRawText: '', onSelectAsset() {}, onCopyAsset() {}})));
  assert.match(container.textContent, /当前显示 0 \/ 0 项/);
  assert.match(container.textContent, /没有符合条件的资产/);
  assert.match(container.textContent, /交互逻辑保留在事实与逻辑工作区/);
  await act(async () => root.unmount());
});
