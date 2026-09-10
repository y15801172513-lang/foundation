import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import {createManagementCenterServer, WORKSPACE_ASSETS, workspaceDocument} from '@foundation/management-center';
import {readFacts, readPreviewConfig, verify} from '@foundation/core';
import {copyDemo, DEMO, EVENTS, removeTempDirectory, ROOT} from '../helpers/project-fixture.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({host: '127.0.0.1', port, path: requestPath}, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), contentType: res.headers['content-type'], headers: res.headers}));
    });
    req.on('error', reject);
  });
}

test('管理中心、声明页面和资源可访问，未声明及穿越路径拒绝', async (t) => {
  const server = createManagementCenterServer(DEMO);
  t.after(() => server.close());
  const port = await listen(server);
  for (const pathname of ['/', '/home', '/detail', '/preview.css', '/src/app.mjs', '/src/pages.mjs', '/src/button.mjs', '/__foundation/workspace.js', '/__foundation/workspace.css']) {
    const response = await request(port, pathname);
    assert.equal(response.status, 200, pathname);
  }
  const binaryName = fs.readdirSync(path.join(ROOT, 'apps/management-center/dist/assets/binary')).sort()[0];
  assert.equal((await request(port, `${WORKSPACE_ASSETS.binaryPrefix}${binaryName}`)).status, 200);
  const chunkName = fs.readdirSync(path.join(ROOT, 'apps/management-center/dist/assets/chunks')).find((name) => name.startsWith('information-logic-workspace-'));
  const chunk = await request(port, `${WORKSPACE_ASSETS.chunkPrefix}${chunkName}`);
  assert.equal(chunk.status, 200);
  assert.equal(chunk.contentType, 'text/javascript');
  assert.equal((await request(port, `${WORKSPACE_ASSETS.preloadChunkPrefix}${chunkName}`)).status, 200, 'Vite modulepreload 必须命中同一白名单 chunk');
  for (const pathname of ['/home.html', '/src/not-declared.mjs', '/%2e%2e/foundation-kit', '/src/%2e%2e/home.html', `${WORKSPACE_ASSETS.chunkPrefix}missing.js`, `${WORKSPACE_ASSETS.chunkPrefix}%2e%2e%2fworkspace.js`, `${WORKSPACE_ASSETS.preloadChunkPrefix}%2e%2e%2fworkspace.js`]) {
    const response = await request(port, pathname);
    assert.equal(response.status, 404, pathname);
  }
});

test('动态项目标题与注入模型经过 HTML/script 上下文转义', (t) => {
  const project = copyDemo();
  t.after(() => removeTempDirectory(project));
  const foundationFile = path.join(project, '.foundation', 'foundation.json');
  const foundation = JSON.parse(fs.readFileSync(foundationFile));
  foundation.name = '<script>alert("x")</script>';
  fs.writeFileSync(foundationFile, JSON.stringify(foundation, null, 2));
  const html = workspaceDocument(readFacts(project), readPreviewConfig(project));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; · Foundation 工作台'));
  assert.ok(html.includes('\\u003cscript>'));
  assert.ok(!html.includes('<title><script>'));
  assert.ok(html.includes('<link rel="icon" href="data:,">'));
});

test('事件项目的三页 preview 与构建资源由声明白名单提供', async (t) => {
  assert.deepEqual(verify(EVENTS), {ok: true, errors: []});
  const server = createManagementCenterServer(EVENTS);
  t.after(() => server.close());
  const port = await listen(server);
  for (const pathname of ['/events', '/events/manage', '/events/detail', '/assets/events-app.js', '/assets/events-app.css']) assert.equal((await request(port, pathname)).status, 200, pathname);
  const fontName = fs.readdirSync(path.join(EVENTS, 'dist', 'assets')).find((name) => name.endsWith('.woff2'));
  assert.ok(fontName, '事件项目构建必须包含 Geist WOFF2');
  const font = await request(port, `/assets/${fontName}`);
  assert.equal(font.status, 200);
  assert.equal(font.contentType, 'font/woff2');
  assert.equal(font.headers['access-control-allow-origin'], '*');
  assert.equal((await request(port, '/assets/events-app.js')).headers['access-control-allow-origin'], '*', 'opaque-origin asset iframe 必须能读取声明的公开模块脚本');
  assert.equal((await request(port, '/__foundation/relations/current')).headers['access-control-allow-origin'], undefined, 'facts API 不得继承静态资源 CORS');
  assert.equal((await request(port, '/events/unknown')).status, 404);
  assert.equal((await request(port, '/assets/missing-font.woff2')).status, 404);
  assert.equal((await request(port, '/assets/%2e%2e%2fpackage.json.woff2')).status, 404);
});
