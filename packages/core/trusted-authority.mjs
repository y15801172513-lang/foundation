import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {LifecycleError} from './install-contract.mjs';
import {isWithin} from './path-boundary.mjs';
import {resolveFoundationPlatformPaths} from './platform-paths.mjs';

const WINDOWS_ABSOLUTE = /^(?:[a-z]:[\\/]|\\\\)/iu;
let activeFirstInstallCandidateRoot = null;
let activeFirstInstallDestination = null;

function discoverExecutionAuthority() {
  let cursor = fs.realpathSync(import.meta.dirname);
  for (;;) {
    const candidateManifest = path.join(cursor, 'manifest.json');
    const candidatePayload = path.join(cursor, 'payload');
    if (fs.existsSync(candidateManifest) && fs.existsSync(candidatePayload) && fs.statSync(candidatePayload).isDirectory() && isWithin(candidatePayload, fs.realpathSync(import.meta.dirname))) {
      return {kind: 'candidate', root: cursor};
    }
    const current = path.join(cursor, 'state', 'current.json');
    const versions = path.join(cursor, 'versions');
    if (fs.existsSync(current) && fs.existsSync(versions) && fs.statSync(versions).isDirectory()) return {kind: 'installed', root: cursor};
    const manifest = path.join(cursor, 'foundation-kit.json');
    const git = path.join(cursor, '.git');
    if (fs.existsSync(manifest) && fs.existsSync(git) && fs.statSync(git).isDirectory()) {
      try {
        const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (value?.product?.name === 'AI Product Foundation Kit' && value?.versionAuthority === 'foundation-kit.json#/product/version') return {kind: 'repository', root: cursor};
      } catch {}
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new LifecycleError('PLATFORM_AUTHORITY_UNAVAILABLE', '当前进程不属于受验证的 Foundation source、candidate 或 installed runtime authority', {stage: 'authority'});
}

function discoverEnclosingRepository(start) {
  let cursor = path.resolve(start);
  for (;;) {
    const manifest = path.join(cursor, 'foundation-kit.json');
    const git = path.join(cursor, '.git');
    if (fs.existsSync(manifest) && fs.existsSync(git) && fs.statSync(git).isDirectory()) {
      try {
        const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (value?.product?.name === 'AI Product Foundation Kit' && value?.versionAuthority === 'foundation-kit.json#/product/version') return cursor;
      } catch {}
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

export function activateFirstInstallBootstrapAuthority(candidateRoot, {destination = null} = {}) {
  const discovered = discoverExecutionAuthority();
  const exact = fs.realpathSync(candidateRoot);
  if (discovered.kind !== 'candidate' || fs.realpathSync(discovered.root) !== exact) {
    throw new LifecycleError('BOOTSTRAP_AUTHORITY_ACTIVATION_REJECTED', '只有当前 exact candidate 的自托管首装路径可以激活平台 authority', {stage: 'authority'});
  }
  activeFirstInstallCandidateRoot = exact;
  // A proposal selects the plan's target, not permission to apply. All effects
  // still require the existing exact manager confirmation and transaction gate.
  activeFirstInstallDestination = destination;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function identityFor(file) {
  const stat = fs.statSync(file);
  return {device: String(stat.dev), inode: String(stat.ino), mode: stat.mode & 0o170000};
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.device === right.device && left.inode === right.inode && left.mode === right.mode);
}

function assertDirectoryNotLink(directory, code, stage = 'authority') {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) throw new LifecycleError(code, `受控路径祖先不得是符号链接：${directory}`, {stage});
  if (!stat.isDirectory()) throw new LifecycleError('TARGET_ANCESTOR_NOT_DIRECTORY', `受控路径祖先不是目录：${directory}`, {stage});
}

export function deriveTrustedLifecycleAuthority() {
  let discovered = discoverExecutionAuthority();
  if (discovered.kind === 'candidate' && activeFirstInstallCandidateRoot !== fs.realpathSync(discovered.root)) {
    const repository = discoverEnclosingRepository(path.dirname(discovered.root));
    if (repository) discovered = {kind: 'repository', root: repository};
  }
  if (discovered.kind !== 'repository') {
    const defaults = resolveFoundationPlatformPaths();
    const destination = discovered.kind === 'installed'
      ? (discovered.root === defaults.installRoot ? null : discovered.root)
      : activeFirstInstallDestination;
    const platform = destination === null ? defaults : resolveFoundationPlatformPaths({destination});
    if (discovered.kind === 'installed' && fs.realpathSync(discovered.root) !== platform.installRoot) {
      throw new LifecycleError('INSTALLED_AUTHORITY_PATH_MISMATCH', 'installed runtime 不位于平台 authority 派生的安装根', {stage: 'authority'});
    }
    const trustedRootRealPath = fs.realpathSync(platform.trustedRootRealPath);
    const candidateRootRealPath = discovered.kind === 'candidate' ? fs.realpathSync(discovered.root) : null;
    const installedStateRoot = path.join(platform.installRoot, 'state');
    const reuseInstalledAuthority = discovered.kind === 'candidate' && fs.existsSync(path.join(installedStateRoot, '.foundation-lifecycle-authority'));
    if (reuseInstalledAuthority && fs.existsSync(path.join(platform.bootstrapStateRoot, '.foundation-lifecycle-authority'))) throw new LifecycleError('BOOTSTRAP_AUTHORITY_CONFLICT', '安装根与 bootstrap 同时存在独立 authority；需要单独诊断，不选择或覆盖其中之一', {stage: 'authority'});
    return Object.freeze({
      mode: discovered.kind === 'candidate' ? 'platform-first-install-candidate' : 'platform-installed-runtime',
      repositoryRealPath: trustedRootRealPath,
      trustedRootRealPath,
      repositoryIdentity: identityFor(trustedRootRealPath),
      trustedRootIdentity: identityFor(trustedRootRealPath),
      authorityStateRoot: discovered.kind === 'candidate' && !reuseInstalledAuthority ? platform.bootstrapStateRoot : installedStateRoot,
      authorityStateBoundaryRoot: discovered.kind === 'candidate' && !reuseInstalledAuthority ? path.dirname(path.dirname(platform.bootstrapStateRoot)) : trustedRootRealPath,
      reuseInstalledAuthority,
      installRoot: platform.installRoot,
      bootstrapStateRoot: platform.bootstrapStateRoot,
      candidateRootRealPath,
      platformPathAuthority: platform.authority,
      homeRealPath: platform.homeRealPath,
    });
  }
  const repositoryPath = discovered.root;
  const repositoryRealPath = fs.realpathSync(repositoryPath);
  if (repositoryRealPath !== repositoryPath) throw new LifecycleError('REPOSITORY_REALPATH_MISMATCH', 'Foundation 仓库路径不是稳定真实路径', {stage: 'authority'});
  assertDirectoryNotLink(repositoryRealPath, 'REPOSITORY_SYMLINK_REJECTED');
  const trustedRoot = path.join(repositoryRealPath, '.tmp');
  if (!fs.existsSync(trustedRoot)) throw new LifecycleError('TRUSTED_ROOT_MISSING', 'Foundation 仓库 .tmp 可信根不存在', {stage: 'authority'});
  assertDirectoryNotLink(trustedRoot, 'TRUSTED_ROOT_SYMLINK_REJECTED');
  const trustedRootRealPath = fs.realpathSync(trustedRoot);
  if (trustedRootRealPath !== trustedRoot) throw new LifecycleError('TRUSTED_ROOT_REALPATH_MISMATCH', 'Foundation 仓库 .tmp 可信根 real path 不一致', {stage: 'authority'});
  return Object.freeze({
    mode: 'repository-candidate',
    repositoryRealPath,
    trustedRootRealPath,
    repositoryIdentity: identityFor(repositoryRealPath),
    trustedRootIdentity: identityFor(trustedRootRealPath),
    authorityStateRoot: trustedRootRealPath,
    authorityStateBoundaryRoot: trustedRootRealPath,
    installRoot: null,
    bootstrapStateRoot: null,
    candidateRootRealPath: null,
  });
}

export function transferBootstrapAuthorityToInstalledState() {
  const authority = deriveTrustedLifecycleAuthority();
  if (authority.mode !== 'platform-first-install-candidate') throw new LifecycleError('BOOTSTRAP_AUTHORITY_TRANSFER_INVALID', '只有当前 exact candidate bootstrap 可以转移 authority state', {stage: 'authority'});
  if (authority.reuseInstalledAuthority) return {transferred: false, reusedInstalledAuthority: true};
  const source = path.join(authority.authorityStateRoot, '.foundation-lifecycle-authority');
  const destinationRoot = path.join(authority.installRoot, 'state');
  const destination = path.join(destinationRoot, '.foundation-lifecycle-authority');
  if (!fs.existsSync(source) || fs.lstatSync(source).isSymbolicLink() || !fs.statSync(source).isDirectory()) throw new LifecycleError('BOOTSTRAP_AUTHORITY_TRANSFER_INVALID', 'bootstrap authority state 缺失或无效', {stage: 'authority'});
  if (!fs.existsSync(destinationRoot) || fs.lstatSync(destinationRoot).isSymbolicLink() || fs.realpathSync(destinationRoot) !== destinationRoot || fs.existsSync(destination)) throw new LifecycleError('BOOTSTRAP_AUTHORITY_TRANSFER_INVALID', 'installed authority 目标缺失、被替换或已存在', {stage: 'authority'});
  fs.renameSync(source, destination);
  fsyncDirectory(destinationRoot);
  return {source, destination, transferred: true};
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function loadTrustedAuthorityKey({create = false} = {}) {
  const authority = deriveTrustedLifecycleAuthority();
  const stateRoot = authority.authorityStateRoot || authority.trustedRootRealPath;
  const stateBoundary = authority.authorityStateBoundaryRoot || authority.trustedRootRealPath;
  const directory = path.join(stateRoot, '.foundation-lifecycle-authority');
  const file = path.join(directory, 'receipt-finalizer-hmac.key');
  if (fs.existsSync(directory)) assertDirectoryNotLink(directory, 'AUTHORITY_KEY_DIRECTORY_SYMLINK_REJECTED');
  if (!fs.existsSync(file) && create) {
    if (!fs.existsSync(directory)) {
      const relative = path.relative(stateBoundary, directory);
      if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new LifecycleError('AUTHORITY_KEY_PATH_INVALID', '可信验证密钥路径逃出平台 authority', {stage: 'authority'});
      let cursor = stateBoundary;
      for (const part of relative.split(path.sep)) {
        cursor = path.join(cursor, part);
        if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, {mode: 0o700});
        assertDirectoryNotLink(cursor, 'AUTHORITY_KEY_DIRECTORY_SYMLINK_REJECTED');
      }
      fsyncDirectory(stateRoot);
    }
    assertDirectoryNotLink(directory, 'AUTHORITY_KEY_DIRECTORY_SYMLINK_REJECTED');
    const descriptor = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, crypto.randomBytes(32));
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fsyncDirectory(directory);
  }
  if (!fs.existsSync(file)) throw new LifecycleError('AUTHORITY_KEY_MISSING', '可信 receipt/finalizer 验证密钥不存在', {stage: 'authority'});
  if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new LifecycleError('AUTHORITY_KEY_INVALID', '可信验证密钥不是普通文件', {stage: 'authority'});
  const key = fs.readFileSync(file);
  if (key.length !== 32) throw new LifecycleError('AUTHORITY_KEY_INVALID', '可信验证密钥长度无效', {stage: 'authority'});
  return {key, keyId: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16), file};
}

export function signTrustedPayload(payload, {createKey = false} = {}) {
  const {key, keyId} = loadTrustedAuthorityKey({create: createKey});
  const serialized = canonical(payload);
  const hash = crypto.createHmac('sha256', key).update(serialized).digest('hex');
  return {algorithm: 'hmac-sha256', keyId, hash};
}

export function verifyTrustedPayload(payload, integrity) {
  if (!integrity || integrity.algorithm !== 'hmac-sha256' || !/^[0-9a-f]{64}$/u.test(integrity.hash || '')) return false;
  const expected = signTrustedPayload(payload);
  return integrity.keyId === expected.keyId && crypto.timingSafeEqual(Buffer.from(integrity.hash, 'hex'), Buffer.from(expected.hash, 'hex'));
}

function assertHostAbsolute(targetRoot) {
  if (typeof targetRoot !== 'string' || !targetRoot || WINDOWS_ABSOLUTE.test(targetRoot) || !path.isAbsolute(targetRoot)) {
    const code = WINDOWS_ABSOLUTE.test(String(targetRoot || '')) ? 'TARGET_PLATFORM_PATH_REJECTED' : 'TARGET_NOT_ABSOLUTE';
    throw new LifecycleError(code, '安装根必须是当前平台的绝对路径', {stage: 'authority'});
  }
}

function inspectAncestors(target, authority) {
  const relative = path.relative(authority.trustedRootRealPath, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !isWithin(authority.trustedRootRealPath, target)) {
    throw new LifecycleError('TARGET_OUTSIDE_TRUSTED_ROOT', 'candidate 生命周期只允许写入 Foundation 仓库真实 .tmp 的子目录', {stage: 'authority'});
  }
  let cursor = authority.trustedRootRealPath;
  let nearest = cursor;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) break;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new LifecycleError('TARGET_SYMLINK_ANCESTOR_REJECTED', `目标路径祖先不得是符号链接：${cursor}`, {stage: 'authority'});
    if (cursor !== target && !stat.isDirectory()) throw new LifecycleError('TARGET_ANCESTOR_NOT_DIRECTORY', `目标路径祖先不是目录：${cursor}`, {stage: 'authority'});
    nearest = cursor;
  }
  const nearestRealPath = fs.realpathSync(nearest);
  if (!isWithin(authority.trustedRootRealPath, nearestRealPath) && nearestRealPath !== authority.trustedRootRealPath) {
    throw new LifecycleError('TARGET_REALPATH_ESCAPE', '目标路径祖先 real path 逃出可信根', {stage: 'authority'});
  }
  return {relative: relative.replaceAll(path.sep, '/'), nearest, nearestRealPath};
}

export function snapshotTrustedTarget(targetRoot, authority = deriveTrustedLifecycleAuthority()) {
  assertHostAbsolute(targetRoot);
  const target = path.resolve(targetRoot);
  const inspected = inspectAncestors(target, authority);
  const exists = fs.existsSync(target);
  if (exists) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new LifecycleError('TARGET_SYMLINK_REJECTED', '生命周期目标不得是符号链接', {stage: 'authority'});
    if (!stat.isDirectory()) throw new LifecycleError('TARGET_NOT_DIRECTORY', '生命周期目标必须是目录', {stage: 'authority'});
    if (fs.realpathSync(target) !== target) throw new LifecycleError('TARGET_REALPATH_MISMATCH', '生命周期目标 real path 不一致', {stage: 'authority'});
  }
  return {
    target,
    targetRelative: inspected.relative,
    snapshot: {
      exists,
      identity: exists ? identityFor(target) : null,
      nearestExistingRelative: path.relative(authority.trustedRootRealPath, inspected.nearest).replaceAll(path.sep, '/') || '.',
      nearestExistingRealPath: inspected.nearestRealPath,
      nearestExistingIdentity: identityFor(inspected.nearest),
    },
  };
}

export function resolveTrustedTargetForApply(plan) {
  const authority = deriveTrustedLifecycleAuthority();
  const plannedAuthority = plan?.authority;
  if (!plannedAuthority || plannedAuthority.mode !== authority.mode
    || plannedAuthority.repositoryRealPath !== authority.repositoryRealPath
    || plannedAuthority.trustedRootRealPath !== authority.trustedRootRealPath
    || plannedAuthority.authorityStateRoot !== authority.authorityStateRoot
    || plannedAuthority.authorityStateBoundaryRoot !== authority.authorityStateBoundaryRoot
    || plannedAuthority.installRoot !== authority.installRoot
    || plannedAuthority.candidateRootRealPath !== authority.candidateRootRealPath
    || !sameIdentity(plannedAuthority.repositoryIdentity, authority.repositoryIdentity)
    || !sameIdentity(plannedAuthority.trustedRootIdentity, authority.trustedRootIdentity)) {
    throw new LifecycleError('TRUSTED_AUTHORITY_CHANGED', '计划生成后 Foundation 仓库或 .tmp 可信根发生变化', {stage: 'authority'});
  }
  const relative = String(plannedAuthority.targetRelative || '');
  if (!relative || relative === '.' || relative.split('/').includes('..') || relative.includes('\\') || path.isAbsolute(relative)) {
    throw new LifecycleError('TARGET_RELATIVE_INVALID', '计划中的可信目标相对路径无效', {stage: 'authority'});
  }
  const effectiveTarget = path.join(authority.trustedRootRealPath, ...relative.split('/'));
  if (path.resolve(plan.targetRoot) !== effectiveTarget) throw new LifecycleError('TARGET_AUTHORITY_MISMATCH', 'plan targetRoot 与可信 authority 派生目标不一致', {stage: 'authority'});
  const inspected = inspectAncestors(effectiveTarget, authority);
  const snapshot = plannedAuthority.targetSnapshot;
  if (!snapshot) throw new LifecycleError('TARGET_SNAPSHOT_MISSING', '计划缺少目标替换防护快照', {stage: 'authority'});
  const plannedNearest = snapshot.nearestExistingRelative === '.'
    ? authority.trustedRootRealPath
    : path.join(authority.trustedRootRealPath, ...snapshot.nearestExistingRelative.split('/'));
  if (!fs.existsSync(plannedNearest) || fs.realpathSync(plannedNearest) !== snapshot.nearestExistingRealPath || !sameIdentity(identityFor(plannedNearest), snapshot.nearestExistingIdentity)) {
    throw new LifecycleError('TARGET_ANCESTOR_REPLACED', '计划生成后目标受控祖先被替换', {stage: 'authority'});
  }
  const exists = fs.existsSync(effectiveTarget);
  if (snapshot.exists !== exists) throw new LifecycleError('TARGET_REPLACED_AFTER_PLAN', '计划生成后目标的存在状态发生变化', {stage: 'authority'});
  if (exists) {
    const stat = fs.lstatSync(effectiveTarget);
    if (stat.isSymbolicLink()) throw new LifecycleError('TARGET_SYMLINK_REJECTED', '计划生成后目标被替换为符号链接', {stage: 'authority'});
    if (!sameIdentity(identityFor(effectiveTarget), snapshot.identity) || fs.realpathSync(effectiveTarget) !== effectiveTarget) {
      throw new LifecycleError('TARGET_REPLACED_AFTER_PLAN', '计划生成后目标目录被替换', {stage: 'authority'});
    }
  }
  if (inspected.relative !== relative) throw new LifecycleError('TARGET_AUTHORITY_MISMATCH', '目标相对路径与可信 authority 不一致', {stage: 'authority'});
  return {authority, target: effectiveTarget};
}

export function assertTrustedCandidatePath(candidatePath, authority = deriveTrustedLifecycleAuthority()) {
  assertHostAbsolute(candidatePath);
  const candidate = path.resolve(candidatePath);
  if (authority.mode === 'platform-first-install-candidate') {
    if (candidate !== authority.candidateRootRealPath || !fs.existsSync(candidate) || fs.lstatSync(candidate).isSymbolicLink() || fs.realpathSync(candidate) !== candidate) {
      throw new LifecycleError('CANDIDATE_AUTHORITY_MISMATCH', '首次安装仅接受当前自托管 launcher 所属的 exact candidate', {stage: 'authority'});
    }
    return candidate;
  }
  inspectAncestors(candidate, authority);
  return candidate;
}
