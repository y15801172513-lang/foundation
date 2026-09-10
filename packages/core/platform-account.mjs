import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function untrusted(message, details = {}) {
  const error = new Error(message);
  error.name = 'LifecycleError';
  error.code = 'PLATFORM_USER_HOME_UNTRUSTED';
  error.stage = 'platform-path-authority';
  error.retryable = false;
  error.recovery = '使用当前登录的标准 macOS 账户运行；不要通过 HOME、USER、LOGNAME、cwd、CLI 或 AI 输入选择安装路径';
  error.details = details;
  error.toJSON = () => ({schemaVersion: '1.0.0', code: error.code, stage: error.stage, retryable: error.retryable, message: error.message, recovery: error.recovery, details: error.details});
  return error;
}

export function readCurrentPlatformAccount() {
  if (process.platform !== 'darwin') {
    const error = untrusted(`首次安装 bootstrap 当前仅支持 macOS，当前为 ${process.platform}`);
    error.code = 'BOOTSTRAP_PLATFORM_UNSUPPORTED';
    throw error;
  }
  if (typeof process.getuid !== 'function' || typeof process.geteuid !== 'function' || typeof process.getgid !== 'function' || typeof process.getegid !== 'function') {
    throw untrusted('当前平台无法提供一致的 uid/euid 用户身份');
  }
  let account;
  try { account = os.userInfo({encoding: 'utf8'}); }
  catch (error) { throw untrusted('无法从 OS account record 读取当前用户身份', {cause: error?.code || error?.message || 'unknown'}); }
  const uid = process.getuid();
  const euid = process.geteuid();
  const gid = process.getgid();
  const egid = process.getegid();
  if (!account || !Number.isInteger(account.uid) || !Number.isInteger(account.gid) || account.uid !== uid || account.uid !== euid || account.gid !== gid || account.gid !== egid) {
    throw untrusted('OS account record 与当前进程 uid/euid/gid/egid 不一致', {accountUid: account?.uid ?? null, uid, euid, accountGid: account?.gid ?? null, gid, egid});
  }
  if (typeof account.username !== 'string' || !account.username || typeof account.homedir !== 'string' || !path.isAbsolute(account.homedir) || path.resolve(account.homedir) !== account.homedir || account.homedir === path.parse(account.homedir).root) {
    throw untrusted('OS account record 未提供可信的绝对 home 路径');
  }
  try {
    const stat = fs.lstatSync(account.homedir);
    if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(account.homedir) !== account.homedir) throw untrusted('OS account home 必须是非符号链接的真实目录', {homedir: account.homedir});
  } catch (error) {
    if (error?.code === 'PLATFORM_USER_HOME_UNTRUSTED') throw error;
    throw untrusted('OS account home 不存在或无法验证', {homedir: account.homedir, cause: error?.code || error?.message || 'unknown'});
  }
  return Object.freeze({schemaVersion: '1.0.0', authority: 'os-user-info-effective-identity-v1', platform: process.platform, uid, gid, username: account.username, homedir: account.homedir});
}
