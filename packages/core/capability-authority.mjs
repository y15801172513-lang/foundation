import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';
import {authorizationEffectForCapabilityPlan, consumeExactManagerConfirmationAtBoundary, failExactManagerConfirmationAtBoundary, publicManagerConfirmationEvidence, reserveExactManagerConfirmationAtBoundary} from './human-authorization.mjs';
import {inspectProjectAuthority} from './project-authority.mjs';
import {classifyProcessOwner, observeProcessFingerprint} from './process-owner.mjs';
import {deriveTrustedLifecycleAuthority, signTrustedPayload, verifyTrustedPayload} from './trusted-authority.mjs';
import {readCurrentPlatformAccount} from './platform-account.mjs';
import {operationCheckpoint} from './runtime-surface.mjs';
import {prepareCodexSkillRegistration, verifyCodexSkillRegistration, applyCodexSkillRegistration, prepareCodexSkillRemoval, verifyCodexSkillRemoval, applyCodexSkillRemoval, codexSkillReceiptContent} from './codex-skill-registration.mjs';
import {acquireTrustedTargetGuard, releaseTrustedTargetGuard, updateTrustedPreIntent, writeTrustedPreIntent, inspectTrustedPreIntents, verifyTrustedPreIntentScope, completeTrustedPreIntentRecovery} from './trusted-intent-ledger.mjs';

export const CAPABILITY_STATUS_CODES = Object.freeze([
  'FOUNDATION_NOT_INSTALLED',
  'FOUNDATION_INSTALL_UNHEALTHY',
  'CAPABILITY_NOT_INSTALLED',
  'CAPABILITY_STATE_MALFORMED',
  'CAPABILITY_STATE_INTEGRITY_INVALID',
  'CAPABILITY_STATE_SCHEMA_INVALID',
  'CAPABILITY_STATE_UNSAFE',
  'CAPABILITY_IDENTITY_MISMATCH',
  'CAPABILITY_NOT_REGISTERED',
  'CAPABILITY_REGISTRATION_STATE_MALFORMED',
  'CAPABILITY_REGISTRATION_STATE_INTEGRITY_INVALID',
  'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH',
  'CAPABILITY_HOST_REGISTRATION_UNAVAILABLE',
  'CAPABILITY_INACTIVE',
  'CAPABILITY_LIVE_OPERATION',
  'CAPABILITY_MANUAL_ACTION_REQUIRED',
  'PROJECT_NOT_ENABLED',
  'HUMAN_AUTHORIZATION_REQUIRED',
  'CAPABILITY_READY',
]);

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function signedPayload(document, code) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new LifecycleError(code, 'capability state 无效', {stage: 'capability'});
  const {integrity, ...payload} = document;
  if (!verifyTrustedPayload(payload, integrity)) throw new LifecycleError(code, 'capability state HMAC 无效', {stage: 'capability'});
  return payload;
}

function installationContext(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new LifecycleError('INSTALLATION_ROOT_REQUIRED', 'capability 必须绑定 Foundation 安装根', {stage: 'capability'});
  const target = path.resolve(root);
  const currentFile = path.join(target, 'state', 'current.json');
  if (!fs.existsSync(currentFile)) return {root: target, installed: false, current: null};
  try { return {root: target, installed: true, current: signedPayload(readJson(currentFile), 'CURRENT_IDENTITY_INVALID')}; }
  catch (error) { return {root: target, installed: true, current: null, error}; }
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertHealthyInstallation(context) {
  if (!context.current) throw new LifecycleError('FOUNDATION_INSTALL_UNHEALTHY', 'Foundation current identity 不可验证', {stage: 'capability'});
  const receiptFile = path.join(context.root, 'state', 'receipts', `${context.current.version}.json`);
  if (!fs.existsSync(receiptFile)) throw new LifecycleError('FOUNDATION_INSTALL_UNHEALTHY', 'Foundation ownership receipt 缺失', {stage: 'capability'});
  const receipt = signedPayload(readJson(receiptFile), 'FOUNDATION_INSTALL_UNHEALTHY');
  if (receipt.identity?.installId !== context.current.identity?.installId || receipt.candidateHash !== context.current.candidateHash || !Array.isArray(receipt.files)) throw new LifecycleError('FOUNDATION_INSTALL_UNHEALTHY', 'Foundation receipt/current identity 不一致', {stage: 'capability'});
  for (const record of receipt.files) {
    const file = path.join(context.root, ...String(record.path || '').split('/'));
    if (!record.path || !isWithin(context.root, file) || !fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile() || sha256(fs.readFileSync(file)) !== record.sha256) throw new LifecycleError('FOUNDATION_INSTALL_UNHEALTHY', `Foundation owned file 不健康：${record.path || 'unknown'}`, {stage: 'capability'});
  }
  return receipt;
}

function installedManifestFile(context, manifestFile) {
  const file = path.resolve(manifestFile);
  const artifacts = path.join(context.root, ...context.current.appPath.split('/'), 'artifacts');
  if (!isWithin(artifacts, file) || !fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile() || fs.realpathSync(file) !== file) throw new LifecycleError('CAPABILITY_IDENTITY_MISMATCH', 'capability manifest 必须来自当前 installed app 的 inert artifacts 边界', {stage: 'capability'});
  return file;
}

function compatibleFoundationVersion(required, actual) {
  if (!required) return true;
  const tuple = (value) => String(value).split('.').map((part) => Number(part));
  const compare = (left, right) => { const a = tuple(left); const b = tuple(right); for (let index = 0; index < 3; index += 1) { if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) < (b[index] || 0) ? -1 : 1; } return 0; };
  return String(required).split(/\s+/u).filter(Boolean).every((clause) => clause.startsWith('>=') ? compare(actual, clause.slice(2)) >= 0 : clause.startsWith('<') ? compare(actual, clause.slice(1)) < 0 : clause === actual);
}

function stateFile(context) { return path.join(context.root, 'state', 'capabilities.json'); }
function registrationsFile(context) { return path.join(context.root, 'state', 'capability-host-registrations.json'); }
function readCurrentManagerRegistration(context) { return {schemaVersion: '1.0.0', available: Boolean(context.current?.identity?.installId), identity: context.current?.identity?.installId ? `foundation-local-manager:${context.current.identity.installId}` : null, source: 'foundation-local-manager'}; }

function readState(context) {
  const file = stateFile(context);
  if (!fs.existsSync(file)) return {schemaVersion: '1.0.0', installId: context.current?.identity?.installId || null, capabilities: {}};
  return signedPayload(readJson(file), 'CAPABILITY_STATE_INVALID');
}

function readRegistrations(context) {
  const file = registrationsFile(context);
  if (!fs.existsSync(file)) return {schemaVersion: '1.0.0', installId: context.current?.identity?.installId || null, registrations: {}};
  return signedPayload(readJson(file), 'CAPABILITY_REGISTRATION_STATE_INVALID');
}

function plainObject(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

function exactKeys(value, keys) {
  return plainObject(value) && canonicalStringify(Object.keys(value).sort()) === canonicalStringify([...keys].sort());
}

function assertOrdinaryStateFile(context, file, code) {
  const stateRoot = path.join(context.root, 'state');
  for (const target of [context.root, stateRoot, file]) {
    if (!fs.existsSync(target)) throw new LifecycleError(code, 'Foundation-owned capability state 路径缺失', {stage: 'capability'});
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || (target === file ? !stat.isFile() : !stat.isDirectory()) || fs.realpathSync(target) !== target) throw new LifecycleError(code, 'Foundation-owned capability state 必须位于无符号链接的普通受控路径', {stage: 'capability'});
  }
}

function readStrictAuthorityDocument(context, {kind}) {
  const stateKind = kind === 'state';
  const file = stateKind ? stateFile(context) : registrationsFile(context);
  const collection = stateKind ? 'capabilities' : 'registrations';
  if (!fs.existsSync(file)) return {file, payload: {schemaVersion: '1.0.0', installId: context.current.identity.installId, [collection]: {}}, missing: true};
  const schemaCode = stateKind ? 'CAPABILITY_STATE_SCHEMA_INVALID' : 'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH';
  const unsafeCode = stateKind ? 'CAPABILITY_STATE_UNSAFE' : 'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH';
  assertOrdinaryStateFile(context, file, unsafeCode);
  let document;
  try { document = readJson(file); }
  catch { throw new LifecycleError(stateKind ? 'CAPABILITY_STATE_MALFORMED' : 'CAPABILITY_REGISTRATION_STATE_MALFORMED', 'Foundation-owned capability authority state 不是有效 JSON', {stage: 'capability'}); }
  if (!plainObject(document)) throw new LifecycleError(schemaCode, 'Foundation-owned capability authority state 必须是 plain object', {stage: 'capability'});
  const {integrity, ...payload} = document;
  if (!verifyTrustedPayload(payload, integrity)) throw new LifecycleError(stateKind ? 'CAPABILITY_STATE_INTEGRITY_INVALID' : 'CAPABILITY_REGISTRATION_STATE_INTEGRITY_INVALID', 'Foundation-owned capability authority state trusted integrity 无效', {stage: 'capability'});
  if (!exactKeys(payload, ['schemaVersion', 'installId', collection]) || payload.schemaVersion !== '1.0.0' || !plainObject(payload[collection])) throw new LifecycleError(schemaCode, 'Foundation-owned capability authority state schema 不受支持', {stage: 'capability'});
  if (payload.installId !== context.current.identity.installId) throw new LifecycleError(stateKind ? 'CAPABILITY_IDENTITY_MISMATCH' : 'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH', 'Foundation-owned capability authority state 与 current install identity 不一致', {stage: 'capability'});
  return {file, payload, missing: false};
}

const CAPABILITY_RECEIPT_KEYS = Object.freeze(['capabilityId', 'type', 'version', 'contentHash', 'files', 'requiredFoundationVersion', 'foundationInstallId', 'installed', 'active', 'projectScoped', 'dependencies', 'installedAt', 'authorizationEvidence']);
const CAPABILITY_REGISTRATION_KEYS = Object.freeze(['capabilityId', 'type', 'version', 'foundationInstallId', 'projectScoped', 'hostRegistrationIdentity', 'contentHash', 'registeredAt', 'active']);

function validateCapabilityManifest(manifest, checked) {
  return plainObject(manifest)
    && manifest.schemaVersion === '1.0.0'
    && typeof manifest.capabilityId === 'string' && Boolean(manifest.capabilityId)
    && typeof manifest.type === 'string' && Boolean(manifest.type)
    && typeof manifest.version === 'string' && Boolean(manifest.version)
    && typeof manifest.requiredFoundationVersion === 'string'
    && typeof manifest.projectScoped === 'boolean'
    && Array.isArray(manifest.dependencyCapabilityIds)
    && Array.isArray(manifest.readOnlyOperationClasses)
    && Array.isArray(manifest.mutatingOperationClasses)
    && Array.isArray(manifest.files)
    && manifest.contentHash === checked.contentHash;
}

function capabilityReceiptCode(receipt, capabilityId, manifest, checked, context) {
  if (plainObject(receipt) && receipt.capabilityId !== capabilityId) return 'CAPABILITY_IDENTITY_MISMATCH';
  if (!plainObject(receipt) || !exactKeys(receipt, CAPABILITY_RECEIPT_KEYS) || typeof receipt.installed !== 'boolean' || typeof receipt.active !== 'boolean' || typeof receipt.projectScoped !== 'boolean' || !Array.isArray(receipt.files) || !Array.isArray(receipt.dependencies) || !plainObject(receipt.authorizationEvidence) || typeof receipt.installedAt !== 'number') return 'CAPABILITY_STATE_SCHEMA_INVALID';
  if (receipt.capabilityId !== capabilityId || receipt.type !== manifest.type || receipt.version !== manifest.version || receipt.contentHash !== checked.contentHash || receipt.foundationInstallId !== context.current.identity.installId || receipt.projectScoped !== manifest.projectScoped || receipt.requiredFoundationVersion !== manifest.requiredFoundationVersion || canonicalStringify(receipt.files) !== canonicalStringify(checked.files) || canonicalStringify(receipt.dependencies) !== canonicalStringify([...(manifest.dependencyCapabilityIds || [])].sort())) return 'CAPABILITY_IDENTITY_MISMATCH';
  if (receipt.installed !== true) return 'CAPABILITY_NOT_INSTALLED';
  return null;
}

function capabilityRegistrationCode(registration, capabilityId, receipt, currentHost, context) {
  if (plainObject(registration) && registration.capabilityId !== capabilityId) return 'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH';
  if (!plainObject(registration) || !exactKeys(registration, CAPABILITY_REGISTRATION_KEYS) || typeof registration.type !== 'string' || typeof registration.version !== 'string' || typeof registration.projectScoped !== 'boolean' || typeof registration.active !== 'boolean' || typeof registration.registeredAt !== 'number') return 'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH';
  if (registration.capabilityId !== capabilityId || registration.type !== receipt.type || registration.version !== receipt.version || registration.foundationInstallId !== context.current.identity.installId || registration.projectScoped !== receipt.projectScoped || registration.contentHash !== receipt.contentHash || registration.hostRegistrationIdentity !== currentHost.identity) return 'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH';
  return null;
}

function writeSigned(file, payload) { writeJsonAtomic(file, {...payload, integrity: signTrustedPayload(payload)}); }

function acquireCapabilityGuard(context, plan, authorization) {
  const file = path.join(context.root, 'state', '.capability-authority.guard');
  const observed = observeProcessFingerprint(process.pid);
  if (observed.state !== 'observed') throw new LifecycleError('PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', '无法取得 capability transaction 的进程实例指纹', {stage: 'capability'});
  const owner = {schemaVersion: '1.0.0', recoveryProtocol: '030R1-write-ahead', operationId: plan.planId, capabilityId: plan.capabilityId, pid: process.pid, processFingerprint: observed.fingerprint, ownerNonce: crypto.randomUUID(), authorization, createdAt: Date.now()};
  const document = {...owner, integrity: signTrustedPayload(owner)};
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(document, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new LifecycleError('CAPABILITY_TRANSACTION_RECOVERY_REQUIRED', '存在 capability transaction evidence；拒绝隐式恢复或覆盖', {stage: 'capability'});
    throw error;
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  return {file, owner};
}

export function inspectCapabilityTransaction(installationRoot) {
  const context = installationContext(installationRoot);
  if (!context.installed || !context.current) return {schemaVersion: '1.0.0', status: 'clean', mutationPerformed: false};
  const guardFile = path.join(context.root, 'state', '.capability-authority.guard');
  if (!fs.existsSync(guardFile)) return {schemaVersion: '1.0.0', status: 'clean', mutationPerformed: false};
  try {
    const owner = signedPayload(readJson(guardFile), 'CAPABILITY_GUARD_INVALID');
    const ownerState = classifyProcessOwner(owner);
    if (ownerState === 'live') return {schemaVersion: '1.0.0', status: 'live-operation', operationId: owner.operationId, capabilityId: owner.capabilityId, pid: owner.pid, processFingerprint: owner.processFingerprint, mutationPerformed: false};
    return {schemaVersion: '1.0.0', status: 'manual-action-required', operationId: owner.operationId, capabilityId: owner.capabilityId, ownerState, code: ownerState === 'unavailable' ? 'PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE' : 'CAPABILITY_TRANSACTION_INCOMPLETE', mutationPerformed: false};
  } catch (error) {
    return {schemaVersion: '1.0.0', status: 'manual-action-required', code: error.code || 'CAPABILITY_GUARD_INVALID', mutationPerformed: false};
  }
}

function assertCapabilityTransactionClean(context) {
  const transaction = inspectCapabilityTransaction(context.root);
  if (transaction.status !== 'clean') throw new LifecycleError(transaction.status === 'live-operation' ? 'CAPABILITY_LIVE_OPERATION' : 'CAPABILITY_MANUAL_ACTION_REQUIRED', 'capability transaction evidence 未清理；拒绝新 mutation', {stage: 'capability', details: transaction});
}

function releaseCapabilityGuard(guard) {
  if (!guard || !fs.existsSync(guard.file)) return;
  try {
    const current = signedPayload(readJson(guard.file), 'CAPABILITY_GUARD_INVALID');
    if (current.ownerNonce === guard.owner.ownerNonce) fs.rmSync(guard.file);
  } catch {}
}

function manifestFiles(manifestFile, manifest) {
  const root = path.dirname(manifestFile);
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new LifecycleError('CAPABILITY_MANIFEST_INVALID', 'capability manifest 缺少 file inventory', {stage: 'capability'});
  const records = manifest.files.map((record) => {
    if (!record || typeof record.path !== 'string' || path.isAbsolute(record.path) || record.path.split('/').includes('..') || !/^[0-9a-f]{64}$/u.test(record.sha256 || '')) throw new LifecycleError('CAPABILITY_MANIFEST_INVALID', 'capability file inventory 路径/hash 无效', {stage: 'capability'});
    const file = path.join(root, ...record.path.split('/'));
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile() || sha256(fs.readFileSync(file)) !== record.sha256) throw new LifecycleError('CAPABILITY_IDENTITY_MISMATCH', `capability artifact 文件不匹配：${record.path}`, {stage: 'capability'});
    return {path: record.path, size: fs.statSync(file).size, sha256: record.sha256};
  }).sort((a, b) => a.path.localeCompare(b.path));
  const contentHash = sha256(canonicalStringify(records));
  if (manifest.contentHash !== contentHash) throw new LifecycleError('CAPABILITY_IDENTITY_MISMATCH', 'capability manifest contentHash 不匹配', {stage: 'capability'});
  return {records, contentHash};
}

export function discoverCapabilityMetadata(manifestFile) {
  const file = path.resolve(manifestFile);
  const manifest = readJson(file);
  return {schemaVersion: manifest.schemaVersion, capabilityId: manifest.capabilityId, type: manifest.type, version: manifest.version, projectScoped: manifest.projectScoped, status: 'inert-not-registered', manifestFile: file};
}

export function auditCapabilityArtifact(manifestFile) {
  const file = path.resolve(manifestFile);
  const manifest = readJson(file);
  const checked = manifestFiles(file, manifest);
  return {ok: true, manifest, files: checked.records, contentHash: checked.contentHash, instructionUse: 'inert-untrusted-reference-only'};
}

export function createCapabilityPlan({operation, installationRoot, manifestFile, project = null, connectCodex = false, now = Date.now(), ttlMs = 15 * 60 * 1000}) {
  if (operation === 'recover') return createCapabilityRecoveryPlan({installationRoot, now, ttlMs});
  if (!['install', 'register', 'activate', 'deactivate', 'uninstall'].includes(operation)) throw new LifecycleError('CAPABILITY_OPERATION_INVALID', 'capability operation 无效', {stage: 'capability-plan'});
  const context = installationContext(installationRoot);
  if (!context.installed || !context.current) throw new LifecycleError(context.error ? 'FOUNDATION_INSTALL_UNHEALTHY' : 'FOUNDATION_NOT_INSTALLED', 'capability plan 需要 healthy Foundation installation', {stage: 'capability-plan'});
  assertHealthyInstallation(context);
  assertCapabilityTransactionClean(context);
  const file = installedManifestFile(context, manifestFile);
  const manifest = readJson(file);
  const checked = manifestFiles(file, manifest);
  const state = readState(context).capabilities[manifest.capabilityId] || null;
  const registration = readRegistrations(context).registrations[manifest.capabilityId] || null;
  const currentHost = readCurrentManagerRegistration(context);
  if (['register', 'activate', 'deactivate'].includes(operation) && (!currentHost?.available || typeof currentHost.identity !== 'string' || !currentHost.identity)) throw new LifecycleError('CAPABILITY_HOST_REGISTRATION_UNAVAILABLE', '当前 healthy Foundation 与本地管理器不能派生 registration identity；capability control plan 保持 inert', {stage: 'capability-plan'});
  if (!compatibleFoundationVersion(manifest.requiredFoundationVersion, context.current.version)) throw new LifecycleError('CAPABILITY_FOUNDATION_VERSION_MISMATCH', 'capability required Foundation version 不匹配', {stage: 'capability-plan'});
  const seed = {schemaVersion: '1.0.0', operation, installationRoot: context.root, installId: context.current.identity.installId, manifestFile: file, capabilityId: manifest.capabilityId, capabilityType: manifest.type, capabilityVersion: manifest.version, contentHash: checked.contentHash, fileInventory: checked.records, requiredFoundationVersion: manifest.requiredFoundationVersion, projectScoped: Boolean(manifest.projectScoped), project: project ? path.resolve(project) : null, managerRegistrationIdentity: currentHost?.available ? currentHost.identity : null, dependencyCapabilityIds: [...(manifest.dependencyCapabilityIds || [])].sort(), mutatingOperationClasses: manifest.mutatingOperationClasses || [], readOnlyOperationClasses: manifest.readOnlyOperationClasses || [], before: {state, registration}, actions: [`capability-${operation}`], preserves: ['project-files', '.foundation/facts', 'unowned-or-modified-residuals'], createdAt: now, expiresAt: now + ttlMs};
  if (typeof connectCodex !== 'boolean' || (connectCodex && (operation !== 'register' || manifest.type !== 'codex-skill' || manifest.capabilityId !== 'ai-product-foundation-kit'))) throw new LifecycleError('CODEX_SKILL_OPERATION_INVALID', 'Codex 接入只适用于 Foundation Skill 的独立 register 计划', {stage: 'capability-plan'});
  if (connectCodex) {
    seed.codexIntegration = prepareCodexSkillRegistration({installationRoot: context.root, installId: context.current.identity.installId, manifestFile: file});
    seed.creates = [...seed.codexIntegration.directories, ...seed.codexIntegration.files.map((entry) => path.join(seed.codexIntegration.destination, entry.path)), path.join(context.root, 'state', 'codex-skill-registration.json')];
    seed.fileCount = seed.codexIntegration.files.length;
    seed.byteCount = seed.codexIntegration.files.reduce((sum, entry) => sum + entry.bytes, 0);
  }
  if (operation === 'uninstall' && manifest.capabilityId === 'ai-product-foundation-kit' && fs.existsSync(path.join(context.root, 'state', 'codex-skill-registration.json'))) {
    seed.codexRemoval = prepareCodexSkillRemoval({installationRoot: context.root, installId: context.current.identity.installId});
    seed.deletes = [...seed.codexRemoval.files.map((entry) => path.join(seed.codexRemoval.destination, entry.path)), path.join(context.root, 'state', 'codex-skill-registration.json')];
  }
  const planId = `capability-plan-${sha256(canonicalStringify(seed)).slice(0, 24)}`;
  const unsigned = {...seed, planId};
  return {...unsigned, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(unsigned))}};
}

function validatePlan(plan, now) {
  if (!plan || !plan.planId || !plan.integrity) throw new LifecycleError('CAPABILITY_PLAN_INVALID', 'capability plan 无效', {stage: 'capability-plan'});
  const {integrity, ...unsigned} = plan;
  if (integrity.algorithm !== 'sha256' || integrity.hash !== sha256(canonicalStringify(unsigned))) throw new LifecycleError('CAPABILITY_PLAN_TAMPERED', 'capability plan 已被改写', {stage: 'capability-plan'});
  if (now > plan.expiresAt) throw new LifecycleError('CAPABILITY_PLAN_EXPIRED', 'capability plan 已过期', {stage: 'capability-plan'});
}

function capabilityTransition(context, plan, authorization, now) {
  const state = readState(context);
  const registrations = readRegistrations(context);
  const existing = state.capabilities[plan.capabilityId] || null;
  const host = readCurrentManagerRegistration(context);
  if (plan.operation === 'install') {
    state.capabilities[plan.capabilityId] = {capabilityId: plan.capabilityId, type: plan.capabilityType, version: plan.capabilityVersion, contentHash: plan.contentHash, files: plan.fileInventory, requiredFoundationVersion: plan.requiredFoundationVersion, foundationInstallId: plan.installId, installed: true, active: false, projectScoped: plan.projectScoped, dependencies: plan.dependencyCapabilityIds, installedAt: now, authorizationEvidence: {authorizationId: authorization.authorizationId, effectHash: authorization.effectHash}};
  } else if (!existing || existing.foundationInstallId !== plan.installId || existing.version !== plan.capabilityVersion || existing.contentHash !== plan.contentHash) throw new LifecycleError('CAPABILITY_NOT_INSTALLED', 'capability receipt 与 plan/Foundation identity 不匹配', {stage: 'capability'});
  if (plan.operation === 'register') registrations.registrations[plan.capabilityId] = {capabilityId: plan.capabilityId, type: plan.capabilityType, version: plan.capabilityVersion, foundationInstallId: plan.installId, projectScoped: plan.projectScoped, hostRegistrationIdentity: host.identity, contentHash: plan.contentHash, registeredAt: now, active: false};
  if (plan.operation === 'activate') {
    const registration = registrations.registrations[plan.capabilityId];
    if (capabilityRegistrationCode(registration, plan.capabilityId, existing, host, context)) throw new LifecycleError('CAPABILITY_NOT_REGISTERED', 'capability host registration 不匹配', {stage: 'capability'});
    state.capabilities[plan.capabilityId].active = true;
    registration.active = true;
  }
  if (plan.operation === 'deactivate') {
    state.capabilities[plan.capabilityId].active = false;
    if (registrations.registrations[plan.capabilityId]) registrations.registrations[plan.capabilityId].active = false;
  }
  if (plan.operation === 'uninstall') {
    delete state.capabilities[plan.capabilityId];
    delete registrations.registrations[plan.capabilityId];
  }
  return {state, registrations};
}

function safeFileContent(file) {
  let cursor = path.dirname(file);
  while (!fs.existsSync(cursor)) cursor = path.dirname(cursor);
  if (fs.realpathSync(cursor) !== cursor || fs.lstatSync(cursor).isSymbolicLink()) throw new LifecycleError('CAPABILITY_JOURNAL_PATH_UNSAFE', 'capability journal 文件祖先路径不安全', {stage: 'capability'});
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || fs.realpathSync(file) !== file || stat.size > 16 * 1024 * 1024) throw new LifecycleError('CAPABILITY_JOURNAL_PATH_UNSAFE', 'capability journal 文件不是有界普通文件', {stage: 'capability'});
    return fs.readFileSync(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function capabilityWriteAheadFiles(context, plan, transition) {
  const signedText = (payload) => `${JSON.stringify({...payload, integrity: signTrustedPayload(payload)}, null, 2)}\n`;
  const entries = [
    {path: stateFile(context), after: signedText(transition.state)},
    {path: registrationsFile(context), after: signedText(transition.registrations)},
  ];
  if (plan.codexIntegration) {
    for (const file of plan.codexIntegration.files) entries.push({path: path.join(plan.codexIntegration.destination, file.path), after: file.content});
    entries.push({path: path.join(context.root, 'state/codex-skill-registration.json'), after: codexSkillReceiptContent(plan.codexIntegration)});
  }
  if (plan.codexRemoval) {
    for (const file of plan.codexRemoval.files) entries.push({path: path.join(plan.codexRemoval.destination, file.path), after: null});
    entries.push({path: path.join(context.root, 'state/codex-skill-registration.json'), after: null});
  }
  return entries.map((entry) => ({...entry, before: safeFileContent(entry.path)}));
}

export function applyCapabilityPlan({plan, now = Date.now()}) {
  if (plan?.operation === 'recover') return applyCapabilityRecoveryPlan({plan, now});
  validatePlan(plan, now);
  const context = installationContext(plan.installationRoot);
  if (!context.installed || !context.current || context.current.identity.installId !== plan.installId) throw new LifecycleError('FOUNDATION_INSTALL_UNHEALTHY', 'Foundation installation identity 已变化', {stage: 'capability'});
  assertHealthyInstallation(context);
  assertCapabilityTransactionClean(context);
  const manifestFile = installedManifestFile(context, plan.manifestFile);
  const checked = auditCapabilityArtifact(manifestFile);
  if (checked.manifest.capabilityId !== plan.capabilityId || checked.manifest.version !== plan.capabilityVersion || checked.contentHash !== plan.contentHash) throw new LifecycleError('CAPABILITY_IDENTITY_MISMATCH', 'capability artifact 在 plan 后变化', {stage: 'capability'});
  const currentHost = readCurrentManagerRegistration(context);
  if (['register', 'activate', 'deactivate'].includes(plan.operation)) {
    if (!currentHost?.available || typeof currentHost.identity !== 'string' || !currentHost.identity) throw new LifecycleError('CAPABILITY_HOST_REGISTRATION_UNAVAILABLE', '当前 Foundation 本地管理器 registration identity 不可用', {stage: 'capability'});
    if (plan.managerRegistrationIdentity !== currentHost.identity) throw new LifecycleError('CAPABILITY_MANAGER_REGISTRATION_CHANGED', 'plan 后本地管理器 registration identity 已变化', {stage: 'capability'});
  }
  const effect = authorizationEffectForCapabilityPlan(plan);
  if (plan.codexIntegration) {
    if (plan.operation !== 'register' || plan.capabilityId !== 'ai-product-foundation-kit' || plan.codexIntegration.installationRoot !== context.root || plan.codexIntegration.installId !== plan.installId) throw new LifecycleError('CODEX_SKILL_PLAN_INVALID', 'Skill 接入必须绑定同一安装身份与 register 操作', {stage: 'capability'});
    verifyCodexSkillRegistration(plan.codexIntegration);
  }
  if (plan.codexRemoval) {
    if (plan.operation !== 'uninstall' || plan.capabilityId !== 'ai-product-foundation-kit' || plan.codexRemoval.installationRoot !== context.root || plan.codexRemoval.installId !== plan.installId) throw new LifecycleError('CODEX_SKILL_PLAN_INVALID', 'Skill 停用必须绑定同一安装与 uninstall 操作', {stage: 'capability'});
    verifyCodexSkillRemoval(plan.codexRemoval);
  }
  const reservation = reserveExactManagerConfirmationAtBoundary(effect);
  const authorization = publicManagerConfirmationEvidence(reservation);
  const intentFile = path.join(context.root, 'state', 'capability-intents', `${plan.planId}.json`);
  let intent = {schemaVersion: '1.0.0', intentId: plan.planId, effectHash: effect.effectHash, authorization, planHash: plan.integrity.hash, status: 'planned', createdAt: now};
  let preIntent = null;
  let trustedGuard = null;
  let consumed = false;
  let guard = null;
  let preserveGuard = false;
  try {
    preIntent = writeTrustedPreIntent({intentId: plan.planId, operationClass: effect.operationClass, operation: plan.operation, effect, authorization, planHash: plan.integrity.hash, target: context.root, beforeState: effect.expectedBeforeState, now});
    operationCheckpoint('after-capability-durable-pre-intent');
    trustedGuard = acquireTrustedTargetGuard(preIntent);
    operationCheckpoint('after-capability-exclusive-acquire');
    assertCapabilityTransactionClean(context);
    const currentBefore = {state: readState(context).capabilities[plan.capabilityId] || null, registration: readRegistrations(context).registrations[plan.capabilityId] || null};
    if (canonicalStringify(currentBefore) !== canonicalStringify(plan.before)) throw new LifecycleError('CAPABILITY_STATE_CHANGED', 'capability state 在 plan 后变化', {stage: 'capability'});
    if (plan.codexIntegration) verifyCodexSkillRegistration(plan.codexIntegration);
    if (plan.codexRemoval) verifyCodexSkillRemoval(plan.codexRemoval);
    const transition = capabilityTransition(context, plan, authorization, now);
    intent = {...intent, recoveryProtocol: '030R1-write-ahead', plan, files: capabilityWriteAheadFiles(context, plan, transition)};
    guard = acquireCapabilityGuard(context, plan, authorization);
    writeSigned(intentFile, intent);
    consumeExactManagerConfirmationAtBoundary(reservation, {effectHash: effect.effectHash, intentId: plan.planId, intentPathHash: preIntent.fileHash}); consumed = true;
    updateTrustedPreIntent(preIntent, 'consumed', {consumedAt: Date.now()});
    operationCheckpoint('after-capability-authorization-consume');
    const {state, registrations} = transition;
    if (plan.codexIntegration) applyCodexSkillRegistration(plan.codexIntegration);
    if (plan.codexRemoval) applyCodexSkillRemoval(plan.codexRemoval);
    writeSigned(stateFile(context), state);
    writeSigned(registrationsFile(context), registrations);
    writeSigned(intentFile, {...intent, status: 'completed', completedAt: Date.now()});
    updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'completed'});
    return {ok: true, operation: plan.operation, capabilityId: plan.capabilityId, authorization: {authorizationId: authorization.authorizationId, effectHash: authorization.effectHash}};
  } catch (error) {
    if (!consumed) {
      try { failExactManagerConfirmationAtBoundary(reservation, {code: error.code || 'CAPABILITY_MUTATION_FAILED', intentWritten: false, intentId: plan.planId}); } catch {}
      if (preIntent) try { updateTrustedPreIntent(preIntent, 'cancelled', {cancelledAt: Date.now(), errorCode: error.code || 'CAPABILITY_MUTATION_FAILED'}); } catch {}
    }
    if (consumed) {
      preserveGuard = true;
      if (preIntent) try { updateTrustedPreIntent(preIntent, 'manual-action-required', {failedAt: Date.now(), errorCode: error.code || 'CAPABILITY_MUTATION_FAILED'}); } catch {}
    }
    throw error;
  } finally {
    if (!preserveGuard) releaseCapabilityGuard(guard);
    if (!preserveGuard) releaseTrustedTargetGuard(trustedGuard);
  }
}

function readCapabilityRecovery(installationRoot) {
  const context = installationContext(installationRoot);
  assertHealthyInstallation(context);
  const guardFile = path.join(context.root, 'state/.capability-authority.guard');
  const guardText = safeFileContent(guardFile);
  if (guardText === null) throw new LifecycleError('CAPABILITY_RECOVERY_NOT_REQUIRED', '没有 capability guard；不制造恢复写入', {stage: 'capability-recovery'});
  const owner = signedPayload(JSON.parse(guardText), 'CAPABILITY_GUARD_INVALID');
  if (!['dead', 'stale-instance'].includes(classifyProcessOwner(owner))) throw new LifecycleError('CAPABILITY_RECOVERY_OWNER_UNCONFIRMED', '原进程仍活跃或不能证明退出；不回收互斥权', {stage: 'capability-recovery'});
  if (owner.recoveryProtocol !== '030R1-write-ahead' || !/^capability-plan-[a-f0-9]{24}$/u.test(owner.operationId)) throw new LifecycleError('CAPABILITY_RECOVERY_LEGACY_EVIDENCE', '旧事务没有可验证写前日志；保留供独立处理', {stage: 'capability-recovery'});
  const intentFile = path.join(context.root, 'state/capability-intents', `${owner.operationId}.json`);
  const intentText = safeFileContent(intentFile);
  const intent = intentText === null ? null : signedPayload(JSON.parse(intentText), 'CAPABILITY_INTENT_INVALID');
  if (intent && (intent.intentId !== owner.operationId || intent.recoveryProtocol !== owner.recoveryProtocol || intent.plan?.capabilityId !== owner.capabilityId || !['install', 'register', 'activate', 'deactivate', 'uninstall'].includes(intent.plan?.operation) || intent.plan?.installId !== context.current.identity.installId || intent.planHash !== intent.plan?.integrity?.hash || !Array.isArray(intent.files))) throw new LifecycleError('CAPABILITY_INTENT_INVALID', '写前日志身份无效', {stage: 'capability-recovery'});
  if (intent) validatePlan(intent.plan, intent.plan.createdAt);
  const allowed = new Set([stateFile(context), registrationsFile(context)]);
  const integration = intent?.plan.codexIntegration || intent?.plan.codexRemoval;
  if (integration) {
    const authority = deriveTrustedLifecycleAuthority();
    if (authority.mode !== 'platform-installed-runtime' || authority.installRoot !== context.root || integration.destination !== path.join(readCurrentPlatformAccount().homedir, '.agents/skills/ai-product-foundation-kit')) throw new LifecycleError('CODEX_SKILL_SOURCE_ONLY', 'Skill 恢复只能由同一 installed authority 在实际 OS account 目标执行', {stage: 'capability-recovery'});
    for (const file of integration.files) allowed.add(path.join(integration.destination, file.path));
    allowed.add(path.join(context.root, 'state/codex-skill-registration.json'));
  }
  const relatedIds = [...new Set([owner.operationId, ...(owner.recoveryAttemptIds || []), ...(intent?.recoveryAttemptIds || [])])];
  if (relatedIds.some((id) => !/^capability-plan-[a-f0-9]{24}$/u.test(id))) throw new LifecycleError('CAPABILITY_INTENT_INVALID', '恢复尝试身份无效', {stage: 'capability-recovery'});
  const ledger = inspectTrustedPreIntents({target: context.root});
  if (ledger.live.length || ledger.pending.some((entry) => !relatedIds.includes(entry.intentId)) || ledger.manual.some((entry) => entry.code !== 'TRUSTED_TARGET_GUARD_MISSING_AFTER_CONSUME' || !relatedIds.includes(entry.intentId))) throw new LifecycleError('CAPABILITY_RECOVERY_SCOPE_BLOCKED', '存在其他活跃、未知或损坏的事务证据；不自动处理', {stage: 'capability-recovery'});
  if (!intent && !ledger.pending.some((entry) => entry.intentId === owner.operationId && entry.status === 'planned')) throw new LifecycleError('CAPABILITY_INTENT_INVALID', '缺失写前日志且不能证明未开始写入', {stage: 'capability-recovery'});
  const files = (intent?.files || []).map((entry) => {
    if (!allowed.delete(entry.path) || ![entry.before, entry.after].every((value) => value === null || typeof value === 'string')) throw new LifecycleError('CAPABILITY_RECOVERY_SCOPE_INVALID', '日志文件超出确证 owned 范围或重复', {stage: 'capability-recovery'});
    const current = safeFileContent(entry.path);
    if (current !== entry.before && current !== entry.after) throw new LifecycleError('CAPABILITY_RECOVERY_USER_CHANGE', '文件含未知或用户修改；保留且拒绝覆盖', {stage: 'capability-recovery', details: {path: entry.path}});
    const desired = intent.status === 'completed' ? entry.after : entry.before;
    return {path: entry.path, currentHash: current === null ? null : sha256(current), desiredHash: desired === null ? null : sha256(desired)};
  });
  if (intent && allowed.size) throw new LifecycleError('CAPABILITY_RECOVERY_SCOPE_INVALID', '写前日志文件范围不完整', {stage: 'capability-recovery'});
  const trustedScope = ledger.pending.map(({intentId, effectHash, targetKey, planHash, fileHash}) => ({intentId, effectHash, targetKey, planHash, fileHash}));
  const snapshot = {originalOperationId: owner.operationId, capabilityId: owner.capabilityId, guardHash: sha256(guardText), intentHash: intentText === null ? null : sha256(intentText), files, trustedScope, relatedIds, mode: intent?.status === 'completed' ? 'finish-completed-cleanup' : 'rollback-exact-write-ahead'};
  return {context, owner, guardFile, intentFile, intent, snapshot, integration};
}

function createCapabilityRecoveryPlan({installationRoot, now, ttlMs}) {
  const read = readCapabilityRecovery(installationRoot);
  const seed = {schemaVersion: '1.0.0', operation: 'recover', installationRoot: read.context.root, installId: read.context.current.identity.installId, capabilityId: read.owner.capabilityId, before: read.snapshot, actions: [read.snapshot.mode], preserves: ['project-files', '.foundation/facts', 'unknown-or-modified-files', 'created-directories-and-incomplete-temporary-files'], replacements: read.snapshot.files.filter((entry) => entry.desiredHash !== null && entry.currentHash !== entry.desiredHash).map((entry) => entry.path), deletes: read.snapshot.files.filter((entry) => entry.desiredHash === null && entry.currentHash !== null).map((entry) => entry.path), createdAt: now, expiresAt: now + ttlMs, ...(read.integration ? {codexRecoveryDestination: read.integration.destination} : {})};
  const unsigned = {...seed, planId: `capability-plan-${sha256(canonicalStringify(seed)).slice(0, 24)}`};
  return {...unsigned, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(unsigned))}};
}

function applyCapabilityRecoveryPlan({plan, now}) {
  validatePlan(plan, now);
  const read = readCapabilityRecovery(plan.installationRoot);
  if (canonicalStringify(read.snapshot) !== canonicalStringify(plan.before) || read.context.current.identity.installId !== plan.installId) throw new LifecycleError('CAPABILITY_RECOVERY_DRIFT', '恢复计划的文件或事务证据已变化；需要新的精确预览', {stage: 'capability-recovery'});
  const effect = authorizationEffectForCapabilityPlan(plan);
  const reservation = reserveExactManagerConfirmationAtBoundary(effect);
  const authorization = publicManagerConfirmationEvidence(reservation);
  let preIntent, guard, consumed = false, completed = false;
  try {
    preIntent = writeTrustedPreIntent({intentId: plan.planId, operationClass: effect.operationClass, operation: 'recover', effect, authorization, planHash: plan.integrity.hash, target: read.context.root, beforeState: plan.before, now});
    guard = acquireTrustedTargetGuard(preIntent, {recoverIntentIds: read.snapshot.relatedIds});
    if (sha256(safeFileContent(read.guardFile)) !== read.snapshot.guardHash || (safeFileContent(read.intentFile) === null ? null : sha256(safeFileContent(read.intentFile))) !== read.snapshot.intentHash) throw new LifecycleError('CAPABILITY_RECOVERY_DRIFT', '取得互斥权后原事务证据变化', {stage: 'capability-recovery'});
    verifyTrustedPreIntentScope(read.snapshot.trustedScope);
    for (const entry of read.snapshot.files) { const current = safeFileContent(entry.path); if ((current === null ? null : sha256(current)) !== entry.currentHash) throw new LifecycleError('CAPABILITY_RECOVERY_DRIFT', '取得互斥权后文件变化', {stage: 'capability-recovery'}); }
    // Persist the recovery identity before consuming it, including the tiny
    // original crash window in which no capability write-ahead file exists.
    read.owner.recoveryAttemptIds = [...new Set([...(read.owner.recoveryAttemptIds || []), plan.planId])];
    writeSigned(read.guardFile, read.owner);
    consumeExactManagerConfirmationAtBoundary(reservation, {effectHash: effect.effectHash, intentId: plan.planId, intentPathHash: preIntent.fileHash}); consumed = true;
    updateTrustedPreIntent(preIntent, 'consumed', {consumedAt: Date.now()});
    if (read.intent) {
      read.intent.recoveryAttemptIds = [...new Set([...(read.intent.recoveryAttemptIds || []), plan.planId])];
      writeSigned(read.intentFile, read.intent);
      for (const entry of read.intent.files) {
        const desired = read.intent.status === 'completed' ? entry.after : entry.before;
        const current = safeFileContent(entry.path);
        if (current !== entry.before && current !== entry.after) throw new LifecycleError('CAPABILITY_RECOVERY_USER_CHANGE', '恢复期间检测到用户修改；停止并保留', {stage: 'capability-recovery'});
        if (current === desired) continue;
        if (desired === null) fs.unlinkSync(entry.path);
        else {
          if (!fs.existsSync(path.dirname(entry.path)) || fs.realpathSync(path.dirname(entry.path)) !== path.dirname(entry.path)) throw new LifecycleError('CAPABILITY_RECOVERY_DRIFT', '恢复父目录不存在或变化；不隐式补目录', {stage: 'capability-recovery'});
          const temporary = `${entry.path}.${crypto.randomUUID()}.recovery`;
          const fd = fs.openSync(temporary, 'wx', 0o600);
          try { fs.writeFileSync(fd, desired); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
          fs.renameSync(temporary, entry.path);
        }
        const directory = fs.openSync(path.dirname(entry.path), 'r');
        try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      }
      writeSigned(read.intentFile, {...read.intent, status: read.intent.status === 'completed' ? 'completed' : 'rolled-back', recoveredAt: Date.now()});
    }
    completeTrustedPreIntentRecovery(read.snapshot.trustedScope);
    updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: read.snapshot.mode});
    releaseTrustedTargetGuard(guard);
    if (fs.existsSync(guard.file)) throw new LifecycleError('CAPABILITY_RECOVERY_GUARD_RETAINED', '可信互斥记录尚未释放；保留 capability recovery 入口', {stage: 'capability-recovery'});
    releaseCapabilityGuard({file: read.guardFile, owner: read.owner});
    if (fs.existsSync(read.guardFile)) throw new LifecycleError('CAPABILITY_RECOVERY_GUARD_RETAINED', 'capability 互斥记录变化或尚未释放', {stage: 'capability-recovery'});
    completed = true;
    return {ok: true, operation: 'capability-recover', outcome: read.snapshot.mode, originalOperationId: read.owner.operationId, mutationPerformed: true, projectFactsChanged: false};
  } catch (error) {
    if (!consumed) { try { failExactManagerConfirmationAtBoundary(reservation, {code: error.code || 'CAPABILITY_RECOVERY_FAILED', intentWritten: false}); } catch {} }
    if (preIntent) { try { updateTrustedPreIntent(preIntent, consumed ? 'manual-action-required' : 'cancelled', {errorCode: error.code || 'CAPABILITY_RECOVERY_FAILED'}); } catch {} }
    throw error;
  } finally { if (!consumed || completed) releaseTrustedTargetGuard(guard); }
}

export function inspectCapabilityStatus({installationRoot, manifestFile, project = null, mutating = false}) {
  let metadata;
  try { metadata = discoverCapabilityMetadata(manifestFile); }
  catch (error) { return {schemaVersion: '1.0.0', capabilityId: null, type: null, version: null, usable: false, instructionPolicy: 'inert-untrusted-reference-only', code: error instanceof SyntaxError ? 'CAPABILITY_MANIFEST_MALFORMED' : 'CAPABILITY_IDENTITY_MISMATCH'}; }
  const context = installationContext(installationRoot);
  const base = {schemaVersion: '1.0.0', capabilityId: metadata.capabilityId, type: metadata.type, version: metadata.version, projectScoped: metadata.projectScoped, usable: false, instructionPolicy: 'inert-untrusted-reference-only'};
  if (!context.installed) return {...base, code: 'FOUNDATION_NOT_INSTALLED'};
  if (!context.current) return {...base, code: 'FOUNDATION_INSTALL_UNHEALTHY'};
  try { assertHealthyInstallation(context); } catch { return {...base, code: 'FOUNDATION_INSTALL_UNHEALTHY'}; }
  const transaction = inspectCapabilityTransaction(context.root);
  if (transaction.status !== 'clean') return {...base, code: transaction.status === 'live-operation' ? 'CAPABILITY_LIVE_OPERATION' : 'CAPABILITY_MANUAL_ACTION_REQUIRED', transaction};
  let installedManifest;
  try { installedManifest = installedManifestFile(context, manifestFile); } catch { return {...base, code: 'CAPABILITY_IDENTITY_MISMATCH'}; }
  let checked;
  try { checked = auditCapabilityArtifact(installedManifest); } catch { return {...base, code: 'CAPABILITY_IDENTITY_MISMATCH'}; }
  if (!validateCapabilityManifest(checked.manifest, checked)) return {...base, code: 'CAPABILITY_IDENTITY_MISMATCH'};
  let stateAuthority;
  try { stateAuthority = readStrictAuthorityDocument(context, {kind: 'state'}); }
  catch (error) { return {...base, code: error?.code || 'CAPABILITY_STATE_SCHEMA_INVALID'}; }
  const state = stateAuthority.payload;
  const receipt = state.capabilities[metadata.capabilityId];
  if (!receipt) return {...base, code: 'CAPABILITY_NOT_INSTALLED'};
  const receiptCode = capabilityReceiptCode(receipt, metadata.capabilityId, checked.manifest, checked, context);
  if (receiptCode) return {...base, code: receiptCode};
  const currentHost = readCurrentManagerRegistration(context);
  if (!currentHost?.available || typeof currentHost.identity !== 'string' || !currentHost.identity) return {...base, code: 'CAPABILITY_HOST_REGISTRATION_UNAVAILABLE', hostRegistration: {available: false, source: currentHost?.source || 'local-manager-unavailable'}};
  let registrationAuthority;
  try { registrationAuthority = readStrictAuthorityDocument(context, {kind: 'registration'}); }
  catch (error) { return {...base, code: error?.code || 'CAPABILITY_REGISTRATION_IDENTITY_MISMATCH'}; }
  const registrations = registrationAuthority.payload;
  const registration = registrations.registrations[metadata.capabilityId];
  if (!registration) return {...base, code: 'CAPABILITY_NOT_REGISTERED'};
  const registrationCode = capabilityRegistrationCode(registration, metadata.capabilityId, receipt, currentHost, context);
  if (registrationCode) return {...base, code: registrationCode};
  if (receipt.active !== true || registration.active !== true) return {...base, code: 'CAPABILITY_INACTIVE'};
  if (receipt.projectScoped) {
    if (!project) return {...base, code: 'PROJECT_NOT_ENABLED'};
    const projectStatus = inspectProjectAuthority(project, {installationRoot: context.root});
    if (projectStatus.state !== 'enabled' || projectStatus.agreement !== true) return {...base, code: 'PROJECT_NOT_ENABLED'};
  }
  if (mutating) return {...base, code: 'MANAGER_CONFIRMATION_REQUIRED', instructionPolicy: 'active-read-only;mutation-needs-exact-manager-confirmation'};
  const manifestIdentity = {schemaVersion: checked.manifest.schemaVersion, capabilityId: checked.manifest.capabilityId, type: checked.manifest.type, version: checked.manifest.version, requiredFoundationVersion: checked.manifest.requiredFoundationVersion, projectScoped: checked.manifest.projectScoped, dependencyCapabilityIds: checked.manifest.dependencyCapabilityIds, files: checked.files, contentHash: checked.contentHash};
  return {...base, projectScoped: checked.manifest.projectScoped, code: 'CAPABILITY_READY', usable: true, stateIdentity: sha256(canonicalStringify({currentInstallId: context.current.identity.installId, currentVersion: context.current.version, manifestIdentity, statePayload: state, registrationPayload: registrations, currentHost, receiptKey: metadata.capabilityId, registrationKey: metadata.capabilityId})), installed: true, active: true, instructionPolicy: 'active-for-declared-read-only-operations'};
}

export function invalidateCapabilitiesForUninstall(installationRoot, authorization) {
  const context = installationContext(installationRoot);
  if (!context.current) return {invalidated: []};
  const state = readState(context);
  const registrations = readRegistrations(context);
  const invalidated = Object.keys(state.capabilities).sort();
  for (const record of Object.values(state.capabilities)) { record.active = false; record.invalidatedByUninstall = true; record.authorizationEvidence = {authorizationId: authorization.authorizationId, effectHash: authorization.effectHash}; }
  for (const record of Object.values(registrations.registrations)) { record.active = false; record.invalidatedByUninstall = true; }
  if (invalidated.length) { writeSigned(stateFile(context), state); writeSigned(registrationsFile(context), registrations); }
  return {invalidated};
}
