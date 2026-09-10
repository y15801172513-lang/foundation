import fs from 'node:fs';
import path from 'node:path';

import {LifecycleError} from './install-contract.mjs';
import {readCurrentPlatformAccount} from './platform-account.mjs';
import {inspectInstallDestination} from './install-destination.mjs';

const PRODUCT_DIRECTORY = 'AI Product Foundation Kit';

function assertPlainExistingDirectory(directory, code) {
  if (!fs.existsSync(directory)) throw new LifecycleError(code, `平台路径祖先不存在：${directory}`, {stage: 'platform-path-authority'});
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(directory) !== directory) {
    throw new LifecycleError(code, `平台路径祖先必须是非符号链接的真实目录：${directory}`, {stage: 'platform-path-authority'});
  }
}

export function resolveFoundationPlatformPaths({destination = null} = {}) {
  const account = readCurrentPlatformAccount();
  if (!account || account.platform !== process.platform || !Number.isInteger(account.uid) || !Number.isInteger(account.gid) || typeof account.username !== 'string' || !account.username || account.uid !== process.getuid?.() || account.uid !== process.geteuid?.() || account.gid !== process.getgid?.() || account.gid !== process.getegid?.()) {
    throw new LifecycleError('PLATFORM_USER_HOME_UNTRUSTED', '平台 account provider 与当前有效 uid/euid/gid/egid 不一致', {stage: 'platform-path-authority', recovery: '使用当前登录账户运行，或修正仅限 .tmp/027R1 的外部测试 account fixture'});
  }
  if (typeof account.homedir !== 'string' || !path.isAbsolute(account.homedir) || path.resolve(account.homedir) !== account.homedir || account.homedir === path.parse(account.homedir).root) throw new LifecycleError('PLATFORM_USER_HOME_UNTRUSTED', '平台 account provider 的 home 不是可信绝对路径', {stage: 'platform-path-authority'});
  const home = account.homedir;
  assertPlainExistingDirectory(home, 'PLATFORM_USER_HOME_UNTRUSTED');
  const applicationSupportRoot = path.join(home, 'Library', 'Application Support');
  const cachesRoot = path.join(home, 'Library', 'Caches');
  assertPlainExistingDirectory(path.join(home, 'Library'), 'PLATFORM_LIBRARY_INVALID');
  assertPlainExistingDirectory(applicationSupportRoot, 'PLATFORM_APPLICATION_SUPPORT_INVALID');
  assertPlainExistingDirectory(cachesRoot, 'PLATFORM_CACHES_INVALID');
  const installRoot = destination || path.join(applicationSupportRoot, PRODUCT_DIRECTORY);
  let trustedRootRealPath = applicationSupportRoot;
  if (destination !== null) {
    const proposed = inspectInstallDestination(destination);
    // Requiring an existing parent keeps the authority anchor stable after install.
    trustedRootRealPath = path.dirname(proposed.realPath);
    assertPlainExistingDirectory(trustedRootRealPath, 'INSTALL_DESTINATION_PARENT_MISSING');
    if (trustedRootRealPath === path.parse(trustedRootRealPath).root) throw new LifecycleError('INSTALL_DESTINATION_INVALID', '安装位置必须位于用户可管理的目录中', {stage: 'platform-path-authority'});
  }
  const bootstrapStateRoot = path.join(cachesRoot, PRODUCT_DIRECTORY, 'bootstrap-manager');
  if (installRoot === home || bootstrapStateRoot === home || installRoot.startsWith(`${bootstrapStateRoot}${path.sep}`) || bootstrapStateRoot.startsWith(`${installRoot}${path.sep}`)) {
    throw new LifecycleError('BOOTSTRAP_PATH_OVERLAP', '安装根与 bootstrap state 路径无效或重叠', {stage: 'platform-path-authority'});
  }
  return Object.freeze({
    schemaVersion: '1.0.0',
    authority: destination === null ? 'macos-os-account-home-v2' : 'macos-account-selected-destination-v1',
    platform: process.platform,
    arch: process.arch,
    homeRealPath: home,
    accountIdentity: Object.freeze({uid: account.uid, gid: account.gid, username: account.username, authority: account.authority}),
    trustedRootRealPath,
    installRoot,
    bootstrapStateRoot,
    administratorRequired: false,
  });
}
