import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import {readRepositoryGitCommit} from '@foundation/core/git-identity';
import {createManagementCenterServer} from '@foundation/management-center';
import {commandIdentifiesManagedPreview, createPreviewController, findRecoverableManagedPreviewPid, MANAGED_PROJECT, npmExecutableFor, portIsAvailable, previewCommand, ROOT, stateFileFor} from '../../scripts/preview-control.mjs';
import {DEMO, EVENTS, makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({host: '127.0.0.1', port, path: pathname}, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error', reject);
  });
}

test('固定预览默认管理 foundation-events，且根地址是 Foundation 外层工作台', async (t) => {
  const temporary = makeTempDirectory('preview-entry-default-');
  const controller = createPreviewController({stateFile: path.join(temporary, 'state.json')});
  assert.equal(controller.project, EVENTS);
  assert.notEqual(controller.project, DEMO);
  const server = createManagementCenterServer(EVENTS);
  t.after(() => { server.close(); removeTempDirectory(temporary); });
  const port = await listen(server);
  const root = await request(port, '/');
  assert.equal(root.status, 200);
  assert.match(root.body, /Foundation 工作台/);
  assert.match(root.body, /__foundation\/workspace\.js/);
  assert.match(root.body, /foundation-events/);
});

test('健康检查不暴露本机路径，并包含工作台安全身份字段', async (t) => {
  const priorOwner = process.env.FOUNDATION_PREVIEW_OWNER;
  const priorProject = process.env.FOUNDATION_PREVIEW_MANAGED_PROJECT;
  const priorPort = process.env.FOUNDATION_PREVIEW_PORT;
  process.env.FOUNDATION_PREVIEW_OWNER = 'test-owner';
  process.env.FOUNDATION_PREVIEW_MANAGED_PROJECT = MANAGED_PROJECT;
  const server = createManagementCenterServer(EVENTS);
  t.after(() => {
    server.close();
    if (priorOwner === undefined) delete process.env.FOUNDATION_PREVIEW_OWNER; else process.env.FOUNDATION_PREVIEW_OWNER = priorOwner;
    if (priorProject === undefined) delete process.env.FOUNDATION_PREVIEW_MANAGED_PROJECT; else process.env.FOUNDATION_PREVIEW_MANAGED_PROJECT = priorProject;
    if (priorPort === undefined) delete process.env.FOUNDATION_PREVIEW_PORT; else process.env.FOUNDATION_PREVIEW_PORT = priorPort;
  });
  const port = await listen(server);
  process.env.FOUNDATION_PREVIEW_PORT = String(port);
  const response = await request(port, '/__foundation/health');
  const health = JSON.parse(response.body);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(health).sort(), ['gitCommit', 'managedProject', 'ok', 'port', 'processOwner', 'service']);
  assert.equal(health.managedProject, MANAGED_PROJECT);
  assert.equal(health.port, port);
  assert.equal(health.processOwner, 'test-owner');
  const repositoryCommit = readRepositoryGitCommit(ROOT);
  assert.equal(health.gitCommit, repositoryCommit);
  if (repositoryCommit) {
    assert.match(health.gitCommit, /^[0-9a-f]{40}$/u);
  } else {
    const provenance = JSON.parse(fs.readFileSync(path.join(ROOT, 'PUBLIC_PROVENANCE.json'), 'utf8'));
    assert.match(provenance.approvedPrivateSourceCommit, /^[0-9a-f]{40}$/u);
    assert.equal(health.gitCommit, null, 'Git-less or unborn checkout must not invent a live HEAD');
  }
  assert.ok(!response.body.includes(EVENTS));
});

test('重复启动复用本项目进程，status 正常，stop 只关闭本项目进程', async (t) => {
  const port = await availablePort();
  const temporary = makeTempDirectory('preview-entry-owned-');
  const stateFile = path.join(temporary, 'state.json');
  const controller = createPreviewController({port, stateFile});
  t.after(async () => { await controller.stop(); removeTempDirectory(temporary); });
  const first = await controller.start({log() {}});
  assert.equal(first.state, 'running');
  assert.equal(first.reused, false);
  const second = await controller.start({log() {}});
  assert.equal(second.state, 'running');
  assert.equal(second.reused, true);
  assert.equal(first.pid, second.pid);
  assert.equal(second.health.gitCommit, readRepositoryGitCommit(ROOT));
  assert.equal((await controller.status()).state, 'running');
  assert.equal((await request(port, '/')).status, 200);
  assert.equal((await controller.stop()).state, 'stopped');
  assert.equal((await controller.status()).state, 'stopped');
});

test('未运行与未知端口占用可区分，stop 不关闭未知进程', async (t) => {
  const port = await availablePort();
  const temporary = makeTempDirectory('preview-entry-conflict-');
  const stateFile = path.join(temporary, 'state.json');
  const controller = createPreviewController({port, stateFile});
  assert.equal((await controller.status()).state, 'stopped');
  const unknown = net.createServer((socket) => socket.end('unknown'));
  t.after(() => { unknown.close(); removeTempDirectory(temporary); });
  await new Promise((resolve, reject) => {
    unknown.once('error', reject);
    unknown.listen(port, '127.0.0.1', resolve);
  });
  const conflict = await controller.status();
  assert.equal(conflict.state, 'conflict');
  assert.equal((await controller.stop()).state, 'conflict');
  assert.equal(await portIsAvailable(port), false);
});

test('失效控制记录会在端口空闲时自动清理', async (t) => {
  const port = await availablePort();
  const temporary = makeTempDirectory('preview-entry-stale-');
  t.after(() => removeTempDirectory(temporary));
  const stateFile = path.join(temporary, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({version: 1, pid: 99999999, owner: 'stale-owner', port, managedProject: MANAGED_PROJECT}));
  const controller = createPreviewController({port, stateFile});
  assert.equal((await controller.status()).state, 'stopped');
  assert.equal(fs.existsSync(stateFile), false);
});

test('仅可证明为当前项目 CLI 的遗留工作台可被恢复识别', () => {
  const port = 4317;
  const expectedCommit = readRepositoryGitCommit(ROOT);
  const health = {ok: true, service: 'foundation-management-center', managedProject: MANAGED_PROJECT, port, processOwner: 'legacy-owner', gitCommit: expectedCommit};
  const command = `${process.execPath} ${path.join(ROOT, 'packages/cli/index.mjs')} center ${EVENTS} --port ${port}`;
  assert.equal(commandIdentifiesManagedPreview(command, ROOT, port), true);
  assert.equal(findRecoverableManagedPreviewPid({root: ROOT, port, health, expectedCommit, findPids: () => [2654], readCommand: () => command}), 2654);
  assert.equal(findRecoverableManagedPreviewPid({root: ROOT, port, health, expectedCommit, findPids: () => [2654], readCommand: () => `${process.execPath} unrelated --port ${port}`}), null);
  assert.equal(findRecoverableManagedPreviewPid({root: ROOT, port, health: {...health, processOwner: ''}, expectedCommit, findPids: () => [2654], readCommand: () => command}), null);
});

test('空格路径和 Windows/macOS 命令选择不依赖 shell', () => {
  const rootWithSpaces = path.join('/tmp', 'Foundation Preview Space');
  const command = previewCommand(rootWithSpaces, 4317);
  assert.equal(command.command, process.execPath);
  assert.ok(command.args.includes(path.join(rootWithSpaces, 'examples', MANAGED_PROJECT)));
  assert.ok(!command.args.join('\n').includes('&&'));
  assert.equal(npmExecutableFor('win32'), 'npm.cmd');
  assert.equal(npmExecutableFor('darwin'), 'npm');
  assert.equal(npmExecutableFor('linux'), 'npm');
  assert.match(stateFileFor(rootWithSpaces), /ai-product-foundation-kit/);
  assert.ok(!stateFileFor(rootWithSpaces).includes('Foundation Preview Space'));
  assert.equal(ROOT, path.resolve(ROOT));
});
