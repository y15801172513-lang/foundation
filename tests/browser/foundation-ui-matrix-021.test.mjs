import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import test from 'node:test';
import {browserLaunchContract, waitForBrowserDevtoolsPort} from '../helpers/browser-launch-contract.mjs';
import {makeScopedTempDirectory, removeTempDirectory, ROOT} from '../helpers/project-fixture.mjs';
import {connectDevtools, cleanupBrowser, evaluate, reloadAndWait} from '../helpers/browser-lifecycle.mjs';

const PREVIEW_URL = 'http://127.0.0.1:4317/';
const SCREENSHOT_DIRECTORY = path.join(ROOT, '.tmp', 'AI_PFK_CROSS_PLATFORM_TYPOGRAPHY_CORRECTION_023R1', 'windows', 'foundation-ui-matrix');
const BROWSER_CANDIDATES = [
  process.env.FOUNDATION_BROWSER_EXECUTABLE,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(devtools, expression, description, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(devtools, expression)) return;
    await delay(50);
  }
  throw new Error(`浏览器等待超时：${description}`);
}

const KEY_CODES = {Tab: 9, Enter: 13, Escape: 27, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35};

async function pressKey(devtools, key, modifiers = 0) {
  const code = key === 'Space' ? 'Space' : key;
  const text = key === 'Space' ? ' ' : key.length === 1 ? key : undefined;
  const params = {key: key === 'Space' ? ' ' : key, code, windowsVirtualKeyCode: KEY_CODES[key] || 0, nativeVirtualKeyCode: KEY_CODES[key] || 0, modifiers};
  await devtools.call('Input.dispatchKeyEvent', {...params, type: 'keyDown', ...(text ? {text} : {})});
  await devtools.call('Input.dispatchKeyEvent', {...params, type: 'keyUp'});
  await delay(40);
}

async function activeElement(devtools) {
  return evaluate(devtools, `(() => {
    const element = document.activeElement;
    return {tag: element?.tagName || '', role: element?.getAttribute('role') || '', text: element?.textContent?.trim().replace(/\\s+/gu, ' ').slice(0, 160) || '', label: element?.getAttribute('aria-label') || '', treeId: element?.dataset?.inspectorTreeId || ''};
  })()`);
}

async function tabTo(devtools, predicate, description, limit = 180) {
  const visited = [];
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const active = await activeElement(devtools);
    if (predicate(active)) return active;
    if (!visited.some((item) => JSON.stringify(item) === JSON.stringify(active))) visited.push(active);
    await pressKey(devtools, 'Tab');
  }
  throw new Error(`键盘 Tab 未能到达：${description}；已访问 ${JSON.stringify(visited)}`);
}

async function screenshot(devtools, name) {
  const result = await devtools.call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false, fromSurface: true});
  const bytes = Buffer.from(result.data, 'base64');
  fs.writeFileSync(path.join(SCREENSHOT_DIRECTORY, name), bytes);
  return bytes;
}

async function clickSelector(devtools, selector) {
  const point = await evaluate(devtools, `(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}; })()`);
  await devtools.call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: point.x, y: point.y});
  await devtools.call('Input.dispatchMouseEvent', {type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1});
  await devtools.call('Input.dispatchMouseEvent', {type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1});
}

async function drag(devtools, from, to) {
  await devtools.call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: from.x, y: from.y});
  await devtools.call('Input.dispatchMouseEvent', {type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1});
  for (let step = 1; step <= 12; step += 1) {
    const ratio = step / 12;
    await devtools.call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: from.x + ((to.x - from.x) * ratio), y: from.y + ((to.y - from.y) * ratio), button: 'left', buttons: 1});
  }
  await devtools.call('Input.dispatchMouseEvent', {type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1});
}

test('真实 Foundation 浏览器矩阵覆盖键盘、拖拽、窄屏、资产和运行噪音', {timeout: 90_000}, async (t) => {
  const health = await fetch(`${PREVIEW_URL}__foundation/health`).catch(() => null);
  assert.equal(health?.status, 200, '先用 npm run preview 启动固定的 4317 Foundation 预览');
  const browser = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  assert.ok(browser, '需要本机 Chrome 或 Edge 执行真实 Foundation 浏览器矩阵');
  fs.mkdirSync(SCREENSHOT_DIRECTORY, {recursive: true});
  const temporary = makeScopedTempDirectory('AI_PFK_CROSS_PLATFORM_TYPOGRAPHY_CORRECTION_023R1/profiles', 'foundation-ui-browser-021-');
  const profile = path.join(temporary, 'browser-profile');
  fs.mkdirSync(profile);
  const launch = browserLaunchContract(process.env, {windowSize: '1440,900', userDataDirectory: profile});
  const child = spawn(browser, launch.args, {stdio: 'ignore', windowsHide: true, shell: false});
  let devtools;
  t.after(async () => {
    await cleanupBrowser({child, devtools, temporary, profile, root: path.join(ROOT, '.tmp'), remove: () => removeTempDirectory(temporary), diagnostic: (value) => t.diagnostic(JSON.stringify(value))});
  });
  const debuggingPort = await waitForBrowserDevtoolsPort(profile, child);
  const targetResponse = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(PREVIEW_URL)}`, {method: 'PUT'});
  assert.equal(targetResponse.ok, true);
  const target = await targetResponse.json();
  devtools = await connectDevtools(target.webSocketDebuggerUrl);
  await Promise.all([devtools.call('Page.enable'), devtools.call('Runtime.enable'), devtools.call('Network.enable'), devtools.call('Log.enable')]);
  await waitFor(devtools, "Boolean(document.querySelector('.workspace') && document.querySelector('#preview-frame'))", '预览工作区首屏');
  await evaluate(devtools, `(() => { const style = document.createElement('style'); style.dataset.browserGate = '021'; style.textContent = '*{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.append(style); return document.fonts.ready.then(() => true); })()`);
  await delay(150);
  const initialTheme = await evaluate(devtools, `(() => ({dark: document.documentElement.classList.contains('dark'), label: document.querySelector('[data-theme-toggle]')?.getAttribute('aria-label'), pressed: document.querySelector('[data-theme-toggle]')?.getAttribute('aria-pressed'), outerBackground: getComputedStyle(document.body).backgroundColor, innerBackground: getComputedStyle(document.querySelector('#preview-frame').contentDocument.body).backgroundColor}))()`);
  if (initialTheme.dark) {
    await clickSelector(devtools, '[data-theme-toggle]');
    await waitFor(devtools, "!document.documentElement.classList.contains('dark') && !document.querySelector('#preview-frame').contentDocument.documentElement.classList.contains('dark')", '浏览器矩阵先归一到亮模式');
  }
  const lightTheme = await evaluate(devtools, `(() => ({label: document.querySelector('[data-theme-toggle]').getAttribute('aria-label'), pressed: document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed'), outerBackground: getComputedStyle(document.body).backgroundColor, innerBackground: getComputedStyle(document.querySelector('#preview-frame').contentDocument.body).backgroundColor}))()`);
  assert.equal(lightTheme.label, '切换到暗模式');
  assert.equal(lightTheme.pressed, 'false');
  await clickSelector(devtools, '[data-theme-toggle]');
  await waitFor(devtools, "document.documentElement.classList.contains('dark') && document.querySelector('#preview-frame').contentDocument.documentElement.classList.contains('dark')", '父工作台与真实预览同步切换暗模式');
  const darkTheme = await evaluate(devtools, `(() => ({theme: document.documentElement.dataset.theme, label: document.querySelector('[data-theme-toggle]').getAttribute('aria-label'), pressed: document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed'), outerBackground: getComputedStyle(document.body).backgroundColor, innerBackground: getComputedStyle(document.querySelector('#preview-frame').contentDocument.body).backgroundColor}))()`);
  assert.equal(darkTheme.theme, 'dark');
  assert.equal(darkTheme.label, '切换到亮模式');
  assert.equal(darkTheme.pressed, 'true');
  assert.notEqual(darkTheme.outerBackground, lightTheme.outerBackground);
  assert.notEqual(darkTheme.innerBackground, lightTheme.innerBackground);
  await screenshot(devtools, '00-theme-dark.png');
  await reloadAndWait(devtools);
  await waitFor(devtools, "Boolean(document.querySelector('.workspace') && document.querySelector('#preview-frame')?.contentDocument?.documentElement?.classList.contains('dark'))", '刷新后恢复持久化暗模式');
  assert.equal(await evaluate(devtools, "document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed')"), 'true');
  await clickSelector(devtools, '[data-theme-toggle]');
  await waitFor(devtools, "!document.documentElement.classList.contains('dark') && !document.querySelector('#preview-frame').contentDocument.documentElement.classList.contains('dark')", '切回亮模式');
  await evaluate(devtools, `(() => { const style = document.createElement('style'); style.dataset.browserGate = '021'; style.textContent = '*{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.append(style); return document.fonts.ready.then(() => true); })()`);
  await delay(150);
  const desktopGeometry = await evaluate(devtools, `(() => Object.fromEntries(['.topbar', '.preview-toolbar', '.canvas-stage', '.panel-slot', '.statusbar'].map((selector) => { const rect = document.querySelector(selector).getBoundingClientRect(); return [selector, {x: rect.x, y: rect.y, width: rect.width, height: rect.height}]; })))()`);
  const firstDesktop = await screenshot(devtools, '01-preview-desktop.png');
  await delay(150);
  const secondDesktop = await screenshot(devtools, '02-preview-desktop-stability.png');
  const desktopGeometryAfter = await evaluate(devtools, `(() => Object.fromEntries(['.topbar', '.preview-toolbar', '.canvas-stage', '.panel-slot', '.statusbar'].map((selector) => { const rect = document.querySelector(selector).getBoundingClientRect(); return [selector, {x: rect.x, y: rect.y, width: rect.width, height: rect.height}]; })))()`);
  assert.deepEqual(desktopGeometryAfter, desktopGeometry, '静止桌面预览的关键区域几何应保持稳定');
  assert.ok(firstDesktop.length > 50_000 && secondDesktop.length > 50_000, '桌面稳定性截图必须成功记录完整页面');

  await tabTo(devtools, (active) => active.tag === 'A' && active.text === '逻辑搭建', '逻辑搭建导航');
  await devtools.call('Network.emulateNetworkConditions', {offline: false, latency: 800, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'cellular3g'});
  await pressKey(devtools, 'Enter');
  await waitFor(devtools, "Boolean(document.querySelector('[data-foundation-loading=workspace] [data-slot=spinner]'))", '工作区切换使用 Spinner');
  const workspaceLoading = await evaluate(devtools, `(() => { const shell = document.querySelector('[data-foundation-loading=workspace]'); const group = shell.querySelector('.workspace-loading'); const spinner = group.querySelector('[data-slot=spinner]'); const shellRect = shell.getBoundingClientRect(); const groupRect = group.getBoundingClientRect(); return {spinnerLabel: spinner.getAttribute('aria-label'), text: group.textContent.trim(), display: getComputedStyle(shell).display, placeItems: getComputedStyle(shell).placeItems, centerDelta: Math.max(Math.abs((groupRect.left + groupRect.width / 2) - (shellRect.left + shellRect.width / 2)), Math.abs((groupRect.top + groupRect.height / 2) - (shellRect.top + shellRect.height / 2)))}; })()`);
  assert.equal(workspaceLoading.spinnerLabel, '正在载入逻辑画布');
  assert.match(workspaceLoading.text, /正在载入逻辑画布/u);
  assert.deepEqual([workspaceLoading.display, workspaceLoading.placeItems], ['grid', 'center']);
  assert.ok(workspaceLoading.centerDelta < 1, `工作区 Spinner 组合必须上下左右居中：${JSON.stringify(workspaceLoading)}`);
  await screenshot(devtools, '02a-workspace-loading-centered.png');
  await waitFor(devtools, "Boolean(document.querySelector('.logic-flow-workspace') && document.querySelectorAll('.page-flow-node').length >= 3)", 'React Flow 逻辑工作区');
  await waitFor(devtools, "Boolean(document.querySelector('.page-thumbnail-loading [data-slot=spinner]'))", '逻辑缩略预览使用 Spinner');
  const thumbnailLoading = await evaluate(devtools, `(() => { const viewport = document.querySelector('.page-thumbnail[aria-busy=true]'); const loading = viewport.querySelector('.page-thumbnail-loading'); const spinner = loading.querySelector('[data-slot=spinner]'); const viewportRect = viewport.getBoundingClientRect(); const spinnerRect = spinner.getBoundingClientRect(); return {iframeInside: viewport.contains(viewport.querySelector('iframe')), spinnerLabel: spinner.getAttribute('aria-label'), centerDelta: Math.max(Math.abs((spinnerRect.left + spinnerRect.width / 2) - (viewportRect.left + viewportRect.width / 2)), Math.abs((spinnerRect.top + spinnerRect.height / 2) - (viewportRect.top + viewportRect.height / 2)))}; })()`);
  assert.equal(thumbnailLoading.iframeInside, true);
  assert.match(thumbnailLoading.spinnerLabel, /页面缩略预览正在载入/u);
  assert.ok(thumbnailLoading.centerDelta < 1, `缩略预览 Spinner 必须上下左右居中：${JSON.stringify(thumbnailLoading)}`);
  await devtools.call('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'none'});
  await waitFor(devtools, "!document.querySelector('.page-thumbnail-loading')", '逻辑缩略预览加载完成');
  const flowState = await evaluate(devtools, `(() => ({nodes: document.querySelectorAll('.page-flow-node').length, edges: document.querySelectorAll('.react-flow__edge').length, controls: [...document.querySelectorAll('.react-flow__controls-button')].map((item) => item.getAttribute('aria-label'))}))()`);
  assert.ok(flowState.nodes >= 3);
  assert.ok(flowState.edges >= 1);
  assert.deepEqual(flowState.controls, ['放大画布', '缩小画布', '适应视图', '锁定画布']);
  const lightFlowTheme = await evaluate(devtools, `(() => { const flow = document.querySelector('.react-flow'); const canvas = document.querySelector('.logic-flow-canvas'); const control = document.querySelector('.react-flow__controls-button'); const node = document.querySelector('.page-flow-node'); const inspector = document.querySelector('.logic-relation-inspector'); return {flowDark: flow.classList.contains('dark'), canvasBackground: getComputedStyle(canvas).backgroundColor, controlBackground: getComputedStyle(control).backgroundColor, controlColor: getComputedStyle(control).color, nodeBackground: getComputedStyle(node).backgroundColor, nodeColor: getComputedStyle(node).color, inspectorBackground: getComputedStyle(inspector).backgroundColor}; })()`);
  assert.equal(lightFlowTheme.flowDark, false);
  await clickSelector(devtools, '[data-theme-toggle]');
  await waitFor(devtools, "document.documentElement.classList.contains('dark') && document.querySelector('.react-flow')?.classList.contains('dark')", 'React Flow 引擎同步切换暗模式');
  const darkFlowTheme = await evaluate(devtools, `(() => { const flow = document.querySelector('.react-flow'); const canvas = document.querySelector('.logic-flow-canvas'); const control = document.querySelector('.react-flow__controls-button'); const node = document.querySelector('.page-flow-node'); const inspector = document.querySelector('.logic-relation-inspector'); return {flowDark: flow.classList.contains('dark'), canvasBackground: getComputedStyle(canvas).backgroundColor, controlBackground: getComputedStyle(control).backgroundColor, controlColor: getComputedStyle(control).color, nodeBackground: getComputedStyle(node).backgroundColor, nodeColor: getComputedStyle(node).color, inspectorBackground: getComputedStyle(inspector).backgroundColor}; })()`);
  assert.equal(darkFlowTheme.flowDark, true);
  for (const key of ['canvasBackground', 'controlBackground', 'controlColor', 'nodeBackground', 'nodeColor', 'inspectorBackground']) assert.notEqual(darkFlowTheme[key], lightFlowTheme[key], `逻辑画布 ${key} 必须响应暗模式`);
  const thumbnailSrc = await evaluate(devtools, "document.querySelector('.page-thumbnail iframe').src");
  assert.equal(new URL(thumbnailSrc).searchParams.get('foundationTheme'), 'dark');
  let darkThumbnailResponse = null;
  for (let attempt = 0; attempt < 100 && !darkThumbnailResponse; attempt += 1) {
    darkThumbnailResponse = [...devtools.events].reverse().find((event) => event.method === 'Network.responseReceived' && event.params?.type === 'Document' && new URL(event.params.response.url).searchParams.get('foundationTheme') === 'dark')?.params.response || null;
    if (!darkThumbnailResponse) await delay(50);
  }
  assert.equal(darkThumbnailResponse?.status, 200, '不透明 sandbox 中的当前页面缩略预览必须重新加载暗模式入口');
  await delay(100);
  await screenshot(devtools, '03-logic-react-flow-dark.png');
  const handles = await evaluate(devtools, `(() => {
    const node = document.querySelector('.page-flow-node[data-page-id="page_events_home"]');
    const center = (element) => { const rect = element.getBoundingClientRect(); return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}; };
    return {source: center(node.querySelector('[data-handleid="new-source"]')), target: center(node.querySelector('[data-handleid="new-target"]'))};
  })()`);
  await drag(devtools, handles.source, handles.target);
  await waitFor(devtools, "Boolean(document.querySelector('[role=dialog]'))", '关系编辑器');
  await waitFor(devtools, "document.activeElement?.id === 'relation-trigger'", '关系编辑器初始焦点');
  assert.equal((await activeElement(devtools)).tag, 'INPUT', '关系编辑器应把焦点放到触发器输入框');
  await pressKey(devtools, 'Escape');
  await waitFor(devtools, "!document.querySelector('[role=dialog]')", '关系编辑器关闭');
  const returnedFocus = await activeElement(devtools);
  assert.notEqual(returnedFocus.tag, 'BODY', '取消关系编辑后不得丢失焦点到 document.body');
  assert.equal(await evaluate(devtools, "Boolean(document.activeElement?.closest('.logic-flow-canvas'))"), true, '取消关系编辑后应返回发起拖拽的 React Flow 画布');

  await tabTo(devtools, (active) => active.tag === 'A' && active.text === '预览搭建', '预览搭建导航');
  await pressKey(devtools, 'Enter');
  await waitFor(devtools, "Boolean(document.querySelector('.workspace') && document.querySelector('[data-sidebar-view=page]'))", '返回预览工作区');
  await tabTo(devtools, (active) => active.role === 'tab' && active.text === '页面逻辑', '页面逻辑页签');
  await pressKey(devtools, 'ArrowRight');
  assert.equal((await activeElement(devtools)).text, '检查对象');
  await pressKey(devtools, 'Space');
  await delay(100);
  const contextTabState = await evaluate(devtools, `(() => ({tabs: [...document.querySelectorAll('[role=tab]')].map((item) => ({text: item.textContent.trim(), selected: item.getAttribute('aria-selected'), active: item.dataset.active})), visiblePanels: [...document.querySelectorAll('[role=tabpanel]')].filter((item) => getComputedStyle(item).display !== 'none').map((item) => item.textContent.trim().slice(0, 40))}))()`);
  assert.equal(contextTabState.tabs.find((item) => item.text === '检查对象')?.selected, 'true', `检查对象页签必须由 Space 激活：${JSON.stringify(contextTabState)}`);
  await waitFor(devtools, "Boolean(document.querySelector('[data-sidebar-view=object]') && document.querySelector('[role=tree]'))", '对象检查树');
  await waitFor(devtools, "document.activeElement?.getAttribute('role') === 'treeitem'", '对象树自动获得键盘焦点');
  const treeStart = await evaluate(devtools, `(() => ({active: document.activeElement.dataset.inspectorTreeId, tabbable: document.querySelectorAll('[role=treeitem][tabindex="0"]').length, toggles: [...document.querySelectorAll('[data-inspector-tree-toggle]')].every((item) => item.tabIndex === -1 && item.getAttribute('aria-hidden') === 'true'), expanded: document.activeElement.getAttribute('aria-expanded')}))()`);
  assert.ok(treeStart.active);
  assert.equal(treeStart.tabbable, 1);
  assert.equal(treeStart.toggles, true);
  assert.ok(['true', 'false'].includes(treeStart.expanded));
  await pressKey(devtools, 'ArrowRight');
  await waitFor(devtools, "document.querySelectorAll('[role=treeitem]').length > 1", 'Right 展开根节点');
  await pressKey(devtools, 'End');
  const treeEnd = await activeElement(devtools);
  assert.ok(treeEnd.treeId && treeEnd.treeId !== treeStart.active, `End 应到达最后一个可见树项：${JSON.stringify(treeEnd)}`);
  await pressKey(devtools, 'Home');
  assert.equal((await activeElement(devtools)).treeId, treeStart.active);
  await pressKey(devtools, 'ArrowRight');
  assert.notEqual((await activeElement(devtools)).treeId, treeStart.active, '展开节点上的 Right 应进入第一个子项');
  await pressKey(devtools, 'ArrowLeft');
  assert.equal((await activeElement(devtools)).treeId, treeStart.active, '子项上的 Left 应回到父项');
  await pressKey(devtools, 'Space');
  await waitFor(devtools, "document.activeElement?.getAttribute('role') === 'treeitem' && document.activeElement?.getAttribute('aria-selected') === 'true'", 'Space 选择树项目但不重复切换');
  await screenshot(devtools, '04-inspector-tree-desktop.png');

  await clickSelector(devtools, 'button[aria-label="切换为悬浮"]');
  await waitFor(devtools, "Boolean(document.querySelector('.floating-panel'))", '信息面板切换为悬浮');
  const floatingBeforeCollapse = await evaluate(devtools, `(() => { const rect = document.querySelector('.floating-panel').getBoundingClientRect(); return {x: rect.x, y: rect.y, width: rect.width, height: rect.height}; })()`);
  await clickSelector(devtools, '.floating-panel button[aria-label="最小化信息面板"]');
  await waitFor(devtools, "Boolean(document.querySelector('.restore-panel button[aria-label=\"展开信息面板\"]'))", '悬浮信息面板缩小');
  const collapsedBeforeDrag = await evaluate(devtools, `(() => { const rect = document.querySelector('.restore-panel').getBoundingClientRect(); return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2}; })()`);
  const collapsedTarget = {x: collapsedBeforeDrag.x + 360, y: collapsedBeforeDrag.y + 120};
  await drag(devtools, collapsedBeforeDrag, collapsedTarget);
  await delay(150);
  await waitFor(devtools, "Boolean(document.querySelector('.restore-panel'))", '拖动后保持缩小状态');
  const collapsedAfterDrag = await evaluate(devtools, `(() => { const rect = document.querySelector('.restore-panel').getBoundingClientRect(); return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2}; })()`);
  const collapsedDelta = {x: collapsedAfterDrag.x - collapsedBeforeDrag.x, y: collapsedAfterDrag.y - collapsedBeforeDrag.y};
  assert.ok(collapsedDelta.x > 300 && collapsedDelta.y > 80, `缩小按钮必须移动到拖拽位置：${JSON.stringify({collapsedBeforeDrag, collapsedAfterDrag})}`);
  const restoreHitTarget = await evaluate(devtools, `(() => { const rect = document.querySelector('.restore-panel').getBoundingClientRect(); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return {tag: hit?.tagName || '', label: hit?.closest('button')?.getAttribute('aria-label') || '', slot: hit?.getAttribute('data-slot') || ''}; })()`);
  assert.equal(restoreHitTarget.label, '展开信息面板', `缩小按钮中心必须保持可点击：${JSON.stringify(restoreHitTarget)}`);
  await clickSelector(devtools, '.restore-panel button[aria-label="展开信息面板"]');
  await delay(150);
  const restoredVisibility = await evaluate(devtools, `(() => ({restore: Boolean(document.querySelector('.restore-panel')), floating: Boolean(document.querySelector('.floating-panel')), docked: Boolean(document.querySelector('.panel-slot .panel-body'))}))()`);
  assert.deepEqual(restoredVisibility, {restore: false, floating: true, docked: false}, `必须从拖动后的缩小按钮位置展开悬浮信息面板：${JSON.stringify(restoredVisibility)}`);
  const floatingAfterRestore = await evaluate(devtools, `(() => { const rect = document.querySelector('.floating-panel').getBoundingClientRect(); return {x: rect.x, y: rect.y, width: rect.width, height: rect.height}; })()`);
  assert.ok(Math.abs((floatingAfterRestore.x - floatingBeforeCollapse.x) - collapsedDelta.x) < 2, `展开面板的水平位移应跟随缩小按钮：${JSON.stringify({floatingBeforeCollapse, floatingAfterRestore, collapsedDelta})}`);
  assert.ok(Math.abs((floatingAfterRestore.y - floatingBeforeCollapse.y) - collapsedDelta.y) < 2, `展开面板的垂直位移应跟随缩小按钮：${JSON.stringify({floatingBeforeCollapse, floatingAfterRestore, collapsedDelta})}`);
  await screenshot(devtools, '04a-floating-panel-restored-at-dragged-anchor.png');
  await clickSelector(devtools, '.floating-panel button[aria-label="最小化信息面板"]');
  await waitFor(devtools, "Boolean(document.querySelector('.restore-panel button[aria-label=\"展开信息面板\"]'))", '再次缩小以验证键盘恢复');
  await evaluate(devtools, `(() => { document.querySelector('.restore-panel button[aria-label="展开信息面板"]').focus(); return document.activeElement?.getAttribute('aria-label'); })()`);
  await pressKey(devtools, 'Enter');
  await waitFor(devtools, "Boolean(document.querySelector('.floating-panel')) && !document.querySelector('.restore-panel')", 'Enter 键恢复悬浮信息面板');
  await screenshot(devtools, '04b-floating-panel-keyboard-restored.png');
  await clickSelector(devtools, '.floating-panel button[aria-label="停靠到右侧"]');
  await waitFor(devtools, "Boolean(document.querySelector('.panel-slot') && !document.querySelector('.floating-panel'))", '信息面板恢复停靠供后续矩阵验证');

  await tabTo(devtools, (active) => active.label === '当前页面', '当前页面选择器');
  const pageBefore = (await activeElement(devtools)).text;
  await pressKey(devtools, 'Space');
  await waitFor(devtools, "document.querySelectorAll('[role=option]').length > 1", '当前页面选项弹层');
  await pressKey(devtools, 'ArrowDown');
  const previewReadyGeometry = await evaluate(devtools, `(() => { const frame = document.querySelector('.canvas-frame').getBoundingClientRect(); return {width: frame.width, height: frame.height}; })()`);
  await devtools.call('Network.emulateNetworkConditions', {offline: false, latency: 800, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'cellular3g'});
  await pressKey(devtools, 'Enter');
  await waitFor(devtools, `document.querySelector('[aria-label="当前页面"]')?.textContent?.trim() !== ${JSON.stringify(pageBefore)}`, '键盘切换页面并重载预览');
  await waitFor(devtools, "Boolean(document.querySelector('.preview-frame-loading [data-slot=spinner]'))", '页面切换在原预览区域显示 Spinner');
  const previewLoading = await evaluate(devtools, `(() => { const frame = document.querySelector('.canvas-frame'); const loading = frame.querySelector('.preview-frame-loading'); const spinner = loading.querySelector('[data-slot=spinner]'); const label = loading.querySelector('span'); const frameRect = frame.getBoundingClientRect(); const spinnerRect = spinner.getBoundingClientRect(); const labelRect = label.getBoundingClientRect(); return {width: frameRect.width, height: frameRect.height, iframeInside: frame.contains(frame.querySelector('iframe')), spinnerLabel: spinner.getAttribute('aria-label'), text: loading.textContent.trim(), horizontalDelta: Math.max(Math.abs((spinnerRect.left + spinnerRect.width / 2) - (frameRect.left + frameRect.width / 2)), Math.abs((labelRect.left + labelRect.width / 2) - (frameRect.left + frameRect.width / 2))), verticalDelta: Math.abs(((spinnerRect.top + labelRect.bottom) / 2) - (frameRect.top + frameRect.height / 2))}; })()`);
  assert.deepEqual({width: previewLoading.width, height: previewLoading.height}, previewReadyGeometry, '页面切换时主预览区域尺寸不得变化');
  assert.equal(previewLoading.iframeInside, true);
  assert.equal(previewLoading.spinnerLabel, '正在载入产品预览');
  assert.match(previewLoading.text, /正在载入产品预览/u);
  assert.ok(previewLoading.horizontalDelta < 1 && previewLoading.verticalDelta < 1, `主预览 Spinner 与文字必须上下左右居中：${JSON.stringify(previewLoading)}`);
  await screenshot(devtools, '04a-preview-loading-stable.png');
  await devtools.call('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'none'});
  await waitFor(devtools, "!document.querySelector('.preview-frame-loading')", '页面预览加载完成');
  await waitFor(devtools, "Boolean(document.querySelector('[data-sidebar-view=object]') && document.querySelector('[role=treeitem][tabindex=\"0\"]'))", '页面重载后对象页签和树焦点状态恢复');

  await devtools.call('Emulation.setDeviceMetricsOverride', {width: 375, height: 812, deviceScaleFactor: 1, mobile: false});
  await delay(200);
  const narrowState = await evaluate(devtools, `(() => ({overflow: document.documentElement.scrollWidth > window.innerWidth, selectedTab: document.querySelector('[role=tab][aria-selected=true]')?.textContent?.trim(), tabbable: document.querySelectorAll('[role=treeitem][tabindex="0"]').length, panelDirection: getComputedStyle(document.querySelector('[data-slot=resizable-panel-group]')).flexDirection, panelWidths: [...document.querySelectorAll('[data-slot=resizable-panel]')].map((item) => item.getBoundingClientRect().width)}))()`);
  assert.equal(narrowState.overflow, false, '375px 窄屏不应产生页面级横向溢出');
  assert.equal(narrowState.panelDirection, 'column', '375px 窄屏应把预览与上下文面板改为上下布局');
  assert.equal(narrowState.panelWidths.every((width) => width <= 375), true, `窄屏面板不得超出视口：${JSON.stringify(narrowState.panelWidths)}`);
  assert.equal(narrowState.selectedTab, '检查对象');
  assert.equal(narrowState.tabbable, 1);
  await screenshot(devtools, '05-inspector-tree-narrow-375x812.png');
  await devtools.call('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
  await delay(100);

  await tabTo(devtools, (active) => active.tag === 'A' && active.text === '资产管理', '资产管理导航');
  await pressKey(devtools, 'Enter');
  await waitFor(devtools, "Boolean(document.querySelector('.asset-management-workspace'))", '资产管理工作区');
  await tabTo(devtools, (active) => active.tag === 'BUTTON' && active.text.startsWith('EventCard'), 'EventCard 资产');
  await pressKey(devtools, 'Space');
  let assetDiagnostic;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    assetDiagnostic = await evaluate(devtools, `(() => { const preview = document.querySelector('.asset-preview'); const frame = preview?.querySelector('iframe'); return {status: preview?.dataset.previewStatus || null, text: document.querySelector('.asset-detail-pane')?.textContent?.trim().replace(/\\s+/gu, ' ').slice(0, 300) || '', src: frame?.getAttribute('src') || ''}; })()`);
    if (assetDiagnostic.status === 'ready') break;
    await delay(50);
  }
  if (assetDiagnostic?.status !== 'ready') {
    assetDiagnostic.contexts = [];
    const contexts = devtools.events.filter((event) => event.method === 'Runtime.executionContextCreated' && event.params?.context?.auxData?.isDefault);
    for (const event of contexts.slice(-8)) {
      const context = event.params.context;
      const details = await devtools.call('Runtime.evaluate', {contextId: context.id, expression: `({href: location.href, origin: location.origin, referrer: document.referrer, parentIsSelf: parent === window})`, returnByValue: true}).catch((error) => ({error: error.message}));
      assetDiagnostic.contexts.push({origin: context.origin, frameId: context.auxData?.frameId, details: details.result?.value || details});
    }
  }
  assert.equal(assetDiagnostic?.status, 'ready', `真实资产隔离预览必须 ready：${JSON.stringify(assetDiagnostic)}`);
  const assetState = await evaluate(devtools, `(() => { const frame = document.querySelector('.asset-preview iframe'); return {sandbox: frame?.getAttribute('sandbox'), title: frame?.getAttribute('title'), status: frame?.closest('.asset-preview')?.dataset.previewStatus}; })()`);
  assert.equal(assetState.sandbox, 'allow-scripts');
  assert.equal(assetState.status, 'ready');
  assert.match(assetState.title, /真实资产预览/u);
  const readyGeometry = await evaluate(devtools, `(() => { const outer = document.querySelector('.asset-preview').getBoundingClientRect(); const viewport = document.querySelector('.asset-preview-viewport').getBoundingClientRect(); return {outerHeight: outer.height, viewportHeight: viewport.height}; })()`);
  await devtools.call('Network.emulateNetworkConditions', {offline: false, latency: 800, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'cellular3g'});
  await pressKey(devtools, 'Tab', 8);
  assert.equal((await activeElement(devtools)).text.startsWith('EventAction'), true, 'EventAction 应与 EventCard 相邻，便于直接切换');
  await pressKey(devtools, 'Space');
  await waitFor(devtools, "document.querySelector('.asset-preview')?.dataset.previewStatus === 'pending'", '资产切换进入固定区域内的 loading');
  const loadingGeometry = await evaluate(devtools, `(() => { const preview = document.querySelector('.asset-preview'); const viewport = preview.querySelector('.asset-preview-viewport'); const outer = preview.getBoundingClientRect(); const viewportRect = viewport.getBoundingClientRect(); const loading = viewport.querySelector('.asset-preview-loading'); const spinner = loading?.querySelector('[data-slot=spinner]'); const label = loading?.querySelector('span'); const spinnerRect = spinner?.getBoundingClientRect(); const labelRect = label?.getBoundingClientRect(); const loadingStyle = loading ? getComputedStyle(loading) : null; return {outerHeight: outer.height, viewportHeight: viewportRect.height, iframeInside: viewport.contains(preview.querySelector('iframe')), loadingInside: Boolean(loading && viewport.contains(loading)), loadingText: loading?.textContent?.trim() || '', spinner: spinner?.tagName || '', spinnerLabel: spinner?.getAttribute('aria-label') || '', display: loadingStyle?.display || '', alignItems: loadingStyle?.alignItems || '', justifyContent: loadingStyle?.justifyContent || '', flexDirection: loadingStyle?.flexDirection || '', horizontalDelta: spinnerRect && labelRect ? Math.max(Math.abs((spinnerRect.left + spinnerRect.width / 2) - (viewportRect.left + viewportRect.width / 2)), Math.abs((labelRect.left + labelRect.width / 2) - (viewportRect.left + viewportRect.width / 2))) : 999, verticalDelta: spinnerRect && labelRect ? Math.abs(((spinnerRect.top + labelRect.bottom) / 2) - (viewportRect.top + viewportRect.height / 2)) : 999}; })()`);
  assert.equal(loadingGeometry.outerHeight, readyGeometry.outerHeight, '资产切换时预览卡片高度不得变化');
  assert.equal(loadingGeometry.viewportHeight, readyGeometry.viewportHeight, '资产切换时预览内容区域高度不得变化');
  assert.equal(loadingGeometry.iframeInside, true);
  assert.equal(loadingGeometry.loadingInside, true);
  assert.match(loadingGeometry.loadingText, /正在载入真实组件/u);
  assert.equal(loadingGeometry.spinner, 'svg');
  assert.equal(loadingGeometry.spinnerLabel, '正在载入真实组件');
  assert.deepEqual([loadingGeometry.display, loadingGeometry.alignItems, loadingGeometry.justifyContent, loadingGeometry.flexDirection], ['flex', 'center', 'center', 'column']);
  assert.ok(loadingGeometry.horizontalDelta < 1, `Spinner 与文字必须水平居中：${JSON.stringify(loadingGeometry)}`);
  assert.ok(loadingGeometry.verticalDelta < 1, `Spinner 与文字组合必须垂直居中：${JSON.stringify(loadingGeometry)}`);
  await evaluate(devtools, "document.querySelector('.asset-preview').scrollIntoView({block: 'center'}); true");
  await delay(50);
  await screenshot(devtools, '06-asset-preview-loading-stable.png');
  await devtools.call('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'none'});
  await waitFor(devtools, "document.querySelector('.asset-preview')?.dataset.previewStatus === 'ready'", '固定预览区域完成资产切换');
  await screenshot(devtools, '07-asset-preview-isolated.png');

  await delay(200);
  const badConsole = devtools.events.filter((event) => (event.method === 'Runtime.exceptionThrown') || (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(event.params?.type)) || (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params?.entry?.level)));
  const badResponses = devtools.events.filter((event) => event.method === 'Network.responseReceived' && Number(event.params?.response?.status) >= 400).map((event) => ({status: event.params.response.status, url: event.params.response.url}));
  const failedLoads = devtools.events.filter((event) => event.method === 'Network.loadingFailed' && !event.params?.canceled).map((event) => ({error: event.params?.errorText, type: event.params?.type}));
  assert.deepEqual(badConsole, [], `浏览器控制台必须零 warning/error/exception：${JSON.stringify(badConsole)}`);
  assert.deepEqual(badResponses, [], `浏览器网络响应必须零 4xx/5xx：${JSON.stringify(badResponses)}`);
  assert.deepEqual(failedLoads, [], `浏览器网络必须零非取消加载失败：${JSON.stringify(failedLoads)}`);
});
