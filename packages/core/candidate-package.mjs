import fs from 'node:fs';
import {FOUNDATION_RELEASE_POLICY, verifyDistributionSignature} from './release-catalog.mjs';
import path from 'node:path';
import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';
import {posixNodeStartupEnvironmentBoundary} from './node-startup-environment.mjs';
import {readOfficialNodeRuntimeArchive, OFFICIAL_NODE_RUNTIME_LOCK} from './official-node-runtime.mjs';

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function assertExactKeys(value, allowed, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LifecycleError(code, `${label} 必须是对象`, {stage: 'candidate-verify'});
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new LifecycleError(code, `${label} 含未声明字段：${unknown.join(', ')}`, {stage: 'candidate-verify'});
}

export function validPackagePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\') || value.includes('\0')) return false;
  const parts = value.split('/');
  return !parts.includes('..') && !parts.includes('.') && parts.every((part) => part && !WINDOWS_RESERVED.test(part) && !/[<>:"|?*]/u.test(part));
}

function walkFiles(root) {
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new LifecycleError('CANDIDATE_SYMLINK_REJECTED', `候选包不得包含符号链接：${absolute}`, {stage: 'candidate-build'});
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(absolute);
      else throw new LifecycleError('CANDIDATE_FILE_TYPE_REJECTED', `候选包仅允许普通文件：${absolute}`, {stage: 'candidate-build'});
    }
  }
  visit(root);
  return result;
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  try { fs.copyFileSync(source, destination, fs.constants.COPYFILE_FICLONE); }
  catch { fs.copyFileSync(source, destination); }
  fs.chmodSync(destination, fs.statSync(source).mode & 0o777);
}

function copyTree(source, destination) {
  for (const file of walkFiles(source)) copyFile(file, path.join(destination, path.relative(source, file)));
}

export function hashDirectory(root) {
  if (!fs.existsSync(root)) return null;
  const records = walkFiles(root).map((file) => {
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    return {path: relative, size: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file))};
  });
  return sha256(canonicalStringify(records));
}

function launcherText(runtimePath, entrypoint) {
  return `#!/bin/sh
case "$0" in
  /*) FOUNDATION_LAUNCHER="$0" ;;
  *) FOUNDATION_LAUNCHER="$PWD/$0" ;;
esac
FOUNDATION_CANDIDATE_ROOT=${'${FOUNDATION_LAUNCHER%/*}'}
CDPATH= cd -P -- "$FOUNDATION_CANDIDATE_ROOT" || exit 126
FOUNDATION_CANDIDATE_ROOT="$PWD"
${posixNodeStartupEnvironmentBoundary()}exec "$FOUNDATION_CANDIDATE_ROOT/payload/${runtimePath}" "$FOUNDATION_CANDIDATE_ROOT/payload/${entrypoint}" "$@"
`;
}

export function buildCandidate({sourceRoot, outputRoot, productVersion, platform, arch, runtimeSource = null, runtimeArchive = null, entrypoint, sourceKind = 'local-build', sourceUrl = null, buildIdentity = 'uncommitted-local', runtimeProvenance = 'local-current-node-unverified'}) {
  const source = path.resolve(sourceRoot);
  const output = path.resolve(outputRoot);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new LifecycleError('CANDIDATE_SOURCE_INVALID', '候选包 sourceRoot 不存在或不是目录', {stage: 'candidate-build'});
  if (!/^\d+\.\d+\.\d+$/u.test(productVersion || '')) throw new LifecycleError('CANDIDATE_VERSION_INVALID', '候选包版本无效', {stage: 'candidate-build'});
  if (!validPackagePath(entrypoint) || !entrypoint.startsWith('app/')) throw new LifecycleError('CANDIDATE_ENTRYPOINT_INVALID', '候选入口必须是 payload/app 内相对路径', {stage: 'candidate-build'});
  if (fs.existsSync(output)) throw new LifecycleError('CANDIDATE_OUTPUT_EXISTS', '候选输出目录已存在，拒绝覆盖', {stage: 'candidate-build'});
  if (runtimeSource && runtimeArchive) throw new LifecycleError('RUNTIME_SOURCE_AMBIGUOUS', '本机 Runtime 与官方归档不可同时选择', {stage: 'candidate-build'});
  const official = runtimeArchive ? readOfficialNodeRuntimeArchive(path.resolve(runtimeArchive), {platform, arch}) : null;
  const payload = path.join(output, 'payload');
  fs.mkdirSync(payload, {recursive: true});
  copyTree(source, payload);
  let runtime = null;
  if (official) {
    const runtimeRelative = 'runtime/bin/node';
    fs.mkdirSync(path.join(payload, 'runtime', 'bin'), {recursive: true});
    fs.writeFileSync(path.join(payload, runtimeRelative), official.binary, {mode: 0o755});
    fs.writeFileSync(path.join(payload, 'runtime', 'LICENSE'), official.license);
    fs.writeFileSync(path.join(payload, 'runtime', 'provenance.json'), `${JSON.stringify(official.provenance, null, 2)}\n`);
    runtime = {strategy: 'bundled-node-runtime', desiredSource: 'official-node-distribution', sourceStatus: 'pinned-official-https-sha256', officialSourceVerified: true, path: runtimeRelative};
  }
  if (runtimeSource) {
    const runtimeFile = path.resolve(runtimeSource);
    if (!fs.existsSync(runtimeFile) || !fs.statSync(runtimeFile).isFile() || fs.lstatSync(runtimeFile).isSymbolicLink()) throw new LifecycleError('RUNTIME_SOURCE_INVALID', '私有 runtime 候选必须是普通文件', {stage: 'candidate-build'});
    const runtimeRelative = platform === 'win32' ? 'runtime/bin/node.exe' : 'runtime/bin/node';
    const runtimeTarget = path.join(payload, ...runtimeRelative.split('/'));
    copyFile(runtimeFile, runtimeTarget);
    fs.chmodSync(runtimeTarget, 0o755);
    runtime = {strategy: 'bundled-node-runtime', desiredSource: 'official-node-distribution', sourceStatus: runtimeProvenance, officialSourceVerified: false, path: runtimeRelative};
  }
  let launcher = null;
  if (runtime && platform === 'darwin') {
    const launcherFile = path.join(output, 'foundation-kit');
    fs.writeFileSync(launcherFile, launcherText(runtime.path, entrypoint), {mode: 0o755});
    launcher = {path: 'foundation-kit', size: fs.statSync(launcherFile).size, sha256: sha256(fs.readFileSync(launcherFile)), mode: fs.statSync(launcherFile).mode & 0o777, runtimePath: `payload/${runtime.path}`, entrypoint: `payload/${entrypoint}`, externalNodeRequired: false};
  }
  const files = walkFiles(payload).map((file) => {
    const relative = path.relative(payload, file).replaceAll(path.sep, '/');
    if (!validPackagePath(relative)) throw new LifecycleError('MANIFEST_PATH_INVALID', `候选文件路径非法：${relative}`, {stage: 'candidate-build'});
    return {path: relative, size: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)), mode: fs.statSync(file).mode & 0o777};
  });
  if (!files.some((file) => file.path === entrypoint)) throw new LifecycleError('CANDIDATE_ENTRYPOINT_MISSING', `候选入口不存在：${entrypoint}`, {stage: 'candidate-build'});
  const base = {
    schemaVersion: '1.0.0',
    productVersion,
    platform,
    arch,
    entrypoint,
    runtime,
    files,
    launcher,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0) + Number(launcher?.size || 0),
    source: {kind: sourceKind, ...(sourceUrl ? {url: sourceUrl} : {})},
    build: {identity: buildIdentity},
    signature: {status: 'unsigned', productionDistribution: false},
    provenance: {status: 'local-candidate', immutableRelease: false},
  };
  const manifest = {...base, candidateHash: sha256(canonicalStringify(base))};
  fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {root: output, manifest};
}

export function validateCandidate(candidateRoot, {platform, arch, requireRuntime = false, allowedSources = [], signatureVerifier = null} = {}) {
  try {
    const root = path.resolve(candidateRoot);
    if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) throw new LifecycleError('CANDIDATE_ROOT_INVALID', '候选根不存在、不是目录或为符号链接', {stage: 'candidate-verify'});
    const manifestFile = path.join(root, 'manifest.json');
    const payload = path.join(root, 'payload');
    if (!fs.existsSync(manifestFile) || !fs.existsSync(payload)) throw new LifecycleError('CANDIDATE_INCOMPLETE', '候选缺少 manifest 或 payload', {stage: 'candidate-verify'});
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assertExactKeys(manifest, ['schemaVersion', 'productVersion', 'platform', 'arch', 'entrypoint', 'runtime', 'launcher', 'files', 'totalBytes', 'source', 'build', 'signature', 'provenance', 'candidateHash'], 'CANDIDATE_SCHEMA_UNKNOWN_FIELD', '候选 manifest');
    if (manifest.schemaVersion !== '1.0.0' || !Array.isArray(manifest.files)) throw new LifecycleError('CANDIDATE_SCHEMA_UNSUPPORTED', '候选 manifest schema 不受支持', {stage: 'candidate-verify'});
    if (!/^\d+\.\d+\.\d+$/u.test(manifest.productVersion || '') || !['win32', 'darwin'].includes(manifest.platform) || !['x64', 'arm64'].includes(manifest.arch)) throw new LifecycleError('CANDIDATE_IDENTITY_INVALID', '候选版本、平台或架构无效', {stage: 'candidate-verify'});
    if (!validPackagePath(manifest.entrypoint) || !manifest.entrypoint.startsWith('app/')) throw new LifecycleError('CANDIDATE_ENTRYPOINT_INVALID', '候选入口无效', {stage: 'candidate-verify'});
    const listed = new Set();
    let computedBytes = 0;
    for (const record of manifest.files) {
      assertExactKeys(record, ['path', 'size', 'sha256', 'mode'], 'CANDIDATE_FILE_SCHEMA_INVALID', '候选文件记录');
      if (!validPackagePath(record.path)) throw new LifecycleError('MANIFEST_PATH_INVALID', `manifest 路径非法：${record.path}`, {stage: 'candidate-verify'});
      if (listed.has(record.path)) throw new LifecycleError('MANIFEST_PATH_DUPLICATE', `manifest 路径重复：${record.path}`, {stage: 'candidate-verify'});
      if (!Number.isInteger(record.size) || record.size < 0 || !/^[0-9a-f]{64}$/u.test(record.sha256 || '') || !Number.isInteger(record.mode)) throw new LifecycleError('CANDIDATE_FILE_SCHEMA_INVALID', `候选文件记录无效：${record.path}`, {stage: 'candidate-verify'});
      listed.add(record.path);
      computedBytes += record.size;
    }
    if (manifest.launcher) {
      assertExactKeys(manifest.launcher, ['path', 'size', 'sha256', 'mode', 'runtimePath', 'entrypoint', 'externalNodeRequired'], 'CANDIDATE_LAUNCHER_INVALID', '候选 launcher');
      const launcherFile = path.join(root, manifest.launcher.path);
      if (manifest.platform !== 'darwin' || manifest.launcher.path !== 'foundation-kit' || manifest.launcher.mode !== 0o755 || manifest.launcher.externalNodeRequired !== false || manifest.launcher.runtimePath !== `payload/${manifest.runtime?.path}` || manifest.launcher.entrypoint !== `payload/${manifest.entrypoint}` || !fs.existsSync(launcherFile) || fs.lstatSync(launcherFile).isSymbolicLink() || !fs.statSync(launcherFile).isFile() || fs.statSync(launcherFile).size !== manifest.launcher.size || (fs.statSync(launcherFile).mode & 0o777) !== manifest.launcher.mode || sha256(fs.readFileSync(launcherFile)) !== manifest.launcher.sha256) {
        throw new LifecycleError('CANDIDATE_LAUNCHER_INVALID', '候选自托管 launcher identity 或内容无效', {stage: 'candidate-verify'});
      }
      computedBytes += manifest.launcher.size;
    }
    if (!listed.has(manifest.entrypoint) || manifest.totalBytes !== computedBytes) throw new LifecycleError('CANDIDATE_CONTENT_SUMMARY_INVALID', '候选入口或总字节数与完整文件清单不一致', {stage: 'candidate-verify'});
    assertExactKeys(manifest.source, ['kind', 'url'], 'CANDIDATE_SOURCE_INVALID', '候选来源');
    assertExactKeys(manifest.build, ['identity'], 'CANDIDATE_BUILD_IDENTITY_MISSING', '构建身份');
    assertExactKeys(manifest.signature, ['status', 'productionDistribution', 'signer'], 'CANDIDATE_SIGNATURE_INVALID', '签名状态');
    assertExactKeys(manifest.provenance, ['status', 'immutableRelease'], 'CANDIDATE_PROVENANCE_INVALID', '发布来源');
    if (manifest.runtime) {
      assertExactKeys(manifest.runtime, ['strategy', 'desiredSource', 'sourceStatus', 'officialSourceVerified', 'path'], 'PRIVATE_RUNTIME_INVALID', '私有 runtime');
      if (!validPackagePath(manifest.runtime.path) || !manifest.runtime.path.startsWith('runtime/') || !listed.has(manifest.runtime.path)) throw new LifecycleError('PRIVATE_RUNTIME_INVALID', '私有 runtime 路径无效或未列入 manifest', {stage: 'candidate-verify'});
      if (manifest.runtime.officialSourceVerified === true) {
        const node = manifest.files.find((entry) => entry.path === manifest.runtime.path);
        const license = manifest.files.find((entry) => entry.path === 'runtime/LICENSE');
        if (manifest.platform !== 'darwin' || manifest.runtime.sourceStatus !== 'pinned-official-https-sha256' || node.sha256 !== OFFICIAL_NODE_RUNTIME_LOCK.binaries[manifest.arch] || license?.sha256 !== OFFICIAL_NODE_RUNTIME_LOCK.licenseSha256 || !listed.has('runtime/provenance.json')) throw new LifecycleError('RUNTIME_PROVENANCE_INVALID', '官方 Runtime 声明与固定二进制/许可身份不一致', {stage: 'candidate-verify'});
        const provenanceFile = path.join(root, 'payload', 'runtime', 'provenance.json');
        if (fs.realpathSync(provenanceFile) !== provenanceFile || !fs.lstatSync(provenanceFile).isFile()) throw new LifecycleError('RUNTIME_PROVENANCE_INVALID', 'Runtime 来源记录路径不安全', {stage: 'candidate-verify'});
        const provenance = JSON.parse(fs.readFileSync(provenanceFile, 'utf8'));
        const lock = OFFICIAL_NODE_RUNTIME_LOCK;
        const expected = {version: lock.version, platform: manifest.platform, arch: manifest.arch, url: `https://nodejs.org/dist/v${lock.version}/node-v${lock.version}-darwin-${manifest.arch}.tar.gz`, archiveSha256: lock.archives[manifest.arch], binarySha256: lock.binaries[manifest.arch], licenseSha256: lock.licenseSha256, verification: 'pinned-official-https-sha256', openPgpVerified: false, foundationDistributionSigned: false};
        if (canonicalStringify(provenance) !== canonicalStringify(expected)) throw new LifecycleError('RUNTIME_PROVENANCE_INVALID', 'Runtime 来源记录内容不符合固定官方归档合同', {stage: 'candidate-verify'});
      }
    }
    const {candidateHash, ...base} = manifest;
    if (candidateHash !== sha256(canonicalStringify(base))) throw new LifecycleError('CANDIDATE_MANIFEST_TAMPERED', '候选 manifest 已被改写', {stage: 'candidate-verify'});
    if (!['unsigned', 'verified'].includes(manifest.signature?.status) || (manifest.signature.status === 'unsigned' && manifest.signature.productionDistribution !== false) || (manifest.signature.status === 'verified' && !manifest.signature.signer)) throw new LifecycleError('CANDIDATE_SIGNATURE_INVALID', '候选签名状态无效', {stage: 'candidate-verify'});
    let detachedDistribution = false;
    if (manifest.signature.status === 'verified') {
      if (typeof signatureVerifier === 'function') {
        if (signatureVerifier({manifest, candidateHash}) !== true) throw new LifecycleError('CANDIDATE_SIGNATURE_INVALID', '候选签名验证失败', {stage: 'candidate-verify'});
      } else {
        const signatureFile = path.join(root, 'distribution-signature.json');
        if (!fs.existsSync(signatureFile)) throw new LifecycleError('SIGNATURE_VERIFIER_REQUIRED', '候选声明已签名，但缺少可信分发签名证据', {stage: 'candidate-verify'});
        if (fs.realpathSync(signatureFile) !== signatureFile || !fs.lstatSync(signatureFile).isFile() || fs.statSync(signatureFile).size > 4096) throw new LifecycleError('CANDIDATE_SIGNATURE_INVALID', '发行签名文件路径或大小无效', {stage: 'candidate-verify'});
        verifyDistributionSignature(manifest, JSON.parse(fs.readFileSync(signatureFile, 'utf8')));
        detachedDistribution = true;
      }
    }
    if (manifest.source?.kind === 'remote') {
      let remote;
      try { remote = new URL(manifest.source.url); } catch { throw new LifecycleError('CANDIDATE_SOURCE_INVALID', '远程候选源 URL 无效', {stage: 'candidate-verify'}); }
      if (remote.protocol !== 'https:' || remote.username || remote.password) throw new LifecycleError('CANDIDATE_SOURCE_NOT_HTTPS', '远程候选只允许无内嵌凭证的 HTTPS 来源', {stage: 'candidate-verify'});
      if (!(detachedDistribution ? FOUNDATION_RELEASE_POLICY.allowedOrigins : allowedSources).includes(remote.origin)) throw new LifecycleError('CANDIDATE_SOURCE_NOT_ALLOWED', `远程候选来源未配置：${remote.origin}`, {stage: 'candidate-verify'});
    } else if (!['local-test', 'repository-local-build', 'local-build'].includes(manifest.source?.kind)) throw new LifecycleError('CANDIDATE_SOURCE_INVALID', '候选来源类型不受支持', {stage: 'candidate-verify'});
    if (typeof manifest.build?.identity !== 'string' || !manifest.build.identity) throw new LifecycleError('CANDIDATE_BUILD_IDENTITY_MISSING', '候选缺少构建身份', {stage: 'candidate-verify'});
    if (platform && manifest.platform !== platform) throw new LifecycleError('CANDIDATE_PLATFORM_MISMATCH', `候选平台 ${manifest.platform} 与当前 ${platform} 不符`, {stage: 'candidate-verify'});
    if (arch && manifest.arch !== arch) throw new LifecycleError('CANDIDATE_ARCH_MISMATCH', `候选架构 ${manifest.arch} 与当前 ${arch} 不符`, {stage: 'candidate-verify'});
    if (requireRuntime && !manifest.runtime) throw new LifecycleError('PRIVATE_RUNTIME_MISSING', '候选未包含 Foundation 私有运行环境', {stage: 'candidate-verify'});
    if (requireRuntime && manifest.platform === 'darwin' && !manifest.launcher) throw new LifecycleError('CANDIDATE_LAUNCHER_MISSING', 'macOS 候选缺少自托管顶层 launcher', {stage: 'candidate-verify'});
    for (const record of manifest.files) {
      const file = path.join(payload, ...record.path.split('/'));
      if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile() || fs.statSync(file).size !== record.size || (fs.statSync(file).mode & 0o777) !== record.mode || sha256(fs.readFileSync(file)) !== record.sha256) throw new LifecycleError('CANDIDATE_HASH_MISMATCH', `候选文件完整性失败：${record.path}`, {stage: 'candidate-verify'});
    }
    for (const file of walkFiles(payload)) {
      const relative = path.relative(payload, file).replaceAll(path.sep, '/');
      if (!listed.has(relative)) throw new LifecycleError('CANDIDATE_UNLISTED_FILE', `候选含未登记文件：${relative}`, {stage: 'candidate-verify'});
    }
    const rootEntries = fs.readdirSync(root).sort();
    const expectedRootEntries = manifest.launcher ? ['foundation-kit', 'manifest.json', 'payload'] : ['manifest.json', 'payload'];
    if (detachedDistribution) expectedRootEntries.push('distribution-signature.json');
    expectedRootEntries.sort();
    if (canonicalStringify(rootEntries) !== canonicalStringify(expectedRootEntries)) throw new LifecycleError('CANDIDATE_UNLISTED_FILE', '候选根含未登记文件或缺失 launcher', {stage: 'candidate-verify'});
    return {ok: true, root, manifest};
  } catch (error) {
    const normalized = error instanceof LifecycleError ? error : new LifecycleError('CANDIDATE_INVALID', error.message, {stage: 'candidate-verify'});
    return {ok: false, error: normalized.toJSON()};
  }
}
