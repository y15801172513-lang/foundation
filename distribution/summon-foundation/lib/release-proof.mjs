import crypto from 'node:crypto';
import {Verifier, toSignedEntity, toTrustMaterial} from '@sigstore/verify';
import {bundleFromJSON} from '@sigstore/bundle';
import {TrustedRoot} from '@sigstore/protobuf-specs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const reject = message => { throw new Error(`发行校验失败：${message}`); };

// The caller obtains trustedRoot from a successfully refreshed GitHub TUF
// target rooted in the packaged, reviewed GitHub bootstrap root. Never from
// the downloaded release, caller approval booleans, or a catalog field.
export function verifyReleaseProof({bundle, trustedRoot, repository, release, sourceCommit, asset, bytes}) {
  if (!repository || !Number.isSafeInteger(repository.id) || repository.id <= 0 || repository.private !== false || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name)) reject('仓库身份无效');
  if (!release || !Number.isSafeInteger(release.id) || release.immutable !== true || release.draft !== false || release.prerelease !== false || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !/^[a-f0-9]{40}$/.test(sourceCommit)) reject('版本不是绑定提交的正式不可变发行');
  if (!Buffer.isBuffer(bytes) || !asset || !Number.isSafeInteger(asset.size) || bytes.length !== asset.size || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || asset.digest !== `sha256:${sha256(bytes)}`) reject('资产长度或摘要不匹配');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.name) || asset.state !== 'uploaded' || asset.browser_download_url !== `https://github.com/${repository.full_name}/releases/download/${release.tag_name}/${asset.name}`) reject('资产不是固定版本下载地址');
  if (release.assets?.filter(x => x.id === asset.id && x.name === asset.name && x.size === asset.size && x.digest === asset.digest).length !== 1) reject('资产不属于对应发行');
  // GitHub releases use its TSA, not public-good Rekor/SCT logs. This matches
  // gh release verify-asset's GitHub policy: real TSA >=1 + CA + exact SAN.
  // No timestamp or signature check is disabled.
  const verifier = new Verifier(toTrustMaterial(TrustedRoot.fromJSON(trustedRoot)), {ctlogThreshold: 0, tlogThreshold: 0, timestampThreshold: 1});
  const entity = toSignedEntity(bundleFromJSON(bundle));
  if (!entity.timestamps.some(t => t.$case === 'timestamp-authority')) reject('缺少 GitHub 签名时间戳');
  verifier.verify(entity, {subjectAlternativeName: /^https:\/\/dotcom\.releases\.github\.com$/});
  const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  const purl = `pkg:github/${repository.full_name}@${release.tag_name}`;
  const predicate = statement.predicate;
  if (statement._type !== 'https://in-toto.io/Statement/v1' || statement.predicateType !== 'https://in-toto.io/attestation/release/v0.2' || predicate?.repository !== repository.full_name || String(predicate.repositoryId) !== String(repository.id) || String(predicate.databaseId) !== String(release.id) || predicate.tag !== release.tag_name || predicate.purl !== purl) reject('签名证明的仓库或发行身份不匹配');
  if (statement.subject?.filter(s => s.uri === purl && s.digest?.sha1 === sourceCommit).length !== 1 || statement.subject?.filter(s => s.name === asset.name && s.digest?.sha256 === asset.digest.slice(7)).length !== 1) reject('签名证明未绑定提交和资产');
  return Object.freeze({repository: repository.full_name, repositoryId: repository.id, releaseId: release.id, tag: release.tag_name, sourceCommit, asset: asset.name, bytes: bytes.length, sha256: sha256(bytes), verification: 'github-release-signature-timestamp-and-byte-binding'});
}
