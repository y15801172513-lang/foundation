import crypto from 'node:crypto';
import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';

const digest = /^[a-f0-9]{64}$/u;
const version = /^\d+\.\d+\.\d+$/u;
// DEFERRED independent product signing policy; not required by the GitHub path.
// Populated only by a separately reviewed release-channel change. A download,
// CLI flag, environment variable or candidate cannot nominate its own key.
export const FOUNDATION_RELEASE_POLICY = Object.freeze({keyId: null, publicKey: null, allowedOrigins: Object.freeze([])});
// User-approved acquisition repository, not an authorization to publish there.
// A future public repository requires a separately reviewed identity change.
export const FOUNDATION_GITHUB_REPOSITORY = Object.freeze({repository:'y15801172513-lang/foundation', repositoryId:1363748227});
function reject(code, message) { throw new LifecycleError(code, message, {stage: 'release-acquisition'}); }
function exact(object, keys) {
  if (!object || Array.isArray(object) || typeof object !== 'object' || Object.keys(object).sort().join('|') !== [...keys].sort().join('|')) reject('RELEASE_INDEX_INVALID', '版本清单字段不符合合同');
}
function httpsLocation(value, origins) {
  let url;
  try { url = new URL(value); } catch { reject('RELEASE_SOURCE_INVALID', '下载地址格式无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !origins.includes(url.origin)) reject('RELEASE_SOURCE_REJECTED', '下载地址必须来自已配置的 HTTPS 来源且不得携带凭证、查询或片段');
  return url;
}

// The caller must obtain policy from its trusted product contract, never from
// this index. Index metadata cannot appoint its own verification key or origin.
export function verifyReleaseCatalog(envelope, policy, {now = Date.now()} = {}) {
  exact(envelope, ['catalog', 'signature']);
  if (!policy?.publicKey || !policy?.keyId || !Array.isArray(policy?.allowedOrigins)) reject('RELEASE_TRUST_UNCONFIGURED', '发行信任根尚未配置；不能自动下载或执行');
  const key = crypto.createPublicKey(policy.publicKey);
  if (key.asymmetricKeyType !== 'ed25519') reject('RELEASE_TRUST_INVALID', '发行签名仅支持 Ed25519');
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/u.test(envelope.signature) || !crypto.verify(null, Buffer.from(canonicalStringify(envelope.catalog)), key, Buffer.from(envelope.signature, 'base64'))) reject('RELEASE_SIGNATURE_INVALID', '版本清单签名验证失败；不降级到其他来源');
  const catalog = envelope.catalog;
  return validateCatalogStructure(catalog, policy, now);
}

function validateCatalogStructure(catalog, policy, now) {
  exact(catalog, ['schemaVersion', 'product', 'keyId', 'issuedAt', 'expiresAt', 'releases']);
  if (catalog.schemaVersion !== '1.0.0' || catalog.product !== 'ai-product-foundation-kit' || catalog.keyId !== policy.keyId || !Number.isSafeInteger(catalog.issuedAt) || !Number.isSafeInteger(catalog.expiresAt) || catalog.issuedAt > now || catalog.expiresAt <= now || catalog.expiresAt <= catalog.issuedAt || !Array.isArray(catalog.releases)) reject('RELEASE_INDEX_INVALID', '版本清单身份或有效期无效');
  const identities = new Set();
  for (const release of catalog.releases) {
    exact(release, ['version', 'platform', 'arch', 'url', 'sha256', 'bytes', 'candidateHash', 'runtime', 'repositoryId', 'sourceCommit']);
    if (!version.test(release.version) || release.platform !== 'darwin' || !['arm64', 'x64'].includes(release.arch) || !digest.test(release.sha256) || !digest.test(release.candidateHash) || !Number.isSafeInteger(release.bytes) || release.bytes <= 0) reject('RELEASE_INDEX_INVALID', '发行版本、平台、架构或产物身份无效');
    const identity = `${release.version}/${release.platform}/${release.arch}`;
    if (identities.has(identity)) reject('RELEASE_INDEX_INVALID', '版本清单包含重复平台版本');
    identities.add(identity);
    const location = httpsLocation(release.url, policy.allowedOrigins);
    if (!location.pathname.includes(release.sha256)) reject('RELEASE_IMMUTABLE_LOCATION_REQUIRED', '产物地址必须包含完整内容摘要');
    githubReleaseAcquisition(release);
    exact(release.runtime, ['version', 'url', 'archiveSha256', 'binarySha256']);
    if (!version.test(release.runtime.version) || !digest.test(release.runtime.archiveSha256) || !digest.test(release.runtime.binarySha256)) reject('RUNTIME_PROVENANCE_INVALID', 'Runtime 来源记录不完整');
    const runtime = httpsLocation(release.runtime.url, ['https://nodejs.org']);
    if (runtime.pathname !== `/dist/v${release.runtime.version}/node-v${release.runtime.version}-darwin-${release.arch}.tar.gz`) reject('RUNTIME_PROVENANCE_INVALID', 'Runtime 必须绑定相同目标架构的官方版本归档');
  }
  return JSON.parse(JSON.stringify(catalog));
}

// This validates metadata only. Authenticity is supplied by authenticated
// GitHub metadata + immutable Release attestation BEFORE archive execution.
// A local JSON file alone never establishes acquisition verification.
export function verifyGitHubReleaseCatalog(catalog, repository = FOUNDATION_GITHUB_REPOSITORY, {now = Date.now()} = {}) {
  if (catalog?.keyId !== null) reject('RELEASE_INDEX_INVALID', 'GitHub 最小流程不使用独立发行 key ID');
  const checked = validateCatalogStructure(catalog, {keyId:null, allowedOrigins:['https://github.com']}, now);
  if (!checked.releases.length) reject('RELEASE_INDEX_INVALID', '需要至少一个明确版本；不选择 latest');
  for (const release of checked.releases) {
    const acquisition = githubReleaseAcquisition(release);
    if (acquisition.repository !== repository.repository || acquisition.repositoryId !== repository.repositoryId) reject('RELEASE_SOURCE_REJECTED', '版本清单不能更换产品固定仓库身份');
  }
  return checked;
}

// Build a host acquisition contract, not an executable supplied by the index.
// Only versioned Release assets are supported; never latest or Actions ZIPs.
export function githubReleaseAcquisition(release) {
  if (!release || !version.test(release.version) || !digest.test(release.sha256) || !Number.isSafeInteger(release.bytes) || release.bytes <= 0) reject('RELEASE_SOURCE_REJECTED', 'Release 版本、字节数或摘要无效');
  let url;
  try { url = new URL(release.url); } catch { reject('RELEASE_SOURCE_REJECTED', 'Release 地址无效'); }
  const match = /^\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/releases\/download\/(v\d+\.\d+\.\d+)\/(foundation-[a-f0-9]{64}\.tar\.gz)$/u.exec(url.pathname);
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || !match || match[3] !== `v${release.version}` || match[4] !== `foundation-${release.sha256}.tar.gz` || !Number.isSafeInteger(release.repositoryId) || release.repositoryId <= 0 || !/^[a-f0-9]{40}$/u.test(release.sourceCommit)) reject('RELEASE_SOURCE_REJECTED', '必须绑定 GitHub 仓库 ID、精确提交、版本 tag 和完整摘要命名的 Release 资产');
  const repository = `${match[1]}/${match[2]}`;
  return Object.freeze({repository, repositoryId: release.repositoryId, tag: match[3], asset: match[4], sourceCommit: release.sourceCommit,
    repositoryEndpoint: `repos/${repository}`, releaseEndpoint: `repos/${repository}/releases/tags/${match[3]}`, commitEndpoint: `repos/${repository}/commits/${match[3]}`,
    releasePredicate: `.draft == false and .prerelease == false and .immutable == true and .tag_name == ${JSON.stringify(match[3])} and ([.assets[] | select(.name == ${JSON.stringify(match[4])} and .state == "uploaded" and .size == ${release.bytes} and .digest == "sha256:${release.sha256}" and .browser_download_url == ${JSON.stringify(release.url)})] | length) == 1`,
    downloadArguments: ['release', 'download', match[3], '--repo', repository, '--pattern', match[4]],
    nodeRequiredOnPath: false, userManualDownload: false});
}

export function selectCatalogRelease(catalog, {version: requestedVersion, platform, arch}) {
  if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) reject('RELEASE_PLATFORM_UNSUPPORTED', '当前入口仅支持 macOS arm64/x64');
  const release = catalog.releases.find((entry) => entry.version === requestedVersion && entry.platform === platform && entry.arch === arch);
  if (!release) reject('RELEASE_VERSION_UNAVAILABLE', '请求的版本或架构尚无可用发行产物；请选择清单中实际存在的版本');
  return release;
}

export function verifyAcquiredReleaseBytes(bytes, release) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== release.bytes || sha256(bytes) !== release.sha256) reject('RELEASE_BYTES_MISMATCH', '下载长度或 SHA-256 不匹配；未执行下载内容');
  return {verified: true, sha256: release.sha256, bytes: bytes.length, executionPerformed: false};
}

export function verifyDistributionSignature(manifest, envelope, policy = FOUNDATION_RELEASE_POLICY) {
  if (!policy.publicKey || !policy.keyId) reject('RELEASE_TRUST_UNCONFIGURED', '尚未批准发行签名身份；候选不能自行指定信任根');
  exact(envelope, ['schemaVersion', 'keyId', 'candidateHash', 'signature']);
  if (envelope.schemaVersion !== '1.0.0' || envelope.keyId !== policy.keyId || envelope.candidateHash !== manifest.candidateHash || manifest.signature?.signer !== policy.keyId || manifest.signature?.status !== 'verified' || manifest.provenance?.immutableRelease !== true || manifest.signature?.productionDistribution !== true || manifest.source?.kind !== 'remote') reject('RELEASE_SIGNATURE_INVALID', '发行签名身份与候选不匹配');
  httpsLocation(manifest.source.url, policy.allowedOrigins);
  const key = crypto.createPublicKey(policy.publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/u.test(envelope.signature)) reject('RELEASE_SIGNATURE_INVALID', '发行签名格式无效');
  const payload = {schemaVersion: envelope.schemaVersion, keyId: envelope.keyId, candidateHash: envelope.candidateHash};
  if (!crypto.verify(null, Buffer.from(canonicalStringify(payload)), key, Buffer.from(envelope.signature, 'base64'))) reject('RELEASE_SIGNATURE_INVALID', '发行签名密码学验证失败');
  return true;
}
