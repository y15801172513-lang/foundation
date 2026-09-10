import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';
import {classifyProcessOwner, observeProcessFingerprint} from './process-owner.mjs';
import {deriveTrustedLifecycleAuthority, loadTrustedAuthorityKey, signTrustedPayload, verifyTrustedPayload} from './trusted-authority.mjs';

function fsyncDirectory(directory) {
  let descriptor;
  try { descriptor = fs.openSync(directory, 'r'); fs.fsyncSync(descriptor); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function assertPlainDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(directory) !== directory) throw new LifecycleError('TRUSTED_INTENT_LEDGER_INVALID', `可信预意图账本路径无效：${directory}`, {stage: 'trusted-intent'});
}

function ensureLedgerDirectory(directory, parent) {
  assertPlainDirectory(parent);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {recursive: false, mode: 0o700});
    fsyncDirectory(parent);
  }
  assertPlainDirectory(directory);
}

function ledgerPaths({create = true} = {}) {
  const authority = deriveTrustedLifecycleAuthority();
  const root = path.join(authority.authorityStateRoot || authority.trustedRootRealPath, '.foundation-lifecycle-authority');
  const intents = path.join(root, 'runtime-intents');
  const guards = path.join(root, 'runtime-target-guards');
  if (!create && !fs.existsSync(root)) return {authority, root, intents, guards, available: false};
  const key = loadTrustedAuthorityKey();
  if (!create) {
    assertPlainDirectory(root);
    if (fs.existsSync(intents)) assertPlainDirectory(intents);
    if (fs.existsSync(guards)) assertPlainDirectory(guards);
    return {authority, root, intents, guards, available: fs.existsSync(intents)};
  }
  ensureLedgerDirectory(intents, root);
  ensureLedgerDirectory(guards, root);
  return {authority, root, intents, guards, available: true};
}

function writeAtomic(file, document, {exclusive = false} = {}) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, exclusive ? 'wx' : 'wx', 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(document, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  if (exclusive) {
    try { fs.linkSync(temporary, file); }
    catch (error) {
      fs.rmSync(temporary);
      if (error.code === 'EEXIST') throw new LifecycleError('TRUSTED_INTENT_ALREADY_EXISTS', '同一 operation 的可信预意图已存在，必须先恢复或重新计划', {stage: 'trusted-intent', retryable: true});
      throw error;
    }
    fs.rmSync(temporary);
  } else fs.renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

function signed(payload) {
  return {...payload, integrity: signTrustedPayload(payload)};
}

function signedWithSnapshot(payload, signing) {
  if (!signing) return signed(payload);
  return {...payload, integrity: {algorithm: 'hmac-sha256', keyId: signing.keyId, hash: crypto.createHmac('sha256', signing.key).update(canonicalStringify(payload)).digest('hex')}};
}

function readSigned(file, code = 'TRUSTED_INTENT_INVALID') {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const {integrity, ...payload} = document;
  if (!verifyTrustedPayload(payload, integrity)) throw new LifecycleError(code, `可信预意图 HMAC 无效：${file}`, {stage: 'trusted-intent'});
  return payload;
}

function targetKey(target) {
  return sha256(canonicalStringify({schemaVersion: '1.0.0', target: path.resolve(target)}));
}

function ownerPayload(intent) {
  const observed = observeProcessFingerprint(process.pid);
  if (observed.state !== 'observed') throw new LifecycleError('PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', '无法取得当前进程实例启动指纹，拒绝取得可信目标互斥权', {stage: 'trusted-intent', retryable: true});
  return {schemaVersion: '1.0.0', intentId: intent.intentId, target: intent.target, targetKey: targetKey(intent.target), pid: process.pid, processFingerprint: observed.fingerprint, ownerNonce: crypto.randomUUID(), acquiredAt: Date.now()};
}

export function writeTrustedPreIntent({intentId, operationClass, operation, effect, authorization, planHash, target, beforeState, now = Date.now()}) {
  if (!intentId || !effect?.effectHash || authorization?.effectHash !== effect.effectHash || !/^[0-9a-f]{64}$/u.test(planHash || '') || typeof target !== 'string' || !path.isAbsolute(target)) throw new LifecycleError('TRUSTED_PRE_INTENT_INVALID', '可信预意图缺少 exact effect、authorization、plan hash 或绝对目标', {stage: 'trusted-intent'});
  const paths = ledgerPaths();
  const confirmationKey = String(authorization.confirmationId || authorization.authorizationId || '').replaceAll(/[^a-z0-9._-]/giu, '_');
  if (!confirmationKey) throw new LifecycleError('TRUSTED_PRE_INTENT_INVALID', '可信预意图缺少 manager confirmation identity', {stage: 'trusted-intent'});
  const file = path.join(paths.intents, `${intentId}-${confirmationKey}.json`);
  if (fs.existsSync(file)) throw new LifecycleError('TRUSTED_INTENT_ALREADY_EXISTS', '同一 operation 的可信预意图已存在，必须先恢复或重新计划', {stage: 'trusted-intent', retryable: true});
  const payload = {schemaVersion: '1.0.0', intentId, operationClass, operation, effectHash: effect.effectHash, authorization, planHash, target: path.resolve(target), targetKey: targetKey(target), beforeState, status: 'planned', createdAt: now, updatedAt: now};
  writeAtomic(file, signed(payload), {exclusive: true});
  return {file, payload, fileHash: sha256(fs.readFileSync(file))};
}

export function updateTrustedPreIntent(record, status, extra = {}, {signing = null} = {}) {
  if (!record?.file || !record?.payload || !['consumed', 'completed', 'cancelled', 'failed', 'manual-action-required'].includes(status)) throw new LifecycleError('TRUSTED_PRE_INTENT_TRANSITION_INVALID', '可信预意图状态迁移无效', {stage: 'trusted-intent'});
  const document = JSON.parse(fs.readFileSync(record.file, 'utf8'));
  const {integrity, ...current} = document;
  const valid = signing
    ? integrity?.algorithm === 'hmac-sha256' && integrity.keyId === signing.keyId && /^[0-9a-f]{64}$/u.test(integrity.hash || '') && crypto.timingSafeEqual(Buffer.from(integrity.hash, 'hex'), Buffer.from(signedWithSnapshot(current, signing).integrity.hash, 'hex'))
    : verifyTrustedPayload(current, integrity);
  if (!valid) throw new LifecycleError('TRUSTED_INTENT_INVALID', `可信预意图 HMAC 无效：${record.file}`, {stage: 'trusted-intent'});
  if (current.intentId !== record.payload.intentId || current.effectHash !== record.payload.effectHash || current.planHash !== record.payload.planHash) throw new LifecycleError('TRUSTED_PRE_INTENT_CHANGED', '可信预意图在状态迁移前已变化', {stage: 'trusted-intent'});
  const next = {...current, ...extra, status, updatedAt: Date.now()};
  writeAtomic(record.file, signedWithSnapshot(next, signing));
  record.payload = next;
  record.fileHash = sha256(fs.readFileSync(record.file));
  return record;
}

export function acquireTrustedTargetGuard(record, {recoverIntentIds = [], target = record?.payload?.target} = {}) {
  const current = readSigned(record.file);
  if (current.intentId !== record.payload.intentId || current.status !== 'planned') throw new LifecycleError('TRUSTED_PRE_INTENT_CHANGED', '取得目标互斥权前可信预意图已变化', {stage: 'trusted-intent'});
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new LifecycleError('TRUSTED_PRE_INTENT_INVALID', '可信互斥目标必须是绝对路径', {stage: 'trusted-intent'});
  const guardIntent = {...current, target: path.resolve(target), targetKey: targetKey(target)};
  const paths = ledgerPaths();
  const file = path.join(paths.guards, `${guardIntent.targetKey}.json`);
  const owner = ownerPayload(guardIntent);
  const deadline = Date.now() + 5_000;
  let descriptor;
  for (;;) {
    try { descriptor = fs.openSync(file, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing;
      try { existing = readSigned(file, 'TRUSTED_TARGET_GUARD_INVALID'); }
      catch (readError) { throw new LifecycleError('TRUSTED_TARGET_GUARD_INVALID', '目标互斥记录无法安全验证', {stage: 'trusted-intent', retryable: true, details: {causeCode: readError.code}}); }
      const ownerState = classifyProcessOwner(existing);
      if (['dead', 'stale-instance'].includes(ownerState) && recoverIntentIds.includes(existing.intentId)) {
        fs.rmSync(file);
        fsyncDirectory(paths.guards);
        continue;
      }
      if (ownerState === 'live' && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        continue;
      }
      const code = ownerState === 'live' ? 'TRUSTED_TARGET_LOCKED' : ownerState === 'unavailable' ? 'PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE' : 'TRUSTED_TARGET_RECOVERY_REQUIRED';
      throw new LifecycleError(code, ownerState === 'live' ? `目标正由 operation ${existing.intentId} 独占` : '目标存在未完成的可信互斥记录，必须先恢复', {stage: 'trusted-intent', retryable: true, details: {ownerState, intentId: existing.intentId, target: existing.target}});
    }
  }
  try { fs.writeFileSync(descriptor, `${JSON.stringify(signed(owner), null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fsyncDirectory(paths.guards);
  return {file, owner};
}

export function reclaimTrustedTargetGuard(target, recoverIntentIds) {
  const paths = ledgerPaths({create: false});
  if (!paths.available || !fs.existsSync(paths.guards)) return {reclaimed: false, reason: 'guard-absent'};
  const file = path.join(paths.guards, `${targetKey(target)}.json`);
  if (!fs.existsSync(file)) return {reclaimed: false, reason: 'guard-absent'};
  const existing = readSigned(file, 'TRUSTED_TARGET_GUARD_INVALID');
  const ownerState = classifyProcessOwner(existing);
  if (!recoverIntentIds.includes(existing.intentId)) throw new LifecycleError('TRUSTED_TARGET_RECOVERY_SCOPE_MISMATCH', '可信目标 guard 不属于已授权 recovery scope', {stage: 'trusted-intent'});
  if (!['dead', 'stale-instance'].includes(ownerState)) throw new LifecycleError(ownerState === 'live' ? 'TRUSTED_TARGET_LOCKED' : 'PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', '可信目标 guard 不能安全回收', {stage: 'trusted-intent', details: {ownerState, intentId: existing.intentId}});
  fs.rmSync(file);
  fsyncDirectory(paths.guards);
  return {reclaimed: true, intentId: existing.intentId, ownerState};
}

export function completeTrustedPreIntentRecovery(entries) {
  const paths = ledgerPaths({create: false});
  if (!paths.available) throw new LifecycleError('TRUSTED_INTENT_LEDGER_INVALID', 'recovery scope 对应的可信预意图账本不存在', {stage: 'trusted-intent'});
  const completed = [];
  for (const entry of entries) {
    let matched = null;
    for (const name of fs.readdirSync(paths.intents).filter((candidate) => candidate.endsWith('.json'))) {
      const file = path.join(paths.intents, name);
      if (sha256(fs.readFileSync(file)) !== entry.fileHash) continue;
      const payload = readSigned(file);
      if (payload.intentId === entry.intentId && payload.effectHash === entry.effectHash && payload.targetKey === entry.targetKey) { matched = {file, payload, fileHash: entry.fileHash}; break; }
    }
    if (!matched) throw new LifecycleError('TRUSTED_RECOVERY_INTENT_CHANGED', `recovery scope 的可信预意图缺失或变化：${entry.intentId}`, {stage: 'trusted-intent'});
    const terminal = matched.payload.status === 'planned' ? 'cancelled' : 'completed';
    updateTrustedPreIntent(matched, terminal, {recoveredAt: Date.now(), outcome: terminal === 'cancelled' ? 'cancelled-before-consume' : 'authorized-bounded-recovery'});
    completed.push({intentId: entry.intentId, status: terminal});
  }
  return completed;
}

export function verifyTrustedPreIntentScope(entries) {
  const paths = ledgerPaths({create: false});
  if (!paths.available) throw new LifecycleError('TRUSTED_INTENT_LEDGER_INVALID', 'recovery scope 对应的可信预意图账本不存在', {stage: 'trusted-intent'});
  const available = fs.readdirSync(paths.intents).filter((candidate) => candidate.endsWith('.json')).map((name) => path.join(paths.intents, name));
  for (const entry of entries) {
    const file = available.find((candidate) => sha256(fs.readFileSync(candidate)) === entry.fileHash);
    if (!file) throw new LifecycleError('TRUSTED_RECOVERY_INTENT_CHANGED', `recovery scope 的可信预意图缺失或变化：${entry.intentId}`, {stage: 'trusted-intent'});
    const payload = readSigned(file);
    if (payload.intentId !== entry.intentId || payload.effectHash !== entry.effectHash || payload.targetKey !== entry.targetKey || payload.planHash !== entry.planHash) throw new LifecycleError('TRUSTED_RECOVERY_INTENT_CHANGED', `recovery scope 的可信预意图 identity 已变化：${entry.intentId}`, {stage: 'trusted-intent'});
  }
  return {ok: true, count: entries.length};
}

export function releaseTrustedTargetGuard(guard, {signing = null} = {}) {
  if (!guard) return;
  try {
    const document = JSON.parse(fs.readFileSync(guard.file, 'utf8'));
    const {integrity, ...current} = document;
    const valid = signing
      ? integrity?.algorithm === 'hmac-sha256' && integrity.keyId === signing.keyId && /^[0-9a-f]{64}$/u.test(integrity.hash || '') && crypto.timingSafeEqual(Buffer.from(integrity.hash, 'hex'), Buffer.from(signedWithSnapshot(current, signing).integrity.hash, 'hex'))
      : verifyTrustedPayload(current, integrity);
    if (!valid) throw new LifecycleError('TRUSTED_TARGET_GUARD_INVALID', '目标互斥记录 HMAC 无效', {stage: 'trusted-intent'});
    if (current.ownerNonce === guard.owner.ownerNonce) {
      fs.rmSync(guard.file);
      fsyncDirectory(path.dirname(guard.file));
    }
  } catch {}
}

export function inspectTrustedPreIntents({target = null} = {}) {
  const paths = ledgerPaths({create: false});
  if (!paths.available) return {schemaVersion: '1.0.0', status: 'clean', pending: [], manual: [], live: [], mutationPerformed: false};
  const expectedKey = target ? targetKey(target) : null;
  const pending = [];
  const manual = [];
  const live = [];
  for (const name of fs.readdirSync(paths.intents).filter((entry) => entry.endsWith('.json')).sort()) {
    const file = path.join(paths.intents, name);
    try {
      const intent = readSigned(file);
      if (expectedKey && intent.targetKey !== expectedKey) continue;
      if (!['completed', 'cancelled'].includes(intent.status)) pending.push({...intent, fileHash: sha256(fs.readFileSync(file))});
    } catch (error) { manual.push({code: error.code || 'TRUSTED_INTENT_INVALID', file: name}); }
  }
  for (const intent of pending) {
    const guardFile = path.join(paths.guards, `${intent.targetKey}.json`);
    if (!fs.existsSync(guardFile)) {
      intent.guardState = 'unclaimed';
      if (intent.status !== 'planned') manual.push({code: 'TRUSTED_TARGET_GUARD_MISSING_AFTER_CONSUME', intentId: intent.intentId, target: intent.target});
      continue;
    }
    try {
      const owner = readSigned(guardFile, 'TRUSTED_TARGET_GUARD_INVALID');
      if (owner.intentId !== intent.intentId) { intent.guardState = 'blocked-by-other-operation'; continue; }
      const ownerState = classifyProcessOwner(owner);
      intent.guardState = ownerState;
      if (ownerState === 'live') live.push({intentId: intent.intentId, target: intent.target, pid: owner.pid, processFingerprint: owner.processFingerprint});
      else if (ownerState === 'unavailable') manual.push({code: 'PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', intentId: intent.intentId, target: intent.target});
    } catch (error) { manual.push({code: error.code || 'TRUSTED_TARGET_GUARD_INVALID', intentId: intent.intentId, target: intent.target}); }
  }
  const status = manual.length ? 'manual-action-required' : live.length ? 'live-operation' : pending.length ? 'recovery-required' : 'clean';
  return {schemaVersion: '1.0.0', status, pending, manual, live, mutationPerformed: false};
}
