import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import {applyCapabilityPlan} from './capability-authority.mjs';
import {applyProjectAuthorityPlan, applyProjectAuthorityRecoveryPlan, applyProjectMutationPlan, applyProjectMutationRecoveryPlan} from './project-authority.mjs';
import {applyLifecyclePlan} from './transaction-engine.mjs';
import {applyNormalUninstallCompositePlan, applyNormalUninstallProjectPlan, applyProjectLayoutPlan} from './project-layout.mjs';
import {applyOfferPreferencePlan} from './offer-consent.mjs';
import {runWithLocalManagerConfirmation} from './manager-confirmation.mjs';
import {createPendingLocalManagerSession, inspectLocalLifecycle, replaceDriftedLocalManagerPreviewForInternalHost, resolveLocalManagerPlanRefForInternalHost, revalidateLocalManagerPlan, writeLocalManagerSession} from './lifecycle-manager.mjs';
import {transferBootstrapAuthorityToInstalledState} from './trusted-authority.mjs';
import {renderLifecyclePage} from './lifecycle-feedback.mjs';

const MAX_BOOTSTRAP_TERMINAL_RECORDS = 32;

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"});
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function page(record, nonce, planRef = null) {
  return renderLifecyclePage(record.session, nonce, planRef);
}
function assertRecordUnchanged(record, plan) {
  const diskSession = JSON.parse(fs.readFileSync(record.sessionFile, 'utf8'));
  const diskPlan = JSON.parse(fs.readFileSync(record.planFile, 'utf8'));
  if (JSON.stringify(diskSession) !== JSON.stringify(record.session) || JSON.stringify(diskPlan) !== JSON.stringify(plan)) {
    const error = new Error('manager state、plan 或 session 在 preview 后发生变化');
    error.code = 'MANAGER_STATE_DRIFT';
    throw error;
  }
}

function finalizeBootstrapRecord(record, stateRoot) {
  if (!record.session.bootstrapPreview) return;
  const terminal = path.join(stateRoot, 'terminal');
  fs.mkdirSync(terminal, {recursive: true, mode: 0o700});
  const pointer = {schemaVersion: '1.0.0', sessionId: record.session.sessionId, operationId: record.session.operationId, planHash: record.session.planHash, effectHash: record.session.effectHash, state: record.session.state, completedAt: record.session.completedAt || record.session.cancelledAt || record.session.failedAt || Date.now(), resultStatus: record.session.result?.status || null, mutationPerformed: record.session.result?.mutationPerformed === true};
  pointer.installationRoot = record.session.bootstrapPreview.installationRoot;
  pointer.targetVersion = record.session.bootstrapPreview.product?.version || null;
  pointer.failure = record.session.failure || null;
  pointer.operation = record.session.operation;
  pointer.result = record.session.result || null;
  pointer.preserves = record.session.preserves;
  pointer.targetRoots = record.session.targetRoots;
  pointer.recordLocation = path.join(terminal, `${record.session.sessionId}.json`);
  fs.writeFileSync(path.join(terminal, `${record.session.sessionId}.json`), `${JSON.stringify(pointer, null, 2)}\n`, {mode: 0o600});
  const terminalRecords = fs.readdirSync(terminal).filter((name) => name.endsWith('.json')).map((name) => {
    const file = path.join(terminal, name);
    let completedAt = 0;
    try { completedAt = Number(JSON.parse(fs.readFileSync(file, 'utf8')).completedAt || 0); } catch {}
    return {file, name, completedAt};
  }).sort((left, right) => left.completedAt - right.completedAt || left.name.localeCompare(right.name));
  for (const terminalRecord of terminalRecords.slice(0, Math.max(0, terminalRecords.length - MAX_BOOTSTRAP_TERMINAL_RECORDS))) fs.rmSync(terminalRecord.file);
  for (const file of [record.planFile, record.sessionFile]) if (fs.existsSync(file)) fs.rmSync(file);
  if (['cancelled', 'failed', 'expired', 'shutdown-no-install'].includes(record.session.state)) {
    const unusedAuthority = path.join(stateRoot, '.foundation-lifecycle-authority');
    const target = record.session.bootstrapPreview?.installationRoot;
    const hasSignedTargetState = typeof target === 'string' && ['installations.json', 'current.json'].some((name) => fs.existsSync(path.join(target, 'state', name)));
    // A failed/rolled-back apply can already have signed state. Retaining its
    // key is necessary for a later exact recovery; cancellation is not authority
    // to destroy evidence from an earlier consumed operation.
    if (!hasSignedTargetState && fs.existsSync(unusedAuthority) && !fs.lstatSync(unusedAuthority).isSymbolicLink() && fs.statSync(unusedAuthority).isDirectory()) fs.rmSync(unusedAuthority, {recursive: true});
  }
}

function dispatch(plan, action, stateRoot) {
  if (plan.operation === 'offer-preference-update') return applyOfferPreferencePlan({plan});
  if (plan.operation === 'normal-uninstall-project-detach') return applyNormalUninstallProjectPlan({plan, decision: action, transactionStateRoot: stateRoot});
  if (plan.operation === 'normal-uninstall') return applyNormalUninstallCompositePlan({plan, decision: action, transactionStateRoot: stateRoot});
  if (['project-layout-migrate', 'project-data-purge'].includes(plan.operation)) return applyProjectLayoutPlan({plan, transactionStateRoot: stateRoot});
  if (['install', 'update', 'repair', 'rollback', 'uninstall', 'recover'].includes(plan.operation) && plan.targetRoot) {
    const result = applyLifecyclePlan({plan});
    if (plan.bootstrap && plan.operation === 'install') transferBootstrapAuthorityToInstalledState();
    return result;
  }
  if (['enable', 'disable'].includes(plan.operation) && plan.bindingVersion) return applyProjectAuthorityPlan({plan});
  if (plan.operation === 'project-authority-recover') return applyProjectAuthorityRecoveryPlan({plan});
  if (plan.operation === 'project-mutation-recover') return applyProjectMutationRecoveryPlan({plan});
  if (plan.handler && plan.project) return applyProjectMutationPlan({plan});
  if (plan.capabilityId) return applyCapabilityPlan({plan});
  const error = new Error(`manager 不支持 operation ${plan.operation}`);
  error.code = 'MANAGER_PLAN_UNSUPPORTED';
  throw error;
}

function serverForRecord({plan, stateRoot, record, planRef = null}) {
  let activePlan = plan;
  let activeRecord = record;
  let activePlanRef = planRef;
  const priorRecords = new Map(); // References to existing records, not a new state store.
  let managerNonce = crypto.randomBytes(32).toString('hex');
  let claimed = false;
  let expiryTimer = null;
  let managerOrigin = null;
  const closeServer = () => {
    if (server.listening) server.close();
    else server.once('listening', () => server.close());
  };
  const terminalizeNoInstall = ({state, status, reason, at = Date.now()}) => {
    if (claimed || activeRecord.session.state !== 'pending') return {won: false, state: activeRecord.session.state};
    claimed = true;
    writeLocalManagerSession(activeRecord, {state, completedAt: at, terminalReason: reason, result: {ok: true, status, mutationPerformed: false}});
    finalizeBootstrapRecord(activeRecord, stateRoot);
    server.emit('foundation-operation-result', activeRecord.session);
    closeServer();
    return {won: true, state};
  };
  const server = http.createServer((request, response) => {
    const expectedOrigin = managerOrigin || `http://127.0.0.1:${server.address()?.port}`;
    if (request.method === 'GET' && request.url === '/') return send(response, 200, page(activeRecord, managerNonce, activePlanRef), 'text/html; charset=utf-8');
    // Read-only events from the same durable session; no worker, queue or new state.
    if (request.method === 'GET' && request.url?.split('?')[0] === '/__foundation/manager/events') {
      const requestedId = new URL(request.url, expectedOrigin).searchParams.get('session-id');
      if (requestedId !== activeRecord.session.sessionId) return send(response, 404, {code:'MANAGER_SESSION_NOT_FOUND'});
      response.writeHead(200, {'content-type':'text/event-stream', 'cache-control':'no-store'});
      response.flushHeaders();
      const publish = session => {
        if (session.sessionId !== requestedId) return;
        response.write(`data: ${JSON.stringify(session)}\n\n`);
        if (!['pending','executing','consumed'].includes(session.state)) response.end();
      };
      const cleanup = () => { server.off('foundation-operation-state', publish); server.off('foundation-operation-result', publish); };
      response.once('close', cleanup);
      server.on('foundation-operation-state', publish);
      server.on('foundation-operation-result', publish);
      publish(activeRecord.session);
      return;
    }
    if (request.method === 'GET' && request.url?.split('?')[0] === '/__foundation/manager/status') {
      const requestedId = new URL(request.url, expectedOrigin).searchParams.get('session-id');
      const record = !requestedId || requestedId === activeRecord.session.sessionId ? activeRecord : priorRecords.get(requestedId);
      return send(response, record ? 200 : 404, record?.session || {state:'not-found', sessionId:requestedId, mutationPerformed:false});
    }
    if (request.method !== 'POST' || request.url !== '/__foundation/manager/confirm') return send(response, 404, {code: 'MANAGER_ROUTE_NOT_FOUND'});
    if (request.headers.origin !== expectedOrigin) return send(response, 403, {code: 'MANAGER_ORIGIN_REJECTED'});
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', async () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return send(response, 400, {code: 'MANAGER_REQUEST_INVALID'}); }
      const expectedAction = ['normal-uninstall-project-detach', 'normal-uninstall'].includes(activePlan.operation) && activePlan.residuals?.length ? 'continue-accessible-with-residuals' : 'confirm-exact-operation';
      const allowedActions = new Set(['cancel-no-change', expectedAction]);
      if (body.managerNonce !== managerNonce || !allowedActions.has(body.action)) return send(response, 403, {code: 'MANAGER_CONFIRMATION_ACTION_INVALID'});
      if (claimed || activeRecord.session.state !== 'pending') return send(response, 409, {code: activeRecord.session.state === 'expired' ? 'MANAGER_CONFIRMATION_EXPIRED' : 'MANAGER_CONFIRMATION_REPLAYED', state: activeRecord.session.state});
      try { assertRecordUnchanged(activeRecord, activePlan); }
      catch (error) { claimed = true; writeLocalManagerSession(activeRecord, {state: 'failed', failedAt: Date.now(), failure: {code: error.code, message: error.message}}); finalizeBootstrapRecord(activeRecord, stateRoot); server.emit('foundation-operation-result', activeRecord.session); if (activePlan.bootstrap) response.on('finish', () => server.close()); return send(response, 409, {ok: false, code: error.code, message: error.message}); }
      claimed = true;
      if (body.action === 'cancel-no-change') {
        writeLocalManagerSession(activeRecord, {state: 'cancelled', cancelledAt: Date.now(), confirmationAction: body.action, result: {ok: true, status: 'CANCELLED_NO_CHANGE', mutationPerformed: false}});
        finalizeBootstrapRecord(activeRecord, stateRoot);
        server.emit('foundation-operation-result', activeRecord.session);
        if (activePlan.bootstrap) response.on('finish', () => server.close());
        return send(response, 200, {ok: true, sessionId: activeRecord.session.sessionId, state: 'cancelled', result: activeRecord.session.result});
      }
      try {
        revalidateLocalManagerPlan(activePlan);
        const confirmedAt = Date.now();
        writeLocalManagerSession(activeRecord, {state: 'executing', confirmedAt, confirmationAction: body.action});
        server.emit('foundation-operation-state', activeRecord.session);
        // Flush the real start event before synchronous dispatch blocks this loop.
        // claimed is already held; runWithLocalManagerConfirmation revalidates again.
        await new Promise(resolve => setImmediate(resolve));
        const consumptions = [];
        const result = runWithLocalManagerConfirmation({
          session: activeRecord.session,
          revalidate: (options) => revalidateLocalManagerPlan(activePlan, options),
          onConsume: (evidence) => { consumptions.push(evidence); writeLocalManagerSession(activeRecord, {state: 'consumed', consumption: evidence, consumptions: [...consumptions]}); },
          onFailure: (failure) => writeLocalManagerSession(activeRecord, {state: 'failed', failure}),
        }, () => dispatch(activePlan, body.action, stateRoot));
        writeLocalManagerSession(activeRecord, {state: 'completed', completedAt: Date.now(), result});
        finalizeBootstrapRecord(activeRecord, stateRoot);
        server.emit('foundation-operation-result', activeRecord.session);
        if (activePlan.bootstrap) response.on('finish', () => server.close());
        return send(response, 200, {ok: true, sessionId: activeRecord.session.sessionId, state: 'completed', result});
      } catch (error) {
        const failedRecord = activeRecord;
        const failedPlanRef = activePlanRef;
        if (failedRecord.session.state !== 'completed') writeLocalManagerSession(failedRecord, {state: 'failed', failedAt: Date.now(), failure: {code: error.code || 'MANAGER_EXECUTION_FAILED', message: error.message, recovery: '旧确认已失效；只读检查实际变更和恢复状态，再选择新计划'}});
        let replacementPlanRef = null;
        if (error.code === 'MANAGER_PLAN_STATE_DRIFT' && failedPlanRef) {
          try {
            const replacement = replaceDriftedLocalManagerPreviewForInternalHost({planRef: failedPlanRef});
            priorRecords.set(failedRecord.session.sessionId, failedRecord);
            activePlan = replacement.internal.plan;
            activeRecord = replacement.internal.record;
            activePlanRef = replacement.planRef;
            replacementPlanRef = replacement.planRef;
            managerNonce = crypto.randomBytes(32).toString('hex');
            claimed = false;
          } catch {}
        }
        finalizeBootstrapRecord(failedRecord, stateRoot);
        server.emit('foundation-operation-result', failedRecord.session);
        if (activePlan.bootstrap) response.on('finish', () => server.close());
        return send(response, error.code === 'MANAGER_PLAN_STATE_DRIFT' || error.code === 'MANAGER_CONFIRMATION_EXPIRED' ? 409 : 500, {ok: false, code: error.code || 'MANAGER_EXECUTION_FAILED', message: error.message, details: error.details || {}, invalidatedPlanRef: failedPlanRef, replacementPlanRef, next: replacementPlanRef ? 'preview-reloaded-with-new-plan-ref' : 'request-plan'});
      }
    });
  });
  server.on('listening', () => { managerOrigin = `http://127.0.0.1:${server.address().port}`; });
  Object.defineProperty(server, 'managerSession', {get: () => activeRecord.session});
  Object.defineProperty(server, 'terminalizeBootstrapNoInstall', {value: terminalizeNoInstall});
  const scheduleExpiry = () => {
    expiryTimer = setTimeout(() => {
      // A drift replacement has a new deadline; never expire its fresh plan
      // using the old timer. Completed sessions may be read until that deadline.
      if (Date.now() < activeRecord.session.expiresAt) return scheduleExpiry();
      const result = terminalizeNoInstall({state: 'expired', status: 'EXPIRED_NO_INSTALL', reason: 'plan-session-deadline'});
      if (!result.won) closeServer();
    }, Math.max(0, activeRecord.session.expiresAt - Date.now()));
    expiryTimer.unref();
  };
  scheduleExpiry();
  server.once('close', () => { if (expiryTimer) clearTimeout(expiryTimer); expiryTimer = null; });
  return server;
}

export function createLocalLifecycleManagerServer({plan, stateRoot}) {
  return serverForRecord({plan, stateRoot, record: createPendingLocalManagerSession({plan, stateRoot})});
}

export function createLocalLifecycleManagerServerForPlanRef({planRef}) {
  const opened = resolveLocalManagerPlanRefForInternalHost({planRef});
  return serverForRecord({plan: opened.internal.plan, stateRoot: opened.internal.stateRoot, record: opened.internal.record, planRef});
}

export function createInstalledOverviewServer({installationRoot}) {
  // No mutable routes and no repository/example fallback. Each read rechecks
  // installed state; the overview itself cannot authorize project integration.
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' || !['/', '/status'].includes(request.url)) return send(response, 404, {code: 'OVERVIEW_ROUTE_NOT_FOUND'});
    try {
      const state = inspectLocalLifecycle({installationRoot});
      if (request.url === '/status') return send(response, 200, state);
      const current = state.installation?.current;
      const summary = `<h2>${current ? `Foundation ${escapeHtml(current.version)}` : '尚无可验证的安装'}</h2><p>安装健康：${escapeHtml(state.bridge?.installationHealth?.code === 'FOUNDATION_HEALTHY' ? '正常' : '请查看诊断详情')} · 恢复状态：${escapeHtml(state.installation?.recovery?.status || '未知')}</p>`;
      return send(response, 200, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Foundation 管理中心</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px}code{overflow-wrap:anywhere}</style><h1>Foundation 管理中心</h1>${summary}<p>安装位置：<code>${escapeHtml(installationRoot)}</code></p><h2>接入你选择的项目</h2><p>在 Codex 对话中告诉我你要接入的精确项目目录。我会先只读检查，再打开单独的项目接入计划供你确认。安装 Foundation 不会自动扫描或启用项目。</p><p>新建项目与接入已有项目是不同操作；既有源码、facts 和未知内容不会被自动覆盖。这里不扫描或展示示例项目；项目状态需要选定目录后读取。</p><h2>再次打开与维护</h2><p>在 Codex 中提供本页安装位置，请求打开管理中心、检查状态、修复、手动更新或回退。所有更改均须另行核对计划并确认。卸载前先停用已接入的 Skill；不会删除项目 facts。</p><details><summary>查看真实诊断数据</summary><pre>${escapeHtml(JSON.stringify(state, null, 2))}</pre></details></html>`, 'text/html; charset=utf-8');
    } catch (error) { return send(response, 409, {ok: false, code: error.code || 'INSTALLED_STATE_UNAVAILABLE', message: error.message, mutationPerformed: false}); }
  });
  return server;
}
