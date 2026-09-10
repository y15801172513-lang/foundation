import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {LifecycleError} from './install-contract.mjs';
import {isWithin} from './path-boundary.mjs';
import {
  deriveTrustedLifecycleAuthority,
  loadTrustedAuthorityKey,
  verifyTrustedPayload,
} from './trusted-authority.mjs';
import {canonicalStringify, sha256} from './install-contract.mjs';
import {verifyManagerConfirmedContinuationAtBoundary} from './human-authorization.mjs';
import {operationCheckpoint} from './runtime-surface.mjs';

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function signWithSnapshot(payload, signing) {
  return {algorithm: 'hmac-sha256', keyId: signing.keyId, hash: crypto.createHmac('sha256', signing.key).update(canonicalStringify(payload)).digest('hex')};
}

function verifyWithSnapshot(payload, integrity, signing) {
  if (!integrity || integrity.algorithm !== 'hmac-sha256' || integrity.keyId !== signing.keyId || !/^[0-9a-f]{64}$/u.test(integrity.hash || '')) return false;
  const expected = signWithSnapshot(payload, signing).hash;
  return crypto.timingSafeEqual(Buffer.from(integrity.hash, 'hex'), Buffer.from(expected, 'hex'));
}

function relativeTarget(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new LifecycleError('FINALIZER_PATH_INVALID', `finalizer 路径无效：${relative}`, {stage: 'uninstall-finalizer'});
  }
  const target = path.resolve(root, ...relative.split('/'));
  if (!isWithin(root, target) || target === root) throw new LifecycleError('FINALIZER_PATH_ESCAPE', `finalizer 路径越界：${relative}`, {stage: 'uninstall-finalizer'});
  let ancestor = root;
  for (const part of relative.split('/').slice(0, -1)) {
    ancestor = path.join(ancestor, part);
    if (!fs.existsSync(ancestor)) break;
    const stat = fs.lstatSync(ancestor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new LifecycleError('FINALIZER_PATH_ANCESTOR_INVALID', `finalizer 路径祖先不是受控目录：${relative}`, {stage: 'uninstall-finalizer'});
  }
  return target;
}

function allowedOwnedPath(record) {
  const identity = record.ownerIdentity;
  if (!identity || !record.category) return false;
  if (record.category === 'app') return record.path.startsWith(`versions/${identity.productVersion}/app/`);
  if (record.category === 'runtime') return record.path.startsWith(`runtimes/node-${identity.runtimeHash.slice(0, 16)}/`);
  if (record.category === 'shim') return ['bin/foundation-kit', 'bin/foundation-kit.cmd'].includes(record.path);
  if (record.category === 'integration') return record.path.startsWith('integrations/codex/skills/ai-product-foundation-kit/');
  return false;
}

function verifyReceipt(root, proof, cache) {
  if (cache.has(proof.path)) return cache.get(proof.path);
  const file = relativeTarget(root, proof.path);
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new LifecycleError('RECEIPT_PROOF_MISSING', `finalizer receipt proof 缺失：${proof.path}`, {stage: 'uninstall-finalizer'});
  const document = readJson(file);
  const {integrity, ...payload} = document;
  if (!verifyTrustedPayload(payload, integrity) || integrity.hash !== proof.integrityHash || sha256(fs.readFileSync(file)) !== proof.fileHash) {
    throw new LifecycleError('RECEIPT_PROOF_INVALID', `finalizer receipt proof 验证失败：${proof.path}`, {stage: 'uninstall-finalizer'});
  }
  cache.set(proof.path, payload);
  return payload;
}

function pruneEmpty(root, relative) {
  const target = relativeTarget(root, relative);
  let stat;
  try { stat = fs.lstatSync(target); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return;
  let entries;
  try { entries = fs.readdirSync(target, {withFileTypes: true}); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) pruneEmpty(root, path.relative(root, path.join(target, entry.name)).replaceAll(path.sep, '/'));
  }
  try { if (fs.readdirSync(target).length === 0) fs.rmdirSync(target); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; }
}

function pruneOneIfEmpty(root, relative) {
  const target = relativeTarget(root, relative);
  let stat;
  try { stat = fs.lstatSync(target); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return;
  try { if (fs.readdirSync(target).length === 0) fs.rmdirSync(target); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; }
}

function cleanupFullOperationalState(root, payload, residualUnknown, signing) {
  const rules = [
    {directory: 'state/receipts', valid: (file, value) => file.endsWith('.json') && value?.schemaVersion === '1.0.0' && value?.identity?.installId === payload.installId && verifyWithSnapshot((({integrity, ...rest}) => rest)(value), value.integrity, signing)},
    {directory: 'state/journals', valid: (file, value) => file === `${value?.operationId}.json` && value?.schemaVersion === '1.0.0' && verifyWithSnapshot((({integrity, ...rest}) => rest)(value), value.integrity, signing)},
    {directory: 'state/operations', valid: (file, value) => file === `${value?.operationId}.json` && value?.schemaVersion === '1.0.0' && verifyWithSnapshot((({integrity, ...rest}) => rest)(value), value.integrity, signing)},
    {directory: 'state/finalizers', valid: (file, value) => file === `${value?.payload?.operationId}.json` && verifyWithSnapshot(value?.payload, value?.integrity, signing)},
  ];
  for (const rule of rules) {
    const directory = relativeTarget(root, rule.directory);
    if (!fs.existsSync(directory)) continue;
    if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) {
      residualUnknown.push({path: rule.directory, reason: 'unexpected-state-directory-type'});
      continue;
    }
    for (const name of fs.readdirSync(directory)) {
      const relative = `${rule.directory}/${name}`;
      const file = path.join(directory, name);
      try {
        if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new Error('unexpected-type');
        const value = readJson(file);
        if (!rule.valid(name, value)) throw new Error('unknown-ownership');
        fs.rmSync(file);
      } catch {
        residualUnknown.push({path: relative, reason: 'unknown-operational-ownership'});
      }
    }
  }
  for (const relative of ['state/receipts', 'state/journals', 'state/operations', 'state/finalizers', 'state']) pruneOneIfEmpty(root, relative);
  for (const relative of ['cache', 'logs', 'staging', 'quarantine', 'integrations', 'versions', 'runtimes', 'bin']) pruneEmpty(root, relative);
}

function currentCoreStateRelationship(kind, document, installId, signing) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return {relationship: 'unknown', reason: 'state-signature-invalid', integrityHash: null};
  const {integrity, ...payload} = document;
  if (!verifyWithSnapshot(payload, integrity, signing)) return {relationship: 'unknown', reason: 'state-signature-invalid', integrityHash: null};
  if (kind === 'installations') {
    if (payload.schemaVersion !== '1.0.0' || !payload.versions || typeof payload.versions !== 'object' || Array.isArray(payload.versions)) return {relationship: 'unknown', reason: 'state-schema-invalid', integrityHash: integrity.hash};
    const identities = Object.values(payload.versions).map((record) => record?.identity?.installId);
    if (!identities.length || identities.some((identity) => typeof identity !== 'string' || !identity)) return {relationship: 'unknown', reason: 'state-identity-invalid', integrityHash: integrity.hash};
    if (identities.some((identity) => identity !== installId)) return {relationship: 'foreign', reason: 'foreign-install-state-preserved', integrityHash: integrity.hash};
    return {relationship: 'owned', reason: 'same-install-owned', integrityHash: integrity.hash};
  }
  const identity = payload.identity?.installId;
  if (typeof identity !== 'string' || !identity) return {relationship: 'unknown', reason: 'state-identity-invalid', integrityHash: integrity.hash};
  if (identity !== installId) return {relationship: 'foreign', reason: 'foreign-install-state-preserved', integrityHash: integrity.hash};
  return {relationship: 'owned', reason: 'same-install-owned', integrityHash: integrity.hash};
}

function preserveCoreState(preservedUnknown, proof, reason) {
  if (!preservedUnknown.some((entry) => entry.path === proof.path && entry.reason === reason)) preservedUnknown.push({path: proof.path, reason});
}

function processCoreStateProof(root, payload, proof, removed, preservedModified, preservedModifiedDetails, preservedUnknown, signing) {
  const expected = {current: 'state/current.json', previous: 'state/previous.json', installations: 'state/installations.json'};
  if (!proof || expected[proof.kind] !== proof.path || proof.expectedInstallId !== payload.installId) throw new LifecycleError('FINALIZER_CORE_STATE_PROOF_INVALID', 'finalizer 核心 state proof 范围或 identity 无效', {stage: 'uninstall-finalizer'});
  const target = relativeTarget(root, proof.path);
  let stat;
  try { stat = fs.lstatSync(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (proof.exists && !removed.includes(proof.path)) removed.push(proof.path);
    return;
  }
  if (!proof.exists) {
    preserveCoreState(preservedUnknown, proof, 'state-created-after-inventory');
    return;
  }
  if (proof.deletePolicy !== 'delete-if-unchanged-and-reverified') {
    preserveCoreState(preservedUnknown, proof, proof.reason || 'state-ownership-unproven');
    return;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    preserveCoreState(preservedUnknown, proof, stat.isSymbolicLink() ? 'symlink-preserved' : 'unexpected-type-preserved');
    return;
  }
  const bytes = fs.readFileSync(target);
  const actualHash = sha256(bytes);
  if (actualHash !== proof.fileHash) {
    if (!preservedModified.includes(proof.path)) preservedModified.push(proof.path);
    preservedModifiedDetails.push({path: proof.path, reason: 'state-changed-after-inventory', expectedHash: proof.fileHash, actualHash});
    return;
  }
  let document;
  try { document = JSON.parse(bytes.toString('utf8')); } catch { document = null; }
  const relationship = currentCoreStateRelationship(proof.kind, document, payload.installId, signing);
  if (relationship.relationship !== 'owned' || relationship.integrityHash !== proof.integrityHash) {
    preserveCoreState(preservedUnknown, proof, relationship.reason || 'state-ownership-unproven');
    return;
  }
  fs.rmSync(target);
  if (!removed.includes(proof.path)) removed.push(proof.path);
}

function scanResidual(root) {
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
      if (relative === 'uninstall-result.json' || relative === '.foundation-operation.lock' || relative.startsWith('user-products/')) continue;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (fs.readdirSync(absolute).length === 0) result.push(relative);
        else visit(absolute);
      }
      else result.push(relative);
    }
  }
  visit(root);
  return result;
}

export function executeUninstallFinalizer(inputFile) {
  const document = readJson(path.resolve(inputFile));
  if (!verifyTrustedPayload(document.payload, document.integrity)) throw new LifecycleError('FINALIZER_INPUT_TAMPERED', 'uninstall finalizer 输入签名无效', {stage: 'uninstall-finalizer'});
  const payload = document.payload;
  const authority = deriveTrustedLifecycleAuthority();
  const signing = loadTrustedAuthorityKey();
  if (payload.authority.repositoryRealPath !== authority.repositoryRealPath || payload.authority.trustedRootRealPath !== authority.trustedRootRealPath) throw new LifecycleError('FINALIZER_AUTHORITY_CHANGED', 'finalizer 可信 authority 已变化', {stage: 'uninstall-finalizer'});
  const root = path.join(authority.trustedRootRealPath, ...payload.targetRelative.split('/'));
  if (!isWithin(authority.trustedRootRealPath, root) || !fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root) throw new LifecycleError('FINALIZER_TARGET_INVALID', 'finalizer 安装根无效', {stage: 'uninstall-finalizer'});
  if (!payload.authorization?.effectHash || !payload.operationId) throw new LifecycleError('FINALIZER_AUTHORIZATION_MISSING', 'finalizer 缺少原始 durable intent 的 manager confirmation reference', {stage: 'uninstall-finalizer'});
  verifyManagerConfirmedContinuationAtBoundary(payload.authorization, payload.authorization.effectHash, payload.operationId);
  const receiptCache = new Map();
  const removed = [];
  const preservedModified = [];
  const preservedModifiedDetails = [];
  const preservedUnknown = [];
  const deletions = [...payload.deletions].sort((a, b) => a.path.localeCompare(b.path));
  let processed = 0;
  operationCheckpoint('uninstall-delete');
  for (const record of deletions) {
    if (!allowedOwnedPath(record)) throw new LifecycleError('FINALIZER_OWNERSHIP_SCOPE_INVALID', `finalizer ownership path 不合法：${record.path}`, {stage: 'uninstall-finalizer'});
    const receipt = verifyReceipt(root, record.receiptProof, receiptCache);
    const owned = receipt.files?.find((file) => file.path === record.path && file.sha256 === record.sha256 && file.category === record.category);
    if (!owned || receipt.identity?.installId !== record.ownerIdentity.installId) throw new LifecycleError('FINALIZER_RECEIPT_MISMATCH', `receipt 不拥有删除目标：${record.path}`, {stage: 'uninstall-finalizer'});
    const target = relativeTarget(root, record.path);
    if (!fs.existsSync(target)) removed.push(record.path);
    else {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile()) preservedUnknown.push({path: record.path, reason: stat.isSymbolicLink() ? 'symlink-preserved' : 'unexpected-type-preserved'});
      else if (sha256(fs.readFileSync(target)) !== record.sha256) preservedModified.push(record.path);
      else { fs.rmSync(target); removed.push(record.path); }
    }
    processed += 1;
    if (processed === Math.max(1, Math.ceil(deletions.length / 2))) operationCheckpoint('mid-delete');
  }
  for (const relative of ['versions', 'bin', 'runtimes', 'integrations']) pruneEmpty(root, relative);
  const residualUnknown = [...preservedUnknown];
  operationCheckpoint('before-core-state');
  const selectedCoreProofs = payload.mode === 'full' ? payload.coreStateProofs : payload.coreStateProofs?.filter((proof) => proof.kind === 'current');
  if (!Array.isArray(selectedCoreProofs) || !selectedCoreProofs.length) throw new LifecycleError('FINALIZER_CORE_STATE_PROOF_MISSING', 'finalizer 缺少核心 state 删除证明', {stage: 'uninstall-finalizer'});
  let coreProcessed = 0;
  for (const proof of selectedCoreProofs) {
    processCoreStateProof(root, payload, proof, removed, preservedModified, preservedModifiedDetails, residualUnknown, signing);
    coreProcessed += 1;
    if (coreProcessed === 1) operationCheckpoint('mid-core-state');
  }
  if (payload.mode === 'full') cleanupFullOperationalState(root, payload, residualUnknown, signing);
  const residualPaths = scanResidual(root);
  const residualInventory = residualPaths.map(relative => {
    const file = relativeTarget(root, relative);
    const stat = fs.lstatSync(file);
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'unknown';
    return {path: file, relativePath: relative, type, bytes: type === 'file' ? stat.size : null,
      sha256: type === 'file' ? sha256(fs.readFileSync(file)) : null,
      identity: {device: String(stat.dev), inode: String(stat.ino), owner: stat.uid, mode: stat.mode & 0o777},
      category: relative === 'state/projects.json' ? 'historical-project-index' : /^(cache|staging)\//u.test(relative) ? 'installation-cache' : relative.startsWith('state/') ? 'audit-and-recovery-record' : 'preserved-or-unknown',
      activity: 'not-checked', deletionAuthority: false, deleteCondition: '重新检查真实路径、身份、内容、活动引用和用途；取得精确人工授权，未知或修改文件保留'};
  });
  const resultPayload = {
    schemaVersion: '1.0.0',
    operationId: payload.operationId,
    state: 'uninstalled',
    mode: payload.mode,
    installId: payload.installId,
    removed,
    preservedModified,
    preservedModifiedDetails,
    preservedUnknown: residualUnknown,
    preservedSharedRuntime: payload.preservedSharedRuntime,
    residualPaths,
    residualInventory,
    cleanupDiscovery: {receipt: path.join(root, 'uninstall-result.json'), format: 'ordinary-json; no installed launcher required', scope: 'this installation root only; external acquisition cache requires separate inventory', deletionAuthority: false},
    preserved: ['user product projects', '.foundation/facts', 'project-owned extension files', 'uninstall-result.json'],
    matrix: payload.matrix,
    recovery: payload.mode === 'app-only' ? '可使用保留的私有运行环境重新安装' : '使用受验证候选重新安装',
  };
  const result = {...resultPayload, integrity: signWithSnapshot(resultPayload, signing)};
  writeJsonAtomic(path.join(root, 'uninstall-result.json'), result);
  return result;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) {
  try {
    process.stdout.write(`${JSON.stringify(executeUninstallFinalizer(process.argv[2]))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(error?.toJSON ? error.toJSON() : {code: 'FINALIZER_UNKNOWN', message: error.message})}\n`);
    process.exitCode = 1;
  }
}
