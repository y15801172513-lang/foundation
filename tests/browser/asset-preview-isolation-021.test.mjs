import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import test from 'node:test';
import {ASSET_PREVIEW_SANDBOX} from '../../apps/management-center/src/features/preview/asset-preview-policy.mjs';
import {browserLaunchContract, waitForBrowserDevtoolsPort} from '../helpers/browser-launch-contract.mjs';
import {makeScopedTempDirectory, removeTempDirectory, ROOT} from '../helpers/project-fixture.mjs';
import {connectDevtools, cleanupBrowser} from '../helpers/browser-lifecycle.mjs';

const BROWSER_CANDIDATES = [
  process.env.FOUNDATION_BROWSER_EXECUTABLE,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('hostile same-origin asset iframe 无法读取父数据或改变 Foundation 状态', {timeout: 30_000}, async (t) => {
  const browser = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  assert.ok(browser, '需要本机 Chrome 或 Edge 执行资产隔离浏览器门禁');
  const temporary = makeScopedTempDirectory('AI_PFK_CROSS_PLATFORM_TYPOGRAPHY_CORRECTION_023R1/profiles', 'asset-isolation-browser-021-');
  const profile = path.join(temporary, 'browser-profile');
  fs.mkdirSync(profile);
  const serverState = {writeProbes: 0, mutations: 0};
  let parentOrigin = '';
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, parentOrigin).pathname;
    if (pathname === '/__foundation/relations') {
      serverState.writeProbes += 1;
      response.writeHead(403, {'content-type': 'application/json'});
      response.end(JSON.stringify({ok: false, error: '写入来源或凭据无效'}));
      return;
    }
    if (pathname === '/hostile') {
      const parentTarget = new URL(request.url, parentOrigin).searchParams.get('parentOrigin');
      response.writeHead(200, {'content-type': 'text/html;charset=utf-8'});
      response.end(`<!doctype html><html><body><script>
        (async () => {
          const result = {parentDom: false, storage: false, cookie: false, nonce: false, write: false};
          try { result.parentDom = Boolean(parent.document.querySelector('[data-parent-secret]')); } catch {}
          try { result.storage = localStorage.getItem('foundation-parent-secret') === 'storage-secret'; } catch {}
          try { result.cookie = document.cookie.includes('foundation_parent_secret'); } catch {}
          let nonce = '';
          try { nonce = parent.__FOUNDATION_WRITE_NONCE__ || ''; result.nonce = nonce === 'nonce-secret-021'; } catch {}
          try {
            const response = await fetch('/__foundation/relations', {method: 'POST', headers: {'content-type': 'application/json', 'x-foundation-write-nonce': nonce}, body: JSON.stringify({from: 'hostile', to: 'facts'})});
            result.write = response.ok;
          } catch {}
          parent.postMessage({namespace: 'asset-preview-hostile-test', kind: 'result', result}, ${JSON.stringify(parentTarget)});
        })();
      </script></body></html>`);
      return;
    }
    if (pathname === '/parent') {
      response.writeHead(200, {'content-type': 'text/html;charset=utf-8'});
      response.end(`<!doctype html><html><body data-parent-secret="dom-secret">
        <output id="result"></output>
        <script>
          window.__FOUNDATION_WRITE_NONCE__ = 'nonce-secret-021';
          window.foundationState = {relationCount: 0};
          document.cookie = 'foundation_parent_secret=cookie-secret; SameSite=Lax';
          localStorage.setItem('foundation-parent-secret', 'storage-secret');
          window.addEventListener('message', (event) => {
            const frame = document.querySelector('iframe');
            const data = event.data;
            if (event.source !== frame.contentWindow || event.origin !== 'null') return;
            if (!data || data.namespace !== 'asset-preview-hostile-test' || data.kind !== 'result') return;
            document.querySelector('#result').textContent = JSON.stringify({attempts: data.result, relationCount: window.foundationState.relationCount});
          });
        </script>
        <iframe title="hostile asset preview" sandbox="${ASSET_PREVIEW_SANDBOX}" src="/hostile?parentOrigin=${encodeURIComponent(parentOrigin)}"></iframe>
      </body></html>`);
      return;
    }
    response.writeHead(404); response.end('not found');
  });
  const port = await listen(server);
  parentOrigin = `http://127.0.0.1:${port}`;
  const launch = browserLaunchContract(process.env, {userDataDirectory: profile});
  const child = spawn(browser, launch.args, {stdio: 'ignore', windowsHide: true, shell: false});
  let devtools;
  t.after(async () => {
    await cleanupBrowser({child, devtools, server, temporary, profile, root: path.join(ROOT, '.tmp'), remove: () => removeTempDirectory(temporary), diagnostic: (value) => t.diagnostic(JSON.stringify(value))});
  });
  const debuggingPort = await waitForBrowserDevtoolsPort(profile, child);
  const targetResponse = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(`${parentOrigin}/parent`)}`, {method: 'PUT'});
  assert.equal(targetResponse.ok, true);
  const target = await targetResponse.json();
  devtools = await connectDevtools(target.webSocketDebuggerUrl);
  await devtools.call('Runtime.enable');
  let serialized = '';
  for (let attempt = 0; attempt < 200 && !serialized; attempt += 1) {
    const evaluation = await devtools.call('Runtime.evaluate', {expression: "document.querySelector('#result')?.textContent || ''", returnByValue: true});
    serialized = evaluation.result.value;
    if (!serialized) await delay(50);
  }
  assert.ok(serialized, 'hostile preview 必须完成全部攻击探测并回报结果');
  const result = JSON.parse(serialized);
  assert.deepEqual(result.attempts, {parentDom: false, storage: false, cookie: false, nonce: false, write: false});
  assert.equal(result.relationCount, 0);
  assert.ok(serverState.writeProbes > 0, 'hostile preview 必须实际发起关系写探测');
  assert.equal(serverState.mutations, 0);
});
