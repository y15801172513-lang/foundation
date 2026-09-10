import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';
import {inspectInstallDestination, revalidateInstallDestination} from './install-destination.mjs';
import {deriveTrustedLifecycleAuthority, signTrustedPayload, verifyTrustedPayload} from './trusted-authority.mjs';
import {readCurrentPlatformAccount} from './platform-account.mjs';

const name = 'ai-product-foundation-kit';
function fail(code, message) { throw new LifecycleError(code, message, {stage: 'codex-skill-registration'}); }

export function codexSkillReceiptContent(registration) {
  const ownership = {schemaVersion: '1.0.0', installId: registration.installId, destination: registration.destination, files: registration.files.map(({path: relative, sha256: hash, bytes}) => ({path: relative, sha256: hash, bytes})), hostDiscoveryVerified: false};
  return `${JSON.stringify({...ownership, integrity: signTrustedPayload(ownership)}, null, 2)}\n`;
}

function writeExclusiveDurable(file, content) {
  const temporary = `${file}.${crypto.randomUUID()}.pending`;
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(descriptor, content); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  // Atomic publication: a process crash never exposes a partly written Skill
  // under its discoverable final name. EEXIST never overwrites another file.
  fs.linkSync(temporary, file);
  fs.unlinkSync(temporary);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

export function prepareCodexSkillRegistration({installationRoot, installId, manifestFile}) {
  const authority = deriveTrustedLifecycleAuthority();
  if (authority.mode !== 'platform-installed-runtime' || authority.installRoot !== installationRoot) fail('CODEX_SKILL_SOURCE_ONLY', '只能由已安装 Runtime 准备用户级 Skill 接入；源码任务不能写宿主目录');
  const account = readCurrentPlatformAccount();
  const destination = path.join(account.homedir, '.agents', 'skills', name);
  const snapshot = inspectInstallDestination(destination);
  if (!snapshot.empty) fail('CODEX_SKILL_NAME_CONFLICT', '同名 Skill 已存在；保留用户内容，不覆盖或静默合并');
  const skill = fs.readFileSync(path.join(path.dirname(manifestFile), 'SKILL.md'), 'utf8');
  const binding = `${JSON.stringify({schemaVersion: '1.0.0', installationRoot, installId, resolver: 'installed-current', authority: 'discovery-hint-only'}, null, 2)}\n`;
  const files = [{path: 'SKILL.md', content: skill}, {path: 'foundation-installation.json', content: binding}].map((entry) => ({...entry, sha256: sha256(entry.content), bytes: Buffer.byteLength(entry.content)}));
  const directories = [];
  let cursor = snapshot.ancestors.at(-1).path;
  for (const part of path.relative(cursor, destination).split(path.sep).filter(Boolean)) { cursor = path.join(cursor, part); directories.push(cursor); }
  return {schemaVersion: '1.0.0', host: 'codex', name, scope: 'user', destination, installationRoot, installId, snapshot, directories, files, registeredWithHost: 'unverified-until-new-task', mutationAuthority: false};
}

export function verifyCodexSkillRegistration(registration) {
  const authority = deriveTrustedLifecycleAuthority();
  if (authority.mode !== 'platform-installed-runtime' || authority.installRoot !== registration.installationRoot) fail('CODEX_SKILL_SOURCE_ONLY', '用户级 Skill 写入不属于当前 installed authority');
  const account = readCurrentPlatformAccount();
  if (registration.destination !== path.join(account.homedir, '.agents', 'skills', name) || registration.name !== name) fail('CODEX_SKILL_DESTINATION_CHANGED', 'Skill 目标与当前 OS account 不一致');
  if (registration.snapshot.realPath !== registration.destination) fail('CODEX_SKILL_PLAN_INVALID', 'Skill 快照与目标目录不一致');
  revalidateInstallDestination(registration.snapshot);
  if (!registration.snapshot.empty || registration.files.length !== 2 || registration.files.map((entry) => entry.path).join('|') !== 'SKILL.md|foundation-installation.json' || registration.files.some((entry) => sha256(entry.content) !== entry.sha256 || Buffer.byteLength(entry.content) !== entry.bytes)) fail('CODEX_SKILL_PLAN_INVALID', 'Skill 精确文件计划无效');
}

// Internal dispatcher only. The caller must have consumed the capability
// manager confirmation and persisted its intent before invoking this function.
export function applyCodexSkillRegistration(registration) {
  verifyCodexSkillRegistration(registration);
  const receiptFile = path.join(registration.installationRoot, 'state', 'codex-skill-registration.json');
  if (fs.existsSync(receiptFile)) fail('CODEX_SKILL_RECEIPT_EXISTS', '既有 Skill 归属记录需要单独核对；不覆盖');
  const createdDirectories = [];
  const createdFiles = [];
  try {
    let cursor = registration.snapshot.ancestors.at(-1).path;
    const remaining = path.relative(cursor, registration.destination);
    for (const part of remaining ? remaining.split(path.sep) : []) {
      if (fs.realpathSync(cursor) !== cursor || fs.lstatSync(cursor).isSymbolicLink()) fail('CODEX_SKILL_DESTINATION_CHANGED', 'Skill 父目录在写入前变化');
      cursor = path.join(cursor, part);
      fs.mkdirSync(cursor, {mode: 0o700});
      createdDirectories.push(cursor);
    }
    for (const entry of registration.files) {
      if (fs.realpathSync(registration.destination) !== registration.destination || fs.lstatSync(registration.destination).isSymbolicLink()) fail('CODEX_SKILL_DESTINATION_CHANGED', 'Skill 目录在写入前变化');
      const file = path.join(registration.destination, entry.path);
      writeExclusiveDurable(file, entry.content);
      createdFiles.push({file, hash: entry.sha256});
    }
    if (fs.realpathSync(path.dirname(receiptFile)) !== path.dirname(receiptFile)) fail('CODEX_SKILL_RECEIPT_INVALID', '归属记录目录在写入前变化');
    writeExclusiveDurable(receiptFile, codexSkillReceiptContent(registration));
    return {filesInstalled: true, hostDiscoveryVerified: false, scope: 'user', destination: registration.destination, next: '新任务查看 Skill 列表并调用；未出现时按宿主文档刷新/重启'};
  } catch (error) {
    for (const entry of createdFiles.reverse()) {
      if (fs.existsSync(entry.file) && fs.realpathSync(entry.file) === entry.file && !fs.lstatSync(entry.file).isSymbolicLink() && sha256(fs.readFileSync(entry.file)) === entry.hash) fs.unlinkSync(entry.file);
    }
    for (const directory of createdDirectories.reverse()) {
      if (fs.existsSync(directory) && fs.realpathSync(directory) === directory && !fs.lstatSync(directory).isSymbolicLink() && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
    }
    throw error;
  }
}

export function inspectCodexSkillOwnership(installationRoot) {
  const file = path.join(installationRoot, 'state', 'codex-skill-registration.json');
  if (!fs.existsSync(file)) return {state: 'not-connected', hostDiscoveryVerified: false, mutationPerformed: false};
  if (fs.lstatSync(file).isSymbolicLink() || fs.realpathSync(file) !== file) fail('CODEX_SKILL_RECEIPT_INVALID', 'Skill 归属记录路径不安全');
  const {integrity, ...record} = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!verifyTrustedPayload(record, integrity)) fail('CODEX_SKILL_RECEIPT_INVALID', 'Skill 归属签名无效');
  if (record.destination !== path.join(readCurrentPlatformAccount().homedir, '.agents', 'skills', name) || !Array.isArray(record.files) || record.files.length !== 2 || record.files.map((entry) => entry.path).join('|') !== 'SKILL.md|foundation-installation.json') fail('CODEX_SKILL_RECEIPT_INVALID', 'Skill 归属记录目标或文件清单无效');
  const snapshot = inspectInstallDestination(record.destination);
  const intact = snapshot.exists && record.files.every((entry) => {
    if (!['SKILL.md', 'foundation-installation.json'].includes(entry.path)) return false;
    const target = path.join(record.destination, entry.path);
    return fs.existsSync(target) && !fs.lstatSync(target).isSymbolicLink() && fs.lstatSync(target).isFile() && sha256(fs.readFileSync(target)) === entry.sha256;
  });
  return {state: intact ? 'files-installed-host-discovery-unverified' : 'modified-or-missing-preserve', destination: record.destination, ownershipHash: sha256(canonicalStringify(record)), hostDiscoveryVerified: false, mutationPerformed: false};
}

export function prepareCodexSkillRemoval({installationRoot, installId}) {
  const authority = deriveTrustedLifecycleAuthority();
  if (authority.mode !== 'platform-installed-runtime' || authority.installRoot !== installationRoot) fail('CODEX_SKILL_SOURCE_ONLY', '只能由已安装 Runtime 准备用户级 Skill 停用');
  const status = inspectCodexSkillOwnership(installationRoot);
  if (status.state === 'not-connected') return null;
  const receiptFile = path.join(installationRoot, 'state', 'codex-skill-registration.json');
  const record = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (record.installId !== installId) fail('CODEX_SKILL_RECEIPT_INVALID', 'Skill 不属于当前 installation identity');
  const snapshot = inspectInstallDestination(record.destination);
  const files = record.files.filter((entry) => {
    const file = path.join(record.destination, entry.path);
    return fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink() && fs.lstatSync(file).isFile() && sha256(fs.readFileSync(file)) === entry.sha256;
  });
  return {installationRoot, installId, destination: record.destination, snapshot, files, receiptSha256: sha256(fs.readFileSync(receiptFile)), preserves: '未知、缺失或用户修改文件不删除；目录保留'};
}

export function verifyCodexSkillRemoval(removal) {
  const current = prepareCodexSkillRemoval(removal);
  const binding = (value) => value && ({...value, snapshot: value.snapshot.snapshotHash});
  if (canonicalStringify(binding(current)) !== canonicalStringify(binding(removal))) fail('CODEX_SKILL_REMOVAL_DRIFT', 'Skill 删除范围在确认后变化；请重新预览');
}

// Same internal, consumed exact-manager-confirmation boundary as registration.
export function applyCodexSkillRemoval(removal) {
  verifyCodexSkillRemoval(removal);
  for (const entry of removal.files) {
    const target = path.join(removal.destination, entry.path);
    if (fs.realpathSync(target) !== target || !fs.lstatSync(target).isFile() || sha256(fs.readFileSync(target)) !== entry.sha256) fail('CODEX_SKILL_REMOVAL_DRIFT', 'Skill 文件在删除前变化；保留文件');
    fs.unlinkSync(target);
  }
  const receipt = path.join(removal.installationRoot, 'state', 'codex-skill-registration.json');
  if (fs.realpathSync(receipt) !== receipt || sha256(fs.readFileSync(receipt)) !== removal.receiptSha256) fail('CODEX_SKILL_REMOVAL_DRIFT', 'Skill 归属记录在删除前变化');
  fs.unlinkSync(receipt);
  return {disconnected: true, removed: removal.files.map((entry) => entry.path), userChangesPreserved: true, hostRefreshRequired: true};
}
