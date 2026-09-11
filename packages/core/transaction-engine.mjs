import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {validateCandidate} from './candidate-package.mjs';
import {canonicalStringify, LifecycleError, sha256, validateLifecyclePlan} from './install-contract.mjs';
import {isWithin} from './path-boundary.mjs';
import {platformShim, probeDiskAvailableBytes} from './platform-bootstrap.mjs';
import {sanitizeNodeStartupEnvironment} from './node-startup-environment.mjs';
import {classifyProcessOwner, observeProcessFingerprint} from './process-owner.mjs';
import {finishConfirmedUpdateInputs} from './update-input-inventory.mjs';
import {
  acquisitionNetworkDisconnected,
  currentRuntimeIdentity,
  effectiveDiskAvailability,
  finalizerRuntimeEnvironment,
  operationCheckpoint,
} from './runtime-surface.mjs';
import {
  authorizationEffectForLifecyclePlan,
  consumeExactManagerConfirmationAtBoundary,
  failExactManagerConfirmationAtBoundary,
  publicManagerConfirmationEvidence,
  reserveExactManagerConfirmationAtBoundary,
} from './human-authorization.mjs';
import {
  assertTrustedCandidatePath,
  deriveTrustedLifecycleAuthority,
  loadTrustedAuthorityKey,
  resolveTrustedTargetForApply,
  signTrustedPayload,
  snapshotTrustedTarget,
  verifyTrustedPayload,
} from './trusted-authority.mjs';
import {
  acquireTrustedTargetGuard,
  completeTrustedPreIntentRecovery,
  inspectTrustedPreIntents,
  releaseTrustedTargetGuard,
  updateTrustedPreIntent,
  writeTrustedPreIntent,
} from './trusted-intent-ledger.mjs';

export const UNINSTALL_MODE_MATRIX = Object.freeze({
  'app-only': Object.freeze({
    appVersions: 'delete-owned-unmodified', privateRuntimes: 'keep', shims: 'delete-owned-unmodified', aiIntegrations: 'keep', extensionOwnedIntegrationRecords: 'keep', caches: 'keep', logs: 'keep', staging: 'keep', quarantine: 'keep', locks: 'remove-active-on-exit', journals: 'keep', operations: 'keep', receipts: 'keep', finalizerInputs: 'keep', installationIndexes: 'keep-for-reinstall', currentPointer: 'delete', previousPointer: 'keep', uninstallResult: 'write-minimal', userProjects: 'always-keep', foundationFacts: 'always-keep', projectComponents: 'always-keep', modifiedOwnedFiles: 'keep-and-report', unknownOwnership: 'keep-and-report', foreignSharedRuntime: 'keep',
  }),
  'app-and-runtime': Object.freeze({
    appVersions: 'delete-owned-unmodified', privateRuntimes: 'delete-unshared-owned-unmodified', shims: 'delete-owned-unmodified', aiIntegrations: 'keep', extensionOwnedIntegrationRecords: 'keep', caches: 'keep', logs: 'keep', staging: 'keep', quarantine: 'keep', locks: 'remove-active-on-exit', journals: 'keep', operations: 'keep', receipts: 'keep', finalizerInputs: 'keep', installationIndexes: 'keep-for-recovery', currentPointer: 'delete', previousPointer: 'keep', uninstallResult: 'write-minimal', userProjects: 'always-keep', foundationFacts: 'always-keep', projectComponents: 'always-keep', modifiedOwnedFiles: 'keep-and-report', unknownOwnership: 'keep-and-report', foreignSharedRuntime: 'keep-and-report',
  }),
  full: Object.freeze({
    appVersions: 'delete-owned-unmodified', privateRuntimes: 'delete-unshared-owned-unmodified', shims: 'delete-owned-unmodified', aiIntegrations: 'delete-owned-unmodified', extensionOwnedIntegrationRecords: 'delete-owned-unmodified', caches: 'delete-foundation-owned', logs: 'delete-foundation-owned', staging: 'delete-known-owned', quarantine: 'delete-known-owned', locks: 'remove-active-on-exit', journals: 'delete-known-owned', operations: 'delete-known-owned', receipts: 'delete-signed-owned', finalizerInputs: 'delete-signed-owned', installationIndexes: 'delete', currentPointer: 'delete', previousPointer: 'delete', uninstallResult: 'write-minimal', userProjects: 'always-keep', foundationFacts: 'always-keep', projectComponents: 'always-keep', modifiedOwnedFiles: 'keep-and-report', unknownOwnership: 'keep-and-report', foreignSharedRuntime: 'keep-and-report',
  }),
});

function fsyncDirectory(directory) {
  let descriptor;
  try { descriptor = fs.openSync(directory, 'r'); fs.fsyncSync(descriptor); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function writeJsonAtomic(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', mode);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

function writeSignedJson(file, payload, {createKey = false, signing = null} = {}) {
  const integrity = signing
    ? {algorithm: 'hmac-sha256', keyId: signing.keyId, hash: crypto.createHmac('sha256', signing.key).update(canonicalStringify(payload)).digest('hex')}
    : signTrustedPayload(payload, {createKey});
  const document = {...payload, integrity};
  writeJsonAtomic(file, document);
  return document;
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function signedPayload(document, code, label) {
  if (!document || typeof document !== 'object') throw new LifecycleError(code, `${label} 不存在或无效`, {stage: 'integrity'});
  const {integrity, ...payload} = document;
  if (!verifyTrustedPayload(payload, integrity)) throw new LifecycleError(code, `${label} HMAC 完整性验证失败`, {stage: 'integrity'});
  return payload;
}

function signedPayloadWithSnapshot(document, code, label, signing) {
  if (!document || typeof document !== 'object') throw new LifecycleError(code, `${label} 不存在或无效`, {stage: 'integrity'});
  const {integrity, ...payload} = document;
  const expected = crypto.createHmac('sha256', signing.key).update(canonicalStringify(payload)).digest('hex');
  if (integrity?.algorithm !== 'hmac-sha256' || integrity.keyId !== signing.keyId || !/^[0-9a-f]{64}$/u.test(integrity.hash || '') || !crypto.timingSafeEqual(Buffer.from(integrity.hash, 'hex'), Buffer.from(expected, 'hex'))) throw new LifecycleError(code, `${label} HMAC 完整性验证失败`, {stage: 'integrity'});
  return payload;
}

function statePaths(root) {
  const state = path.join(root, 'state');
  return {state, current: path.join(state, 'current.json'), previous: path.join(state, 'previous.json'), installations: path.join(state, 'installations.json'), operations: path.join(state, 'operations'), journals: path.join(state, 'journals'), receipts: path.join(state, 'receipts'), finalizers: path.join(state, 'finalizers'), recoveryIntents: path.join(state, 'recovery-intents')};
}

function readCurrent(root) {
  const file = statePaths(root).current;
  return fs.existsSync(file) ? signedPayload(readJson(file), 'CURRENT_IDENTITY_INVALID', 'current pointer') : null;
}

const emptyInstallations = () => ({schemaVersion: '1.0.0', versions: {}, history: []});

function readInstallations(root) {
  const file = statePaths(root).installations;
  return fs.existsSync(file) ? signedPayload(readJson(file), 'INSTALLATION_INDEX_INVALID', 'installation index') : emptyInstallations();
}

function writeCurrent(root, current) {
  const file = statePaths(root).current;
  if (current) writeSignedJson(file, current);
  else if (fs.existsSync(file)) fs.rmSync(file);
}

const writeInstallations = (root, installations) => writeSignedJson(statePaths(root).installations, installations);

function ensureControlledRoot(root, authority) {
  if (fs.existsSync(root)) return;
  const relative = path.relative(authority.trustedRootRealPath, root);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new LifecycleError('TARGET_OUTSIDE_TRUSTED_ROOT', '目标逃出可信 .tmp 根', {stage: 'preflight'});
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root) throw new LifecycleError('TARGET_REALPATH_MISMATCH', '创建后的目标 real path 不一致', {stage: 'preflight'});
  fsyncDirectory(path.dirname(root));
}

const classifyLockOwner = classifyProcessOwner;

function ownerPayload(planId) {
  const observed = observeProcessFingerprint(process.pid);
  if (observed.state !== 'observed') throw new LifecycleError('PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', '无法取得当前进程实例启动指纹，拒绝创建不可靠 operation lock', {stage: 'lock', retryable: true});
  return {schemaVersion: '1.0.0', operationId: planId, pid: process.pid, processStartedAt: Date.now(), processFingerprint: observed.fingerprint, ownerNonce: crypto.randomUUID()};
}

function acquireOwnerFile(root, planId, {name, label, unknownCode, lockedCode, deadCode = lockedCode, reclaim = false}) {
  const file = path.join(root, name);
  loadTrustedAuthorityKey({create: true});
  let reclaimed = null;
  if (fs.existsSync(file)) {
    try {
      const existing = signedPayload(readJson(file), unknownCode, label);
      const state = classifyLockOwner(existing);
      if (state === 'live') throw new LifecycleError(lockedCode, `已有 live ${label} ${existing.operationId}（PID ${existing.pid}）`, {stage: 'lock', retryable: true, details: {lockKind: name, ownerState: state, operationId: existing.operationId, pid: existing.pid, processFingerprint: existing.processFingerprint}});
      if (state === 'unavailable') throw new LifecycleError(lockedCode, `${label} 缺少可安全验证的进程实例证据`, {stage: 'lock', retryable: true, details: {lockKind: name, ownerState: state, operationId: existing.operationId, pid: existing.pid}});
      if (!reclaim) throw new LifecycleError(deadCode, `${label} 必须先由 exact authorized recover plan 处理，拒绝直接删除后继续`, {stage: 'lock', retryable: true, details: {lockKind: name, ownerState: state, operationId: existing.operationId, pid: existing.pid, recoveryRequired: true}});
      fs.rmSync(file);
      fsyncDirectory(root);
      reclaimed = {operationId: existing.operationId, recoveredState: state === 'stale-instance' ? `stale-instance-${name}-removed` : `dead-${name}-removed`};
    } catch (error) {
      if (error.code === lockedCode || error.code === deadCode) throw error;
      throw new LifecycleError(lockedCode, `存在无法安全接管的 ${label}`, {stage: 'lock', retryable: true, details: {lockKind: name, ownerState: 'unknown', causeCode: error.code || unknownCode}});
    }
  }
  const owner = ownerPayload(planId);
  const document = {...owner, integrity: signTrustedPayload(owner)};
  let descriptor;
  try { descriptor = fs.openSync(file, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new LifecycleError(lockedCode, `${label} 被并发进程抢先取得`, {stage: 'lock', retryable: true, details: {lockKind: name, ownerState: 'raced'}});
    throw error;
  }
  try { fs.writeFileSync(descriptor, `${JSON.stringify(document, null, 2)}\n`); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fsyncDirectory(root);
  return {file, owner, reclaimed};
}

const acquireGuard = (root, operationId, {reclaim = false} = {}) => acquireOwnerFile(root, operationId, {name: '.foundation-operation.guard', label: 'lifecycle acquisition guard', unknownCode: 'OPERATION_GUARD_UNKNOWN', lockedCode: 'OPERATION_LOCKED', deadCode: 'RECOVERY_REQUIRED', reclaim});
const acquireLock = (root, operationId) => acquireOwnerFile(root, operationId, {name: '.foundation-operation.lock', label: 'operation lock', unknownCode: 'OPERATION_LOCK_UNKNOWN', lockedCode: 'OPERATION_LOCKED', reclaim: false});

function releaseOwnerFile(ownership) {
  if (!ownership) return;
  try {
    if (fs.existsSync(ownership.file)) {
      const current = readJson(ownership.file);
      if (current?.ownerNonce === ownership.owner.ownerNonce) {
        fs.rmSync(ownership.file);
        fsyncDirectory(path.dirname(ownership.file));
      }
    }
  } catch {}
}

const releaseLock = releaseOwnerFile;
const releaseGuard = releaseOwnerFile;

function copyTree(source, destination) {
  fs.mkdirSync(destination, {recursive: true});
  for (const entry of fs.readdirSync(source, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new LifecycleError('STAGING_SYMLINK_REJECTED', `拒绝复制符号链接：${from}`, {stage: 'staging'});
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) {
      fs.copyFileSync(from, to); fs.chmodSync(to, fs.statSync(from).mode & 0o777);
      const descriptor = fs.openSync(to, 'r'); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    } else throw new LifecycleError('STAGING_FILE_TYPE_REJECTED', `拒绝复制非普通文件：${from}`, {stage: 'staging'});
  }
  fsyncDirectory(destination);
}

function walkFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new LifecycleError('INSTALLED_SYMLINK_REJECTED', `已安装内容不得包含符号链接：${absolute}`, {stage: 'integrity'});
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
      else throw new LifecycleError('INSTALLED_FILE_TYPE_REJECTED', `已安装内容含非普通文件：${absolute}`, {stage: 'integrity'});
    }
  }
  visit(root);
  return files;
}

function normalizedTreePath(relative, code) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').some((part) => !part || part === '.' || part === '..')) throw new LifecycleError(code, `树校验路径无效：${relative}`, {stage: 'integrity'});
  const normalized = relative.normalize('NFC');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function expectedDirectoryKeys(files, code) {
  const directories = new Set();
  for (const relative of files.keys()) {
    const parts = relative.split('/');
    for (let index = 1; index < parts.length; index += 1) directories.add(normalizedTreePath(parts.slice(0, index).join('/'), code));
  }
  return directories;
}

function verifyCompleteTree({root, baseRelative, expectedFiles, code}) {
  const base = path.join(root, ...baseRelative.split('/'));
  if (!fs.existsSync(base) || fs.lstatSync(base).isSymbolicLink() || !fs.statSync(base).isDirectory()) throw new LifecycleError(code, `已存在目标缺失或类型错误：${baseRelative}`, {stage: 'integrity'});
  const expected = new Map();
  for (const [relative, record] of expectedFiles) {
    const key = normalizedTreePath(relative, code);
    if (expected.has(key)) throw new LifecycleError(code, `期望树存在规范化路径冲突：${baseRelative}/${relative}`, {stage: 'integrity'});
    expected.set(key, {relative, record});
  }
  const expectedDirectories = expectedDirectoryKeys(new Map([...expected.values()].map(({relative, record}) => [relative, record])), code);
  const actualFiles = new Map();
  const actualDirectories = new Set();
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(base, absolute).replaceAll(path.sep, '/');
      const key = normalizedTreePath(relative, code);
      if (entry.isSymbolicLink()) throw new LifecycleError(code, `目标树包含符号链接：${baseRelative}/${relative}`, {stage: 'integrity'});
      if (entry.isDirectory()) {
        if (actualDirectories.has(key) || actualFiles.has(key)) throw new LifecycleError(code, `目标树存在规范化路径冲突：${baseRelative}/${relative}`, {stage: 'integrity'});
        actualDirectories.add(key);
        visit(absolute);
      } else if (entry.isFile()) {
        if (actualFiles.has(key) || actualDirectories.has(key)) throw new LifecycleError(code, `目标树存在规范化路径冲突：${baseRelative}/${relative}`, {stage: 'integrity'});
        actualFiles.set(key, {relative, absolute});
      } else throw new LifecycleError(code, `目标树包含非普通文件：${baseRelative}/${relative}`, {stage: 'integrity'});
    }
  }
  visit(base);
  if (actualFiles.size !== expected.size || [...actualFiles.keys()].some((key) => !expected.has(key)) || actualDirectories.size !== expectedDirectories.size || [...actualDirectories].some((key) => !expectedDirectories.has(key))) throw new LifecycleError(code, `已存在目标完整树与权威清单不一致：${baseRelative}`, {stage: 'integrity'});
  for (const [key, {relative, record}] of expected) {
    const actual = actualFiles.get(key);
    if (!actual) throw new LifecycleError(code, `已存在目标文件缺失：${baseRelative}/${relative}`, {stage: 'integrity'});
    const stat = fs.statSync(actual.absolute);
    if (stat.size !== record.size || sha256(fs.readFileSync(actual.absolute)) !== record.sha256 || (Number.isInteger(record.mode) && (stat.mode & 0o777) !== record.mode)) throw new LifecycleError(code, `已存在目标 size/hash/mode 不一致：${baseRelative}/${relative}`, {stage: 'integrity'});
  }
}

function verifyManifestTree({root, baseRelative, manifestFiles, manifestPrefix, code}) {
  const expected = manifestFiles.filter((record) => record.path.startsWith(manifestPrefix)).map((record) => [record.path.slice(manifestPrefix.length), record]);
  verifyCompleteTree({root, baseRelative, expectedFiles: expected, code});
}

function verifyReceiptTree({root, baseRelative, receiptFiles, category, code}) {
  const prefix = `${baseRelative}/`;
  const categoryFiles = receiptFiles.filter((record) => record.category === category);
  const expected = categoryFiles.filter((record) => record.path.startsWith(prefix)).map((record) => [record.path.slice(prefix.length), record]);
  if (!expected.length || expected.length !== categoryFiles.length) throw new LifecycleError(code, `receipt 缺少或含越界的 ${category} 完整树记录`, {stage: 'integrity'});
  verifyCompleteTree({root, baseRelative, expectedFiles: expected, code});
}

function verifyReceiptFile(root, file, code) {
  const target = path.join(root, ...file.path.split('/'));
  if (!fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isFile()) throw new LifecycleError(code, `receipt-owned 文件缺失或类型错误：${file.path}`, {stage: 'integrity'});
  const stat = fs.statSync(target);
  if (stat.size !== file.size || sha256(fs.readFileSync(target)) !== file.sha256 || (Number.isInteger(file.mode) && (stat.mode & 0o777) !== file.mode)) throw new LifecycleError(code, `receipt-owned 文件 size/hash/mode 损坏：${file.path}`, {stage: 'integrity'});
}

const runtimeRecord = (manifest) => manifest.runtime ? manifest.files.find((record) => record.path === manifest.runtime.path) : null;

function identityFrom(plan, manifest) {
  const runtime = runtimeRecord(manifest);
  if (!runtime) throw new LifecycleError('PRIVATE_RUNTIME_MISSING', '候选缺少私有 runtime identity', {stage: 'candidate-verify'});
  return {productVersion: manifest.productVersion, candidateManifestHash: manifest.candidateHash, runtimeHash: runtime.sha256, platform: manifest.platform, architecture: manifest.arch, installId: plan.installId};
}

const identityEqual = (left, right) => Boolean(left && right && ['productVersion', 'candidateManifestHash', 'runtimeHash', 'platform', 'architecture', 'installId'].every((key) => left[key] === right[key]));

function currentRecord(plan, manifest) {
  const identity = identityFrom(plan, manifest);
  const runtimeId = `node-${identity.runtimeHash.slice(0, 16)}`;
  const appPath = `versions/${identity.productVersion}/app`;
  const runtimeRoot = `runtimes/${runtimeId}`;
  return {schemaVersion: '1.0.0', version: identity.productVersion, platform: identity.platform, arch: identity.architecture, candidateHash: identity.candidateManifestHash, appPath, runtimeRoot, runtimePath: `${runtimeRoot}/${manifest.runtime.path.slice('runtime/'.length)}`, entrypoint: `${appPath}/${manifest.entrypoint.slice('app/'.length)}`, installIdentity: plan.installIdentity, identity};
}

function healthProbe(root, record, {code = 'EXECUTABLE_HEALTH_FAILED'} = {}) {
  const runtime = path.join(root, ...record.runtimePath.split('/'));
  const entrypoint = path.join(root, ...record.entrypoint.split('/'));
  if (!fs.existsSync(runtime) || !fs.existsSync(entrypoint) || fs.lstatSync(runtime).isSymbolicLink() || fs.lstatSync(entrypoint).isSymbolicLink()) throw new LifecycleError(code, 'runtime 或 entrypoint 缺失/为符号链接', {stage: 'health-check'});
  if (process.platform !== 'win32') { try { fs.accessSync(runtime, fs.constants.X_OK); } catch { throw new LifecycleError(code, '私有 runtime 存在但不可执行', {stage: 'health-check'}); } }
  const run = spawnSync(runtime, [entrypoint, '--foundation-health'], {cwd: root, encoding: 'utf8', timeout: 15_000, env: {PATH: '', FOUNDATION_HEALTH_PROBE: '1'}});
  if (run.error || run.signal || run.status !== 0) throw new LifecycleError(code, `私有 runtime 健康命令失败：${run.error?.message || run.signal || run.status}`, {stage: 'health-check'});
  const lines = run.stdout.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length !== 1) throw new LifecycleError(code, '私有 runtime 健康命令必须只返回一个结构化结果', {stage: 'health-check'});
  let output; try { output = JSON.parse(lines[0]); } catch { output = null; }
  const keys = output && typeof output === 'object' && !Array.isArray(output) ? Object.keys(output).sort() : [];
  const allowedKeys = new Set(['ok', 'runtime', 'version']);
  const schemaValid = output && typeof output === 'object' && !Array.isArray(output) && keys.every((key) => allowedKeys.has(key)) && output.ok === true && typeof output.version === 'string' && output.version.length > 0 && output.version === record.identity.productVersion && (output.runtime === undefined || (typeof output.runtime === 'string' && output.runtime.length > 0));
  if (!schemaValid) throw new LifecycleError(code, '私有 runtime 健康命令未返回单一、严格且匹配 productVersion 的结果', {stage: 'health-check'});
  return {ok: true, exitCode: run.status, output};
}

function stageRecord(record) {
  return {...record, appPath: 'app', runtimeRoot: 'runtime', runtimePath: `runtime/${record.runtimePath.split('/').slice(2).join('/')}`, entrypoint: `app/${record.entrypoint.split('/').slice(3).join('/')}`};
}

function receiptPayload(root, plan, record, manifest, integrationRoot = null) {
  const files = [];
  for (const source of manifest.files.filter((file) => file.path.startsWith('app/'))) files.push({path: `${record.appPath}/${source.path.slice('app/'.length)}`, sha256: source.sha256, size: source.size, mode: source.mode, category: 'app'});
  for (const source of manifest.files.filter((file) => file.path.startsWith('runtime/'))) files.push({path: `${record.runtimeRoot}/${source.path.slice('runtime/'.length)}`, sha256: source.sha256, size: source.size, mode: source.mode, category: 'runtime'});
  const shimPath = `bin/${plan.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit'}`;
  const shimFile = path.join(root, ...shimPath.split('/'));
  files.push({path: shimPath, sha256: sha256(fs.readFileSync(shimFile)), size: fs.statSync(shimFile).size, mode: fs.statSync(shimFile).mode & 0o777, category: 'shim'});
  if (integrationRoot && fs.existsSync(integrationRoot)) for (const file of walkFiles(integrationRoot)) files.push({path: path.relative(root, file).replaceAll(path.sep, '/'), sha256: sha256(fs.readFileSync(file)), size: fs.statSync(file).size, mode: fs.statSync(file).mode & 0o777, category: 'integration'});
  return {schemaVersion: '1.0.0', operationId: plan.planId, identity: record.identity, version: record.version, candidateHash: record.candidateHash, appPath: record.appPath, runtimeRoot: record.runtimeRoot, runtimePath: record.runtimePath, entrypoint: record.entrypoint, files: files.sort((a, b) => a.path.localeCompare(b.path)), preserves: ['user product projects', '.foundation/facts', 'project-owned extension files']};
}

function readReceipts(root) {
  const directory = statePaths(root).receipts;
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((entry) => entry.endsWith('.json')).sort().map((name) => {
    const file = path.join(directory, name);
    const document = readJson(file);
    return {file, relative: path.relative(root, file).replaceAll(path.sep, '/'), document, payload: signedPayload(document, 'RECEIPT_INTEGRITY_INVALID', `receipt ${name}`)};
  });
}

const receiptForIdentity = (root, identity) => readReceipts(root).find((receipt) => identityEqual(receipt.payload.identity, identity)) || null;

function verifyRecordFromReceipt(root, record, receipt, code, categories = null, {probe = true} = {}) {
  if (!receipt || !identityEqual(receipt.payload.identity, record.identity)) throw new LifecycleError(code, 'receipt 与 installed identity 不匹配', {stage: 'integrity'});
  if (receipt.payload.schemaVersion !== '1.0.0' || receipt.payload.appPath !== record.appPath || receipt.payload.runtimeRoot !== record.runtimeRoot || receipt.payload.runtimePath !== record.runtimePath || receipt.payload.entrypoint !== record.entrypoint || !Array.isArray(receipt.payload.files)) throw new LifecycleError(code, 'receipt 路径绑定与 installed record 不匹配', {stage: 'integrity'});
  const selected = new Set(categories || ['app', 'runtime', 'shim', 'integration']);
  if (selected.has('app')) verifyReceiptTree({root, baseRelative: record.appPath, receiptFiles: receipt.payload.files, category: 'app', code});
  if (selected.has('runtime')) verifyReceiptTree({root, baseRelative: record.runtimeRoot, receiptFiles: receipt.payload.files, category: 'runtime', code});
  for (const file of receipt.payload.files.filter((entry) => selected.has(entry.category) && !['app', 'runtime'].includes(entry.category))) verifyReceiptFile(root, file, code);
  if (probe) healthProbe(root, record, {code});
}

function validateBoundCandidate(plan) {
  assertTrustedCandidatePath(plan.candidate.path);
  const checked = validateCandidate(plan.candidate.path, {platform: plan.platform, arch: plan.arch, requireRuntime: true});
  if (!checked.ok) throw new LifecycleError(checked.error.code, checked.error.message, {stage: checked.error.stage});
  const runtime = runtimeRecord(checked.manifest);
  if (checked.manifest.candidateHash !== plan.candidate.manifestHash || checked.manifest.productVersion !== plan.targetVersion || checked.manifest.totalBytes !== plan.candidate.bytes || (plan.candidate.runtimeHash && runtime?.sha256 !== plan.candidate.runtimeHash) || plan.candidate.acquisition !== 'local-ingestion') throw new LifecycleError('CANDIDATE_PLAN_MISMATCH', '候选完整 identity/字节/获取模式与 plan 不一致', {stage: 'candidate-verify'});
  return checked;
}

function journalPayload(plan, root, owner, current, installations, authorization) {
  const shim = path.join(root, 'bin', plan.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit');
  const receipt = plan.targetVersion ? path.join(statePaths(root).receipts, `${plan.targetVersion}.json`) : null;
  return {schemaVersion: '1.0.0', operationId: plan.planId, operation: plan.operation, status: 'planned', outcome: null, owner, authorization, plan, identity: null, steps: [{stage: 'planned', status: 'complete', at: Date.now()}], previous: {current, installations, shim: fs.existsSync(shim) ? {contentBase64: fs.readFileSync(shim).toString('base64'), mode: fs.statSync(shim).mode & 0o777} : null, receipt: receipt && fs.existsSync(receipt) ? fs.readFileSync(receipt).toString('base64') : null}, created: {app: false, runtime: false, integration: false, receipt: false}, repairBackups: [], result: null};
}

function writeJournal(file, journal, status = journal.status, stage = null, signing = null) {
  journal.status = status;
  if (stage) journal.steps.push({stage, status: 'complete', at: Date.now()});
  writeSignedJson(file, journal, {signing});
}

function controlledRemove(root, relative, {recursive = false} = {}) {
  const target = path.resolve(root, ...relative.split('/'));
  if (!isWithin(root, target) || target === root || !fs.existsSync(target)) return;
  if (fs.lstatSync(target).isSymbolicLink()) throw new LifecycleError('RECOVERY_SYMLINK_REJECTED', `恢复拒绝符号链接目标：${relative}`, {stage: 'recovery'});
  fs.rmSync(target, {recursive, force: recursive});
}

function rollbackJournal(root, journal, journalFile) {
  writeJournal(journalFile, journal, 'rolling-back', 'rolling-back');
  const identity = journal.identity;
  for (const backup of [...(journal.repairBackups || [])].reverse()) {
    const installed = path.join(root, ...backup.installed.split('/'));
    const saved = path.join(root, ...backup.backup.split('/'));
    if (!isWithin(root, installed) || !isWithin(root, saved)) throw new LifecycleError('RECOVERY_SCOPE_INVALID', 'repair backup 恢复范围越界', {stage: 'recovery'});
    if (backup.existed && fs.existsSync(saved)) { fs.mkdirSync(path.dirname(installed), {recursive: true}); fs.copyFileSync(saved, installed); fs.chmodSync(installed, backup.mode); }
    else if (!backup.existed && fs.existsSync(installed) && !fs.lstatSync(installed).isSymbolicLink()) fs.rmSync(installed);
  }
  if (journal.created.integration) controlledRemove(root, 'integrations/codex/skills/ai-product-foundation-kit', {recursive: true});
  if (journal.created.app && identity) controlledRemove(root, `versions/${identity.productVersion}`, {recursive: true});
  if (journal.created.runtime && identity) controlledRemove(root, `runtimes/node-${identity.runtimeHash.slice(0, 16)}`, {recursive: true});
  writeInstallations(root, journal.previous.installations || emptyInstallations());
  writeCurrent(root, journal.previous.current);
  const shim = path.join(root, 'bin', journal.plan.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit');
  if (journal.previous.shim) { fs.mkdirSync(path.dirname(shim), {recursive: true}); fs.writeFileSync(shim, Buffer.from(journal.previous.shim.contentBase64, 'base64'), {mode: journal.previous.shim.mode}); }
  else if (fs.existsSync(shim) && !fs.lstatSync(shim).isSymbolicLink()) fs.rmSync(shim);
  if (journal.plan.targetVersion) {
    const receipt = path.join(statePaths(root).receipts, `${journal.plan.targetVersion}.json`);
    if (journal.previous.receipt) { fs.mkdirSync(path.dirname(receipt), {recursive: true}); fs.writeFileSync(receipt, Buffer.from(journal.previous.receipt, 'base64')); }
    else if (journal.created.receipt && fs.existsSync(receipt)) fs.rmSync(receipt);
  }
  controlledRemove(root, `staging/${journal.operationId}`, {recursive: true});
  journal.outcome = 'rolled-back';
  writeJournal(journalFile, journal, 'completed', 'recovery-complete');
  return {operationId: journal.operationId, operation: journal.operation, recoveredState: 'rolled-back'};
}

function installOrUpdate({plan, root, current, installations, journal, journalFile}) {
  operationCheckpoint('download');
  const checked = validateBoundCandidate(plan);
  operationCheckpoint('after-verify');
  const record = currentRecord(plan, checked.manifest);
  journal.identity = record.identity;
  writeJournal(journalFile, journal, 'planned', 'candidate-verified');
  operationCheckpoint('before-staging');
  const stagingRelative = `staging/${plan.planId}`;
  const staging = path.join(root, ...stagingRelative.split('/'));
  controlledRemove(root, stagingRelative, {recursive: true});
  fs.mkdirSync(staging, {recursive: true});
  const payload = path.join(checked.root, 'payload');
  copyTree(path.join(payload, 'app'), path.join(staging, 'app'));
  copyTree(path.join(payload, 'runtime'), path.join(staging, 'runtime'));
  healthProbe(staging, stageRecord(record));
  writeJournal(journalFile, journal, 'staged', 'staged-and-health-verified');
  operationCheckpoint('after-staging');

  const appBase = path.join(root, ...record.appPath.split('/'));
  const runtimeBase = path.join(root, ...record.runtimeRoot.split('/'));
  if (fs.existsSync(appBase)) {
    verifyManifestTree({root, baseRelative: record.appPath, manifestFiles: checked.manifest.files, manifestPrefix: 'app/', code: 'APP_VERSION_COLLISION'});
    if (!receiptForIdentity(root, record.identity)) throw new LifecycleError('APP_VERSION_OWNERSHIP_UNKNOWN', '同版本 app 已存在但没有匹配 signed receipt', {stage: 'integrity'});
  } else {
    journal.created.app = true; writeJournal(journalFile, journal, 'switching', 'app-switch-intent'); fs.mkdirSync(path.dirname(appBase), {recursive: true}); fs.renameSync(path.join(staging, 'app'), appBase);
  }
  if (fs.existsSync(runtimeBase)) {
    verifyManifestTree({root, baseRelative: record.runtimeRoot, manifestFiles: checked.manifest.files, manifestPrefix: 'runtime/', code: 'RUNTIME_COLLISION'});
    if (!readReceipts(root).some((receipt) => receipt.payload.identity?.runtimeHash === record.identity.runtimeHash)) throw new LifecycleError('RUNTIME_OWNERSHIP_UNKNOWN', 'hash-named runtime 已存在但没有匹配 signed receipt', {stage: 'integrity'});
  } else {
    journal.created.runtime = true; writeJournal(journalFile, journal, 'switching', 'runtime-switch-intent'); fs.mkdirSync(path.dirname(runtimeBase), {recursive: true}); fs.renameSync(path.join(staging, 'runtime'), runtimeBase);
  }
  verifyManifestTree({root, baseRelative: record.appPath, manifestFiles: checked.manifest.files, manifestPrefix: 'app/', code: 'APP_VERSION_COLLISION'});
  verifyManifestTree({root, baseRelative: record.runtimeRoot, manifestFiles: checked.manifest.files, manifestPrefix: 'runtime/', code: 'RUNTIME_COLLISION'});
  healthProbe(root, record);
  operationCheckpoint('before-path-shim');
  const shim = path.join(root, 'bin', plan.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit');
  fs.mkdirSync(path.dirname(shim), {recursive: true});
  fs.writeFileSync(shim, platformShim({platform: plan.platform, runtimePath: record.runtimePath, entrypoint: record.entrypoint}), {mode: plan.platform === 'win32' ? 0o644 : 0o755});
  writeJournal(journalFile, journal, 'switching', 'shim-switched');
  operationCheckpoint('after-path-shim');
  operationCheckpoint('after-shim-switch');
  const integrationRoot = null;
  // Capability artifacts remain inert under the installed app. Registration and
  // activation are separate exact manager-confirmed capability operations.
  operationCheckpoint('health-check');
  operationCheckpoint('before-current-switch');
  const nextInstallations = structuredClone(installations);
  if (current && current.version !== record.version) nextInstallations.history.push(current.version);
  nextInstallations.history = [...new Set(nextInstallations.history)];
  nextInstallations.versions[record.version] = record;
  if (current) writeSignedJson(statePaths(root).previous, current);
  writeInstallations(root, nextInstallations);
  writeCurrent(root, record);
  writeJournal(journalFile, journal, 'switching', 'current-switched');
  operationCheckpoint('after-current-switch');
  const receiptFile = path.join(statePaths(root).receipts, `${record.version}.json`);
  journal.created.receipt = !fs.existsSync(receiptFile);
  writeJournal(journalFile, journal, 'switching', 'receipt-commit-intent');
  writeSignedJson(receiptFile, receiptPayload(root, plan, record, checked.manifest, integrationRoot));
  const stable=spawnSync(shim,['--foundation-health'],{cwd:root,encoding:'utf8',timeout:15000,env:{PATH:'',FOUNDATION_HEALTH_PROBE:'1'}});
  let stableHealth;try{stableHealth=JSON.parse(stable.stdout);}catch{}
  if(stable.error||stable.signal||stable.status!==0||stableHealth?.ok!==true||stableHealth.version!==record.version)throw new LifecycleError('STABLE_LAUNCHER_HEALTH_FAILED','稳定入口健康核验失败；恢复旧可用版本',{stage:'health-check'});
  const result = {schemaVersion: '1.0.0', ok: true, operationId: plan.planId, state: current ? 'updated' : 'installed', current: record, previous: current?.version || null, executableHealth: 'passed',stableLauncherHealth:'passed'};
  journal.result = result;
  writeJournal(journalFile, journal, 'committed', 'receipt-committed');
  operationCheckpoint('after-receipt-commit');
  controlledRemove(root, stagingRelative, {recursive: true});
  return result;
}

function rollbackOperation({plan, root, journal, journalFile}) {
  const target = readInstallations(root).versions?.[plan.targetVersion];
  if (!target) throw new LifecycleError('ROLLBACK_VERSION_MISSING', `未保留可回退版本：${plan.targetVersion}`, {stage: 'rollback'});
  try { verifyRecordFromReceipt(root, target, receiptForIdentity(root, target.identity), 'ROLLBACK_TARGET_UNHEALTHY', ['app', 'runtime']); }
  catch (error) { throw new LifecycleError('ROLLBACK_TARGET_UNHEALTHY', error.message, {stage: 'rollback'}); }
  journal.identity = target.identity;
  writeJournal(journalFile, journal, 'staged', 'rollback-target-verified');
  const shim = path.join(root, 'bin', plan.platform === 'win32' ? 'foundation-kit.cmd' : 'foundation-kit');
  fs.mkdirSync(path.dirname(shim), {recursive: true});
  fs.writeFileSync(shim, platformShim({platform: plan.platform, runtimePath: target.runtimePath, entrypoint: target.entrypoint}), {mode: plan.platform === 'win32' ? 0o644 : 0o755});
  writeCurrent(root, target);
  const result = {schemaVersion: '1.0.0', ok: true, operationId: plan.planId, state: 'rolled-back', current: target, executableHealth: 'passed'};
  journal.result = result; writeJournal(journalFile, journal, 'committed', 'rollback-committed'); return result;
}

function repairOperation({plan, root, current, journal, journalFile}) {
  const checked = validateBoundCandidate(plan);
  if (!identityEqual(identityFrom(plan, checked.manifest), current.identity)) throw new LifecycleError('REPAIR_IDENTITY_MISMATCH', 'repair candidate 必须与 current installed identity 完全一致；不同候选应走 update', {stage: 'repair'});
  if (!receiptForIdentity(root, current.identity)) throw new LifecycleError('REPAIR_RECEIPT_MISMATCH', 'repair 缺少匹配 current identity 的 signed receipt', {stage: 'repair'});
  journal.identity = current.identity;
  const quarantined = [];
  const repairRecords = checked.manifest.files.filter((entry) => entry.path.startsWith('app/') || entry.path.startsWith('runtime/'));
  const expectedInstalled = new Set(repairRecords.map((record) => record.path.startsWith('app/') ? `${current.appPath}/${record.path.slice('app/'.length)}` : `${current.runtimeRoot}/${record.path.slice('runtime/'.length)}`));
  for (const baseRelative of [current.appPath, current.runtimeRoot]) {
    const base = path.join(root, ...baseRelative.split('/'));
    for (const extra of walkFiles(base).map((file) => path.relative(root, file).replaceAll(path.sep, '/')).filter((relative) => !expectedInstalled.has(relative))) {
      const installed = path.join(root, ...extra.split('/'));
      const backupRelative = `quarantine/${plan.planId}/${extra}`;
      const backup = path.join(root, ...backupRelative.split('/'));
      fs.mkdirSync(path.dirname(backup), {recursive: true});
      fs.copyFileSync(installed, backup);
      journal.repairBackups.push({installed: extra, backup: backupRelative, existed: true, mode: fs.statSync(installed).mode & 0o777});
      writeJournal(journalFile, journal, 'switching', 'repair-extra-quarantined');
      fs.rmSync(installed);
      quarantined.push(backupRelative);
    }
  }
  for (const record of repairRecords) {
    const installedRelative = record.path.startsWith('app/') ? `${current.appPath}/${record.path.slice('app/'.length)}` : `${current.runtimeRoot}/${record.path.slice('runtime/'.length)}`;
    const installed = path.join(root, ...installedRelative.split('/'));
    const source = path.join(checked.root, 'payload', ...record.path.split('/'));
    const exists = fs.existsSync(installed);
    if (exists && !fs.lstatSync(installed).isSymbolicLink() && fs.statSync(installed).isFile() && sha256(fs.readFileSync(installed)) === record.sha256) continue;
    if (exists && fs.lstatSync(installed).isSymbolicLink()) throw new LifecycleError('REPAIR_SYMLINK_REJECTED', `repair 拒绝符号链接：${installedRelative}`, {stage: 'repair'});
    const backupRelative = `quarantine/${plan.planId}/${installedRelative}`;
    if (exists) { const backup = path.join(root, ...backupRelative.split('/')); fs.mkdirSync(path.dirname(backup), {recursive: true}); fs.copyFileSync(installed, backup); quarantined.push(backupRelative); }
    journal.repairBackups.push({installed: installedRelative, backup: backupRelative, existed: exists, mode: exists ? fs.statSync(installed).mode & 0o777 : record.mode});
    writeJournal(journalFile, journal, 'switching', 'repair-backup-durable');
    fs.mkdirSync(path.dirname(installed), {recursive: true}); fs.copyFileSync(source, installed); fs.chmodSync(installed, record.mode);
  }
  verifyManifestTree({root, baseRelative: current.appPath, manifestFiles: checked.manifest.files, manifestPrefix: 'app/', code: 'REPAIR_INTEGRITY_FAILED'});
  verifyManifestTree({root, baseRelative: current.runtimeRoot, manifestFiles: checked.manifest.files, manifestPrefix: 'runtime/', code: 'REPAIR_INTEGRITY_FAILED'});
  healthProbe(root, current);
  const result = {schemaVersion: '1.0.0', ok: true, operationId: plan.planId, state: 'repaired', current, quarantined, executableHealth: 'passed'};
  journal.result = result; writeJournal(journalFile, journal, 'committed', 'repair-committed'); return result;
}

const receiptProof = (root, receipt) => ({path: receipt.relative, integrityHash: receipt.document.integrity.hash, fileHash: sha256(fs.readFileSync(receipt.file))});

function coreStateRelationship(kind, document, installId) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return {relationship: 'unknown', reason: 'state-signature-invalid', integrityHash: null};
  const {integrity, ...payload} = document;
  if (!verifyTrustedPayload(payload, integrity)) return {relationship: 'unknown', reason: 'state-signature-invalid', integrityHash: null};
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

function coreStateProof(root, relative, kind, installId) {
  const file = path.join(root, ...relative.split('/'));
  const base = {path: relative, kind, expectedInstallId: installId};
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') return {...base, exists: false, type: 'missing', relationship: 'absent', reason: 'absent-at-inventory', deletePolicy: 'already-absent'};
    throw error;
  }
  if (stat.isSymbolicLink()) return {...base, exists: true, type: 'symlink', relationship: 'unknown', reason: 'symlink-preserved', deletePolicy: 'preserve'};
  if (!stat.isFile()) return {...base, exists: true, type: stat.isDirectory() ? 'directory' : 'special', relationship: 'unknown', reason: 'unexpected-type-preserved', deletePolicy: 'preserve'};
  const bytes = fs.readFileSync(file);
  let document;
  try { document = JSON.parse(bytes.toString('utf8')); } catch { document = null; }
  const relationship = coreStateRelationship(kind, document, installId);
  return {...base, exists: true, type: 'file', fileHash: sha256(bytes), ...relationship, deletePolicy: relationship.relationship === 'owned' ? 'delete-if-unchanged-and-reverified' : 'preserve'};
}

function buildCoreStateProofs(root, installId) {
  return [
    coreStateProof(root, 'state/current.json', 'current', installId),
    coreStateProof(root, 'state/previous.json', 'previous', installId),
    coreStateProof(root, 'state/installations.json', 'installations', installId),
  ];
}

function buildUninstallInput({plan, root, current, authorization}) {
  const receipts = readReceipts(root);
  const own = receipts.filter((receipt) => receipt.payload.identity?.installId === current.identity.installId);
  if (!own.length) throw new LifecycleError('UNINSTALL_RECEIPT_MISSING', '卸载缺少当前 install identity 的 signed receipt', {stage: 'uninstall'});
  const foreignRuntimePaths = new Set(receipts.filter((receipt) => receipt.payload.identity?.installId !== current.identity.installId).flatMap((receipt) => receipt.payload.files.filter((file) => file.category === 'runtime').map((file) => file.path)));
  const allowed = new Set(['app', 'shim']);
  if (['app-and-runtime', 'full'].includes(plan.mode)) allowed.add('runtime');
  if (plan.mode === 'full') allowed.add('integration');
  const byPath = new Map();
  const preservedSharedRuntime = [];
  const ordered = [...own].sort((a, b) => Number(b.payload.identity.productVersion === current.version) - Number(a.payload.identity.productVersion === current.version));
  for (const receipt of ordered) for (const file of receipt.payload.files) {
    if (!allowed.has(file.category) || byPath.has(file.path)) continue;
    if (file.category === 'runtime' && foreignRuntimePaths.has(file.path)) { preservedSharedRuntime.push(file.path); continue; }
    byPath.set(file.path, {...file, ownerIdentity: receipt.payload.identity, receiptProof: receiptProof(root, receipt)});
  }
  const authority = deriveTrustedLifecycleAuthority();
  const payload = {schemaVersion: '1.0.0', operationId: plan.planId, mode: plan.mode, installId: current.identity.installId, authorization, authority: {mode: authority.mode, repositoryRealPath: authority.repositoryRealPath, trustedRootRealPath: authority.trustedRootRealPath}, targetRelative: plan.authority.targetRelative, deletions: [...byPath.values()], coreStateProofs: buildCoreStateProofs(root, current.identity.installId), preservedSharedRuntime: [...new Set(preservedSharedRuntime)].sort(), matrix: UNINSTALL_MODE_MATRIX[plan.mode]};
  return {payload, integrity: signTrustedPayload(payload)};
}

function runFinalizer(inputFile, signing) {
  operationCheckpoint('uninstall-finalizer');
  const env = {...sanitizeNodeStartupEnvironment(), ...finalizerRuntimeEnvironment()};
  const run = spawnSync(process.execPath, [path.join(import.meta.dirname, 'uninstall-finalizer.mjs'), inputFile], {encoding: 'utf8', env, timeout: 120_000});
  if (run.signal || run.error?.code === 'ETIMEDOUT') throw new LifecycleError('FINALIZER_INTERRUPTED', `卸载 finalizer 结果未知：${run.signal || run.error?.code}`, {stage: 'uninstall-finalizer', retryable: true});
  if (run.status !== 0) {
    let error; try { error = JSON.parse(run.stderr.trim().split(/\r?\n/u).at(-1)); } catch { error = null; }
    throw new LifecycleError(error?.code || 'FINALIZER_FAILED', error?.message || `卸载 finalizer 失败：${run.status}`, {stage: 'uninstall-finalizer', retryable: true});
  }
  let result;
  try { result = JSON.parse(run.stdout.trim().split(/\r?\n/u).at(-1)); }
  catch { throw new LifecycleError('UNINSTALL_RESULT_INVALID', '卸载 finalizer 未返回有效 signed result', {stage: 'uninstall-finalizer', retryable: true}); }
  return signing
    ? signedPayloadWithSnapshot(result, 'UNINSTALL_RESULT_INVALID', 'uninstall result', signing)
    : signedPayload(result, 'UNINSTALL_RESULT_INVALID', 'uninstall result');
}

function invalidateCapabilityControlPlane(root, authorization) {
  const changed = [];
  for (const [relative, collection] of [['state/capabilities.json', 'capabilities'], ['state/capability-host-registrations.json', 'registrations']]) {
    const file = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(file)) continue;
    const payload = signedPayload(readJson(file), 'CAPABILITY_STATE_INVALID', relative);
    const records = payload[collection];
    if (!records || typeof records !== 'object' || Array.isArray(records)) throw new LifecycleError('CAPABILITY_STATE_INVALID', `卸载前 capability ${collection} state 无效`, {stage: 'uninstall'});
    for (const record of Object.values(records)) {
      record.active = false;
      record.invalidatedByFoundationUninstall = true;
      record.invalidationAuthorization = {authorizationId: authorization.authorizationId, effectHash: authorization.effectHash};
    }
    writeSignedJson(file, payload);
    changed.push(relative);
  }
  return changed;
}

function uninstallOperation({plan, root, current, journal, journalFile, signing}) {
  journal.invalidatedCapabilityState = invalidateCapabilityControlPlane(root, journal.authorization);
  writeJournal(journalFile, journal, 'switching', 'capability-registration-invalidated', signing);
  const input = buildUninstallInput({plan, root, current, authorization: journal.authorization});
  const file = path.join(statePaths(root).finalizers, `${plan.planId}.json`);
  writeJsonAtomic(file, input);
  journal.identity = current.identity;
  writeJournal(journalFile, journal, 'uninstalling', 'finalizer-input-durable', signing);
  operationCheckpoint('uninstall-inventory');
  const result = runFinalizer(file, signing);
  journal.result = result;
  if (plan.mode !== 'full' && fs.existsSync(journalFile)) writeJournal(journalFile, journal, 'committed', 'uninstall-finalizer-complete', signing);
  return result;
}

function assertMachineState(plan, root) {
  const current = readCurrent(root);
  if (plan.operation === 'install' && current) throw new LifecycleError('ALREADY_INSTALLED', 'Foundation 已安装，请使用 update、repair 或重新安装计划', {stage: 'preflight'});
  if (plan.operation !== 'install') {
    if (!current) throw new LifecycleError('NOT_INSTALLED', 'Foundation 尚未安装', {stage: 'preflight'});
    if (plan.currentVersion !== current.version) throw new LifecycleError('MACHINE_STATE_CHANGED', `当前版本已从计划中的 ${plan.currentVersion} 变为 ${current.version}`, {stage: 'preflight'});
    if (current.identity?.installId !== plan.installId) throw new LifecycleError('INSTALL_IDENTITY_CHANGED', '当前 install identity 与计划不一致', {stage: 'preflight'});
  }
  return current;
}

function finalizeCommitted(root, journal, journalFile) {
  if (journal.operation === 'uninstall') {
    const topResult = readJson(path.join(root, 'uninstall-result.json'));
    if (topResult?.operationId === journal.operationId) { journal.result = topResult; writeJournal(journalFile, journal, 'completed', 'recovery-finalized'); return {operationId: journal.operationId, operation: journal.operation, recoveredState: 'completed'}; }
  }
  if (journal.identity) {
    const current = readCurrent(root);
    const receipt = current ? receiptForIdentity(root, journal.identity) : null;
    if (!current || !identityEqual(current.identity, journal.identity) || !receipt) return rollbackJournal(root, journal, journalFile);
    verifyRecordFromReceipt(root, current, receipt, 'RECOVERY_COMMITTED_UNHEALTHY');
  }
  if (journal.result) writeSignedJson(path.join(statePaths(root).operations, `${journal.operationId}.json`), journal.result);
  controlledRemove(root, `staging/${journal.operationId}`, {recursive: true});
  writeJournal(journalFile, journal, 'completed', 'recovery-finalized');
  return {operationId: journal.operationId, operation: journal.operation, recoveredState: 'completed'};
}

function recoverLifecycleStateUnderGuard(target, initialRecovered = []) {
  const recovered = [];
  recovered.push(...initialRecovered);
  const manual = [];
  const lockFile = path.join(target, '.foundation-operation.lock');
  if (fs.existsSync(lockFile)) {
    try {
      const lock = signedPayload(readJson(lockFile), 'OPERATION_LOCK_UNKNOWN', 'operation lock');
      const state = classifyLockOwner(lock);
      if (state === 'live') return {status: 'live-operation', operationId: lock.operationId, pid: lock.pid, processFingerprint: lock.processFingerprint, recovered, manual};
      if (state === 'unavailable') {
        manual.push({code: 'PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', path: '.foundation-operation.lock', operationId: lock.operationId, pid: lock.pid});
        return {status: 'manual-action-required', recovered, manual};
      }
      fs.rmSync(lockFile);
      recovered.push({operationId: lock.operationId, recoveredState: state === 'stale-instance' ? 'stale-instance-lock-removed' : 'stale-lock-removed'});
    } catch (error) { manual.push({code: error.code || 'OPERATION_LOCK_UNKNOWN', path: '.foundation-operation.lock'}); return {status: 'manual-action-required', recovered, manual}; }
  }
  const journals = statePaths(target).journals;
  if (!fs.existsSync(journals)) return {status: manual.length ? 'manual-action-required' : recovered.length ? 'recovered' : 'clean', recovered, manual};
  for (const name of fs.readdirSync(journals).filter((entry) => entry.endsWith('.json')).sort()) {
    const file = path.join(journals, name);
    if (!fs.existsSync(file)) continue;
    let journal;
    try { journal = signedPayload(readJson(file), 'JOURNAL_INTEGRITY_INVALID', `journal ${name}`); }
    catch (error) { manual.push({code: error.code || 'JOURNAL_MALFORMED', path: `state/journals/${name}`}); continue; }
    if (journal.operationId !== name.slice(0, -5)) { manual.push({code: 'JOURNAL_OPERATION_MISMATCH', path: `state/journals/${name}`}); continue; }
    if (journal.status === 'completed') continue;
    try {
      if (['planned', 'staged', 'switching', 'rolling-back'].includes(journal.status)) recovered.push(rollbackJournal(target, journal, file));
      else if (journal.status === 'committed') recovered.push(finalizeCommitted(target, journal, file));
      else if (journal.status === 'uninstalling') {
        const resultFile = path.join(target, 'uninstall-result.json');
        if (fs.existsSync(resultFile) && readJson(resultFile)?.operationId === journal.operationId) recovered.push(finalizeCommitted(target, journal, file));
        else {
          const result = runFinalizer(path.join(statePaths(target).finalizers, `${journal.operationId}.json`));
          journal.result = result;
          if (journal.plan.mode !== 'full' && fs.existsSync(file)) writeJournal(file, journal, 'committed', 'finalizer-restarted');
          recovered.push(journal.plan.mode === 'full' ? {operationId: journal.operationId, operation: 'uninstall', recoveredState: 'completed'} : finalizeCommitted(target, journal, file));
        }
      } else manual.push({code: 'JOURNAL_UNKNOWN_STATE', path: `state/journals/${name}`, status: journal.status});
    } catch (error) { manual.push({code: error.code || 'RECOVERY_FAILED', path: `state/journals/${name}`}); }
  }
  return {status: manual.length ? 'manual-action-required' : recovered.length ? 'recovered' : 'clean', recovered, manual};
}

function inspectOwnerFile(target, name, unknownCode) {
  const file = path.join(target, name);
  if (!fs.existsSync(file)) return null;
  try {
    const owner = signedPayload(readJson(file), unknownCode, name);
    const ownerState = classifyLockOwner(owner);
    return {path: name, operationId: owner.operationId, pid: owner.pid, processFingerprint: owner.processFingerprint || null, ownerState};
  } catch (error) {
    return {path: name, ownerState: 'unknown', code: error.code || unknownCode};
  }
}

function inspectLifecycleRecoveryState(target, {includeGuard = true} = {}) {
  const owners = [];
  if (includeGuard) {
    const guard = inspectOwnerFile(target, '.foundation-operation.guard', 'OPERATION_GUARD_UNKNOWN');
    if (guard) owners.push(guard);
  }
  const lock = inspectOwnerFile(target, '.foundation-operation.lock', 'OPERATION_LOCK_UNKNOWN');
  if (lock) owners.push(lock);
  const manual = owners.filter((owner) => ['unknown', 'unavailable'].includes(owner.ownerState)).map((owner) => ({code: owner.code || 'PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', path: owner.path, operationId: owner.operationId || null, pid: owner.pid || null}));
  const live = owners.find((owner) => owner.ownerState === 'live');
  const pending = owners.filter((owner) => ['dead', 'stale-instance'].includes(owner.ownerState)).map((owner) => ({code: 'OWNER_RECOVERY_REQUIRED', ...owner}));
  const journals = [];
  const directory = statePaths(target).journals;
  if (fs.existsSync(directory)) {
    for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.json')).sort()) {
      const file = path.join(directory, name);
      try {
        const journal = signedPayload(readJson(file), 'JOURNAL_INTEGRITY_INVALID', `journal ${name}`);
        if (journal.operationId !== name.slice(0, -5)) manual.push({code: 'JOURNAL_OPERATION_MISMATCH', path: `state/journals/${name}`});
        else if (!['planned', 'staged', 'switching', 'rolling-back', 'committed', 'uninstalling', 'completed'].includes(journal.status)) manual.push({code: 'JOURNAL_UNKNOWN_STATE', path: `state/journals/${name}`, status: journal.status});
        else if (journal.status !== 'completed') journals.push({operationId: journal.operationId, operation: journal.operation, status: journal.status, path: `state/journals/${name}`, hash: sha256(fs.readFileSync(file)), authorization: journal.authorization || null});
      } catch (error) { manual.push({code: error.code || 'JOURNAL_MALFORMED', path: `state/journals/${name}`}); }
    }
  }
  if (manual.length) return {status: 'manual-action-required', recovered: [], manual, pending, journals, mutationPerformed: false};
  if (live) return {status: 'live-operation', operationId: live.operationId, pid: live.pid, processFingerprint: live.processFingerprint, recovered: [], manual: [], pending, journals, mutationPerformed: false};
  if (pending.length || journals.length) return {status: 'recovery-required', recovered: [], manual: [], pending, journals, mutationPerformed: false};
  return {status: 'clean', recovered: [], manual: [], pending: [], journals: [], mutationPerformed: false};
}

export function inspectLifecycleRecovery(root) {
  const target = path.resolve(root);
  const authority = deriveTrustedLifecycleAuthority();
  snapshotTrustedTarget(target, authority);
  const local = fs.existsSync(target) ? inspectLifecycleRecoveryState(target) : {status: 'clean', recovered: [], manual: [], pending: [], journals: [], mutationPerformed: false};
  const trusted = inspectTrustedPreIntents({target});
  if (trusted.status === 'clean') return local;
  const status = trusted.status === 'manual-action-required' || local.status === 'manual-action-required' ? 'manual-action-required'
    : trusted.status === 'live-operation' || local.status === 'live-operation' ? 'live-operation' : 'recovery-required';
  return {...local, status, trustedIntents: trusted.pending, trustedManual: trusted.manual, trustedLive: trusted.live};
}

export function recoverLifecycleState(root) {
  const state = inspectLifecycleRecovery(root);
  if (state.status === 'clean' || state.status === 'live-operation' || state.status === 'manual-action-required') return state;
  return {...state, code: 'EXPLICIT_RECOVERY_PLAN_REQUIRED', message: '恢复会修改 Foundation state；请生成 exact recover plan 并在 Foundation 本地管理器中确认'};
}

export function inspectInstallation(root) {
  const target = path.resolve(root);
  const authority = deriveTrustedLifecycleAuthority();
  snapshotTrustedTarget(target, authority);
  const recovery = inspectLifecycleRecovery(target);
  if (!fs.existsSync(target)) return {schemaVersion: '1.0.0', root: target, installed: false, current: null, versions: [], history: [], recovery};
  let current = null;
  let installations = emptyInstallations();
  try {
    current = readCurrent(target);
    installations = readInstallations(target);
    return {schemaVersion: '1.0.0', root: target, installed: Boolean(current), current, versions: Object.keys(installations.versions || {}).sort(), history: installations.history || [], recovery};
  } catch (error) {
    return {schemaVersion: '1.0.0', root: target, installed: null, current: null, versions: [], history: [], recovery: {status: 'manual-action-required', recovered: [], manual: [...(recovery.manual || []), {code: error.code || 'INSTALLATION_STATE_INVALID'}], pending: recovery.pending || [], journals: recovery.journals || [], mutationPerformed: false}};
  }
}

export function inspectCurrentInstallationAuthority(root) {
  const target = path.resolve(root);
  const installation = inspectInstallation(target);
  if (!installation.installed || !installation.current) throw new LifecycleError('FOUNDATION_NOT_HEALTHY', 'Foundation 没有可验证的 installed current', {stage: 'bridge-health'});
  if (installation.recovery?.status !== 'clean') throw new LifecycleError('FOUNDATION_NOT_HEALTHY', `Foundation lifecycle recovery 状态为 ${installation.recovery?.status || 'unknown'}`, {stage: 'bridge-health', details: {recovery: installation.recovery}});
  const current = readCurrent(target);
  const index = readInstallations(target);
  const installedRecord = index.versions?.[current.version] || null;
  if (!installedRecord || !identityEqual(installedRecord.identity, current.identity) || installedRecord.candidateHash !== current.candidateHash || installedRecord.appPath !== current.appPath || installedRecord.runtimeRoot !== current.runtimeRoot || installedRecord.runtimePath !== current.runtimePath || installedRecord.entrypoint !== current.entrypoint) throw new LifecycleError('FOUNDATION_CURRENT_RECEIPT_INVALID', 'current pointer 与 installation index identity/path 不一致', {stage: 'bridge-health'});
  let receipt;
  try { receipt = receiptForIdentity(target, current.identity); }
  catch (error) { throw new LifecycleError('FOUNDATION_CURRENT_RECEIPT_INVALID', `current receipt 无法验证：${error.message}`, {stage: 'bridge-health'}); }
  // App bytes have not been checked in this first phase. Never execute its
  // health entrypoint until verifyCurrentInstallationAppAuthority completes.
  try { verifyRecordFromReceipt(target, current, receipt, 'FOUNDATION_CURRENT_RECEIPT_INVALID', ['runtime', 'shim'], {probe: false}); }
  catch (error) { if (error.code === 'FOUNDATION_CURRENT_RECEIPT_INVALID') throw error; throw new LifecycleError('FOUNDATION_CURRENT_RECEIPT_INVALID', error.message, {stage: 'bridge-health'}); }
  return Object.freeze({installation, current, installedRecord, receipt: receipt.payload, receiptFile: receipt.file, receiptHash: sha256(fs.readFileSync(receipt.file)), runtimeVerified: true, mutationPerformed: false});
}

export function verifyCurrentInstallationAppAuthority(context) {
  if (!context?.installation?.root || !context.current || !context.receipt) throw new LifecycleError('FOUNDATION_CURRENT_RECEIPT_INVALID', 'current app verification context 无效', {stage: 'bridge-health'});
  verifyRecordFromReceipt(context.installation.root, context.current, {payload: context.receipt}, 'FOUNDATION_CURRENT_RECEIPT_INVALID', ['app']);
  return Object.freeze({verified: true, appPath: context.current.appPath, receiptHash: context.receiptHash, mutationPerformed: false});
}

export function applyLifecyclePlan({plan, now = Date.now()}) {
  const validation = validateLifecyclePlan(plan, {now});
  if (!validation.ok) throw new LifecycleError(validation.error.code, validation.error.message, {stage: validation.error.stage, retryable: validation.error.retryable, recovery: validation.error.recovery});
  const runtimeIdentity = currentRuntimeIdentity();
  if (plan.platform !== runtimeIdentity.platform || plan.arch !== runtimeIdentity.arch) throw new LifecycleError('MACHINE_IDENTITY_CHANGED', `计划绑定 ${plan.platform}/${plan.arch}，当前为 ${runtimeIdentity.platform}/${runtimeIdentity.arch}`, {stage: 'preflight'});
  const lookupAuthority = deriveTrustedLifecycleAuthority();
  const lookupRelative = plan.authority?.targetRelative;
  if (typeof lookupRelative !== 'string' || !lookupRelative || lookupRelative.split('/').includes('..') || lookupRelative.includes('\\')) throw new LifecycleError('TARGET_RELATIVE_INVALID', '计划中的可信目标相对路径无效', {stage: 'authority'});
  const lookupRoot = path.join(lookupAuthority.trustedRootRealPath, ...lookupRelative.split('/'));
  if (path.resolve(plan.targetRoot) !== lookupRoot || !isWithin(lookupAuthority.trustedRootRealPath, lookupRoot)) throw new LifecycleError('TARGET_AUTHORITY_MISMATCH', 'plan targetRoot 与可信 authority 派生目标不一致', {stage: 'authority'});
  if (fs.existsSync(lookupRoot)) snapshotTrustedTarget(lookupRoot, lookupAuthority);
  const {authority, target: root} = resolveTrustedTargetForApply(plan);
  const verifyReinstall = () => {
    if (!plan.bootstrap?.reinstall) return;
    const file = path.join(root, 'uninstall-result.json');
    if (plan.operation !== 'install' || plan.bootstrap.reinstall.installId !== plan.installId || !fs.existsSync(file) || fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile() || sha256(fs.readFileSync(file)) !== plan.bootstrap.reinstall.receiptHash) throw new LifecycleError('REINSTALL_RECEIPT_DRIFT', '重装回执在预览后发生变化；请重新检查并确认', {stage: 'preflight'});
  };
  verifyReinstall();
  if (plan.operation === 'uninstall' && fs.existsSync(path.join(root, 'state', 'codex-skill-registration.json'))) throw new LifecycleError('CODEX_SKILL_DISCONNECT_REQUIRED', '请先通过独立 capability-uninstall 计划停用 Codex Skill；保留宿主文件与安装，不自动跨目录删除', {stage: 'preflight'});
  const trustedSigning = loadTrustedAuthorityKey();
  const disk = probeDiskAvailableBytes(root);
  const effectiveAvailable = effectiveDiskAvailability(disk.availableBytes);
  if (!Number.isFinite(effectiveAvailable) || effectiveAvailable < plan.impact.diskBytes) throw new LifecycleError('DISK_SPACE_INSUFFICIENT', '可用磁盘空间不足，尚未写入安装根', {stage: 'preflight', retryable: true});
  if (acquisitionNetworkDisconnected() && plan.candidate) throw new LifecycleError('NETWORK_UNAVAILABLE', '当前受保护 runtime 报告 acquisition network unavailable', {stage: 'acquisition', retryable: true, details: {remoteAcquisition: 'pending'}});
  const preRecoveryState = plan.operation === 'recover' ? inspectLifecycleRecovery(root) : null;
  if (plan.operation === 'recover' && sha256(JSON.stringify(preRecoveryState)) !== sha256(JSON.stringify(plan.recoverySnapshot))) throw new LifecycleError('RECOVERY_STATE_CHANGED', 'recover plan 后 journal/owner scope 已变化，必须重新生成计划和授权', {stage: 'recovery'});
  const effect = authorizationEffectForLifecyclePlan(plan);
  const reservation = reserveExactManagerConfirmationAtBoundary(effect);
  let authorizationConsumed = false;
  let preIntent = null;
  let trustedGuard = null;
  let guard = null;
  let lock = null;
  let journal = null;
  let journalFile = null;
  let current = null;
  let installations = null;
  try {
    const authorization = publicManagerConfirmationEvidence(reservation);
    preIntent = writeTrustedPreIntent({
      intentId: plan.planId,
      operationClass: effect.operationClass,
      operation: plan.operation,
      effect,
      authorization,
      planHash: plan.integrity.hash,
      target: root,
      beforeState: effect.expectedBeforeState,
      now,
    });
    operationCheckpoint('after-durable-pre-intent');
    operationCheckpoint('before-exclusive-acquire');
    trustedGuard = acquireTrustedTargetGuard(preIntent, {recoverIntentIds: plan.operation === 'recover' ? (preRecoveryState?.trustedIntents || []).map((entry) => entry.intentId) : []});
    operationCheckpoint('after-exclusive-acquire');
    resolveTrustedTargetForApply(plan);
    verifyReinstall();

    const startupState = fs.existsSync(root) ? inspectLifecycleRecoveryState(root) : {status: 'clean', recovered: [], manual: [], pending: [], journals: [], mutationPerformed: false};
    if (plan.operation !== 'recover') {
      if (startupState.status === 'live-operation') throw new LifecycleError('OPERATION_LOCKED', `已有 live 操作 ${startupState.operationId}`, {stage: 'lock', retryable: true, details: startupState});
      if (startupState.status === 'manual-action-required') throw new LifecycleError('OPERATION_RECOVERY_MANUAL', '存在无法安全验证的 lock/journal/state；拒绝新 mutation', {stage: 'recovery', details: startupState});
      if (startupState.status === 'recovery-required') throw new LifecycleError('RECOVERY_REQUIRED', '存在需要显式 recover plan + manager confirmation 的 stale owner 或未完成 journal', {stage: 'recovery', details: startupState});
      current = assertMachineState(plan, root);
      installations = readInstallations(root);
    }
    consumeExactManagerConfirmationAtBoundary(reservation, {effectHash: effect.effectHash, intentId: plan.planId, intentPathHash: preIntent.fileHash});
    authorizationConsumed = true;
    updateTrustedPreIntent(preIntent, 'consumed', {consumedAt: Date.now()}, {signing: trustedSigning});
    operationCheckpoint('after-authorization-consume');

    if (plan.operation === 'recover' && !fs.existsSync(root)) {
      for (const entry of preRecoveryState?.trustedIntents || []) if (entry.status === 'planned') try { failExactManagerConfirmationAtBoundary(entry.authorization, {code: 'AUTHORIZED_RECOVERY_CANCELLED_PRECONSUME_RESERVATION', intentWritten: false, intentId: entry.intentId}); } catch {}
      const recoveredTrustedIntents = completeTrustedPreIntentRecovery(preRecoveryState?.trustedIntents || []);
      updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'completed-with-target-absent'}, {signing: trustedSigning});
      return {status: 'recovered', recovered: [], manual: [], pending: [], journals: [], recoveredTrustedIntents, targetPreservedAbsent: true, mutationPerformed: true, authorization: {authorizationId: authorization.authorizationId, effectHash: effect.effectHash}};
    }

    ensureControlledRoot(root, authority);
    const paths = statePaths(root);
    const resultFile = path.join(paths.operations, `${plan.planId}.json`);
    guard = acquireGuard(root, plan.planId, {reclaim: plan.operation === 'recover'});

    if (plan.operation === 'recover') {
      const observed = inspectLifecycleRecoveryState(root, {includeGuard: false});
      if (observed.status === 'live-operation') throw new LifecycleError('OPERATION_LOCKED', `已有 live 操作 ${observed.operationId}`, {stage: 'lock', retryable: true, details: observed});
      if (observed.status === 'manual-action-required') throw new LifecycleError('OPERATION_RECOVERY_MANUAL', '恢复 evidence 无法安全验证', {stage: 'recovery', details: observed});
      const intentId = `recovery-intent-${plan.planId}`;
      const recoveryIntent = {schemaVersion: '1.0.0', intentId, operationId: plan.planId, operation: 'recover', effectHash: effect.effectHash, authorization, recoverySnapshot: preRecoveryState, postClaimScope: observed, status: 'planned', createdAt: Date.now()};
      const recoveryIntentFile = path.join(paths.recoveryIntents, `${plan.planId}.json`);
      writeSignedJson(recoveryIntentFile, recoveryIntent);
      const recovered = recoverLifecycleStateUnderGuard(root, guard.reclaimed ? [guard.reclaimed] : []);
      if (recovered.status === 'manual-action-required' || recovered.status === 'live-operation') throw new LifecycleError('OPERATION_RECOVERY_MANUAL', '授权 recovery 未能完成 exact bounded scope', {stage: 'recovery', details: recovered});
      for (const entry of preRecoveryState?.trustedIntents || []) if (entry.status === 'planned') try { failExactManagerConfirmationAtBoundary(entry.authorization, {code: 'AUTHORIZED_RECOVERY_CANCELLED_PRECONSUME_RESERVATION', intentWritten: false, intentId: entry.intentId}); } catch {}
      const recoveredTrustedIntents = completeTrustedPreIntentRecovery(preRecoveryState?.trustedIntents || []);
      writeSignedJson(recoveryIntentFile, {...recoveryIntent, status: 'completed', completedAt: Date.now(), result: recovered});
      updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'completed'}, {signing: trustedSigning});
      return {...recovered, status: recovered.status === 'clean' && recoveredTrustedIntents.length ? 'recovered' : recovered.status, recoveredTrustedIntents, mutationPerformed: true, authorization: {authorizationId: authorization.authorizationId, effectHash: effect.effectHash}};
    }
    lock = acquireLock(root, plan.planId);
    journal = journalPayload(plan, root, lock.owner, current, installations, authorization);
    journalFile = path.join(paths.journals, `${plan.planId}.json`);
    writeJournal(journalFile, journal, 'planned');
    releaseGuard(guard);
    guard = null;

    let result;
    if (['install', 'update'].includes(plan.operation)) result = installOrUpdate({plan, root, current, installations, journal, journalFile});
    else if (plan.operation === 'rollback') result = rollbackOperation({plan, root, journal, journalFile});
    else if (plan.operation === 'repair') result = repairOperation({plan, root, current, journal, journalFile});
    else if (plan.operation === 'uninstall') result = uninstallOperation({plan, root, current, journal, journalFile, signing: trustedSigning});
    else throw new LifecycleError('OPERATION_UNSUPPORTED', `未实现操作：${plan.operation}`);
    if (plan.operation !== 'uninstall' || plan.mode !== 'full') { writeSignedJson(resultFile, result, {signing: trustedSigning}); writeJournal(journalFile, journal, 'completed', 'operation-complete', trustedSigning); }
    updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'completed'}, {signing: trustedSigning});
    if(plan.operation==='update'&&plan.hostCleanup){
      try{result.cleanup=finishConfirmedUpdateInputs(plan);writeSignedJson(resultFile,result,{signing:trustedSigning});}
      catch{result.cleanup={state:'retained',reason:'cleanup-or-secondary-record-unavailable'};}
    }
    return result;
  } catch (error) {
    if (!authorizationConsumed) {
      try { failExactManagerConfirmationAtBoundary(reservation, {code: error.code || 'MUTATION_FAILED', intentWritten: false, intentId: preIntent?.payload?.intentId || null}); } catch {}
      if (preIntent) try { updateTrustedPreIntent(preIntent, 'cancelled', {cancelledAt: Date.now(), errorCode: error.code || 'MUTATION_FAILED'}, {signing: trustedSigning}); } catch {}
    } else if (preIntent) {
      try { updateTrustedPreIntent(preIntent, 'manual-action-required', {failedAt: Date.now(), errorCode: error.code || 'MUTATION_FAILED'}, {signing: trustedSigning}); } catch {}
    }
    if (!journal || error.code === 'FINALIZER_INTERRUPTED') throw error;
    try {
      rollbackJournal(root, journal, journalFile);
      // The operation failed, but rollbackJournal durably completed recovery.
      // Close the pre-intent before releasing its guard; leaving it nonterminal
      // makes the next read misclassify a safely rolled-back operation as a lost
      // consumed guard. Preserve failure identity and the original thrown error.
      if (preIntent) updateTrustedPreIntent(preIntent, 'completed', {failedAt: Date.now(), completedAt: Date.now(), outcome: 'failed-rolled-back', errorCode: error.code || 'MUTATION_FAILED'}, {signing: trustedSigning});
    }
    catch (recoveryError) { journal.status = 'unknown'; journal.outcome = 'manual-action-required'; journal.recoveryError = {code: recoveryError.code || 'RECOVERY_FAILED', message: recoveryError.message}; writeSignedJson(journalFile, journal); }
    throw error;
  } finally {
    releaseGuard(guard);
    releaseLock(lock);
    releaseTrustedTargetGuard(trustedGuard, {signing: trustedSigning});
  }
}
