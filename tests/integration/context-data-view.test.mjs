import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {buildContextRecord, contextPlainText, projectAssets, readFacts} from '@foundation/core';
import {EVENTS, ROOT} from '../helpers/project-fixture.mjs';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost'});
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true});
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
  globalThis.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  return dom;
}

test('ContextDataView 用户可切换原始数据并触发复制回调', async (t) => {
  const dom = installDom();
  const vite = await createServer({root: path.join(ROOT, 'apps/management-center'), configFile: path.join(ROOT, 'apps/management-center/vite.config.js'), optimizeDeps: {noDiscovery: true}, server: {middlewareMode: true}});
  t.after(async () => { await vite.close(); dom.window.close(); });
  const {act} = await import('react');
  const {createRoot} = await import('react-dom/client');
  const {ContextDataView} = await vite.ssrLoadModule('/src/features/context-panel/context-data-view.jsx');
  const facts = readFacts(EVENTS);
  const record = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets: projectAssets(facts), pageId: 'page_events_home', scope: 'page'});
  const rawText = contextPlainText(record);
  let copyCount = 0;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => root.render(await import('react').then(({createElement}) => createElement(ContextDataView, {record, rawText, scopeLabel: '测试上下文', onCopy: () => { copyCount += 1; }}))));
  assert.match(container.textContent, /白话说明/);
  assert.match(container.textContent, /用途尚未登记/);
  assert.equal(container.querySelector('[data-slot="tabs-list"]').getAttribute('data-variant'), 'line');
  assert.equal(container.querySelector('details'), null);

  const rawTab = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('原始数据'));
  await act(async () => rawTab.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  const raw = container.querySelector('textarea[aria-label="测试上下文原始数据"]');
  assert.equal(raw?.value, rawText);

  const copy = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('复制给 Codex'));
  await act(async () => copy.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  assert.equal(copyCount, 1);
  await act(async () => root.unmount());
});
