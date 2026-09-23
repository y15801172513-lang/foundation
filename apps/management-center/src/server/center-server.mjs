import {browserRequirementDigest,browserConfigurationInputs,currentEvidenceInputs} from '@foundation/core';
import {projectSemanticRevision} from '../../../../packages/core/workspace-host.mjs';
import {captureProjectRoundInputs, projectRuntimeDigest} from '@foundation/core';
import {observeWorkbenchCapabilities} from './preview-capability-observer.mjs';
import {synchronizeProject, inspectSyncSources} from '../../../../packages/core/workspace-host.mjs';
import {applyProjectMutationPlan, inspectProjectAuthority} from '../../../../packages/core/workspace-host.mjs';
import fs from 'node:fs';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {connectDevtools, evaluate, cleanupBrowser} from '../../../../packages/core/workspace-host.mjs';
import {browserLaunchContract, waitForBrowserDevtoolsPort} from '../../../../packages/core/workspace-host.mjs';
import {signTrustedPayload} from '../../../../packages/core/workspace-host.mjs';
import {canonicalStringify, sha256} from '@foundation/core';
import {evidenceInputFingerprint, evidenceSubjectFingerprint, factImplementationInputs} from '@foundation/core';
import {openOrReuseWorkbench} from '../../../../packages/core/workspace-host.mjs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertProjectMutationAuthority, createProjectMutationPlan, readFacts, readPreviewConfig, readRepositoryGitCommit, realProject, relationsVersion, verify} from '@foundation/core';
import {createLocalLifecycleManagerServer} from '../../../../packages/core/lifecycle-manager-host.mjs';
import {workspaceDocument, workspaceModelDocument} from './workspace-document.mjs';
import {inspectLocalLifecycle} from '@foundation/core';
import {WORKSPACE_ASSETS} from './workspace-assets.mjs';
import {readProjectPolicyForDisplay, projectWithEffectivePolicy, validateFacts, inspectProjectDeliveryFiles} from '@foundation/core';
import {createWorkbenchRuntime} from '../../../../packages/core/workspace-host.mjs';
import {prepareWorkbenchSnapshot} from './workbench-snapshot.mjs';

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

function snapshotResponse(req,res,runtime) {
  let current;
  try{current=runtime.request();}catch(error){send(res,409,JSON.stringify({ok:false,message:error.message,...runtime.inspect()}),'application/json');return;}
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/__foundation/revision')return send(res,200,JSON.stringify(runtime.inspect()),'application/json');
  if(url.pathname==='/__foundation/health')return send(res,200,JSON.stringify({ok:true,service:'foundation-management-center',...runtime.inspect()}),'application/json');
  if(url.pathname==='/__foundation/model') {
    const selected=runtime.generation(url.searchParams.get('revision') || current.revision);
    return selected?send(res,200,JSON.stringify(selected.model),'application/json'):send(res,409,JSON.stringify({state:'reload-required'}),'application/json');
  }
  let selected=url.searchParams.has('revision')?runtime.generation(url.searchParams.get('revision')):current,pathname=requestPath(req.url);
  const generation=/^\/__foundation\/g\/([a-f0-9]{64})(\/.*)$/u.exec(pathname || '');
  if(generation){selected=runtime.generation(generation[1]);pathname=generation[2];}
  else if(req.headers.referer) {
    try{const ref=new URL(req.headers.referer);const match=/^\/__foundation\/g\/([a-f0-9]{64})\//u.exec(ref.pathname);if(ref.host===req.headers.host){if(match)selected=runtime.generation(match[1]);else if(ref.searchParams.has('revision'))selected=runtime.generation(ref.searchParams.get('revision'));}}catch{}
  }
  if(!selected)return send(res,409,JSON.stringify({state:'reload-required',message:'旧版本资源已淘汰，请重新载入工作台'}),'application/json');
  const versionHtml=bytes=>String(bytes).replace(/((?:src|href)=["'])\/(?!\/)/gu,`$1/__foundation/g/${selected.revision}/`);
  if(pathname==='/'||pathname==='/index.html')return send(res,200,versionHtml(selected.html),'text/html;charset=utf-8',{'x-foundation-revision':selected.revision});
  if(pathname==='/__foundation/relations/current')return send(res,200,JSON.stringify({ok:true,relations:selected.model.relations,version:selected.model.relationsVersion}),'application/json');
  if(pathname==='/__foundation/installed-status')return send(res,200,JSON.stringify(runtime.inspect()),'application/json');
  const entry=selected.resourceBytes[pathname];
  if(entry)return send(res,200,entry.mime.startsWith('text/html')?versionHtml(entry.bytes):entry.bytes,entry.mime,{'x-foundation-revision':selected.revision,'access-control-allow-origin':'*'});
  return send(res,404,'未找到当前完整版本中的资源');
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

export function createManagementCenterServer(project, {installationRoot = null, validateContext = null, runtime = null, runtimeWriteNonce = null} = {}) {
  const projectRoot = realProject(project);
  if (installationRoot && !runtime) synchronizeProject({project:projectRoot,installationRoot,trigger:'workbench-start'});
  const withoutPreview = installationRoot && !fs.existsSync(path.join(projectRoot, '.foundation/preview.json'));
  const errors = withoutPreview ? validateFacts(readFacts(projectRoot), {projectRoot}) : null;
  const verification = withoutPreview ? {ok: errors.length === 0, errors} : verify(projectRoot);
  if (!verification.ok) throw new Error(`项目校验失败：\n${verification.errors.join('\n')}`);
  const preview = withoutPreview ? {schemaVersion: '0.1.0', mode: 'unconfigured', routes: [], assets: []} : readPreviewConfig(projectRoot);
  const writeNonce = runtimeWriteNonce || crypto.randomBytes(18).toString('base64url');
  const managerServers = new Set();
  const declared = new Map([...preview.routes, ...preview.assets].map((entry) => [entry.path, entry.absoluteFile]));
  const server = http.createServer(async (req, res) => {
    if(runtime && req.method==='GET')return snapshotResponse(req,res,runtime);
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
        if (inspectProjectAuthority(projectRoot,{installationRoot}).continuousSync?.state === 'active') {
          const result = applyProjectMutationPlan({plan});
          const relations = readFacts(projectRoot).relations;
          return send(res,200,JSON.stringify({ok:true,...result,relations:relations.items,version:relationsVersion(relations),mutationPerformed:true}),'application/json;charset=utf-8');
        }
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
    if (pathname === '/' || pathname === '/index.html') {
      try {
        const synchronization = null; // GET never scans or writes facts.
        const data = readFacts(projectRoot);
        data.synchronization = synchronization;
        const observation = captureProjectRoundInputs(projectRoot);
        data.semanticRevision = projectSemanticRevision(data, observation.files);
        data.objectIdentities = (data.project.contextLifecycle?.identities || []).map(identity => ({...identity, state: identity.state === 'active' && observation.files.some(file => file.path === identity.sourceFile && file.physical === identity.sourcePhysical) ? 'active' : 'unverified'}));
        if (installationRoot) {
          // Effective display only: never rewrite the historical identity or
          // project preferences to make them agree with a new runtime.
          data.foundation = projectWithEffectivePolicy(data.foundation, readProjectPolicyForDisplay({installationRoot, project: projectRoot}));
          data.delivery = inspectProjectDeliveryFiles({project:projectRoot,installationRoot});
        }
        const currentPreview = fs.existsSync(path.join(projectRoot,'.foundation/preview.json')) ? readPreviewConfig(projectRoot) : preview;
        return send(res, 200, workspaceDocument(data, currentPreview, {writeNonce}), 'text/html;charset=utf-8');
      } catch (error) { return send(res, 409, JSON.stringify({ok:false,message:error.message,mutationPerformed:false}), 'application/json;charset=utf-8'); }
    }
    if (pathname === WORKSPACE_ASSETS.script) return sendFile(res, path.join(DIST_ASSETS, 'workspace.js'));
    if (pathname === WORKSPACE_ASSETS.stylesheet) return sendFile(res, path.join(DIST_ASSETS, 'workspace.css'));
    const chunk = resolveChunk(pathname);
    if (chunk) return sendFile(res, chunk);
    const binary = resolveBinary(pathname);
    if (binary) return sendFile(res, binary);
    let declaredFile = declared.get(pathname);
    if (installationRoot && fs.existsSync(path.join(projectRoot,'.foundation/preview.json'))) {
      try { const currentPreview = readPreviewConfig(projectRoot); declaredFile = [...currentPreview.routes,...currentPreview.assets].find(entry => entry.path === pathname)?.absoluteFile; }
      catch(error) {return send(res,409,'预览映射待核：'+error.message);}
    }
    if (declaredFile) return sendFile(res, declaredFile, {'access-control-allow-origin': '*'});
    const managedFont = resolveManagedFont(projectRoot, pathname);
    if (managedFont) return sendFile(res, managedFont, {'access-control-allow-origin': '*'});
    return send(res, 404, '未找到预览资源');
  });
  server.on('close', () => { runtime?.close();for (const manager of managerServers) manager.close(); managerServers.clear(); });
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
  if(project)synchronizeProject({project,installationRoot,trigger:'workbench-open'});
  const writeNonce=crypto.randomBytes(18).toString('base64url');
  const options={installationRoot,project,writeNonce,distRoot:path.resolve(import.meta.dirname,'../../dist')};
  const initialSnapshot=prepareWorkbenchSnapshot(options);
  const runtime=createWorkbenchRuntime({options,initialSnapshot,workerUrl:new URL('./workbench-validation-worker.mjs',import.meta.url)});
  if(project){const server=createManagementCenterServer(project,{installationRoot,runtime,runtimeWriteNonce:writeNonce,validateContext:()=>runtime.request({strict:true})});server.foundationRuntime=runtime;return server;}
  const server=http.createServer((req,res)=>{
    if(req.method!=='GET')return send(res,405,'未选择项目的工作台只读');
    return snapshotResponse(req,res,runtime);
  });
  server.foundationRuntime=runtime;server.on('close',()=>runtime.close());
  return server;
}

// Explicit verification uses the same CDP driver as browser acceptance tests.
// It accepts declarative, scope-bound checks, never caller JavaScript or results.
export async function verifyInstalledProjectBrowser({installationRoot,project,taskId,requirementId,assetId,scenarioId}) {
  const state=inspectLocalLifecycle({installationRoot,project,operationRequirement:'lifecycle-inspect'});
  if(state.bridge?.installationHealth?.code!=='FOUNDATION_HEALTHY'||!state.project?.agreement||state.project.state!=='enabled')throw new Error('浏览器验证需要当前安装和项目身份');
  // Opening the workbench synchronizes project inputs. Freeze verification only
  // after that same transition, so the server can serve the captured revision.
  synchronizeProject({project,installationRoot,trigger:'workbench-open'});
  const facts=readFacts(project),task=facts.changes.items.find(item=>item.id===taskId),scope=task?.deliveryScope;
  const requirement=scope?.items?.find(item=>item.requirementId===requirementId),asset=[...facts.components.items,...facts.pages.items,...facts.motions.items].find(item=>item.id===assetId);
  const pageTarget=!asset?.assetModel && facts.pages.items.some(page=>page.id===assetId);
  const pageRoute=pageTarget?JSON.parse(fs.readFileSync(path.join(project,'.foundation/preview.json'),'utf8')).routes.find(route=>route.path===asset.preview):null;
  const scenario=asset?.animationName&&scenarioId==='motion'?{id:'motion',definitionId:assetId}:pageTarget && scenarioId==='page' && pageRoute?{id:'page',definitionId:assetId,adapter:pageRoute.file}:asset?.assetModel?.previewScenarios?.find(item=>item.id===scenarioId);
  if(scope?.schemaVersion!=='2.0.0'||scope.platform!=='web'||!requirement?.factIds?.includes(assetId)||!scenario||scenario.definitionId!==assetId||!requirement.browserChecks?.length)throw new Error('浏览器验证需要当前 Web 范围、匹配的定义场景和明确行为检查');
  const browserPath=process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':process.platform==='linux'?['/usr/bin/google-chrome','/usr/bin/chromium'].find(file=>fs.existsSync(file)):null;
  if(!browserPath||!fs.existsSync(browserPath)||typeof WebSocket==='undefined')return {state:'blocked',reason:'当前环境没有可用的受控 Chrome/CDP 运行工具；未签发通过收据',mutationPerformed:false};
  const viewports=scope.layoutPolicy?.viewports || [];
  if(!viewports.length||viewports.length>10||viewports.some(viewport=>viewport.width>4096||viewport.height>8192))return {state:'blocked',reason:'需明确有限的实际验证视口；未改写设计尺寸',mutationPerformed:false};
  const before=prepareWorkbenchSnapshot({installationRoot,project});
  const sourceDigest=sha256(canonicalStringify(inspectSyncSources(project)));
  const sourceScene=before.sourceScenes[assetId+':'+scenarioId];
  const route=pageTarget?Object.entries(before.routeMap).find(([,file])=>file===scenario.adapter)?.[0]:sourceScene?.route;
  if(!route)throw new Error('场景未由当前导出声明和固定配置生成；自定义回调不能证明组件本体');
  const inputs=currentEvidenceInputs(project,asset);
  if(!inputs.length||factImplementationInputs(asset).some(edge=>edge.coverage!=='complete'))return {state:'blocked',reason:'定义的运行依赖覆盖不完整，保留待核',mutationPerformed:false};
  const runRoot=path.join(installationRoot,'state','evidence-runs',crypto.randomUUID());
  let cursor=installationRoot;
  for(const part of path.relative(installationRoot,runRoot).split(path.sep)){cursor=path.join(cursor,part);if(fs.existsSync(cursor)){if(fs.realpathSync(cursor)!==cursor||fs.lstatSync(cursor).isSymbolicLink())throw new Error('验证运行目录不安全');}else fs.mkdirSync(cursor,{mode:0o700});}
  const profile=path.join(runRoot,'profile'),temporary=path.join(runRoot,'tmp');fs.mkdirSync(profile);fs.mkdirSync(temporary);
  let ownedServer,devtools,browser;
  const observations=[],checks=[];
  try {
    const instance=await openOrReuseWorkbench({installationRoot,project,createServer:options=>{ownedServer=createInstalledWorkbenchServer(options);return ownedServer;}});
    const launch=browserLaunchContract({}, {userDataDirectory:profile});
    browser=spawn(browserPath,launch.args,{env:{...process.env,TMPDIR:temporary,XDG_CACHE_HOME:temporary},stdio:'ignore'});
    const port=await waitForBrowserDevtoolsPort(profile,browser);
    const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
    devtools=await connectDevtools(target.webSocketDebuggerUrl);await devtools.call('Runtime.enable');
    const browserVersion=await devtools.call('Browser.getVersion');
    for(const viewport of viewports) {
      await devtools.call('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
      const url=new URL(route,instance.url);url.searchParams.set('revision',before.revision);url.searchParams.set('projectId',state.project.projectId);url.searchParams.set('channel',crypto.randomUUID());for(const [key,value]of Object.entries({foundationAssetPreview:'1',assetId,scenarioId,instanceId:scenario.instanceId || '',state:scenario.state || '',variantValues:JSON.stringify(scenario.variantValues || {})}))url.searchParams.set(key,value);
      await devtools.call('Page.navigate',{url:url.href});
      for(let n=0;n<100;n++){if(await evaluate(devtools,'document.readyState === "complete"'))break;await new Promise(resolve=>setTimeout(resolve,50));}
      for(const declaredCheck of requirement.browserChecks) {
        const check={...declaredCheck,expected:declaredCheck.expectedByViewport?.[`${viewport.width}x${viewport.height}`] ?? declaredCheck.expected};
        await devtools.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:check.reducedMotion || 'no-preference'}]});
        const expression=`(()=>{const c=${JSON.stringify(check)},nodes=[...document.querySelectorAll(c.selector)],e=nodes[0];if(c.action==='count')return {actual:String(nodes.length),passed:String(nodes.length)===c.expected};if(!e)return {actual:null,passed:false};if(c.action==='click'){e.click();return {actual:'clicked',passed:true};}if(c.action==='fill'){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(setter)setter.call(e,c.expected);else e.value=c.expected;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {actual:e.value,passed:e.value===c.expected};}if(c.action==='visible'){const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {actual:{width:r.width,height:r.height,display:s.display,visibility:s.visibility},passed:r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};}const actual=c.action==='css'?getComputedStyle(e).getPropertyValue(c.attribute):c.action==='attribute'?e.getAttribute(c.attribute):e.textContent;return {actual,passed:actual===c.expected};})()`;
        let observed;
        for(let n=0;n<40;n++){observed=await evaluate(devtools,expression);if(observed.passed||['click','fill'].includes(check.action))break;await new Promise(resolve=>setTimeout(resolve,50));}
        checks.push({id:`${check.id}_${viewport.width}x${viewport.height}`,result:observed.passed?'passed':'failed',actual:observed.actual,expected:check.expected ?? null});
      }
      const layout=await evaluate(devtools,'({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})');
      const legitimateOverflow=scope.layoutPolicy.mode==='fixed-artboard'||scope.layoutPolicy.overflow==='horizontal-scroll';
      checks.push({id:`layout_${viewport.width}x${viewport.height}`,result:layout.width===viewport.width&&layout.height===viewport.height&&(legitimateOverflow||layout.scrollWidth<=viewport.width)?'passed':'failed',actual:layout});
      const screenshot=(await devtools.call('Page.captureScreenshot',{format:'png'})).data;
      observations.push({viewport,layout,screenshotSha256:sha256(Buffer.from(screenshot,'base64'))});
    }
    const page=facts.pages.items.find(page=>requirement.factIds.includes(page.id)) || facts.pages.items.find(page=>(asset.usageLocations || []).some(usage=>usage.pageId===page.id)) || facts.pages.items.find(page=>asset.pageIds?.includes(page.id));
    const assetUrl=new URL(route,instance.url);for(const [key,value]of Object.entries({projectId:state.project.projectId,revision:before.revision,channel:crypto.randomUUID(),assetId,scenarioId,foundationAssetPreview:'1',instanceId:scenario.instanceId || '',state:scenario.state || '',variantValues:JSON.stringify(scenario.variantValues || {})}))assetUrl.searchParams.set(key,value);
    checks.push(...await observeWorkbenchCapabilities({devtools,devtoolsPort:port,sourceSceneDigest:sourceScene?.renderDigest,workbenchUrl:instance.url,projectId:state.project.projectId,revision:before.revision,pageId:page?.id,assetUrl:pageTarget?null:assetUrl.href}));
    checks.push({id:'runtime-errors',result:devtools.events.some(event=>event.method==='Runtime.exceptionThrown')?'failed':'passed'});
    const after=prepareWorkbenchSnapshot({installationRoot,project});
    if(after.revision!==before.revision||sourceDigest!==sha256(canonicalStringify(inspectSyncSources(project))))throw new Error('运行期间输入、构建或任务发生变化；未签发证据');
    const result=checks.some(check=>check.result==='failed')?'failed':'passed';
    const report={configurationInputs:browserConfigurationInputs(project),projectRuntimeDigest:projectRuntimeDigest(captureProjectRoundInputs(project)),...(sourceScene?{sourceScene}:{ }),kind:'browser-observation',taskId,scopeRevision:scope.revision,scopeDigest:browserRequirementDigest(scope,requirementId),subjectDigest:evidenceSubjectFingerprint(asset),sourceDigest,subject:{definitionId:assetId,scenarioId,requirementId,...(scenario.instanceId?{instanceId:scenario.instanceId}:{})},inputFingerprint:evidenceInputFingerprint(inputs),artifactDigest:before.buildDigest,currentFileSha256:sha256(fs.readFileSync(path.join(installationRoot,'state/current.json'))),previewConfigSha256:sha256(fs.readFileSync(path.join(project,'.foundation/preview.json'))),artifactFiles:(sourceScene?[]:[...new Set(Object.values(before.routeMap))]).map(file=>({path:file,sha256:sha256(fs.readFileSync(path.join(project,file)))})),environment:{browser:browserVersion,browserExecutable:{path:browserPath,sha256:sha256(fs.readFileSync(browserPath))},platform:process.platform,architecture:process.arch,osRelease:os.release(),viewports},runnerVersion:'foundation-cdp/1.0.0',verifierVersion:'foundation-browser-checks/3.0.0',dimensions:['runtime','layout'],checkIds:checks.map(check=>check.id),checks,result,observations,revision:before.revision,artifactInputs:Object.entries(before.resourceBytes).map(([url,entry])=>({url,sha256:entry.sha256})),limitations:['只覆盖当前范围声明的检查与视口，不代表真人接受或范围外行为']};
    const receipt={purpose:'foundation-evidence-run',project:realProject(project),reportDigest:sha256(canonicalStringify(report))};
    const signed={...report,foundationReceipt:{...receipt,integrity:signTrustedPayload(receipt)}};
    const reportText=JSON.stringify(signed,null,2)+'\n';
    return {state:result,report:signed,reportText,reportSha256:sha256(reportText),mutationPerformed:false};
  }finally {
    if(browser)await cleanupBrowser({child:browser,devtools,server:ownedServer,temporary:runRoot,profile,root:installationRoot,remove:()=>fs.rmSync(runRoot,{recursive:true})});
    else {ownedServer?.close();if(fs.realpathSync(runRoot)===runRoot)fs.rmSync(runRoot,{recursive:true});}
  }
}
