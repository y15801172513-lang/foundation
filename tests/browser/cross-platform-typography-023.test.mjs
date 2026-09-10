import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import test from 'node:test';
import {browserLaunchContract, waitForBrowserDevtoolsPort} from '../helpers/browser-launch-contract.mjs';
import {evaluateWindowsFontEvidence} from '../helpers/platform-font-evidence.mjs';
import {makeScopedTempDirectory, removeTempDirectory, ROOT} from '../helpers/project-fixture.mjs';

const PREVIEW_URL = 'http://127.0.0.1:4317/';
const EVIDENCE_DIRECTORY = path.join(ROOT, '.tmp', 'AI_PFK_CROSS_PLATFORM_TYPOGRAPHY_CORRECTION_023R1', 'windows', 'typography');
const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const FONT_STACK = '"Geist Variable", "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function connectDevtools(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', () => reject(new Error('无法连接浏览器 DevTools')), {once: true});
  });
  let sequence = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) { events.push(message); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  return {
    events,
    call(method, params = {}) {
      const id = ++sequence;
      socket.send(JSON.stringify({id, method, params}));
      return new Promise((resolve, reject) => pending.set(id, {resolve, reject}));
    },
    close() { socket.close(); },
  };
}

async function evaluate(devtools, expression) {
  const result = await devtools.call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || '浏览器表达式执行失败');
  return result.result.value;
}

async function waitFor(devtools, expression, description, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(devtools, expression)) return;
    await delay(50);
  }
  throw new Error(`浏览器等待超时：${description}`);
}

async function screenshot(devtools, filename) {
  const result = await devtools.call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false, fromSurface: true});
  fs.writeFileSync(path.join(EVIDENCE_DIRECTORY, filename), Buffer.from(result.data, 'base64'));
}

async function platformFonts(devtools, selector, iframeSelector = null) {
  const document = await devtools.call('DOM.getDocument', {depth: 1, pierce: true});
  let rootNodeId = document.root.nodeId;
  if (iframeSelector) {
    const frame = await devtools.call('DOM.querySelector', {nodeId: rootNodeId, selector: iframeSelector});
    assert.ok(frame.nodeId, `未找到 iframe：${iframeSelector}`);
    const described = await devtools.call('DOM.describeNode', {nodeId: frame.nodeId, depth: 1, pierce: true});
    rootNodeId = described.node.contentDocument?.nodeId;
    assert.ok(rootNodeId, `iframe 尚无 contentDocument：${iframeSelector}`);
  }
  const node = await devtools.call('DOM.querySelector', {nodeId: rootNodeId, selector});
  assert.ok(node.nodeId, `未找到字体证据节点：${selector}`);
  return (await devtools.call('CSS.getPlatformFontsForNode', {nodeId: node.nodeId})).fonts;
}

test('023 Windows Chromium verifies actual Latin/CJK fonts, semantic metrics, widths, themes, and local font requests', {timeout: 120_000}, async (t) => {
  if (process.platform !== 'win32') return t.skip('skipped_not_applicable: Windows 字体门只能在 Windows 主机执行，且 skip 不满足 Windows 发布门');
  const health = await fetch(`${PREVIEW_URL}__foundation/health`).catch(() => null);
  assert.equal(health?.status, 200, '先用 npm run preview 启动固定的 4317 Foundation 预览');
  const browser = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  assert.ok(browser, '需要本机 Chrome 或 Edge 执行真实字体门');
  fs.mkdirSync(EVIDENCE_DIRECTORY, {recursive: true});
  const temporary = makeScopedTempDirectory('AI_PFK_CROSS_PLATFORM_TYPOGRAPHY_CORRECTION_023R1/profiles', 'foundation-typography-browser-023-');
  const profile = path.join(temporary, 'browser-profile');
  fs.mkdirSync(profile);
  const launch = browserLaunchContract(process.env, {windowSize: '1440,900', userDataDirectory: profile});
  const child = spawn(browser, launch.args, {stdio: 'ignore', windowsHide: true, shell: false});
  let devtools;
  t.after(async () => {
    devtools?.close();
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, delay(5_000)]);
    }
    let cleanupError;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { removeTempDirectory(temporary); cleanupError = null; break; }
      catch (error) { cleanupError = error; await delay(100); }
    }
    if (cleanupError) throw cleanupError;
  });

  const debuggingPort = await waitForBrowserDevtoolsPort(profile, child);
  const targetResponse = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent('about:blank')}`, {method: 'PUT'});
  assert.equal(targetResponse.ok, true);
  const target = await targetResponse.json();
  devtools = await connectDevtools(target.webSocketDebuggerUrl);
  for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) {
    await devtools.call(method);
  }
  await devtools.call('Page.navigate', {url: PREVIEW_URL});
  await waitFor(devtools, "Boolean(document.querySelector('.workspace') && document.querySelector('#preview-frame')?.contentDocument?.querySelector('.events-header'))", '管理中心与示例 iframe');
  await evaluate(devtools, `Promise.all([document.fonts.ready, document.querySelector('#preview-frame').contentDocument.fonts.ready]).then(() => true)`);
  await devtools.call('DOM.enable');
  await devtools.call('CSS.enable');

  await evaluate(devtools, `(() => { const probe=document.createElement('span'); probe.id='foundation-cjk-capability-probe'; probe.lang='zh-CN'; probe.textContent='跨平台字体探测'; probe.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;opacity:.001;pointer-events:none;font-family:"PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif;font-size:24px'; document.body.append(probe); return document.fonts.ready.then(() => probe.getBoundingClientRect().width > 0); })()`);
  const probeFonts = await platformFonts(devtools, '#foundation-cjk-capability-probe');

  const computed = await evaluate(devtools, `(() => {
    const style = (element) => { const value = getComputedStyle(element); const rect = element.getBoundingClientRect(); return {fontFamily:value.fontFamily,fontSize:value.fontSize,fontWeight:value.fontWeight,lineHeight:value.lineHeight,letterSpacing:value.letterSpacing,fontVariantNumeric:value.fontVariantNumeric,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,width:rect.width,height:rect.height}; };
    const frame = document.querySelector('#preview-frame').contentDocument;
    return {outerBody:style(document.body),project:style(document.querySelector('.topbar-project')),navigation:style(document.querySelector('.topbar-navigation')),statusbar:style(document.querySelector('.statusbar')),innerBody:style(frame.body),pageTitle:style(frame.querySelector('.events-header h1')),button:style(frame.querySelector('[data-slot="button"]')),select:style(document.querySelector('[data-slot="select-trigger"]'))};
  })()`);
  for (const key of ['outerBody', 'project', 'navigation', 'statusbar', 'innerBody', 'pageTitle', 'button', 'select']) assert.equal(computed[key].fontFamily, FONT_STACK, `${key} 必须继承统一 font-sans`);
  assert.deepEqual({size: computed.pageTitle.fontSize, weight: computed.pageTitle.fontWeight, line: computed.pageTitle.lineHeight, tracking: computed.pageTitle.letterSpacing}, {size: '24px', weight: '600', line: '33px', tracking: 'normal'});
  for (const key of ['pageTitle', 'button', 'select']) {
    assert.ok(computed[key].scrollWidth <= computed[key].clientWidth + 1, `${key} 不应横向裁切`);
    assert.ok(computed[key].scrollHeight <= computed[key].clientHeight + 1, `${key} 不应纵向裁切`);
  }

  const outerLatin = await platformFonts(devtools, '.topbar-project');
  const outerChinese = await platformFonts(devtools, '.topbar-navigation a');
  const outerMixed = await platformFonts(devtools, '.statusbar span:last-child');
  const innerChinese = await platformFonts(devtools, '.events-header h1', '#preview-frame');
  const innerMixed = await platformFonts(devtools, '.eyebrow', '#preview-frame');
  const fontDecision = evaluateWindowsFontEvidence({
    probeFonts,
    latinFonts: outerLatin,
    cjkTargets: [{target: 'outerChinese', fonts: outerChinese}, {target: 'innerChinese', fonts: innerChinese}],
    mixedTargets: [{target: 'outerMixed', fonts: outerMixed}, {target: 'innerMixed', fonts: innerMixed}],
  });

  const matrix = [];
  for (const width of [1440, 1280, 375, 320]) {
    await devtools.call('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: false});
    for (const theme of ['light', 'dark']) {
      await evaluate(devtools, `(() => { const desired=${JSON.stringify(theme)}; const current=document.documentElement.classList.contains('dark')?'dark':'light'; if(current!==desired) document.querySelector('[data-theme-toggle]').click(); return true; })()`);
      await waitFor(devtools, `document.documentElement.classList.contains('dark') === ${theme === 'dark'} && document.querySelector('#preview-frame').contentDocument.documentElement.classList.contains('dark') === ${theme === 'dark'}`, `${width}px ${theme} 主题同步`);
      const state = await evaluate(devtools, `(() => ({width:innerWidth,theme:document.documentElement.classList.contains('dark')?'dark':'light',bodyOverflow:document.body.scrollWidth-document.body.clientWidth,topbarHeight:document.querySelector('.topbar').getBoundingClientRect().height,statusbarHeight:document.querySelector('.statusbar').getBoundingClientRect().height,innerOverflow:document.querySelector('#preview-frame').contentDocument.body.scrollWidth-document.querySelector('#preview-frame').contentDocument.body.clientWidth}))()`);
      assert.equal(state.width, width);
      assert.ok(state.bodyOverflow <= 1, `外层不应出现非预期横向溢出：${JSON.stringify(state)}`);
      assert.ok(state.innerOverflow <= 1, `示例不应出现非预期横向溢出：${JSON.stringify(state)}`);
      matrix.push(state);
      await screenshot(devtools, `${String(width).padStart(4, '0')}-${theme}.png`);
    }
  }

  await devtools.call('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  const pageScaleEvidence = [];
  for (const pageScaleFactor of [1, 1.25, 1.5]) {
    await devtools.call('Emulation.setPageScaleFactor', {pageScaleFactor});
    pageScaleEvidence.push(await evaluate(devtools, `({requested:${pageScaleFactor},visualViewportScale:visualViewport.scale,devicePixelRatio})`));
    await screenshot(devtools, `1280-dark-page-scale-${String(pageScaleFactor).replace('.', '-')}.png`);
  }
  await devtools.call('Emulation.setPageScaleFactor', {pageScaleFactor: 1});

  const routes = [];
  for (const route of ['/events', '/events/detail', '/events/manage']) {
    await devtools.call('Page.navigate', {url: new URL(route, PREVIEW_URL).href});
    await waitFor(devtools, "Boolean(document.querySelector('.events-shell'))", route);
    await evaluate(devtools, 'document.fonts.ready.then(() => true)');
    const routeState = await evaluate(devtools, `(() => ({route:location.pathname,fontFamily:getComputedStyle(document.body).fontFamily,overflow:document.body.scrollWidth-document.body.clientWidth,title:document.querySelector('h1')?.textContent||'',buttons:[...document.querySelectorAll('[data-slot="button"]')].map((item)=>({text:item.textContent.trim(),clipped:item.scrollHeight>item.clientHeight+1||item.scrollWidth>item.clientWidth+1}))}))()`);
    assert.equal(routeState.fontFamily, FONT_STACK);
    assert.ok(routeState.overflow <= 1, `${route} 不应横向溢出`);
    assert.equal(routeState.buttons.some((button) => button.clipped), false, `${route} 控件不应裁切`);
    routes.push(routeState);
    await screenshot(devtools, `route-${route.split('/').filter(Boolean).join('-')}.png`);
  }

  const version = await devtools.call('Browser.getVersion');
  const fontResponses = devtools.events.filter((event) => event.method === 'Network.responseReceived' && /\.woff2(?:\?|$)/u.test(event.params.response.url)).map((event) => ({url: event.params.response.url, status: event.params.response.status, mimeType: event.params.response.mimeType}));
  assert.ok(fontResponses.length >= 1, '必须观察到本地 Geist WOFF2 请求');
  assert.equal(fontResponses.some((item) => new URL(item.url).origin !== new URL(PREVIEW_URL).origin || item.status !== 200), false, `字体请求必须同源且成功：${JSON.stringify(fontResponses)}`);
  const consoleErrors = devtools.events.filter((event) => event.method === 'Runtime.exceptionThrown' || (event.method === 'Log.entryAdded' && event.params.entry.level === 'error'));
  const failedResponses = devtools.events.filter((event) => event.method === 'Network.responseReceived' && event.params.response.status >= 400).map((event) => ({url: event.params.response.url, status: event.params.response.status}));
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(failedResponses, []);

  fs.writeFileSync(path.join(EVIDENCE_DIRECTORY, 'windows-evidence.json'), `${JSON.stringify({
    os: {platform: process.platform, release: os.release(), version: os.version()},
    browser: version,
    sandboxMode: launch.sandboxMode,
    optInSource: launch.optInSource,
    displayScale: {devicePixelRatio: computed.outerBody ? await evaluate(devtools, 'devicePixelRatio') : null, note: 'Headless Chrome used deviceScaleFactor=1; host OS display scaling was not changed.'},
    computed,
    platformFonts: {outerLatin, outerChinese, outerMixed, innerChinese, innerMixed},
    fontDecision,
    matrix,
    pageScaleEvidence,
    pageScaleQualification: 'CDP page scale evidence is not claimed as Chrome browser zoom.',
    routes,
    fontResponses,
    consoleErrors,
    failedResponses,
  }, null, 2)}\n`, 'utf8');
});

test('023 Windows Chrome applies real browser zoom at 100, 125, and 150 percent', {timeout: 120_000}, async (t) => {
  if (process.platform !== 'win32') return t.skip('skipped_not_applicable: Windows browser zoom gate requires a Windows host');
  const browser = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  assert.ok(browser);
  const evidence = [];
  for (const factor of [1, 1.25, 1.5]) {
    const temporary = makeScopedTempDirectory('AI_PFK_CROSS_PLATFORM_TYPOGRAPHY_CORRECTION_023R1/profiles', `foundation-typography-zoom-${factor}-`);
    const profile = path.join(temporary, 'browser-profile');
    fs.mkdirSync(profile, {recursive: true});
    const launch = browserLaunchContract(process.env, {windowSize: '1440,900', userDataDirectory: profile});
    const child = spawn(browser, launch.args, {stdio: 'ignore', windowsHide: true, shell: false});
    let devtools;
    try {
      const debuggingPort = await waitForBrowserDevtoolsPort(profile, child);
      const targetResponse = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent('about:blank')}`, {method: 'PUT'});
      const target = await targetResponse.json();
      devtools = await connectDevtools(target.webSocketDebuggerUrl);
      await devtools.call('Page.enable');
      await devtools.call('Runtime.enable');
      await devtools.call('Page.navigate', {url: PREVIEW_URL});
      await waitFor(devtools, "Boolean(document.querySelector('.topbar') && document.querySelector('#preview-frame')?.contentDocument?.body)", `${factor * 100}% 浏览器缩放`);
      const zoomSteps = factor === 1 ? 0 : factor === 1.25 ? 2 : 3;
      for (let step = 0; step < zoomSteps; step += 1) {
        const key = {modifiers: 2, windowsVirtualKeyCode: 187, nativeVirtualKeyCode: 187, key: '+', code: 'Equal'};
        await devtools.call('Input.dispatchKeyEvent', {...key, type: 'rawKeyDown'});
        await devtools.call('Input.dispatchKeyEvent', {...key, type: 'keyUp'});
        await delay(100);
      }
      const state = await evaluate(devtools, `(() => ({requested:${factor},devicePixelRatio,visualViewportScale:visualViewport.scale,innerWidth,documentWidth:document.documentElement.clientWidth,pageTitleFontSize:getComputedStyle(document.querySelector('#preview-frame').contentDocument.querySelector('h1')).fontSize}))()`);
      assert.ok(Math.abs(state.devicePixelRatio - factor) < 0.02, `Chrome per-host zoom 应改变 devicePixelRatio：${JSON.stringify(state)}`);
      assert.equal(state.visualViewportScale, 1, `浏览器 zoom 不应伪装成 pinch/page scale：${JSON.stringify(state)}`);
      assert.equal(state.pageTitleFontSize, '24px');
      evidence.push({...state, keyboardZoomSteps: zoomSteps, sandboxMode: launch.sandboxMode, optInSource: launch.optInSource});
      await screenshot(devtools, `browser-zoom-${Math.round(factor * 100)}.png`);
    } finally {
      devtools?.close();
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await Promise.race([exited, delay(5_000)]);
      }
      let cleanupError;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try { removeTempDirectory(temporary); cleanupError = null; break; }
        catch (error) { cleanupError = error; await delay(100); }
      }
      if (cleanupError) throw cleanupError;
    }
  }
  assert.ok(evidence[0].innerWidth > evidence[1].innerWidth && evidence[1].innerWidth > evidence[2].innerWidth, `浏览器 zoom 应减少 CSS viewport：${JSON.stringify(evidence)}`);
  fs.writeFileSync(path.join(EVIDENCE_DIRECTORY, 'browser-zoom-evidence.json'), `${JSON.stringify({browserZoom: evidence, qualification: 'Chrome Ctrl+Plus browser shortcut delivered through DevTools Input; visualViewport.scale remains 1, distinguishing it from CDP page scale.'}, null, 2)}\n`, 'utf8');
});
