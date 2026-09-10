import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertProjectMutationAuthority, createProjectMutationPlan, readFacts, readPreviewConfig, readRepositoryGitCommit, realProject, relationsVersion, verify} from '@foundation/core';
import {createLocalLifecycleManagerServer} from '../../../../packages/core/lifecycle-manager-host.mjs';
import {workspaceDocument, workspaceModelDocument} from './workspace-document.mjs';
import {inspectLocalLifecycle} from '../../../../packages/core/lifecycle-manager.mjs';
import {WORKSPACE_ASSETS} from './workspace-assets.mjs';

const DIST_ASSETS = path.resolve(import.meta.dirname, '../../dist/assets');
const BINARY_ASSETS = path.join(DIST_ASSETS, 'binary');
const CHUNK_ASSETS = path.join(DIST_ASSETS, 'chunks');
const MIME = new Map([['.css', 'text/css'], ['.js', 'text/javascript'], ['.mjs', 'text/javascript'], ['.html', 'text/html;charset=utf-8'], ['.json', 'application/json'], ['.woff2', 'font/woff2'], ['.woff', 'font/woff'], ['.png', 'image/png'], ['.svg', 'image/svg+xml']]);

function send(res, status, body, contentType = 'text/plain;charset=utf-8', headers = {}) {
  res.writeHead(status, {'content-type': contentType, 'cache-control': 'no-store', ...headers});
  res.end(body);
}

function sendFile(res, file, headers = {}) {
  send(res, 200, fs.readFileSync(file), MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream', headers);
}

class RequestError extends Error { constructor(status, message) { super(message); this.status = status; } }

function readJson(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > 65536) { req.resume(); reject(new RequestError(413, '请求过大')); return; }
    const chunks = []; let size = 0; let oversized = false;
    req.on('data', (chunk) => { size += chunk.length; if (size > 65536) oversized = true; else chunks.push(chunk); });
    req.on('end', () => {
      if (oversized) return reject(new RequestError(413, '请求过大'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new RequestError(400, '请求不是有效 JSON')); }
    });
    req.on('error', (error) => reject(new RequestError(400, error.message)));
  });
}

function relationErrorStatus(error, projectRoot) {
  if (String(error?.code || '').startsWith('HUMAN_AUTHORIZATION_')) return 403;
  if (error instanceof RequestError) return error.status;
  if (error?.code === 'PROJECT_HANDLER_BINDING_MISMATCH' || error?.code === 'PROJECT_HANDLER_WRITE_SET_MISMATCH') {
    try { readFacts(projectRoot); return 409; }
    catch { return 500; }
  }
  if (error?.code === 'duplicate' || error?.code === 'version_conflict' || error?.code === 'writer_locked' || error?.code === 'PROJECT_NOT_ENABLED') return 409;
  if (error?.code === 'schema') return 422;
  return 500;
}

function validateRelationPlanPreview(projectRoot, plan) {
  const facts = readFacts(projectRoot);
  const relations = facts.relations;
  const pages = new Set((facts.pages?.items || []).map((entry) => entry.id));
  const payload = plan.handler.payload;
  const currentVersion = relationsVersion(relations);
  if (payload.expectedVersion && payload.expectedVersion !== currentVersion) {
    const error = Object.assign(new Error('关系事实已更新，请刷新后重试'), {code: 'version_conflict', currentVersion});
    throw error;
  }
  if (!pages.has(payload.semantics.from) || !pages.has(payload.semantics.to)) throw Object.assign(new Error('关系引用了未登记页面'), {code: 'schema'});
  const same = (item) => Object.entries(payload.semantics).every(([field, value]) => (item[field] ?? null) === value);
  if ((relations.items || []).some(same)) throw Object.assign(new Error('完全相同的关系已登记'), {code: 'duplicate'});
  return {currentVersion};
}

function isJsonMediaType(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split(';');
  if (parts.shift()?.trim().toLowerCase() !== 'application/json') return false;
  const token = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
  const quoted = /^"(?:[\t !#-\[\]-~]|\\[\t !-~])*"$/u;
  return parts.every((part) => {
    const separator = part.indexOf('=');
    if (separator <= 0) return false;
    const name = part.slice(0, separator).trim();
    const parameter = part.slice(separator + 1).trim();
    return token.test(name) && (token.test(parameter) || quoted.test(parameter));
  });
}

function requestAuthorityAllowed(req, server) {
  const address = server.address();
  if (!address || typeof address === 'string') return false;
  const port = address.port;
  const host = String(req.headers.host || '').toLowerCase();
  if (!new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(host)) return false;
  const rawOrigin = req.headers.origin;
  if (typeof rawOrigin !== 'string' || rawOrigin === 'null') return false;
  try {
    const origin = new URL(rawOrigin);
    if (origin.protocol !== 'http:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return false;
    return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(origin.origin.toLowerCase());
  } catch { return false; }
}

function healthPayload(projectRoot) {
  return {
    ok: true,
    service: 'foundation-management-center',
    managedProject: process.env.FOUNDATION_PREVIEW_MANAGED_PROJECT || path.basename(projectRoot),
    port: Number(process.env.FOUNDATION_PREVIEW_PORT || 0) || null,
    processOwner: process.env.FOUNDATION_PREVIEW_OWNER || null,
    gitCommit: readRepositoryGitCommit(projectRoot)
  };
}

function requestPath(url) {
  const raw = String(url || '/').split('?')[0];
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) return null;
  return decoded;
}

function resolveBinary(pathname) {
  if (!pathname.startsWith(WORKSPACE_ASSETS.binaryPrefix)) return null;
  const relative = pathname.slice(WORKSPACE_ASSETS.binaryPrefix.length);
  if (!relative || relative.includes('/') || relative.includes('\\')) return null;
  const file = path.resolve(BINARY_ASSETS, relative);
  if (path.dirname(file) !== BINARY_ASSETS || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

function resolveChunk(pathname) {
  const prefix = [WORKSPACE_ASSETS.chunkPrefix, WORKSPACE_ASSETS.preloadChunkPrefix].find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return null;
  const relative = pathname.slice(prefix.length);
  if (!relative || !relative.endsWith('.js') || relative.includes('/') || relative.includes('\\')) return null;
  const file = path.resolve(CHUNK_ASSETS, relative);
  if (path.dirname(file) !== CHUNK_ASSETS || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

function resolveManagedFont(projectRoot, pathname) {
  const prefix = '/assets/';
  if (!pathname.startsWith(prefix)) return null;
  const relative = pathname.slice(prefix.length);
  if (!relative || !relative.endsWith('.woff2') || relative.includes('/') || relative.includes('\\')) return null;
  const assetRoot = path.resolve(projectRoot, 'dist', 'assets');
  if (!fs.existsSync(assetRoot) || !fs.statSync(assetRoot).isDirectory()) return null;
  const realAssetRoot = fs.realpathSync(assetRoot);
  const candidate = path.resolve(assetRoot, relative);
  if (path.dirname(candidate) !== assetRoot || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  const realFile = fs.realpathSync(candidate);
  if (path.dirname(realFile) !== realAssetRoot) return null;
  return realFile;
}

export function createManagementCenterServer(project, {installationRoot = null, validateContext = null} = {}) {
  const projectRoot = realProject(project);
  const verification = verify(projectRoot);
  if (!verification.ok) throw new Error(`项目校验失败：\n${verification.errors.join('\n')}`);
  const preview = readPreviewConfig(projectRoot);
  const writeNonce = crypto.randomBytes(18).toString('base64url');
  const managerServers = new Set();
  const declared = new Map([...preview.routes, ...preview.assets].map((entry) => [entry.path, entry.absoluteFile]));
  const server = http.createServer(async (req, res) => {
    try { validateContext?.(); }
    catch (error) { return send(res, 409, JSON.stringify({ok:false,message:error.message,mutationPerformed:false}), 'application/json;charset=utf-8'); }
    const pathname = requestPath(req.url);
    if (!pathname) return send(res, 404, '未找到预览资源');
    if (pathname === '/__foundation/health') return send(res, 200, JSON.stringify(healthPayload(projectRoot)), 'application/json;charset=utf-8');
    if (pathname === '/__foundation/relations/current') {
      if (req.method !== 'GET') { res.setHeader('allow', 'GET'); return send(res, 405, JSON.stringify({ok: false, error: '仅允许 GET'}), 'application/json;charset=utf-8'); }
      const relations = readFacts(projectRoot).relations;
      return send(res, 200, JSON.stringify({ok: true, relations: relations.items || [], version: relationsVersion(relations)}), 'application/json;charset=utf-8');
    }
    if (pathname === '/__foundation/relations') {
      if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(res, 405, JSON.stringify({ok: false, error: '仅允许 POST'}), 'application/json;charset=utf-8'); }
      if (!isJsonMediaType(req.headers['content-type'])) return send(res, 415, JSON.stringify({ok: false, error: '需要 application/json'}), 'application/json;charset=utf-8');
      if (!requestAuthorityAllowed(req, server) || req.headers['x-foundation-write-nonce'] !== writeNonce) return send(res, 403, JSON.stringify({ok: false, error: '写入来源或凭据无效'}), 'application/json;charset=utf-8');
      try {
        assertProjectMutationAuthority(projectRoot, {installationRoot, capability: 'management-center-relation-write'});
        const body = await readJson(req);
        const draft = body && typeof body === 'object' && body.draft ? body.draft : body;
        const plan = createProjectMutationPlan({operation: 'relation-facts-write', project: projectRoot, installationRoot, handlerPayload: {draft, generatedAt: new Date().toISOString()}, preserves: ['project-code', '.foundation/identity', '.foundation/facts except exact relations.json', '.foundation/backups', 'unknown-and-user-modified-files']});
        validateRelationPlanPreview(projectRoot, plan);
        const manager = createLocalLifecycleManagerServer({plan, stateRoot: path.join(installationRoot, 'state', 'local-manager')});
        managerServers.add(manager);
        manager.once('close', () => managerServers.delete(manager));
        await new Promise((resolve, reject) => { manager.once('error', reject); manager.listen(0, '127.0.0.1', resolve); });
        return send(res, 202, JSON.stringify({ok: true, state: 'pending-manager-confirmation', managerUrl: `http://127.0.0.1:${manager.address().port}/`, sessionId: manager.managerSession.sessionId, planHash: plan.integrity.hash, mutationPerformed: false}), 'application/json;charset=utf-8');
      } catch (error) {
        const conflict = error?.code === 'version_conflict' ? {currentVersion: error.currentVersion || relationsVersion(readFacts(projectRoot).relations), refreshUrl: '/__foundation/relations/current'} : {};
        return send(res, relationErrorStatus(error, projectRoot), JSON.stringify({ok: false, error: error.message, code: error?.code || 'io', ...conflict}), 'application/json;charset=utf-8');
      }
    }
    if (pathname === '/' || pathname === '/index.html') return send(res, 200, workspaceDocument(readFacts(projectRoot), preview, {writeNonce}), 'text/html;charset=utf-8');
    if (pathname === WORKSPACE_ASSETS.script) return sendFile(res, path.join(DIST_ASSETS, 'workspace.js'));
    if (pathname === WORKSPACE_ASSETS.stylesheet) return sendFile(res, path.join(DIST_ASSETS, 'workspace.css'));
    const chunk = resolveChunk(pathname);
    if (chunk) return sendFile(res, chunk);
    const binary = resolveBinary(pathname);
    if (binary) return sendFile(res, binary);
    const managedFont = resolveManagedFont(projectRoot, pathname);
    if (managedFont) return sendFile(res, managedFont, {'access-control-allow-origin': '*'});
    const declaredFile = declared.get(pathname);
    if (declaredFile) return sendFile(res, declaredFile, {'access-control-allow-origin': '*'});
    return send(res, 404, '未找到预览资源');
  });
  server.on('close', () => { for (const manager of managerServers) manager.close(); managerServers.clear(); });
  return server;
}

export function listenManagementCenter(project, port = 4173, options = {}) {
  const server = createManagementCenterServer(project, options);
  server.once('error', (error) => {
    console.error(`管理中心启动失败：${error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用` : error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`管理中心：http://127.0.0.1:${port}`));
  return server;
}

// The installed entry reuses the original workspace, never a second home page.
// No project argument means the original empty canvas, without scanning or enabling.
export function createInstalledWorkbenchServer({installationRoot, project = null}) {
  let identity = null;
  const read = () => {
    if (!installationRoot) throw new Error('缺少安装位置；请先核验安装定位记录，不猜测或扫描');
    const state = inspectLocalLifecycle({installationRoot});
    if (!state.installation?.current || state.bridge?.installationHealth?.code !== 'FOUNDATION_HEALTHY') throw new Error('已安装工作台不可用：安装身份或健康核验未通过；请只读检查状态');
    const currentIdentity = JSON.stringify(state.installation.current);
    if (identity !== null && currentIdentity !== identity) throw new Error('安装版本或身份已变化；请从稳定入口重新打开工作台');
    identity = currentIdentity;
    return state;
  };
  read();
  if (project) {
    const validateContext = () => {
      read();
      const binding = inspectLocalLifecycle({installationRoot, project}).project;
      if (binding?.state !== 'enabled' || !binding.agreement) throw new Error('项目未接入此安装或绑定已失效；请先只读核验，再单独确认接入');
    };
    validateContext();
    return createManagementCenterServer(project, {installationRoot, validateContext});
  }
  return http.createServer((req, res) => {
    if (req.method !== 'GET') return send(res, 405, '未选择项目的工作台只读');
    try {
      const state = read();
      const pathname = requestPath(req.url);
      if (pathname === '/__foundation/installed-status') return send(res, 200, JSON.stringify(state), 'application/json;charset=utf-8');
      if (pathname === '/' || pathname === '/index.html') return send(res, 200, workspaceModelDocument({project:{name:'Foundation'}, pages:[], relations:[], components:[], assets:[], changes:[], interactions:[], preview:{mode:'local-static',allowedOrigins:['self']}, projectSelected:false}), 'text/html;charset=utf-8');
      if (pathname === WORKSPACE_ASSETS.script) return sendFile(res, path.join(DIST_ASSETS, 'workspace.js'));
      if (pathname === WORKSPACE_ASSETS.stylesheet) return sendFile(res, path.join(DIST_ASSETS, 'workspace.css'));
      const asset = resolveChunk(pathname) || resolveBinary(pathname);
      if (asset) return sendFile(res, asset);
      return send(res, 404, '未找到工作台资源');
    } catch (error) { return send(res, 409, JSON.stringify({ok:false,message:error.message,mutationPerformed:false}), 'application/json;charset=utf-8'); }
  });
}
