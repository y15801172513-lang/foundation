import {FOUNDATION_RELEASE_POLICY, FOUNDATION_GITHUB_REPOSITORY, verifyReleaseCatalog, verifyGitHubReleaseCatalog, githubReleaseAcquisition} from './release-catalog.mjs';

// Build-time source generation only. No network, filesystem or execution.
// The published script must itself be retrieved from an approved immutable
// product-contract revision. A hash received alongside an unknown script is
// not a trust anchor. Production build callers cannot nominate a key via CLI.
// DEFERRED experimental independent-signature renderer: tests/history only.
// Not reachable from the current build CLI; never an automatic fallback.
export function renderConversationalEntry(envelope, policy = FOUNDATION_RELEASE_POLICY, {now = Date.now()} = {}) {
  const catalog = verifyReleaseCatalog(envelope, policy, {now});
  return renderVerifiedCatalog(catalog, {productSignature:true});
}

export function renderGitHubConversationalEntry(catalog, repository = FOUNDATION_GITHUB_REPOSITORY, {now = Date.now()} = {}) {
  return renderVerifiedCatalog(verifyGitHubReleaseCatalog(catalog, repository, {now}), {productSignature:false});
}

function renderVerifiedCatalog(catalog, {productSignature}) {
  const releases = catalog.releases.map((entry) => ({...entry, nodeSha256: entry.runtime.binarySha256, hostAcquisition: githubReleaseAcquisition(entry)}));
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  const selections = releases.map((entry) => {
    const host = entry.hostAcquisition;
    const receipt = JSON.stringify({schemaVersion:'1.0.0', product:catalog.product, version:entry.version, arch:entry.arch, repository:host.repository, repositoryId:host.repositoryId, sourceCommit:host.sourceCommit, asset:host.asset, sha256:entry.sha256, bytes:entry.bytes, candidateHash:entry.candidateHash, purpose:'acquisition-cache', retained:true, deletionAuthority:false});
    return `  ${quote(entry.version + '/' + entry.arch)}) archive_hash=${quote(entry.sha256)}; archive_bytes=${entry.bytes}; candidate_hash=${quote(entry.candidateHash)}; node_hash=${quote(entry.nodeSha256)}; repository=${quote(host.repository)}; repository_id=${host.repositoryId}; tag=${quote(host.tag)}; asset=${quote(host.asset)}; source_commit=${quote(host.sourceCommit)}; release_predicate=${quote(host.releasePredicate)}; acquisition_receipt=${quote(receipt)};;`;
  }).join('\n');
  const inspection = JSON.stringify({schemaVersion: '1.0.0', product: catalog.product, keyId: catalog.keyId, expiresAt: catalog.expiresAt, availableVersions: releases, versionAvailability:'entry-catalog; remote availability not checked', release:{remoteQuery:'not-checked', remoteAcquisition:'not-checked', publication:'unknown'}, acquisition: productSignature ? 'host-download-then-local-byte-verification' : 'fixed-github-release-attestation-and-byte-verification', independentProductKeyRequired:productSignature, remoteAcquisitionVerified:false, requiredHost: 'Codex with authenticated GitHub CLI release verification, local command execution and in-app browser', nodeRequiredOnPath: false, installationAuthority: 'exact Foundation manager confirmation', realUserAccepted: false});
  return `#!/bin/sh
# Foundation conversational entry — generated from a verified release catalog.
# This is a host-called background entry, not a user-operated installer bundle.
set -eu
umask 077
unset NODE_OPTIONS NODE_PATH NODE_V8_COVERAGE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_COMPILE_CACHE_PORTABLE NODE_PRESERVE_SYMLINKS
PATH=''
export PATH
fail() { /usr/bin/printf '错误：%s\\n' "$1" >&2; exit 1; }
version=''; archive=''; destination=''; github_client=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --inspect) [ "$#" -eq 1 ] || fail 'inspect 不接受其他参数'; /usr/bin/printf '%s\\n' ${quote(inspection)}; exit 0;;
    --version) [ "$#" -ge 2 ] && [ -z "$version" ] || fail 'version 参数重复或缺值'; version=$2; shift 2;;
    --archive) [ "$#" -ge 2 ] && [ -z "$archive" ] || fail 'archive 参数重复或缺值'; archive=$2; shift 2;;
    --github-client) [ "$#" -ge 2 ] && [ -z "$github_client" ] || fail 'github-client 参数重复或缺值'; github_client=$2; shift 2;;
    --destination) [ "$#" -ge 2 ] && [ -z "$destination" ] || fail 'destination 参数重复或缺值'; destination=$2; shift 2;;
    *) fail '仅支持 --inspect 或 --version / (--archive 或 --github-client) / 可选 --destination';;
  esac
done
[ "$(/usr/bin/uname -s)" = Darwin ] || fail '仅支持 macOS'
arch=$(/usr/bin/uname -m)
[ "$arch" != x86_64 ] || arch=x64
case "$version/$arch" in
${selections}
  *) fail '所选版本或架构不存在；先读取 --inspect 的实际清单';;
esac
[ "$(/bin/date +%s)" -lt ${Math.floor(catalog.expiresAt / 1000)} ] || fail '安装契约已到期；重新取得同一可信渠道的有效契约'
[ -z "$archive" ] || [ -z "$github_client" ] || fail '不能同时指定归档和 GitHub 宿主客户端'
[ -n "$archive$github_client" ] || fail '需要宿主获取能力；不要求用户手动下载'
${productSignature ? '# Legacy independently signed entry retained but not required by the minimal workflow.' : `[ -n "$github_client" ] && [ -z "$archive" ] || fail 'GitHub 最小入口必须由宿主核验并自动下载 Release；不能用本地归档或字段跳过来源检查'`}
case "$archive$github_client" in /*) ;; *) fail '宿主文件或客户端必须为已核验绝对路径；不接收下载凭证';; esac
if [ -n "$destination" ]; then case "$destination" in /*) ;; *) fail '安装意向目录必须为绝对路径';; esac; fi
plain_chain() {
  cursor=$1
  while [ "$cursor" != / ]; do
    [ ! -L "$cursor" ] || fail '路径包含符号链接；不跟随'
    case "$cursor" in */../*|*/./*|*/..|*/.|*//*) fail '路径必须规范化';; esac
    cursor=\${cursor%/*}
    [ -n "$cursor" ] || cursor=/
  done
}
if [ -n "$archive" ]; then
  plain_chain "$archive"
  [ -f "$archive" ] || fail '归档不存在或不是普通文件'
fi
if [ -n "$github_client" ]; then
  plain_chain "$github_client"
  [ -f "$github_client" ] && [ -x "$github_client" ] || fail '宿主 GitHub 客户端不可用；不自动安装开发工具'
fi
# A source checkout is not a real-install execution surface. The generated
# entry must be acquired in a separately authorized user-install task.
case "$0" in /*) script_location=$0;; *) script_location="$(/bin/pwd -P)/$0";; esac
for source_location in "\${script_location%/*}" "$(/bin/pwd -P)"; do
  script_parent=$source_location
  while [ "$script_parent" != / ]; do
    if [ -f "$script_parent/AGENTS.md" ] && [ -f "$script_parent/packages/core/trusted-authority.mjs" ]; then fail 'SOURCE_ONLY：源码建设目录不允许真实获取缓存或安装；请在独立授权任务使用已发布入口'; fi
    script_parent=\${script_parent%/*}
    [ -n "$script_parent" ] || script_parent=/
  done
done
# Account data comes from the OS, never HOME or an AI-supplied cache override.
account=$(/usr/bin/id -un)
account_record=$(/usr/bin/dscl . -read "/Users/$account" NFSHomeDirectory) || fail '无法读取 OS account'
case "$account_record" in 'NFSHomeDirectory: '/*) account_home=\${account_record#NFSHomeDirectory: };; *) fail 'OS account home 不可验证';; esac
case "$account_home" in *'
'*) fail 'OS account home 格式不支持';; esac
plain_chain "$account_home"
[ -d "$account_home" ] || fail 'OS account home 不存在'
[ "$(cd -P "$account_home" && /bin/pwd -P)" = "$account_home" ] || fail 'OS account home 实路径不一致'
cache="$account_home/Library/Caches/ai-product-foundation-kit-acquisition"
/usr/bin/printf '确认前仅准备获取缓存：%s\\n安装目录仅为意向，安装仍须 Foundation 页面确认。\\n' "$cache"
plain_chain "$cache"
for directory in "$account_home/Library" "$account_home/Library/Caches" "$cache"; do
  [ -d "$directory" ] || /bin/mkdir -m 700 "$directory" || fail '不能创建获取缓存'
  [ ! -L "$directory" ] && [ "$(cd -P "$directory" && /bin/pwd -P)" = "$directory" ] || fail '缓存路径变化'
done
[ "$(/usr/bin/stat -f %u "$cache")" = "$(/usr/bin/id -u)" ] && [ "$(/usr/bin/stat -f %Lp "$cache")" = 700 ] || fail '获取缓存必须由当前用户独占（0700）；不自动更改已有权限'
stage=$(/usr/bin/mktemp -d "$cache/acquisition.XXXXXXXX") || fail '无法创建独占获取目录'
/usr/bin/printf '%s\\n' "$acquisition_receipt" > "$stage/acquisition.json"
/usr/bin/printf '本次获取目录：%s\\n成功、失败及卸载后均保留获取缓存；不会自动删除。acquisition.json 仅为识别线索，不是删除授权。\\n' "$stage"
# The host supplies an already authenticated, verified real gh executable.
# It is an acquisition dependency only, never copied into installed runtime.
# Explicit hostname prevents GH_HOST from selecting a different service.
if [ -n "$github_client" ]; then
  export GH_HOST=github.com GH_PROMPT_DISABLED=1 GH_NO_UPDATE_NOTIFIER=1 GH_NO_EXTENSION_UPDATE_NOTIFIER=1
  actual_repository=$("$github_client" api --hostname github.com "repos/$repository" --jq '.id') || fail '私有仓库读取失败；检查宿主登录和网络'
  [ "$actual_repository" = "$repository_id" ] || fail '仓库身份漂移'
  actual_commit=$("$github_client" api --hostname github.com "repos/$repository/commits/$tag" --jq '.sha') || fail '无法解析精确版本提交'
  [ "$actual_commit" = "$source_commit" ] || fail '版本 tag 与批准提交不一致'
  actual_release=$("$github_client" api --hostname github.com "repos/$repository/releases/tags/$tag" --jq "$release_predicate") || fail '无法核验正式 Release'
  [ "$actual_release" = true ] || fail 'Release 尚非不可变正式发行，或资产身份不匹配'
  "$github_client" release download "$tag" --repo "github.com/$repository" --pattern "$asset" --dir "$stage" || fail 'Release 下载失败；不降级到 Actions 或其他来源'
  /bin/mv "$stage/$asset" "$stage/release.tar.gz" || fail '缺少精确下载资产'
else
  /bin/cp "$archive" "$stage/release.tar.gz" || fail '归档复制失败；未执行'
fi
# Preserve interrupted attempts for explicit inspection; never rm user paths.
actual_size=$(/usr/bin/stat -f %z "$stage/release.tar.gz")
[ "$actual_size" = "$archive_bytes" ] || fail '归档长度不符；保留隔离副本，未执行'
actual_hash=$(/usr/bin/shasum -a 256 "$stage/release.tar.gz")
actual_hash=\${actual_hash%% *}
[ "$actual_hash" = "$archive_hash" ] || fail '归档 SHA-256 不符；保留隔离副本，未执行'
${productSignature ? '' : `"$github_client" release verify-asset "$tag" "$stage/release.tar.gz" --repo "github.com/$repository" --format json > "$stage/github-release-verification.json" || fail 'GitHub Release 证明核验失败；未展开或执行，不回退来源'
/usr/bin/printf '已核验固定 GitHub Release 资产与 SHA-256；未做独立开发者代码签名或 Apple 公证。\\n'`}
/bin/mkdir -m 700 "$stage/candidate"
# Only the already authenticated, digest-bound release is extracted. Keep the
# private outer cache and umask; restore recorded modes without foreign owners,
# ACLs, flags or extended metadata. Candidate inventory checks remain mandatory.
/usr/bin/tar -xzf "$stage/release.tar.gz" -p --no-same-owner --no-acls --no-fflags --no-mac-metadata --no-xattrs -C "$stage/candidate" || fail '已校验归档展开失败；不得执行部分内容'
node="$stage/candidate/payload/runtime/bin/node"
plain_chain "$node"
[ -f "$node" ] && [ -x "$node" ] || fail '缺少绑定 Runtime'
actual_node=$(/usr/bin/shasum -a 256 "$node")
[ "\${actual_node%% *}" = "$node_hash" ] || fail 'Runtime 不符合官方字节身份'
"$node" --input-type=module -e 'import fs from "node:fs"; const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(m.candidateHash!==process.argv[2] || ${productSignature ? 'm.signature?.status!=="verified" || m.signature?.productionDistribution!==true' : 'm.signature?.status!=="unsigned" || m.signature?.productionDistribution!==false || m.source?.kind!=="repository-local-build" || m.build?.identity!==process.argv[3]'} || m.runtime?.officialSourceVerified!==true) { console.error("错误：归档不是绑定的发行字节；未安装"); process.exit(1); }' "$stage/candidate/manifest.json" "$candidate_hash" "$source_commit" || fail '发行身份检查失败'
# The candidate then performs its own detached signature / complete inventory
# validation. Neither this script nor conversational consent can apply a plan.
${productSignature ? '' : `# This event is emitted only after live repository/tag/asset attestation,
# archive bytes, runtime bytes and manifest commit binding have passed.
# It is an observation of this invocation, NOT a receipt accepted as authority.
/usr/bin/printf '{"operation":"release-acquisition","status":"GITHUB_ACQUISITION_VERIFIED","version":"%s","repository":"%s","repositoryId":%s,"sourceCommit":"%s","asset":"%s","sha256":"%s","bytes":%s,"candidateHash":"%s","independentSignature":"unsigned","installationStatus":"not-checked","installationConfirmed":false}\\n' "$version" "$repository" "$repository_id" "$source_commit" "$asset" "$archive_hash" "$archive_bytes" "$candidate_hash"`}
if [ -n "$destination" ]; then
  exec "$stage/candidate/foundation-kit" install --destination "$destination" --browser codex
else
  exec "$stage/candidate/foundation-kit" install --browser codex
fi
`;
}
