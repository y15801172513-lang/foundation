import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {LifecycleError, sha256} from './install-contract.mjs';

// Pinned from https://nodejs.org/dist/v24.14.1/SHASUMS256.txt over HTTPS,
// 2026-09-08. This is NOT a claim of OpenPGP verification or Foundation signing.
export const OFFICIAL_NODE_RUNTIME_LOCK = Object.freeze({
  version: '24.14.1',
  platform: 'darwin',
  archives: Object.freeze({
    arm64: '25495ff85bd89e2d8a24d88566d7e2f827c6b0d3d872b2cebf75371f93fcb1fe',
    x64: '2526230ad7d922be82d4fdb1e7ee1e84303e133e3b4b0ec4c2897ab31de0253d',
  }),
  binaries: Object.freeze({
    arm64: '35d4bc736bbe4161f0c074aa140ddb74586e46969bc2ad63d32c838bec4463ff',
    x64: '9ab4f6249a8de4671c3205ef58621dfb19d120a9c59fd96ed206571bafb0319c',
  }),
  licenseSha256: '4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18',
});

export function readOfficialNodeRuntimeArchive(archive, {platform, arch}) {
  const expected = OFFICIAL_NODE_RUNTIME_LOCK.archives[arch];
  const fail = (code, message) => { throw new LifecycleError(code, message, {stage: 'runtime-provenance'}); };
  if (platform !== 'darwin' || !expected || process.platform !== 'darwin') fail('OFFICIAL_RUNTIME_PLATFORM_UNSUPPORTED', '官方 Runtime 归档构建当前仅支持 macOS arm64/x64');
  if (!path.isAbsolute(archive) || fs.realpathSync(archive) !== archive || !fs.lstatSync(archive).isFile() || fs.lstatSync(archive).isSymbolicLink()) fail('OFFICIAL_RUNTIME_ARCHIVE_INVALID', 'Runtime 归档必须是非符号链接的真实文件');
  if (fs.statSync(archive).size > 128 * 1024 * 1024 || sha256(fs.readFileSync(archive)) !== expected) fail('OFFICIAL_RUNTIME_ARCHIVE_HASH_MISMATCH', 'Runtime 归档不符合产品绑定的官方版本 SHA-256');
  const prefix = `node-v${OFFICIAL_NODE_RUNTIME_LOCK.version}-darwin-${arch}`;
  const readMember = (name) => {
    const child = spawnSync('/usr/bin/tar', ['-xOzf', archive, `${prefix}/${name}`], {env: {PATH: '', LANG: 'C'}, maxBuffer: 256 * 1024 * 1024, timeout: 30000});
    if (child.status !== 0 || !child.stdout?.length) fail('OFFICIAL_RUNTIME_ARCHIVE_READ_FAILED', '无法读取已验证归档内的固定 Runtime/许可成员');
    return child.stdout;
  };
  const binary = readMember('bin/node');
  const license = readMember('LICENSE');
  if (sha256(binary) !== OFFICIAL_NODE_RUNTIME_LOCK.binaries[arch] || sha256(license) !== OFFICIAL_NODE_RUNTIME_LOCK.licenseSha256) fail('OFFICIAL_RUNTIME_MEMBER_MISMATCH', 'Runtime 或许可字节不符合固定归档成员身份');
  return {binary, license, provenance: {version: OFFICIAL_NODE_RUNTIME_LOCK.version, platform, arch, url: `https://nodejs.org/dist/v${OFFICIAL_NODE_RUNTIME_LOCK.version}/${prefix}.tar.gz`, archiveSha256: expected, binarySha256: sha256(binary), licenseSha256: sha256(license), verification: 'pinned-official-https-sha256', openPgpVerified: false, foundationDistributionSigned: false}};
}
