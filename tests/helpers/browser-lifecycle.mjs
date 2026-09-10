import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exited = (child) => child.exitCode !== null || child.signalCode !== null;

export async function terminateBrowser(child, {graceMs = 3000, escalationMs = 3000} = {}) {
  async function wait(ms) {
    if (exited(child)) return true;
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); child.removeListener('exit', done); resolve(true); };
      const timer = setTimeout(() => { child.removeListener('exit', done); resolve(exited(child)); }, ms);
      child.once('exit', done);
      if (exited(child)) done();
    });
  }
  if (!exited(child)) child.kill('SIGTERM');
  if (!await wait(graceMs)) {
    child.kill('SIGKILL');
    if (!await wait(escalationMs)) throw new Error('浏览器强制终止后仍未实际退出');
  }
  return {pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode};
}

export async function retryProfileRemoval(remove, {attempts = 10, intervalMs = 100} = {}) {
  // Chromium filesystem handles may release shortly after process exit.
  // Permission, containment and all other errors are never retried.
  for (let attempt = 0; ; attempt++) {
    try { return remove(); }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY'].includes(error.code) || attempt + 1 >= attempts) throw error;
      await delay(intervalMs);
    }
  }
}

function assertContainedProfile(temporary, profile, root) {
  for (const p of [root, temporary, profile]) {
    if (fs.lstatSync(p).isSymbolicLink() || fs.realpathSync(p) !== p || !fs.statSync(p).isDirectory()) throw new Error('浏览器 profile 必须是无符号链接真实目录');
  }
  for (const [parent, child] of [[root, temporary], [temporary, profile]]) {
    const rel = path.relative(parent, child);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('浏览器 profile 逃出测试拥有根');
  }
}

export async function cleanupBrowser({child, devtools, server, temporary, profile, root, remove, diagnostic = () => {}}) {
  assertContainedProfile(temporary, profile, root);
  const failures = [];
  try { await devtools?.close(); } catch (e) { failures.push(e); }
  try { diagnostic({browserExit: await terminateBrowser(child)}); } catch (e) { failures.push(e); }
  if (server) {
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('测试服务器关闭超时')), 3000);
        server.close((error) => { clearTimeout(timer); if (error) reject(error); else resolve(); });
        server.closeAllConnections();
      });
    } catch (e) { failures.push(e); }
  }
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try {
      let remaining;
      for (let attempt = 0; attempt < 30; attempt++) {
        remaining = execFileSync('/bin/ps', ['-axo', 'pid=,command='], {encoding: 'utf8', timeout: 3000})
          .split('\n').filter((line) => line.includes(`--user-data-dir=${profile}`));
        if (!remaining.length) break;
        await delay(100);
      }
      if (remaining.length) throw new Error('测试 profile 仍有浏览器子进程；保留 profile');
      diagnostic({ownedProfileProcesses: 0});
    } catch (e) { failures.push(e); }
  }
  if (failures.length) throw new AggregateError(failures, '浏览器生命周期清理失败；保留现场');
  assertContainedProfile(temporary, profile, root);
  await retryProfileRemoval(remove);
  if (fs.existsSync(temporary)) throw new Error('浏览器 profile 清理后仍存在');
}

export async function connectDevtools(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('DevTools 连接超时')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接浏览器 DevTools')); }, {once: true});
  });
  let sequence = 0;
  const pending = new Map();
  const listeners = new Set();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) { events.push(message); for (const listener of [...listeners]) listener(message); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), {cdpCode: message.error.code}));
    else request.resolve(message.result);
  });
  return {
    events,
    call(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools 命令超时：${method}`)); }, 10000);
        pending.set(id, {resolve, reject, timer});
        socket.send(JSON.stringify({id, method, params}));
      });
    },
    expectEvent(method, predicate = () => true) {
      let listener, timer;
      const promise = new Promise((resolve, reject) => {
        listener = (message) => { if (message.method === method && predicate(message.params)) { clearTimeout(timer); listeners.delete(listener); resolve(message.params); } };
        listeners.add(listener);
        timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`DevTools 事件超时：${method}`)); }, 10000);
      });
      return {promise, cancel() { clearTimeout(timer); listeners.delete(listener); }};
    },
    async close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('DevTools 已关闭')); }
      pending.clear();
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('DevTools 关闭超时')), 3000);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, {once: true});
        socket.close();
      });
    },
  };
}

export async function evaluate(devtools, expression, contextId) {
  const result = await devtools.call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, ...(contextId ? {contextId} : {})});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || '浏览器表达式执行失败');
  return result.result.value;
}

export function isNavigationContextError(error) {
  return error?.cdpCode === -32000 && /^(?:Cannot find context with specified id|Execution context was destroyed\.?|Inspected target navigated or closed|Cannot find default execution context)$/u.test(error.message);
}

export async function reloadAndWait(devtools) {
  const before = (await devtools.call('Page.getFrameTree')).frameTree.frame;
  // All subscriptions precede reload, including synchronously emitted events.
  const navigation = devtools.expectEvent('Page.frameNavigated', (p) => p.frame.id === before.id && p.frame.loaderId !== before.loaderId);
  const loaded = devtools.expectEvent('Page.loadEventFired');
  const context = devtools.expectEvent('Runtime.executionContextCreated', (p) => p.context.auxData?.isDefault && p.context.auxData?.frameId === before.id);
  try {
    const events = Promise.all([navigation.promise, loaded.promise, context.promise]);
    await Promise.all([devtools.call('Page.reload'), events]);
    const [, , created] = await events;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if (await evaluate(devtools, 'document.readyState === "complete" && Boolean(document.documentElement)', created.context.id)) return;
      } catch (error) { if (!isNavigationContextError(error)) throw error; }
      await delay(50);
    }
    throw new Error('刷新后新文档执行上下文等待超时');
  } finally { navigation.cancel(); loaded.cancel(); context.cancel(); }
}
