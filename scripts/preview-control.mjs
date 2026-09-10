import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readRepositoryGitCommit} from '@foundation/core/git-identity';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANAGED_PROJECT = 'foundation-events';
export const PREVIEW_PORT = 4317;
export const HEALTH_PATH = '/__foundation/health';

function stateDirectory() {
  return path.join(os.tmpdir(), 'ai-product-foundation-kit');
}

export function stateFileFor(root = ROOT) {
  const identity = crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
  return path.join(stateDirectory(), `preview-${identity}.json`);
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(state, null, 2), {mode: 0o600});
}

function readState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return state && typeof state === 'object' ? state : null;
  } catch { return null; }
}

function removeState(file) {
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export function requestHealth(port, timeout = 700) {
  return new Promise((resolve) => {
    const request = http.get({host: '127.0.0.1', port, path: HEALTH_PATH, timeout}, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); }
      });
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(null));
  });
}

export function isOwnedHealth(health, owner, port, expectedCommit) {
  return Boolean(health
    && health.ok === true
    && health.service === 'foundation-management-center'
    && health.managedProject === MANAGED_PROJECT
    && health.port === port
    && health.processOwner === owner
    && /^[0-9a-f]{40}$/iu.test(expectedCommit || '')
    && health.gitCommit === expectedCommit);
}

export function isRecoverableHealth(health, port, expectedCommit) {
  return Boolean(health
    && health.ok === true
    && health.service === 'foundation-management-center'
    && health.managedProject === MANAGED_PROJECT
    && health.port === port
    && typeof health.processOwner === 'string'
    && health.processOwner.length > 0
    && /^[0-9a-f]{40}$/iu.test(expectedCommit || '')
    && health.gitCommit === expectedCommit);
}

function listeningPids(port) {
  const result = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {encoding: 'utf8', timeout: 1200, windowsHide: true});
  if (result.error || result.status !== 0) return [];
  return String(result.stdout || '').split(/\s+/u).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
}

function processCommand(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {encoding: 'utf8', timeout: 1200, windowsHide: true});
  if (result.error || result.status !== 0) return null;
  const command = String(result.stdout || '').trim();
  return command || null;
}

export function commandIdentifiesManagedPreview(command, root, port) {
  if (typeof command !== 'string') return false;
  const cli = path.join(root, 'packages', 'cli', 'index.mjs');
  const project = path.join(root, 'examples', MANAGED_PROJECT);
  return command.includes(cli)
    && command.includes(project)
    && /(?:^|\s)center(?:\s|$)/u.test(command)
    && new RegExp(`(?:^|\\s)--port\\s+${port}(?:\\s|$)`, 'u').test(command);
}

export function findRecoverableManagedPreviewPid({root = ROOT, port = PREVIEW_PORT, health, expectedCommit, findPids = listeningPids, readCommand = processCommand} = {}) {
  if (!isRecoverableHealth(health, port, expectedCommit)) return null;
  const matches = findPids(port).filter((pid) => commandIdentifiesManagedPreview(readCommand(pid), root, port));
  return matches.length === 1 ? matches[0] : null;
}

export function portIsAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (error) => resolve(error.code === 'EADDRINUSE' ? false : null));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

function requiredArtifacts(root) {
  return [
    path.join(root, 'package.json'),
    path.join(root, 'packages/cli/index.mjs'),
    path.join(root, 'apps/management-center/dist/assets/workspace.js'),
    path.join(root, 'apps/management-center/dist/assets/workspace.css'),
    path.join(root, 'examples/foundation-events/.foundation/preview.json'),
    path.join(root, 'examples/foundation-events/dist/index.html'),
    path.join(root, 'examples/foundation-events/dist/assets/events-app.js'),
    path.join(root, 'examples/foundation-events/dist/assets/events-app.css')
  ];
}

export function validateEnvironment(root = ROOT) {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < 20) throw new Error(`需要 Node.js 20+，当前为 ${process.version}`);
  const missing = requiredArtifacts(root).filter((file) => !fs.existsSync(file));
  return {missing};
}

export function npmExecutableFor(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function restoreArtifacts(root = ROOT, output = console) {
  const {missing} = validateEnvironment(root);
  if (!missing.length) return {restored: false};
  output.log('关键预览产物缺失，正在执行必要构建恢复…');
  const npm = npmExecutableFor();
  const result = spawnSync(npm, ['run', 'build'], {cwd: root, stdio: 'inherit', windowsHide: true});
  if (result.error) throw new Error(`构建恢复无法启动：${result.error.message}`);
  if (result.status !== 0) throw new Error('构建恢复失败，请先运行 npm run build 查看详细原因');
  const after = validateEnvironment(root).missing;
  if (after.length) throw new Error(`构建后仍缺少关键预览产物：${after.map((file) => path.basename(file)).join('、')}`);
  return {restored: true};
}

export function previewCommand(root = ROOT, port = PREVIEW_PORT) {
  return {command: process.execPath, args: [path.join(root, 'packages/cli/index.mjs'), 'center', path.join(root, 'examples', MANAGED_PROJECT), '--port', String(port)]};
}

function defaultSpawn(root, port, owner) {
  const command = previewCommand(root, port);
  return spawn(command.command, command.args, {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {...process.env, FOUNDATION_PREVIEW_OWNER: owner, FOUNDATION_PREVIEW_MANAGED_PROJECT: MANAGED_PROJECT, FOUNDATION_PREVIEW_PORT: String(port)}
  });
}

async function waitFor(check, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

export function createPreviewController({root = ROOT, port = PREVIEW_PORT, stateFile = stateFileFor(root), spawnProcess = defaultSpawn, recoverPid = findRecoverableManagedPreviewPid} = {}) {
  const project = path.join(root, 'examples', MANAGED_PROJECT);
  async function status() {
    const expectedCommit = readRepositoryGitCommit(root);
    if (!expectedCommit) return {state: 'error', message: '无法确认 Foundation Git HEAD，拒绝识别或复用预览进程'};
    const state = readState(stateFile);
    const health = await requestHealth(port);
    if (state && isOwnedHealth(health, state.owner, port, expectedCommit) && isPidAlive(state.pid)) return {state: 'running', health, pid: state.pid, reused: true};
    const available = await portIsAvailable(port);
    if (state) removeState(stateFile);
    const pid = recoverPid({root, port, health, expectedCommit});
    if (pid && isPidAlive(pid)) return {state: 'recoverable', health, pid, message: '发现可验证的遗留 Foundation 工作台，可由 preview:stop 安全关闭'};
    if (available === false) return {state: 'conflict', health, message: `端口 ${port} 已被其他程序占用，未执行关闭操作`};
    if (available === null) return {state: 'error', message: `无法检查端口 ${port}，请检查本机网络权限`};
    return {state: 'stopped', message: 'Foundation 工作台未运行'};
  }

  async function start(output = console) {
    restoreArtifacts(root, output);
    let before = await status();
    if (before.state === 'running') return before;
    if (before.state === 'recoverable') {
      output.log('正在优雅关闭可验证的遗留 Foundation 工作台…');
      const stopped = await stop();
      if (stopped.state !== 'stopped') throw new Error(stopped.message || '无法关闭遗留 Foundation 工作台');
      before = await status();
    }
    if (before.state === 'conflict') throw new Error(before.message);
    if (before.state === 'error') throw new Error(before.message);
    output.log(`正在启动 Foundation 工作台（管理项目：${MANAGED_PROJECT}）…`);
    const owner = crypto.randomUUID();
    const child = spawnProcess(root, port, owner);
    if (!child || !Number.isInteger(child.pid)) throw new Error('预览进程未能创建，请检查 Node.js 与项目文件');
    child.unref?.();
    writeState(stateFile, {version: 1, pid: child.pid, owner, port, managedProject: MANAGED_PROJECT, createdAt: new Date().toISOString()});
    const expectedCommit = readRepositoryGitCommit(root);
    if (!expectedCommit) {
      removeState(stateFile);
      try { process.kill(child.pid, 'SIGTERM'); } catch {}
      throw new Error('无法确认 Foundation Git HEAD，已终止新建预览进程');
    }
    const health = await waitFor(async () => {
      if (!isPidAlive(child.pid)) return null;
      const result = await requestHealth(port);
      return isOwnedHealth(result, owner, port, expectedCommit) ? result : null;
    });
    if (!health) {
      removeState(stateFile);
      throw new Error(`Foundation 工作台未能在端口 ${port} 通过健康检查；请运行 npm run preview:status 查看占用状态`);
    }
    return {state: 'running', health, pid: child.pid, reused: false};
  }

  async function stop() {
    const state = readState(stateFile);
    if (!state) {
      const expectedCommit = readRepositoryGitCommit(root);
      const health = expectedCommit ? await requestHealth(port) : null;
      const pid = recoverPid({root, port, health, expectedCommit});
      if (pid && isPidAlive(pid)) {
        try { process.kill(pid, 'SIGTERM'); } catch (error) { throw new Error(`无法关闭可验证的遗留 Foundation 工作台：${error.message}`); }
        const stopped = await waitFor(async () => !isPidAlive(pid), 3500);
        if (!stopped) return {state: 'recoverable', message: '可验证的遗留 Foundation 工作台未在预期时间内退出；请稍后再次执行 preview:stop'};
        return {state: 'stopped', message: '已关闭可验证的遗留 Foundation 工作台'};
      }
      const available = await portIsAvailable(port);
      if (available === false) return {state: 'conflict', message: `端口 ${port} 有未知进程占用，未执行关闭操作`};
      return {state: 'stopped', message: '没有由本项目启动的 Foundation 工作台'};
    }
    const health = await requestHealth(port);
    const expectedCommit = readRepositoryGitCommit(root);
    if (!isOwnedHealth(health, state.owner, port, expectedCommit) || !isPidAlive(state.pid)) {
      removeState(stateFile);
      return {state: 'stale', message: '本项目预览记录已失效，未关闭端口上的未知进程'};
    }
    try { process.kill(state.pid, 'SIGTERM'); } catch (error) { throw new Error(`无法关闭本项目预览进程：${error.message}`); }
    const stopped = await waitFor(async () => !isPidAlive(state.pid), 3500);
    if (!stopped) throw new Error('本项目预览进程未在预期时间内退出；控制记录已保留，可稍后再次执行 preview:stop');
    removeState(stateFile);
    return {state: 'stopped', message: 'Foundation 工作台已关闭'};
  }

  return {project, port, stateFile, status, start, stop};
}

export function formatPreviewResult(result) {
  if (result.state === 'running') return `Foundation 工作台已启动\n地址：http://127.0.0.1:${result.health.port}/\n管理项目：${MANAGED_PROJECT}${result.reused ? '\n已复用现有本项目进程' : ''}`;
  return result.message;
}
