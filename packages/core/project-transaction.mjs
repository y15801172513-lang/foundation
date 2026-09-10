import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';
import {classifyProcessOwner, observeProcessFingerprint} from './process-owner.mjs';
import {operationCheckpoint} from './runtime-surface.mjs';

export const PROJECT_TRANSACTION_VERSION = '1.0.0';
export const PROJECT_TRANSACTION_CHECKPOINTS = Object.freeze([
  'after-exclusive-guard',
  'after-durable-pre-intent',
  'after-snapshot-durable',
  'after-confirmation-consume',
  'after-target-apply',
  'after-postcondition-verify',
  'after-durable-completion',
]);

function failure(code, message, details = {}, retryable = false) {
  throw new LifecycleError(code, message, {stage: 'project-transaction', retryable, recovery: retryable ? '读取持久 transaction 状态；live owner 结束后由 Foundation manager 恢复，不得重放确认' : '保留 transaction evidence 并停止；不要手工扩大或重建计划', details});
}

function fsyncDirectory(directory) {
  let descriptor;
  try { descriptor = fs.openSync(directory, 'r'); fs.fsyncSync(descriptor); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function assertPlainDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(directory) !== directory) failure('PROJECT_TRANSACTION_STATE_ROOT_INVALID', `transaction state 不是稳定普通目录：${directory}`);
}

function statePaths(stateRoot) {
  if (typeof stateRoot !== 'string' || !path.isAbsolute(stateRoot) || path.resolve(stateRoot) === path.parse(path.resolve(stateRoot)).root) failure('PROJECT_TRANSACTION_STATE_ROOT_INVALID', 'transaction stateRoot 必须是非根绝对路径');
  const root = path.resolve(stateRoot);
  const existing = (() => { let cursor = root; while (!fs.existsSync(cursor) && path.dirname(cursor) !== cursor) cursor = path.dirname(cursor); return cursor; })();
  if (!fs.existsSync(existing) || fs.lstatSync(existing).isSymbolicLink() || fs.realpathSync(existing) !== existing) failure('PROJECT_TRANSACTION_STATE_ROOT_INVALID', 'transaction stateRoot 的已存在祖先不稳定或是符号链接');
  return {root, transactions: path.join(root, 'transactions'), backups: path.join(root, 'transaction-backups'), guards: path.join(root, 'transaction-guards')};
}

function ensureState(paths) {
  for (const directory of [paths.root, paths.transactions, paths.backups, paths.guards]) {
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    assertPlainDirectory(directory);
  }
}

function signed(payload) {
  const normalized = JSON.parse(JSON.stringify(payload));
  return {...normalized, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(normalized))}};
}

function verified(document, code = 'PROJECT_TRANSACTION_JOURNAL_TAMPERED') {
  const {integrity, ...payload} = document || {};
  if (integrity?.algorithm !== 'sha256' || integrity.hash !== sha256(canonicalStringify(payload))) failure(code, 'project transaction journal 完整性校验失败');
  return payload;
}

function writeJsonAtomic(file, value, {exclusive = false} = {}) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  if (exclusive) {
    try { fs.linkSync(temporary, file); }
    catch (error) {
      fs.rmSync(temporary, {force: true});
      if (error.code === 'EEXIST') failure('PROJECT_TRANSACTION_REPLAYED', '相同 operation 已存在持久 transaction，拒绝重放', {file}, true);
      throw error;
    }
    fs.rmSync(temporary, {force: true});
  } else fs.renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

function readJournal(file) {
  return verified(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function updateJournal(record, status, checkpoint = null, extra = {}) {
  const current = readJournal(record.file);
  if (current.operationId !== record.payload.operationId || current.intentHash !== record.payload.intentHash) failure('PROJECT_TRANSACTION_INTENT_CHANGED', 'project transaction identity 在 checkpoint 前变化');
  const checkpoints = [...(current.checkpoints || []), ...(checkpoint ? [{name: checkpoint, at: Date.now()}] : [])];
  const payload = {...current, ...extra, status, checkpoints, updatedAt: Date.now()};
  writeJsonAtomic(record.file, signed(payload));
  record.payload = payload;
  return record;
}

function normalizeScope(scope) {
  if (!scope || typeof scope.root !== 'string' || !path.isAbsolute(scope.root) || !Array.isArray(scope.paths)) failure('PROJECT_TRANSACTION_SCOPE_INVALID', 'transaction scope 缺少绝对 root 或 paths');
  const root = path.resolve(scope.root);
  if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory() || fs.realpathSync(root) !== root) failure('PROJECT_TRANSACTION_SCOPE_INVALID', `transaction root 不稳定：${root}`);
  const paths = [...new Set(scope.paths.map((entry) => String(entry).replaceAll('\\', '/')).filter(Boolean))].sort();
  for (const relative of paths) if (path.isAbsolute(relative) || relative.split('/').includes('..')) failure('PROJECT_TRANSACTION_SCOPE_INVALID', `transaction relative path 越界：${relative}`);
  return {root, paths};
}

function walkSnapshot(root, absolute, relative, backupRoot, records, scopeIndex) {
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) failure('PROJECT_TRANSACTION_SYMLINK_REJECTED', `transaction snapshot 拒绝符号链接：${relative}`);
  if (stat.isDirectory()) {
    records.push({path: relative, type: 'directory', mode: stat.mode & 0o777});
    for (const name of fs.readdirSync(absolute).sort((a, b) => a.localeCompare(b, 'en'))) walkSnapshot(root, path.join(absolute, name), `${relative}/${name}`, backupRoot, records, scopeIndex);
    return;
  }
  if (!stat.isFile()) failure('PROJECT_TRANSACTION_UNSUPPORTED_TYPE', `transaction snapshot 拒绝非普通类型：${relative}`);
  const bytes = fs.readFileSync(absolute);
  const backup = `${scopeIndex.toString().padStart(4, '0')}-${records.length.toString().padStart(8, '0')}.bin`;
  const backupFile = path.join(backupRoot, backup);
  const descriptor = fs.openSync(backupFile, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  records.push({path: relative, type: 'file', mode: stat.mode & 0o777, byteLength: bytes.length, sha256: sha256(bytes), backup});
}

function captureScopes(scopes, backupRoot) {
  fs.mkdirSync(backupRoot, {recursive: false, mode: 0o700});
  const captured = [];
  for (const [scopeIndex, raw] of scopes.map(normalizeScope).entries()) {
    const records = [];
    for (const relative of raw.paths) {
      const absolute = path.join(raw.root, ...relative.split('/'));
      if (!fs.existsSync(absolute)) records.push({path: relative, type: 'missing'});
      else walkSnapshot(raw.root, absolute, relative, backupRoot, records, scopeIndex);
    }
    captured.push({scopeIndex, root: raw.root, paths: raw.paths, records});
  }
  fsyncDirectory(backupRoot);
  return captured;
}

function assertNoUnsafeCurrent(absolute) {
  if (!fs.existsSync(absolute)) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) failure('PROJECT_TRANSACTION_RECOVERY_SYMLINK', `rollback 拒绝符号链接：${absolute}`);
  if (stat.isDirectory()) for (const name of fs.readdirSync(absolute)) assertNoUnsafeCurrent(path.join(absolute, name));
  else if (!stat.isFile()) failure('PROJECT_TRANSACTION_RECOVERY_UNSUPPORTED_TYPE', `rollback 拒绝非普通类型：${absolute}`);
}

function removeCurrent(absolute) {
  if (!fs.existsSync(absolute)) return;
  assertNoUnsafeCurrent(absolute);
  fs.rmSync(absolute, {recursive: true, force: true});
}

function restoreScopes(captured, backupRoot) {
  for (const scope of captured) {
    for (const relative of [...scope.paths].sort((a, b) => b.length - a.length)) removeCurrent(path.join(scope.root, ...relative.split('/')));
    const directories = scope.records.filter((record) => record.type === 'directory').sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    for (const record of directories) { const target = path.join(scope.root, ...record.path.split('/')); fs.mkdirSync(target, {recursive: true, mode: record.mode}); fs.chmodSync(target, record.mode); }
    for (const record of scope.records.filter((entry) => entry.type === 'file')) {
      const source = path.join(backupRoot, record.backup);
      const bytes = fs.readFileSync(source);
      if (bytes.length !== record.byteLength || sha256(bytes) !== record.sha256) failure('PROJECT_TRANSACTION_BACKUP_TAMPERED', `transaction backup 已变化：${record.path}`);
      const target = path.join(scope.root, ...record.path.split('/'));
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, bytes, {mode: record.mode});
      fs.chmodSync(target, record.mode);
    }
  }
}

function acquireGuard(paths, operationId, intentHash) {
  const observed = observeProcessFingerprint(process.pid);
  if (observed.state !== 'observed') failure('PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', '无法取得 process-instance 指纹', {}, true);
  const file = path.join(paths.guards, `${operationId}.json`);
  const owner = {schemaVersion: PROJECT_TRANSACTION_VERSION, operationId, intentHash, pid: process.pid, processFingerprint: observed.fingerprint, ownerNonce: crypto.randomUUID(), acquiredAt: Date.now()};
  try { writeJsonAtomic(file, signed(owner), {exclusive: true}); }
  catch (error) {
    if (error.code === 'PROJECT_TRANSACTION_REPLAYED') failure('PROJECT_TRANSACTION_LOCKED', `operation ${operationId} 已由另一个 process-instance 取得`, {operationId}, true);
    throw error;
  }
  return {file, owner};
}

function releaseGuard(guard) {
  if (!guard || !fs.existsSync(guard.file)) return;
  try {
    const current = verified(JSON.parse(fs.readFileSync(guard.file, 'utf8')), 'PROJECT_TRANSACTION_GUARD_TAMPERED');
    if (current.ownerNonce === guard.owner.ownerNonce) { fs.rmSync(guard.file); fsyncDirectory(path.dirname(guard.file)); }
  } catch {}
}

function checkpoint(record, name, status = record.payload.status, extra = {}) {
  updateJournal(record, status, name, extra);
  operationCheckpoint(`project-transaction:${record.payload.operation}:${name}`);
}

export function executeProjectTransaction({operationId, operation, planHash, expectedBeforeState, stateRoot, scopes, consume, apply, verify, completion = {}, recoveryPolicy = null}) {
  if (typeof operationId !== 'string' || !operationId || typeof operation !== 'string' || !/^[0-9a-f]{64}$/u.test(planHash || '') || typeof consume !== 'function' || typeof apply !== 'function' || typeof verify !== 'function') failure('PROJECT_TRANSACTION_INPUT_INVALID', 'transaction 缺少 operation/planHash/consume/apply/verify');
  const paths = statePaths(stateRoot);
  ensureState(paths);
  const intentHash = sha256(canonicalStringify({schemaVersion: PROJECT_TRANSACTION_VERSION, operationId, operation, planHash, expectedBeforeState, scopes: scopes.map(normalizeScope), recoveryPolicy}));
  const guard = acquireGuard(paths, operationId, intentHash);
  let record = null;
  let leaveForRecovery = false;
  try {
    operationCheckpoint(`project-transaction:${operation}:after-exclusive-guard`);
    const journalFile = path.join(paths.transactions, `${operationId}.json`);
    const backupRoot = path.join(paths.backups, operationId);
    const payload = {schemaVersion: PROJECT_TRANSACTION_VERSION, operationId, operation, planHash, intentHash, expectedBeforeState, scopes: scopes.map(normalizeScope), recoveryPolicy, backupRoot, status: 'planned', checkpoints: [{name: 'after-exclusive-guard', at: Date.now()}], owner: guard.owner, createdAt: Date.now(), updatedAt: Date.now()};
    writeJsonAtomic(journalFile, signed(payload), {exclusive: true});
    record = {file: journalFile, payload};
    checkpoint(record, 'after-durable-pre-intent');
    const captured = captureScopes(scopes, backupRoot);
    checkpoint(record, 'after-snapshot-durable', 'snapshot-durable', {captured, snapshotHash: sha256(canonicalStringify(captured))});
    const consumption = consume();
    checkpoint(record, 'after-confirmation-consume', 'consumed', {consumption});
    const result = apply({checkpoint: (name, extra = {}) => checkpoint(record, `write:${name}`, 'applying', extra)});
    checkpoint(record, 'after-target-apply', 'applied', {result});
    const verification = verify(result);
    checkpoint(record, 'after-postcondition-verify', 'verified', {verification});
    updateJournal(record, 'completed', 'after-durable-completion', {completion: {...completion, result, verification}, completedAt: Date.now()});
    operationCheckpoint(`project-transaction:${operation}:after-durable-completion`);
    return {...result, transaction: {operationId, state: 'completed', journal: journalFile, snapshotHash: record.payload.snapshotHash, verification}};
  } catch (error) {
    if (error.code === 'FAULT_INJECTED') { leaveForRecovery = true; throw error; }
    if (record?.payload?.captured) {
      try {
        restoreScopes(record.payload.captured, record.payload.backupRoot);
        updateJournal(record, 'rolled-back', 'rollback-complete', {failedAt: Date.now(), failure: {code: error.code || 'PROJECT_TRANSACTION_FAILED', message: error.message}});
      } catch (recoveryError) {
        updateJournal(record, 'manual-action-required', 'rollback-failed', {failedAt: Date.now(), failure: {code: error.code || 'PROJECT_TRANSACTION_FAILED', message: error.message}, recoveryFailure: {code: recoveryError.code || 'PROJECT_TRANSACTION_RECOVERY_FAILED', message: recoveryError.message}});
      }
    }
    throw error;
  } finally {
    if (!leaveForRecovery) releaseGuard(guard);
  }
}

export function inspectProjectTransactions({stateRoot}) {
  const paths = statePaths(stateRoot);
  if (!fs.existsSync(paths.transactions)) return {schemaVersion: PROJECT_TRANSACTION_VERSION, state: 'clean', transactions: [], mutationPerformed: false};
  const transactions = [];
  for (const name of fs.readdirSync(paths.transactions).filter((entry) => entry.endsWith('.json')).sort()) {
    try { const payload = readJournal(path.join(paths.transactions, name)); transactions.push({operationId: payload.operationId, operation: payload.operation, status: payload.status, intentHash: payload.intentHash, checkpoints: payload.checkpoints}); }
    catch (error) { transactions.push({operationId: name.slice(0, -5), status: 'manual-action-required', error: {code: error.code || 'PROJECT_TRANSACTION_JOURNAL_INVALID'}}); }
  }
  const pending = transactions.filter((entry) => !['completed', 'rolled-back'].includes(entry.status));
  return {schemaVersion: PROJECT_TRANSACTION_VERSION, state: pending.length ? 'recovery-required' : 'clean', transactions, mutationPerformed: false};
}

export function recoverProjectTransactions({stateRoot}) {
  const paths = statePaths(stateRoot);
  if (!fs.existsSync(paths.transactions) && !fs.existsSync(paths.guards)) return {schemaVersion: PROJECT_TRANSACTION_VERSION, state: 'clean', recovered: [], mutationPerformed: false};
  const recovered = [];
  const transactionNames = fs.existsSync(paths.transactions) ? fs.readdirSync(paths.transactions).filter((entry) => entry.endsWith('.json')).sort() : [];
  const transactionIds = new Set(transactionNames.map((name) => name.slice(0, -5)));
  if (fs.existsSync(paths.guards)) for (const name of fs.readdirSync(paths.guards).filter((entry) => entry.endsWith('.json')).sort()) {
    const operationId = name.slice(0, -5);
    if (transactionIds.has(operationId)) continue;
    const guardFile = path.join(paths.guards, name);
    const owner = verified(JSON.parse(fs.readFileSync(guardFile, 'utf8')), 'PROJECT_TRANSACTION_GUARD_TAMPERED');
    if (owner.operationId !== operationId) failure('PROJECT_TRANSACTION_GUARD_SCOPE_MISMATCH', 'orphan guard operation identity 不匹配');
    const ownerState = classifyProcessOwner(owner);
    if (ownerState === 'live') { recovered.push({operationId, outcome: 'live-owner-not-taken-over'}); continue; }
    if (!['dead', 'stale-instance'].includes(ownerState)) failure('PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', '无法验证 orphan project transaction owner', {operationId}, true);
    fs.rmSync(guardFile); fsyncDirectory(paths.guards);
    recovered.push({operationId, outcome: 'pre-intent-crash-no-target-writes'});
  }
  for (const name of transactionNames) {
    const file = path.join(paths.transactions, name);
    const payload = readJournal(file);
    const guardFile = path.join(paths.guards, `${payload.operationId}.json`);
    if (['completed', 'rolled-back'].includes(payload.status)) {
      if (fs.existsSync(guardFile)) {
        const owner = verified(JSON.parse(fs.readFileSync(guardFile, 'utf8')), 'PROJECT_TRANSACTION_GUARD_TAMPERED');
        if (owner.operationId !== payload.operationId || owner.intentHash !== payload.intentHash) failure('PROJECT_TRANSACTION_GUARD_SCOPE_MISMATCH', 'terminal transaction guard 不属于持久 intent');
        const state = classifyProcessOwner(owner);
        if (state === 'live') continue;
        if (!['dead', 'stale-instance'].includes(state)) failure('PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', '无法验证 terminal transaction owner', {operationId: payload.operationId}, true);
        fs.rmSync(guardFile); fsyncDirectory(paths.guards);
      }
      continue;
    }
    if (!fs.existsSync(guardFile)) failure('PROJECT_TRANSACTION_GUARD_MISSING', `transaction ${payload.operationId} 的 process guard 缺失`);
    const owner = verified(JSON.parse(fs.readFileSync(guardFile, 'utf8')), 'PROJECT_TRANSACTION_GUARD_TAMPERED');
    if (owner.operationId !== payload.operationId || owner.intentHash !== payload.intentHash || owner.ownerNonce !== payload.owner?.ownerNonce) failure('PROJECT_TRANSACTION_GUARD_SCOPE_MISMATCH', 'stale process guard 与持久 intent 不一致');
    const ownerState = classifyProcessOwner(owner);
    if (ownerState === 'live') { recovered.push({operationId: payload.operationId, outcome: 'live-owner-not-taken-over'}); continue; }
    if (!['dead', 'stale-instance'].includes(ownerState)) failure('PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', '无法验证 stale project transaction owner', {operationId: payload.operationId}, true);
    const record = {file, payload};
    if (!payload.captured) {
      if (payload.status !== 'planned' || payload.checkpoints?.some((entry) => !['after-exclusive-guard', 'after-durable-pre-intent'].includes(entry.name))) failure('PROJECT_TRANSACTION_SNAPSHOT_INVALID', `transaction ${payload.operationId} 在可能写目标后缺少 snapshot`);
      updateJournal(record, 'rolled-back', 'restart-no-target-write-complete', {recoveredAt: Date.now(), recoveredOwnerState: ownerState});
      fs.rmSync(guardFile); fsyncDirectory(paths.guards);
      recovered.push({operationId: payload.operationId, outcome: 'pre-snapshot-crash-no-target-writes'});
      continue;
    }
    if (payload.snapshotHash !== sha256(canonicalStringify(payload.captured))) failure('PROJECT_TRANSACTION_SNAPSHOT_INVALID', `transaction ${payload.operationId} snapshot 完整性无效`);
    const resumeCheckpoint = payload.recoveryPolicy?.resumeAfterCheckpoint;
    if (resumeCheckpoint && payload.checkpoints?.some((entry) => entry.name === `write:${resumeCheckpoint}`)) {
      updateJournal(record, 'completed', 'restart-resume-complete', {recoveredAt: Date.now(), recoveredOwnerState: ownerState, completion: {result: payload.resumeResult || null, recovered: true}});
      fs.rmSync(guardFile); fsyncDirectory(paths.guards);
      recovered.push({operationId: payload.operationId, outcome: 'resumed-confirmed-exact-plan', snapshotHash: payload.snapshotHash});
      continue;
    }
    restoreScopes(payload.captured, payload.backupRoot);
    updateJournal(record, 'rolled-back', 'restart-rollback-complete', {recoveredAt: Date.now(), recoveredOwnerState: ownerState});
    fs.rmSync(guardFile); fsyncDirectory(paths.guards);
    recovered.push({operationId: payload.operationId, outcome: 'byte-exact-rolled-back', snapshotHash: payload.snapshotHash});
  }
  return {schemaVersion: PROJECT_TRANSACTION_VERSION, state: 'recovered', recovered, mutationPerformed: recovered.some((entry) => entry.outcome === 'byte-exact-rolled-back')};
}
