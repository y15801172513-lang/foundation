import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import {createManagementCenterServer} from '@foundation/management-center';
import {readFacts, relationsVersion, sha256} from '@foundation/core';
import {EVENTS, copyProjectFixture, makeScopedTempDirectory, projectFixturePath, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {enableProjectFixture, installFoundationFixture} from '../helpers/authorized-project-fixture.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function request(port, {method = 'GET', pathname = '/', headers = {}, body = ''} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, method, path: pathname, headers}, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function confirmManager(pending) {
  const url = new URL(pending.managerUrl);
  const port = Number(url.port);
  const page = await request(port);
  const nonce = /name="managerNonce" value="([^"]+)"/u.exec(page.body)?.[1];
  assert.ok(nonce);
  return request(port, {method: 'POST', pathname: '/__foundation/manager/confirm', headers: {'content-type': 'application/json', origin: url.origin}, body: JSON.stringify({managerNonce: nonce, action: 'confirm-exact-operation'})});
}

test('关系 HTTP 写入执行方法、媒体、来源、nonce、JSON、schema 与冲突门禁', async (t) => {
  const temporary = makeScopedTempDirectory('project-authority-sandboxes', 'relation-http-017r1-'); t.after(() => removeTempDirectory(temporary));
  const installationRoot = installFoundationFixture(temporary);
  const project = projectFixturePath(temporary, 'project');
  copyProjectFixture(EVENTS, project);
  enableProjectFixture(project, installationRoot);
  const server = createManagementCenterServer(project, {installationRoot});
  t.after(() => server.close());
  const port = await listen(server);
  const origin = `http://127.0.0.1:${port}`;
  const html = (await request(port)).body;
  const nonce = JSON.parse(html.match(/window\.__FOUNDATION_WRITE_NONCE__=("[^"]+")/)[1]);
  const baseHeaders = {'content-type': 'application/json', origin, 'x-foundation-write-nonce': nonce};

  const method = await request(port, {method: 'GET', pathname: '/__foundation/relations'});
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, 'POST');
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {...baseHeaders, 'content-type': 'text/plain'}, body: '{}'})).status, 415);
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {...baseHeaders, 'content-type': 'application/json+evil'}, body: '{}'})).status, 415);
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {...baseHeaders, 'content-type': 'application/json; charset=utf-8'}, body: '{}'})).status, 422);
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {...baseHeaders, host: `localhost:${port}`, origin: `http://localhost:${port}`}, body: '{}'})).status, 422);
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {...baseHeaders, host: `evil.example:${port}`}, body: '{}'})).status, 403);
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {...baseHeaders, host: `127.0.0.1.nip.io:${port}`}, body: '{}'})).status, 403);
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {...baseHeaders, origin: 'null'}, body: '{}'})).status, 403);
  const {origin: _omittedOrigin, ...missingOriginHeaders} = baseHeaders;
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: missingOriginHeaders, body: '{}'})).status, 403);
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {...baseHeaders, origin: 'http://evil.example'}, body: '{}'})).status, 403);
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {...baseHeaders, 'x-foundation-write-nonce': 'wrong'}, body: '{}'})).status, 403);
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: baseHeaders, body: '{'})).status, 400);
  const invalidReferenceDraft = {from: 'page_events_home', to: 'missing'};
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: baseHeaders, body: JSON.stringify({draft: invalidReferenceDraft})})).status, 422);

  const staleVersion = relationsVersion(readFacts(project).relations);
  const draft = {from: 'page_events_manage', to: 'page_events_home', trigger: '返回首页'};
  const projectBeforeManagerConfirmation = sha256(fs.readFileSync(path.join(project, '.foundation', 'facts', 'relations.json')));
  const created = await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: baseHeaders, body: JSON.stringify({draft})});
  assert.equal(created.status, 202);
  const pending = JSON.parse(created.body);
  assert.equal(pending.state, 'pending-manager-confirmation');
  assert.equal(sha256(fs.readFileSync(path.join(project, '.foundation', 'facts', 'relations.json'))), projectBeforeManagerConfirmation);
  const confirmed = await confirmManager(pending);
  assert.equal(confirmed.status, 200, confirmed.body);
  assert.notEqual(relationsVersion(readFacts(project).relations), staleVersion);
  assert.equal((await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: baseHeaders, body: JSON.stringify({draft})})).status, 409);
  const staleDraft = {from: 'page_events_manage', to: 'page_events_home', trigger: '过期客户端', expectedVersion: staleVersion};
  const stale = await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: baseHeaders, body: JSON.stringify({draft: staleDraft})});
  assert.equal(stale.status, 409);
  const stalePayload = JSON.parse(stale.body);
  assert.equal(stalePayload.code, 'version_conflict');
  assert.equal(stalePayload.currentVersion, relationsVersion(readFacts(project).relations));
  assert.equal(stalePayload.refreshUrl, '/__foundation/relations/current');
  const refreshed = await request(port, {pathname: stalePayload.refreshUrl});
  assert.equal(refreshed.status, 200);
  assert.equal(JSON.parse(refreshed.body).version, stalePayload.currentVersion);
  const tooLarge = await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {...baseHeaders, 'content-length': '70000'}, body: 'x'.repeat(70000)});
  assert.equal(tooLarge.status, 413);

  const expectedVersion = relationsVersion(readFacts(project).relations);
  const concurrentBody = (trigger) => {
    const concurrentDraft = {from: 'page_events_manage', to: 'page_events_home', trigger, expectedVersion};
    return JSON.stringify({draft: concurrentDraft});
  };
  const concurrent = await Promise.all([request(port, {method: 'POST', pathname: '/__foundation/relations', headers: baseHeaders, body: concurrentBody('并发 A')}), request(port, {method: 'POST', pathname: '/__foundation/relations', headers: baseHeaders, body: concurrentBody('并发 B')})]);
  assert.deepEqual(concurrent.map((item) => item.status).sort(), [202, 202]);
  const confirmationResults = [];
  for (const response of concurrent) confirmationResults.push(await confirmManager(JSON.parse(response.body)));
  assert.deepEqual(confirmationResults.map((item) => item.status).sort(), [200, 409]);
});

test('关系持久化异常返回 500 而不是伪装成输入错误', async (t) => {
  const temporary = makeScopedTempDirectory('project-authority-sandboxes', 'relation-http-500-'); t.after(() => removeTempDirectory(temporary));
  const installationRoot = installFoundationFixture(temporary);
  const project = projectFixturePath(temporary, 'project');
  copyProjectFixture(EVENTS, project);
  enableProjectFixture(project, installationRoot);
  const server = createManagementCenterServer(project, {installationRoot});
  t.after(() => server.close());
  const port = await listen(server); const origin = `http://127.0.0.1:${port}`;
  const html = (await request(port)).body;
  const nonce = JSON.parse(html.match(/window\.__FOUNDATION_WRITE_NONCE__=("[^"]+")/)[1]);
  const draft = {from: 'page_events_home', to: 'page_events_manage'};
  fs.writeFileSync(path.join(project, '.foundation', 'facts', 'relations.json'), '{');
  const response = await request(port, {method: 'POST', pathname: '/__foundation/relations', headers: {'content-type': 'application/json', origin, 'x-foundation-write-nonce': nonce}, body: JSON.stringify({draft})});
  assert.equal(response.status, 500);
});
