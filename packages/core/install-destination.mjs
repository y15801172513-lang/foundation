import fs from 'node:fs';
import path from 'node:path';
import {LifecycleError, canonicalStringify, sha256} from './install-contract.mjs';
import {probeDiskAvailableBytes} from './platform-bootstrap.mjs';

const fail = (code, message) => { throw new LifecycleError(code, message, {stage: 'install-destination'}); };

// Read-only proposal, never an execution authority. The manager must bind this
// snapshot into its plan and revalidate it before the first transaction write.
export function inspectInstallDestination(destination, {requiredBytes = 0} = {}) {
  if (typeof destination !== 'string' || !path.isAbsolute(destination) || destination.includes('\0') || destination !== path.resolve(destination) || destination === path.parse(destination).root) fail('INSTALL_DESTINATION_INVALID', '请选择规范的绝对目录路径，不可使用磁盘根目录');
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) fail('INSTALL_SPACE_INVALID', '所需空间必须是非负安全整数');
  let cursor = path.parse(destination).root;
  const ancestors = [];
  let missing = false;
  for (const part of destination.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (missing) continue;
    let stat;
    try { stat = fs.lstatSync(cursor); }
    catch (error) { if (error.code === 'ENOENT') { missing = true; continue; } throw error; }
    if (stat.isSymbolicLink() || fs.realpathSync(cursor) !== cursor) fail('INSTALL_DESTINATION_SYMLINK', '安装路径及其祖先不得是符号链接');
    if (!stat.isDirectory()) fail('INSTALL_DESTINATION_NOT_DIRECTORY', '安装路径祖先不是目录');
    ancestors.push({path: cursor, device: String(stat.dev), inode: String(stat.ino), mode: stat.mode & 0o777});
  }
  const nearest = ancestors.at(-1)?.path;
  if (!nearest) fail('INSTALL_DESTINATION_INVALID', '安装目录必须有可验证的现存父目录');
  try { fs.accessSync(nearest, fs.constants.W_OK | fs.constants.X_OK); }
  catch { fail('INSTALL_DESTINATION_UNWRITABLE', '当前用户不能写入所选目录；请选择可写目录'); }
  const exists = nearest === destination;
  const entries = exists ? fs.readdirSync(destination).sort() : [];
  const disk = probeDiskAvailableBytes(nearest);
  if (disk.availableBytes < requiredBytes) fail('INSTALL_SPACE_INSUFFICIENT', '所选目录可用空间不足');
  const snapshot = {realPath: destination, exists, ancestors, entries};
  return Object.freeze({schemaVersion: '1.0.0', ...snapshot, snapshotHash: sha256(canonicalStringify(snapshot)), empty: entries.length === 0, requiredBytes, availableBytes: disk.availableBytes, mutationAuthority: false, mutationPerformed: false});
}

export function revalidateInstallDestination(proposal) {
  const current = inspectInstallDestination(proposal.realPath, {requiredBytes: proposal.requiredBytes});
  if (current.snapshotHash !== proposal.snapshotHash) fail('INSTALL_DESTINATION_DRIFT', '目录在预览后变化，旧计划失效；请重新检查并确认');
  return current;
}
// UI input only. Exact plans still use the canonical, revalidated real path.
export function normalizeInstallDestinationInput(input) {
  if (typeof input !== 'string') throw new Error('请输入完整的 macOS 文件夹路径');
  let value = input.trim();
  const pairs = {'"': '"', "'": "'", '“': '”', '‘': '’'};
  if (pairs[value[0]] && value.at(-1) === pairs[value[0]]) value = value.slice(1, -1).trim();
  if (/^[a-z]:/iu.test(value) || value.startsWith('\\\\') || value.startsWith('//')) throw new Error('这是 Windows 盘符或网络共享路径；当前 macOS 版本不支持。请使用本机绝对路径。');
  if (!value.startsWith('/') || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('请输入完整的 macOS 绝对路径；不会展开 ~、变量或执行命令');
  return value;
}
