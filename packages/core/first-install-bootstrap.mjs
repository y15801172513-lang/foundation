import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {validateCandidate} from './candidate-package.mjs';
import {FOUNDATION_RELEASE_POLICY} from './release-catalog.mjs';
import {canonicalStringify, createLifecyclePlan, LifecycleError, sha256} from './install-contract.mjs';
import {createLocalLifecycleManagerServer} from './lifecycle-manager-host.mjs';
import {probeDiskAvailableBytes} from './platform-bootstrap.mjs';
import {resolveFoundationPlatformPaths} from './platform-paths.mjs';
import {openFoundationManagerUrl} from './browser-launch.mjs';
import {sanitizeNodeStartupEnvironment} from './node-startup-environment.mjs';
import {activateFirstInstallBootstrapAuthority, deriveTrustedLifecycleAuthority, loadTrustedAuthorityKey, transferBootstrapAuthorityToInstalledState, verifyTrustedPayload} from './trusted-authority.mjs';
import {classifyProcessOwner, observeProcessFingerprint} from './process-owner.mjs';
import {visibleLocalManagerSession} from './lifecycle-manager.mjs';
import {inspectInstallation, inspectLifecycleRecovery, inspectCurrentInstallationAuthority, verifyCurrentInstallationAppAuthority} from './transaction-engine.mjs';

const MAX_BOOTSTRAP_TERMINAL_RECORDS = 32;

function bootstrapError(code, message, details = {}) {
  return new LifecycleError(code, message, {stage: 'first-install-bootstrap', recovery: '关闭旧页面后，从 exact candidate 重新运行 foundation-kit install', details});
}

export function discoverLaunchedCandidateRoot() {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
  if (!invoked) throw bootstrapError('CANDIDATE_LAUNCH_CONTEXT_INVALID', '无法识别当前 candidate 启动入口');
  let cursor = path.dirname(invoked);
  for (;;) {
    const manifest = path.join(cursor, 'manifest.json');
    const payload = path.join(cursor, 'payload');
    if (fs.existsSync(manifest) && fs.existsSync(payload) && fs.statSync(payload).isDirectory()) {
      const relative = path.relative(payload, invoked);
      if (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw bootstrapError('CANDIDATE_LAUNCH_CONTEXT_INVALID', 'install common path 只允许由候选包顶层自托管 launcher 启动');
}

export function isLaunchedCandidate() {
  try { discoverLaunchedCandidateRoot(); return true; } catch { return false; }
}

export function readFirstInstallOperationStatus(sessionId) {
  if (typeof sessionId !== 'string' || !/^manager-session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(sessionId)) throw bootstrapError('MANAGER_SESSION_ID_INVALID', '首次安装操作编号无效');
  const {bootstrapStateRoot} = resolveFoundationPlatformPaths();
  for (const collection of ['sessions', 'terminal']) {
    const file = path.join(bootstrapStateRoot, collection, `${sessionId}.json`);
    let cursor = path.parse(file).root;
    let missing = false;
    for (const segment of file.slice(cursor.length).split(path.sep)) {
      cursor = path.join(cursor, segment);
      let stat;
      try { stat = fs.lstatSync(cursor); }
      catch (error) { if (error.code === 'ENOENT') { missing = true; break; } throw error; }
      if (stat.isSymbolicLink() || fs.realpathSync(cursor) !== cursor || (cursor !== file && !stat.isDirectory()) || (cursor === file && (!stat.isFile() || stat.size > 1024 * 1024))) throw bootstrapError('BOOTSTRAP_STATUS_PATH_INVALID', '操作记录路径被替换或类型无效');
    }
    if (missing) continue;
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record.sessionId !== sessionId) throw bootstrapError('BOOTSTRAP_STATUS_IDENTITY_INVALID', '操作记录与查询编号不一致');
    const visible = visibleLocalManagerSession(record);
    return {schemaVersion: '1.0.0', sessionId, state: visible.state, recordedState: record.state, operationId: record.operationId, planHash: record.planHash, effectHash: record.effectHash, result: record.result || null, feedback: visible.feedback, recordLocation: file, resultStatus: record.resultStatus || record.result?.status || null, failure: record.failure || null, installationRoot: record.installationRoot || record.bootstrapPreview?.installationRoot || null, targetVersion: record.targetVersion || record.bootstrapPreview?.product?.version || null, mutationPerformed: false, evidence: 'operation-record-not-installation-health-proof', next: visible.feedback.next};
  }
  return {schemaVersion: '1.0.0', sessionId, state: 'not-found', mutationPerformed: false, next: '记录可能已按保留策略清理；只读检查安装状态，不重放旧批准'};
}

function terminalDirectory(stateRoot) {
  return path.join(stateRoot, 'terminal');
}

function pruneBootstrapTerminalRecords(stateRoot) {
  const directory = terminalDirectory(stateRoot);
  if (!fs.existsSync(directory)) return;
  const records = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => {
    const file = path.join(directory, name);
    let completedAt = 0;
    try {
      const pointer = JSON.parse(fs.readFileSync(file, 'utf8'));
      completedAt = Number(pointer.completedAt || pointer.recoveredAt || 0);
    } catch {}
    return {file, name, completedAt};
  }).sort((left, right) => left.completedAt - right.completedAt || left.name.localeCompare(right.name));
  for (const record of records.slice(0, Math.max(0, records.length - MAX_BOOTSTRAP_TERMINAL_RECORDS))) fs.rmSync(record.file);
}

function acquireBootstrapLauncherLock(stateRoot) {
  const boundary = path.dirname(path.dirname(stateRoot));
  if (!fs.existsSync(boundary) || fs.lstatSync(boundary).isSymbolicLink() || fs.realpathSync(boundary) !== boundary) throw bootstrapError('BOOTSTRAP_STATE_PATH_INVALID', 'bootstrap state 平台根无效');
  let cursor = boundary;
  for (const part of path.relative(boundary, stateRoot).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, {mode: 0o700});
    if (fs.lstatSync(cursor).isSymbolicLink() || !fs.statSync(cursor).isDirectory() || fs.realpathSync(cursor) !== cursor) throw bootstrapError('BOOTSTRAP_STATE_PATH_INVALID', `bootstrap state 祖先无效：${cursor}`);
  }
  if (fs.lstatSync(stateRoot).isSymbolicLink() || fs.realpathSync(stateRoot) !== stateRoot) throw bootstrapError('BOOTSTRAP_STATE_PATH_INVALID', 'bootstrap state root 被替换或是符号链接');
  const lockFile = path.join(stateRoot, 'launcher.lock');
  if (fs.existsSync(lockFile)) {
    let owner;
    try { owner = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { throw bootstrapError('BOOTSTRAP_LOCK_INVALID', 'bootstrap launcher lock 无法验证'); }
    const ownerState = classifyProcessOwner(owner);
    if (ownerState === 'live') throw bootstrapError('BOOTSTRAP_LAUNCHER_BUSY', '另一个 Foundation bootstrap launcher 正在等待或执行 exact session', {pid: owner.pid});
    if (!['dead', 'stale-instance'].includes(ownerState)) throw bootstrapError('BOOTSTRAP_LOCK_INVALID', 'bootstrap launcher lock 缺少可验证的进程 identity');
    fs.rmSync(lockFile);
  }
  const observed = observeProcessFingerprint(process.pid);
  if (observed.state !== 'observed') throw bootstrapError('BOOTSTRAP_PROCESS_IDENTITY_UNAVAILABLE', '无法取得 launcher 进程实例 identity');
  const owner = {schemaVersion: '1.0.0', pid: process.pid, processFingerprint: observed.fingerprint, nonce: crypto.randomUUID(), acquiredAt: Date.now()};
  const descriptor = fs.openSync(lockFile, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(owner, null, 2)}\n`); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  return () => {
    try {
      const current = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      if (current.nonce === owner.nonce && current.pid === owner.pid) fs.rmSync(lockFile);
    } catch {}
  };
}

export function recoverAbandonedBootstrapState(stateRoot, {now = Date.now()} = {}) {
  const sessions = path.join(stateRoot, 'sessions');
  const plans = path.join(stateRoot, 'plans');
  const recovered = [];
  if (!fs.existsSync(sessions)) return recovered;
  fs.mkdirSync(terminalDirectory(stateRoot), {recursive: true, mode: 0o700});
  for (const name of fs.readdirSync(sessions).filter((entry) => entry.endsWith('.json')).sort()) {
    const file = path.join(sessions, name);
    const session = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!['pending', 'executing', 'consumed', 'cancelled', 'completed', 'failed'].includes(session.state)) throw bootstrapError('BOOTSTRAP_RECOVERY_REQUIRED', `bootstrap session ${session.sessionId} 状态未知；拒绝制造新授权`, {sessionId: session.sessionId, state: session.state});
    const state = session.state === 'pending' ? (now > session.expiresAt ? 'expired' : 'abandoned') : ['executing', 'consumed'].includes(session.state) ? `interrupted-${session.state}-authorization-not-reusable` : session.state;
    const terminal = {schemaVersion: '1.0.0', sessionId: session.sessionId, operationId: session.operationId, planHash: session.planHash, effectHash: session.effectHash, state, recoveredAt: now, mutationPerformed: false};
    fs.writeFileSync(path.join(terminalDirectory(stateRoot), `${session.sessionId}.json`), `${JSON.stringify(terminal, null, 2)}\n`, {mode: 0o600});
    fs.rmSync(file);
    const planFile = path.join(plans, name);
    if (fs.existsSync(planFile)) fs.rmSync(planFile);
    recovered.push(terminal);
  }
  pruneBootstrapTerminalRecords(stateRoot);
  return recovered;
}

function resealPlan(base, bootstrap) {
  const {integrity: _integrity, planId: _planId, ...seed} = base;
  const withBootstrap = {...seed, bootstrap};
  const planId = `plan-${sha256(canonicalStringify(withBootstrap)).slice(0, 24)}`;
  const unsigned = {...withBootstrap, planId};
  return {...unsigned, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(unsigned))}};
}

export function classifyFirstInstallCandidateTrust(manifest) {
  const signature = manifest?.signature;
  const provenance = manifest?.provenance;
  const source = manifest?.source;
  const localSource = ['repository-local-build', 'local-build', 'local-test'].includes(source?.kind);
  if (signature?.status === 'unsigned' && signature.productionDistribution === false && !signature.signer && provenance?.status === 'local-candidate' && provenance.immutableRelease === false && localSource) {
    return Object.freeze({policy: 'local-development', accepted: true, status: 'accepted-local-development', label: 'unsigned / local-only / not a production release'});
  }
  if (signature?.status === 'verified' && signature.productionDistribution === true && typeof signature.signer === 'string' && signature.signer && provenance?.immutableRelease === true && source?.kind === 'remote') {
    return Object.freeze({policy: 'verified-distribution', accepted: false, status: 'unavailable-not-verified', code: 'VERIFIED_DISTRIBUTION_UNAVAILABLE', label: 'verified distribution unavailable / not verified'});
  }
  throw bootstrapError('CANDIDATE_TRUST_POLICY_INVALID', '候选 trust 字段未知、混合或相互矛盾；拒绝首次安装', {signature: signature || null, provenance: provenance || null, source: source || null});
}

export function createFirstInstallBootstrapPlan({now = Date.now(), ttlMs = 10 * 60 * 1000, destination = null} = {}) {
  const candidateRoot = discoverLaunchedCandidateRoot();
  activateFirstInstallBootstrapAuthority(candidateRoot, {destination});
  let untrustedManifest;
  try { untrustedManifest = JSON.parse(fs.readFileSync(path.join(candidateRoot, 'manifest.json'), 'utf8')); }
  catch (error) { throw bootstrapError('CANDIDATE_TRUST_POLICY_INVALID', '候选 manifest 无法读取 trust policy', {cause: error?.code || error?.message || 'unknown'}); }
  let trust = classifyFirstInstallCandidateTrust(untrustedManifest);
  if (!trust.accepted && !FOUNDATION_RELEASE_POLICY.publicKey) throw bootstrapError(trust.code, '发行签名身份与获取渠道尚未批准配置，verified-distribution 保持不可用，未执行 mutation', {policy: trust.policy, status: trust.status});
  const checked = validateCandidate(candidateRoot, {platform: process.platform, arch: process.arch, requireRuntime: true});
  if (!checked.ok) throw new LifecycleError(checked.error.code, checked.error.message, {stage: checked.error.stage, details: checked.error.details});
  if (!trust.accepted) {
    // No caller callback, environment switch or manifest-only approval here:
    // validateCandidate must verify the detached signature against the product's
    // pinned release policy. That policy is intentionally unconfigured today.
    if (checked.manifest.runtime?.officialSourceVerified !== true) throw bootstrapError('RUNTIME_PROVENANCE_INVALID', '可信发行必须携带已绑定的官方 Runtime');
    trust = Object.freeze({policy: 'verified-distribution', accepted: true, status: 'verified-detached-signature', label: '产品签名及官方 Runtime 摘要已验证；系统执行策略仍由 macOS 检查'});
  }
  const paths = resolveFoundationPlatformPaths({destination});
  const installedAuthority = path.join(paths.installRoot, 'state', '.foundation-lifecycle-authority');
  const bootstrapAuthority = path.join(paths.bootstrapStateRoot, '.foundation-lifecycle-authority');
  if (fs.existsSync(path.join(paths.installRoot, 'bin', 'foundation-kit')) && fs.existsSync(installedAuthority)) return {kind: 'installed', paths};
  if (!checked.manifest.launcher) throw bootstrapError('CANDIDATE_DISTRIBUTION_STATUS_INVALID', '首次安装候选缺少完整自托管 launcher');
  const runtime = checked.manifest.files.find((record) => record.path === checked.manifest.runtime.path);
  if (fs.existsSync(bootstrapAuthority)) {
    const recoverySnapshot = inspectLifecycleRecovery(paths.installRoot);
    if (recoverySnapshot.status !== 'clean') {
      const base = createLifecyclePlan({operation: 'recover', profile: 'core', targetRoot: paths.installRoot, sandboxRoot: paths.bootstrapStateRoot, recoverySnapshot, now, ttlMs});
      const bootstrap = {
        schemaVersion: '1.0.0', platformPathAuthority: paths.authority,
        product: {name: 'AI Product Foundation Kit', version: checked.manifest.productVersion, buildIdentity: checked.manifest.build.identity},
        candidate: {root: checked.root, candidateHash: checked.manifest.candidateHash, trustPolicy: trust.policy, signatureStatus: checked.manifest.signature.status, distribution: trust.policy === 'verified-distribution' ? 'verified-artifact-system-trust-not-asserted' : 'local-only', productionRelease: checked.manifest.signature.productionDistribution === true, runtimeHash: runtime.sha256},
        installationRoot: paths.installRoot, bundledRuntimePath: path.join(checked.root, 'payload', ...checked.manifest.runtime.path.split('/')),
        aiCodexIntegrationDestination: 'none', managerState: {path: paths.bootstrapStateRoot, reason: '中断后的 bootstrap 只允许新的 exact recovery confirmation；旧确认不可重用'},
        disk: {requiredBytes: 0, availableBytes: probeDiskAvailableBytes(paths.installRoot).availableBytes},
        pathEffects: {creates: [], replaces: ['bounded lifecycle recovery state'], deletes: ['only incomplete owned staging/output proven by signed recovery scope'], preserves: ['all product projects', 'all .foundation/** project data', 'all unowned paths']},
        preConfirmWrites: ['bootstrap launcher lock', 'new exact recovery plan record', 'new exact manager session record'],
        projects: {scanCount: 0, modifications: 'none'}, rollbackRecovery: 'new exact recovery effect; interrupted authorization is never reused', cleanup: 'recovery session becomes a terminal pointer; installed state or a fresh install plan becomes authoritative after recovery',
      };
      const plan = resealPlan({...base, creates: [], replacements: bootstrap.pathEffects.replaces, deletes: bootstrap.pathEffects.deletes, preserves: bootstrap.pathEffects.preserves, fileCount: 0, byteCount: 0}, bootstrap);
      return {kind: 'bootstrap', phase: 'recovery', paths, checked, plan, preview: bootstrap};
    }
    if (fs.existsSync(paths.installRoot)) {
      const inspected = inspectInstallation(paths.installRoot);
      if (inspected.installed === true && inspected.current) return {kind: 'transfer-installed-authority', paths};
    }
  }
  let reinstall = null;
  if (fs.existsSync(paths.installRoot)) {
    const allowed = new Set(['state']);
    const entries = fs.readdirSync(paths.installRoot);
    let verifiedReinstall = false;
    const resultFile = path.join(paths.installRoot, 'uninstall-result.json');
    if (deriveTrustedLifecycleAuthority().reuseInstalledAuthority && fs.existsSync(resultFile) && fs.realpathSync(resultFile) === resultFile && fs.lstatSync(resultFile).isFile() && fs.statSync(resultFile).size <= 4 * 1024 * 1024) {
      const {integrity, ...previous} = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      const inspected = inspectInstallation(paths.installRoot);
      verifiedReinstall = verifyTrustedPayload(previous, integrity) && previous.state === 'uninstalled' && ['app-only', 'app-and-runtime'].includes(previous.mode) && typeof previous.installId === 'string' && inspected.installed === false && inspected.recovery.status === 'clean';
      if (verifiedReinstall) reinstall = {installId: previous.installId, receiptHash: sha256(fs.readFileSync(resultFile))};
    }
    if (entries.some((entry) => !allowed.has(entry)) && !verifiedReinstall) throw bootstrapError('INSTALLATION_ROOT_OCCUPIED', '安装根有未知内容或未验证的卸载状态；不覆盖。重装必须有同一 authority 的有效卸载回执', {entries});
  }
  const disk = probeDiskAvailableBytes(paths.installRoot);
  const binding = {path: checked.root, manifestHash: checked.manifest.candidateHash, runtimeHash: runtime.sha256, bytes: checked.manifest.totalBytes, fileCount: checked.manifest.files.length + 1, version: checked.manifest.productVersion, acquisition: 'local-ingestion'};
  const base = createLifecyclePlan({operation: 'install', profile: 'core', targetRoot: paths.installRoot, sandboxRoot: paths.bootstrapStateRoot, targetVersion: checked.manifest.productVersion, candidate: binding, now, ttlMs});
  if (reinstall && reinstall.installId !== base.installId) throw bootstrapError('REINSTALL_IDENTITY_MISMATCH', '卸载回执与所选目录的安装身份不一致；不自动迁移安装');
  const bootstrap = {
    schemaVersion: '1.0.0',
    reinstall,
    platformPathAuthority: paths.authority,
    product: {name: 'AI Product Foundation Kit', version: checked.manifest.productVersion, buildIdentity: checked.manifest.build.identity},
    candidate: {root: checked.root, candidateHash: checked.manifest.candidateHash, trustPolicy: trust.policy, signatureStatus: checked.manifest.signature.status, distribution: trust.policy === 'verified-distribution' ? 'verified-artifact-system-trust-not-asserted' : 'local-only', productionRelease: checked.manifest.signature.productionDistribution === true, runtimeHash: runtime.sha256},
    installationRoot: paths.installRoot,
    bundledRuntimePath: path.join(checked.root, 'payload', ...checked.manifest.runtime.path.split('/')),
    aiCodexIntegrationDestination: 'none',
    managerState: {path: paths.bootstrapStateRoot, reason: '未安装 host 在用户确认前仅保存 exact plan 与本地管理器 session；成功后 installed state 成为唯一权威'},
    disk: {requiredBytes: checked.manifest.totalBytes, availableBytes: disk.availableBytes, probePath: disk.probePath},
    pathEffects: {creates: ['installation root', 'versioned application', 'private runtime', 'bin launcher', 'signed current/index/receipt/operation state'], replaces: [], deletes: [], preserves: ['all product projects', 'all .foundation/** project data', 'all unowned paths']},
    preConfirmWrites: ['bootstrap launcher lock', 'bootstrap authority key', 'exact plan record', 'exact manager session record'],
    projects: {scanCount: 0, modifications: 'none'},
    rollbackRecovery: 'journaled apply; pre-confirm cancel/abandon/expiry installs nothing; interrupted consumed apply requires bounded installed-state recovery and never reuses confirmation',
    cleanup: 'active bootstrap plan/session is reduced to one terminal audit pointer; installed state is authoritative after success',
  };
  const plan = resealPlan({...base, creates: bootstrap.pathEffects.creates, replacements: [], deletes: [], preserves: bootstrap.pathEffects.preserves, fileCount: binding.fileCount, byteCount: binding.bytes}, bootstrap);
  return {kind: 'bootstrap', paths, checked, plan, preview: bootstrap};
}

export function routeToInstalledAuthority(paths, output = console) {
  const installedLauncher = path.join(paths.installRoot, 'bin', 'foundation-kit');
  if (!fs.existsSync(installedLauncher) || fs.lstatSync(installedLauncher).isSymbolicLink() || !fs.statSync(installedLauncher).isFile()) throw bootstrapError('INSTALLED_AUTHORITY_ROUTE_FAILED', '平台安装根存在但 installed launcher 缺失或无效；拒绝创建第二套安装');
  // Presence is not integrity. Validate signed current/index/receipts and
  // runtime/shim/app bytes before executing any target-owned launcher.
  const existing = inspectCurrentInstallationAuthority(paths.installRoot);
  verifyCurrentInstallationAppAuthority(existing);
  const result = spawnSync(installedLauncher, ['manager', 'inspect', '--root', paths.installRoot], {encoding: 'utf8', env: {...sanitizeNodeStartupEnvironment(), PATH: ''}});
  if (result.status !== 0) throw bootstrapError('INSTALLED_AUTHORITY_ROUTE_FAILED', 'installed Runtime 未能验证并接管 lifecycle inspect；拒绝覆盖或创建第二套安装', {status: result.status, stderr: result.stderr});
  output.log(JSON.stringify({ok: true, status: 'ALREADY_INSTALLED_ROUTED_TO_INSTALLED_AUTHORITY', installationRoot: paths.installRoot, installedLauncher, installedResult: JSON.parse(result.stdout), duplicateInstallationCreated: false}, null, 2));
}

export function runFirstInstallBootstrap(output = console, {destination = null, browser = 'system'} = {}) {
  const prepared = createFirstInstallBootstrapPlan({destination});
  if (prepared.kind === 'installed') return routeToInstalledAuthority(prepared.paths, output);
  if (prepared.kind === 'transfer-installed-authority') {
    const releaseLock = acquireBootstrapLauncherLock(prepared.paths.bootstrapStateRoot);
    try { transferBootstrapAuthorityToInstalledState(); }
    finally { releaseLock(); }
    return routeToInstalledAuthority(prepared.paths, output);
  }
  const releaseLock = acquireBootstrapLauncherLock(prepared.paths.bootstrapStateRoot);
  let server;
  let recovered;
  try {
    recovered = recoverAbandonedBootstrapState(prepared.paths.bootstrapStateRoot);
    loadTrustedAuthorityKey({create: true});
    server = createLocalLifecycleManagerServer({plan: prepared.plan, stateRoot: prepared.paths.bootstrapStateRoot});
  } catch (error) {
    releaseLock();
    throw error;
  }
  let normalCleanupRecorded = false;
  server.on('foundation-operation-state', session => output.log(JSON.stringify({status:'FOUNDATION_OPERATION_STATE', sessionId:session.sessionId, operationId:session.operationId, operation:session.operation, state:session.state})));
  const cleanupForSignal = (signal) => {
    if (normalCleanupRecorded) return;
    normalCleanupRecorded = true;
    const terminal = server.terminalizeBootstrapNoInstall({state: 'shutdown-no-install', status: 'SHUTDOWN_NO_INSTALL', reason: `normal-${signal.toLowerCase()}`});
    output.log(JSON.stringify({ok: true, status: 'BOOTSTRAP_NORMAL_SHUTDOWN_NO_INSTALL', signal, terminalState: terminal.state, mutationPerformed: false}, null, 2));
    if (!terminal.won && server.listening) server.close();
  };
  const onSigint = () => cleanupForSignal('SIGINT');
  const onSigterm = () => cleanupForSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  server.on('close', () => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    releaseLock();
    const session = server.managerSession;
    output.log(JSON.stringify({ok: session.state === 'completed', status: 'BOOTSTRAP_OPERATION_ENDED', sessionId: session.sessionId, state: session.state, result: session.result || null, failure: session.failure || null, installationRoot: prepared.paths.installRoot, next: session.state === 'completed' ? 'verify-installed-launcher-and-current-state' : 'inspect-operation-state-before-retry'}, null, 2));
  });
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const browserResult = browser === 'codex' ? {opened: false, requiredHostAction: 'open-returned-loopback-url-in-codex-browser', userConfirmationRequired: true} : openFoundationManagerUrl(url);
    output.log(JSON.stringify({ok: true, status: 'AWAITING_FOUNDATION_UI_CONFIRMATION', url, sessionId: server.managerSession.sessionId, planId: prepared.plan.planId, planHash: prepared.plan.integrity.hash, effectHash: server.managerSession.effectHash, candidateStatus: prepared.preview.candidate.trustPolicy === 'local-development' ? 'unsigned / local-only / not a production release' : 'verified-detached-signature / macOS policy applies separately', installationRoot: prepared.paths.installRoot, bootstrapStateRoot: prepared.paths.bootstrapStateRoot, expiresAt: server.managerSession.expiresAt, closeBehavior: `关闭页面不会安装；launcher 将在 ${new Date(server.managerSession.expiresAt).toISOString()} 自动退出`, projectScanCount: 0, projectModifications: 'none', browser: browserResult, recoveredAbandonedSessions: recovered.length, mutationPerformed: false, managerStateMutationPerformed: true}, null, 2));
  });
  server.on('error', (error) => {
    server.terminalizeBootstrapNoInstall({state: 'shutdown-no-install', status: 'SERVER_ERROR_NO_INSTALL', reason: 'loopback-server-error'});
    releaseLock();
    output.error(`错误：${error.message}`);
    process.exitCode = 1;
  });
  return server;
}
