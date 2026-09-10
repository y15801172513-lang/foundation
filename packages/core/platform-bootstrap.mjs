import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LifecycleError} from './install-contract.mjs';
import {posixNodeStartupEnvironmentBoundary, windowsNodeStartupEnvironmentBoundary} from './node-startup-environment.mjs';
import {currentRuntimeIdentity} from './runtime-surface.mjs';

export const SUPPORT_STATUSES = Object.freeze(['verified', 'candidate-unverified', 'unsupported']);

function strategyFor(platform, arch) {
  const sea = platform === 'win32' && ['x64', 'arm64'].includes(arch) ? 'candidate'
    : platform === 'darwin' && arch === 'arm64' ? 'candidate'
      : 'unsupported';
  return {primary: 'bundled-official-node', sea, externalNode: 'diagnostic-only', externalPackageManagers: 'not-required'};
}

export function runtimeStrategy() {
  const {platform, arch} = currentRuntimeIdentity();
  return strategyFor(platform, arch);
}

export function createSupportMatrix() {
  return {
    schemaVersion: '1.0.0',
    entries: [
      {platform: 'win32', arch: 'x64', status: 'candidate-unverified', runtime: strategyFor('win32', 'x64')},
      {platform: 'win32', arch: 'arm64', status: 'candidate-unverified', runtime: strategyFor('win32', 'arm64')},
      {platform: 'darwin', arch: 'arm64', status: 'candidate-unverified', runtime: strategyFor('darwin', 'arm64')},
      {platform: 'darwin', arch: 'x64', status: 'candidate-unverified', runtime: strategyFor('darwin', 'x64')},
      {platform: 'linux', arch: '*', status: 'unsupported', runtime: strategyFor('linux', 'x64')},
    ],
    verifiedRule: '只有真实设备完整安装、更新、回退、卸载与安全验收可标记 verified',
  };
}

export function probeDiskAvailableBytes(targetRoot) {
  if (!targetRoot || !path.isAbsolute(targetRoot)) throw new LifecycleError('DISK_SPACE_UNAVAILABLE', '无法确定目标文件系统：目标路径不是绝对路径', {stage: 'preflight', retryable: true});
  let cursor = path.resolve(targetRoot);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new LifecycleError('DISK_SPACE_UNAVAILABLE', '无法找到目标文件系统的现存祖先', {stage: 'preflight', retryable: true});
    cursor = parent;
  }
  const stat = fs.lstatSync(cursor);
  if (stat.isSymbolicLink()) throw new LifecycleError('DISK_PROBE_SYMLINK_REJECTED', '磁盘预检祖先不得是符号链接', {stage: 'preflight'});
  if (!stat.isDirectory()) cursor = path.dirname(cursor);
  if (typeof fs.statfsSync !== 'function') throw new LifecycleError('DISK_SPACE_UNAVAILABLE', '当前 Node.js 无法读取文件系统可用空间', {stage: 'preflight', retryable: true});
  try {
    const fileSystem = fs.statfsSync(cursor);
    const availableBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
    if (!Number.isFinite(availableBytes) || availableBytes < 0) throw new Error('invalid-statfs-result');
    return {availableBytes, probePath: fs.realpathSync(cursor)};
  } catch (error) {
    if (error instanceof LifecycleError) throw error;
    throw new LifecycleError('DISK_SPACE_UNAVAILABLE', `无法读取目标文件系统可用空间：${error.message}`, {stage: 'preflight', retryable: true});
  }
}

export function inspectPlatform({targetRoot} = {}) {
  const {platform, arch} = currentRuntimeIdentity();
  const entry = createSupportMatrix().entries.find((item) => item.platform === platform && (item.arch === arch || item.arch === '*')) || {platform, arch, status: 'unsupported', runtime: strategyFor(platform, arch)};
  let disk = null;
  let diskProbePath = null;
  let diskProbeError = null;
  try {
    if (targetRoot) {
      const probed = probeDiskAvailableBytes(targetRoot);
      disk = probed.availableBytes;
      diskProbePath = probed.probePath;
    }
  } catch (error) { diskProbeError = error.code || 'DISK_SPACE_UNAVAILABLE'; }
  return {schemaVersion: '1.0.0', ...entry, osRelease: os.release(), diskAvailableBytes: disk, diskProbePath, diskProbeError, remoteAcquisition: 'pending', currentUserInstall: true, administratorRequired: false};
}

export function platformShim({platform, runtimePath, entrypoint}) {
  if (platform === 'win32') return `@echo off\r\nsetlocal\r\n${windowsNodeStartupEnvironmentBoundary()}\r\n"%~dp0\\..\\${runtimePath.replaceAll('/', '\\')}" "%~dp0\\..\\${entrypoint.replaceAll('/', '\\')}" %*\r\nexit /b %errorlevel%\r\n`;
  return `#!/bin/sh\nFOUNDATION_SHIM_DIR=${'${0%/*}'}\n[ "$FOUNDATION_SHIM_DIR" = "$0" ] && FOUNDATION_SHIM_DIR=.\nFOUNDATION_INSTALL_ROOT=$(CDPATH= cd -- "$FOUNDATION_SHIM_DIR/.." && pwd) || exit 1\n${posixNodeStartupEnvironmentBoundary()}exec "$FOUNDATION_INSTALL_ROOT/${runtimePath}" "$FOUNDATION_INSTALL_ROOT/${entrypoint}" "$@"\n`;
}
