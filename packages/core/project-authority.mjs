import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';
import {PROJECT_LAYOUT_PATHS, PROJECT_LAYOUT_VERSION, inspectProjectLayout, snapshotProtectedProjectData} from './project-layout.mjs';
import {inventoryExistingProject} from './governance.mjs';
import {foundationUiPolicyRecord} from './ui-policy.mjs';
import {
  authorizationEffectForProjectPlan,
  authorizationEffectForProjectMutationPlan,
  authorizationEffectForProjectMutationRecoveryPlan,
  authorizationEffectForProjectRecoveryPlan,
  consumeExactManagerConfirmationAtBoundary,
  failExactManagerConfirmationAtBoundary,
  publicManagerConfirmationEvidence,
  reserveExactManagerConfirmationAtBoundary,
} from './human-authorization.mjs';
import {classifyProcessOwner, observeProcessFingerprint} from './process-owner.mjs';
import {operationCheckpoint} from './runtime-surface.mjs';
import {
  assertClosedHandlerBinding,
  deriveClosedHandlerBinding,
  executeClosedProjectHandler,
  restoreClosedHandlerWrites,
  snapshotClosedHandlerWrites,
} from './project-mutation-handlers.mjs';
import {
  acquireTrustedTargetGuard,
  completeTrustedPreIntentRecovery,
  inspectTrustedPreIntents,
  releaseTrustedTargetGuard,
  updateTrustedPreIntent,
  verifyTrustedPreIntentScope,
  writeTrustedPreIntent,
} from './trusted-intent-ledger.mjs';
import {
  deriveTrustedLifecycleAuthority,
  signTrustedPayload,
  snapshotTrustedTarget,
  verifyTrustedPayload,
} from './trusted-authority.mjs';

export const PROJECT_AUTHORITY_STATES = Object.freeze(['unmanaged', 'inventory-only', 'enabled', 'disabled']);
export const PROJECT_BINDING_VERSION = PROJECT_LAYOUT_VERSION;
const PORTABLE_RELATIVE = `${PROJECT_LAYOUT_PATHS.integration}/binding.json`;
const IDENTITY_RELATIVE = PROJECT_LAYOUT_PATHS.identity;
const OWNERSHIP_RELATIVE = PROJECT_LAYOUT_PATHS.ownership;

function fsyncDirectory(directory) {
  let descriptor;
  try { descriptor = fs.openSync(directory, 'r'); fs.fsyncSync(descriptor); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function writeJsonAtomic(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', mode);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function signedPayload(document, code, label) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new LifecycleError(code, `${label} 不存在或无效`, {stage: 'project-authority'});
  const {integrity, ...payload} = document;
  if (!verifyTrustedPayload(payload, integrity)) throw new LifecycleError(code, `${label} HMAC 完整性验证失败`, {stage: 'project-authority'});
  return payload;
}

function canonicalPath(value) {
  return path.resolve(value).normalize('NFC').replaceAll('\\', '/').toLocaleLowerCase('en-US');
}

function overlaps(left, right) {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function projectIdentity(project) {
  const stat = fs.statSync(project);
  return {device: String(stat.dev), inode: String(stat.ino), kind: stat.isDirectory() ? 'directory' : 'other'};
}

function hashTree(root) {
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
      if (entry.isSymbolicLink()) throw new LifecycleError('PROJECT_TEMPLATE_SYMLINK_REJECTED', 'packaged template 不得包含符号链接', {stage: 'project-authority'});
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) records.push({path: relative, size: fs.statSync(absolute).size, sha256: sha256(fs.readFileSync(absolute))});
      else throw new LifecycleError('PROJECT_TEMPLATE_TYPE_REJECTED', 'packaged template 只能包含普通文件和目录', {stage: 'project-authority'});
    }
  };
  visit(root);
  return sha256(canonicalStringify(records));
}

function installedTemplate(context) {
  const template = path.join(context.root, ...context.current.appPath.split('/'), 'templates', 'foundation-project');
  if (!fs.existsSync(template) || fs.lstatSync(template).isSymbolicLink() || !fs.statSync(template).isDirectory() || fs.realpathSync(template) !== template) throw new LifecycleError('INSTALLED_PROJECT_TEMPLATE_INVALID', '当前 installed candidate 缺少真实 packaged templates/foundation-project', {stage: 'project-authority'});
  return {path: template, hash: hashTree(template)};
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.device === right.device && left.inode === right.inode && left.kind === right.kind);
}

function projectPath(project, {mayNotExist = false} = {}) {
  if (typeof project !== 'string' || !path.isAbsolute(project)) throw new LifecycleError('PROJECT_PATH_NOT_ABSOLUTE', '项目必须使用明确的绝对路径', {stage: 'project-authority'});
  const resolved = path.resolve(project);
  let cursor = resolved;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (!fs.existsSync(cursor) || fs.lstatSync(cursor).isSymbolicLink() || fs.realpathSync(cursor) !== cursor) throw new LifecycleError('PROJECT_REALPATH_UNSTABLE', '项目路径或其已存在祖先包含符号链接/非真实路径', {stage: 'project-authority'});
  if (!mayNotExist && !fs.existsSync(resolved)) throw new LifecycleError('PROJECT_NOT_FOUND', '项目目录不存在', {stage: 'project-authority'});
  if (fs.existsSync(resolved)) {
    if (fs.lstatSync(resolved).isSymbolicLink() || fs.realpathSync(resolved) !== resolved || !fs.statSync(resolved).isDirectory()) throw new LifecycleError('PROJECT_REALPATH_UNSTABLE', '项目必须是无符号链接的真实目录', {stage: 'project-authority'});
  }
  return resolved;
}

function sourceRole(project) {
  const authority = deriveTrustedLifecycleAuthority();
  const source = authority.repositoryRealPath;
  if (canonicalPath(project) === canonicalPath(source)) return {role: 'foundation-source', root: source};
  if (fs.existsSync(path.join(project, 'manifest.json')) && fs.existsSync(path.join(project, 'payload'))) return {role: 'candidate-output', root: project};
  const roles = [
    ['packaged-template', path.join(source, 'templates')],
    ['development-fixture', path.join(source, 'examples')],
    ['candidate-output', path.join(source, '.tmp', 'candidates')],
    ['candidate-build', path.join(source, '.tmp', 'candidate-build')],
    ['lifecycle-authority', path.join(source, '.tmp', '.foundation-lifecycle-authority')],
    ['cache', path.join(source, '.tmp', 'npm-cache')],
  ];
  for (const [role, root] of roles) if (canonicalPath(project) === canonicalPath(root) || canonicalPath(project).startsWith(`${canonicalPath(root)}/`)) return {role, root};
  const temporary = path.join(source, '.tmp');
  if (canonicalPath(project) === canonicalPath(temporary) || canonicalPath(project).startsWith(`${canonicalPath(temporary)}/`)) return {role: 'repository-temporary', root: temporary};
  return {role: 'user-project-candidate', root: project};
}

function assertEligibleProject(project, installationRoot, options = {}) {
  const target = projectPath(project, options);
  const role = sourceRole(target);
  if (role.role !== 'user-project-candidate') throw new LifecycleError('PROJECT_ROLE_REJECTED', `Foundation 内部角色不能作为用户项目启用：${role.role}`, {stage: 'project-authority', details: {project: target, role: role.role}});
  if (installationRoot && overlaps(target, installationRoot)) throw new LifecycleError('PROJECT_INSTALLATION_OVERLAP', '用户项目不得与 Foundation 安装根互为祖先或后代', {stage: 'project-authority', details: {project: target, installationRoot}});
  return target;
}

function installationContext(installationRoot) {
  if (typeof installationRoot !== 'string' || !path.isAbsolute(installationRoot)) throw new LifecycleError('INSTALLATION_ROOT_REQUIRED', '项目权限操作必须绑定明确的 Foundation 安装根绝对路径', {stage: 'project-authority'});
  const authority = deriveTrustedLifecycleAuthority();
  const root = path.resolve(installationRoot);
  snapshotTrustedTarget(root, authority);
  const currentFile = path.join(root, 'state', 'current.json');
  if (!fs.existsSync(currentFile)) throw new LifecycleError('FOUNDATION_NOT_INSTALLED', '指定安装根没有有效的 Foundation current identity', {stage: 'project-authority'});
  const document = readJson(currentFile);
  const current = signedPayload(document, 'CURRENT_IDENTITY_INVALID', 'current pointer');
  return {authority, root, current, currentIntegrityHash: document.integrity.hash};
}

function emptyRegistry(installId) {
  return {schemaVersion: '1.0.0', bindingVersion: PROJECT_BINDING_VERSION, installId, projects: {}};
}

function registryContext(context) {
  const file = path.join(context.root, 'state', 'projects.json');
  if (!fs.existsSync(file)) return {file, document: null, payload: emptyRegistry(context.current.identity.installId), fileHash: null};
  const document = readJson(file);
  const payload = signedPayload(document, 'PROJECT_REGISTRY_INVALID', 'project registry');
  if (payload.schemaVersion !== '1.0.0' || payload.bindingVersion !== PROJECT_BINDING_VERSION || payload.installId !== context.current.identity.installId || !payload.projects || Array.isArray(payload.projects)) throw new LifecycleError('PROJECT_REGISTRY_INVALID', 'project registry schema/install identity 无效', {stage: 'project-authority'});
  return {file, document, payload, fileHash: sha256(fs.readFileSync(file))};
}

function portableContext(project) {
  const file = path.join(project, ...PORTABLE_RELATIVE.split('/'));
  if (!fs.existsSync(file)) return {file, value: null, hash: null};
  if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new LifecycleError('PROJECT_BINDING_INVALID', 'portable project binding 不是普通文件', {stage: 'project-authority'});
  const value = readJson(file);
  if (value?.schemaVersion !== '1.0.0' || value?.layoutVersion !== PROJECT_LAYOUT_VERSION || value?.bindingVersion !== PROJECT_BINDING_VERSION || typeof value?.projectId !== 'string' || value?.identity?.scheme !== 'foundation-project-id-v2' || value?.identity?.value !== value.projectId || !['enabled', 'disabled'].includes(value?.state) || 'projectPath' in value || 'absolutePath' in value) throw new LifecycleError('PROJECT_BINDING_INVALID', 'portable project binding schema、stable identity 或可移植性无效', {stage: 'project-authority'});
  return {file, value, hash: sha256(fs.readFileSync(file))};
}

function recordMatches(record, project, portable) {
  return Boolean(record && portable?.value && record.projectId === portable.value.projectId
    && record.bindingVersion === portable.value.bindingVersion
    && record.portableBindingHash === portable.hash
    && record.realPath === project
    && record.canonicalPath === canonicalPath(project)
    && sameIdentity(record.projectIdentity, projectIdentity(project)));
}

export function inspectProjectAuthority(project, {installationRoot = null} = {}) {
  let target;
  try { target = projectPath(project); }
  catch (error) { return {schemaVersion: '1.0.0', state: 'unmanaged', project: typeof project === 'string' ? project : null, role: 'invalid-project', reason: 'project-authority-invalid', authorityError: error?.code || 'PROJECT_PATH_INVALID', agreement: false, mutationPerformed: false}; }
  const role = sourceRole(target);
  if (role.role !== 'user-project-candidate') return {schemaVersion: '1.0.0', state: 'unmanaged', project: target, role: role.role, reason: 'foundation-internal-role', agreement: false, mutationPerformed: false};
  let portable;
  try { portable = portableContext(target); }
  catch (error) { return {schemaVersion: '1.0.0', state: 'unmanaged', project: target, role: role.role, reason: 'portable-binding-invalid', authorityError: error?.code || 'PROJECT_BINDING_INVALID', agreement: false, mutationPerformed: false}; }
  if (!installationRoot) return {schemaVersion: '1.0.0', state: portable.value?.state === 'disabled' ? 'disabled' : 'unmanaged', project: target, role: role.role, reason: 'installation-root-not-bound', agreement: false, mutationPerformed: false};
  let context;
  try { context = installationContext(installationRoot); }
  catch (error) { return {schemaVersion: '1.0.0', state: 'unmanaged', project: target, role: role.role, projectId: portable.value?.projectId || null, reason: 'installation-authority-invalid', authorityError: error?.code || 'FOUNDATION_NOT_INSTALLED', agreement: false, mutationPerformed: false}; }
  if (overlaps(target, context.root)) return {schemaVersion: '1.0.0', state: 'unmanaged', project: target, role: 'installation-overlap', reason: 'project-installation-overlap', agreement: false, mutationPerformed: false};
  let registry;
  try { registry = registryContext(context); }
  catch (error) { return {schemaVersion: '1.0.0', state: 'unmanaged', project: target, role: role.role, projectId: portable.value?.projectId || null, reason: 'machine-registry-invalid', authorityError: error?.code || 'PROJECT_REGISTRY_INVALID', agreement: false, mutationPerformed: false}; }
  const record = portable.value ? registry.payload.projects[portable.value.projectId] : null;
  if (portable.value?.state === 'disabled') return {schemaVersion: '1.0.0', state: 'disabled', project: target, role: role.role, projectId: portable.value.projectId, reason: recordMatches(record, target, portable) && record.state === 'disabled' ? 'project-disabled' : 'portable-and-machine-authority-disagree', agreement: recordMatches(record, target, portable) && record.state === 'disabled', mutationPerformed: false};
  if (portable.value?.state === 'enabled' && record?.state === 'enabled' && recordMatches(record, target, portable)) {
    const authorityIdentity = sha256(canonicalStringify({currentInstallId: context.current.identity.installId, currentIdentity: context.current.identity, currentIntegrityHash: context.currentIntegrityHash, project: target, canonicalPath: canonicalPath(target), projectIdentity: projectIdentity(target), portableBinding: portable.value, portableBindingHash: portable.hash, machineRecord: record, registryFileHash: registry.fileHash}));
    return {schemaVersion: '1.0.0', state: 'enabled', project: target, role: role.role, projectId: portable.value.projectId, bindingVersion: portable.value.bindingVersion, installationRoot: context.root, agreement: true, authorityIdentity, mutationPerformed: false};
  }
  return {schemaVersion: '1.0.0', state: 'unmanaged', project: target, role: role.role, projectId: portable.value?.projectId || null, reason: portable.value ? 'portable-and-machine-authority-disagree' : 'no-portable-binding', agreement: false, mutationPerformed: false};
}

export function inventoryProject(project) {
  const target = projectPath(project);
  const before = sourceRole(target);
  return {...inventoryExistingProject(target), authorityState: 'inventory-only', role: before.role, writesPerformed: false};
}

function planIntegrity(seed) {
  const planId = `project-plan-${sha256(canonicalStringify(seed)).slice(0, 24)}`;
  const unsigned = {...seed, planId};
  const hash = sha256(canonicalStringify(unsigned));
  return {...unsigned, integrity: {algorithm: 'sha256', hash}};
}

function validateProjectPlan(plan, now = Date.now()) {
  if (!plan || plan.schemaVersion !== '1.0.0' || plan.bindingVersion !== PROJECT_BINDING_VERSION || !['enable', 'disable'].includes(plan.operation) || typeof plan.projectId !== 'string' || !plan.projectId || !Array.isArray(plan.changes) || !Array.isArray(plan.preserves)) throw new LifecycleError('PROJECT_PLAN_INVALID', '项目权限 plan schema 不受支持', {stage: 'project-plan'});
  const {integrity, ...unsigned} = plan || {};
  const expected = sha256(canonicalStringify(unsigned));
  if (!integrity || integrity.algorithm !== 'sha256' || integrity.hash !== expected) throw new LifecycleError('PROJECT_PLAN_TAMPERED', '项目权限 plan 或完整性哈希已被改写', {stage: 'project-plan'});
  if (now > plan.expiresAt) throw new LifecycleError('PROJECT_PLAN_EXPIRED', '项目权限 plan 已过期，请重新生成', {stage: 'project-plan', retryable: true});
}

export function createProjectAuthorityPlan({operation, project, installationRoot, createFromTemplate = false, rebind = false, now = Date.now(), ttlMs = 15 * 60 * 1000}) {
  if (!['enable', 'disable'].includes(operation)) throw new LifecycleError('PROJECT_OPERATION_INVALID', '项目权限只支持 enable 或 disable', {stage: 'project-plan'});
  if (createFromTemplate && operation !== 'enable') throw new LifecycleError('PROJECT_CREATE_OPERATION_INVALID', 'create 只能生成 enable plan', {stage: 'project-plan'});
  const context = installationContext(installationRoot);
  const target = assertEligibleProject(project, context.root, {mayNotExist: createFromTemplate});
  if (createFromTemplate && fs.existsSync(target) && fs.readdirSync(target).length) throw new LifecycleError('PROJECT_CREATE_TARGET_NOT_EMPTY', 'create 目标必须不存在或为空', {stage: 'project-plan'});
  const existingLayout = fs.existsSync(target) ? inspectProjectLayout(target) : null;
  if (existingLayout?.state === 'legacy' && existingLayout.legacy.present.length) throw new LifecycleError('PROJECT_LAYOUT_MIGRATION_REQUIRED', '检测到 legacy .foundation；必须先在本地管理器中单独迁移，enable 不会静默改名、移动或删除旧内容', {stage: 'project-plan', details: {project: target, state: existingLayout.state, legacy: existingLayout.legacy.present, ownershipSchemaVersion: existingLayout.ownership?.schemaVersion || null, ownershipIntegrity: existingLayout.ownership?.integrity?.hash || null}});
  const portable = fs.existsSync(target) ? portableContext(target) : {file: path.join(target, ...PORTABLE_RELATIVE.split('/')), value: null, hash: null};
  const registry = registryContext(context);
  for (const record of Object.values(registry.payload.projects)) {
    if (typeof record?.realPath === 'string' && canonicalPath(record.realPath) === canonicalPath(target) && record.realPath !== target) {
      throw new LifecycleError('PROJECT_PATH_NORMALIZATION_COLLISION', '项目路径与已注册路径存在 case/Unicode 规范化碰撞，拒绝别名或静默重绑', {stage: 'project-plan', details: {project: target, registeredPath: record.realPath}});
    }
  }
  const status = fs.existsSync(target) ? inspectProjectAuthority(target, {installationRoot: context.root}) : {state: 'unmanaged'};
  if (operation === 'disable' && status.state !== 'enabled') throw new LifecycleError('PROJECT_NOT_ENABLED', '只有 portable binding 与本机 registration 一致的 enabled 项目才能 disable', {stage: 'project-plan'});
  if (operation === 'enable' && portable.value?.state === 'enabled') {
    const existing = registry.payload.projects[portable.value.projectId];
    if (existing && canonicalPath(existing.realPath) !== canonicalPath(target) && !rebind) throw new LifecycleError('PROJECT_MOVE_REQUIRES_EXPLICIT_REBIND', '检测到项目移动/复制；必须显式 rebind 后重新启用', {stage: 'project-plan'});
  }
  const existingIdentity = fs.existsSync(target) && fs.existsSync(path.join(target, ...IDENTITY_RELATIVE.split('/'))) ? readJson(path.join(target, ...IDENTITY_RELATIVE.split('/'))) : null;
  const projectId = operation === 'disable' ? status.projectId : (portable.value?.projectId || existingIdentity?.projectId || `project-${crypto.randomUUID()}`);
  const template = createFromTemplate ? installedTemplate(context) : null;
  const changes = operation === 'enable'
    ? [...(createFromTemplate ? ['create-project-from-packaged-template'] : []), 'write-project-identity-if-absent', 'create-foundation-facts-if-absent', 'write-owned-integration-binding', 'write-project-ownership-manifest', 'write-signed-machine-registration', 'enable-foundation-management']
    : ['mark-machine-registration-disabled', 'mark-portable-project-binding-disabled', 'stop-foundation-management'];
  const seed = {
    schemaVersion: '1.0.0', bindingVersion: PROJECT_BINDING_VERSION, operation, project: target, installationRoot: context.root, installId: context.current.identity.installId, projectId,
    createFromTemplate, rebind, createdAt: now, expiresAt: now + ttlMs,
    projectSnapshot: {exists: fs.existsSync(target), identity: fs.existsSync(target) ? projectIdentity(target) : null, protected: fs.existsSync(target) ? snapshotProtectedProjectData(target) : null},
    templateSnapshot: template ? {path: template.path, hash: template.hash} : null,
    portableBeforeHash: portable.hash, registryBeforeHash: registry.fileHash, currentIntegrityHash: context.currentIntegrityHash,
    changes,
    creates: operation === 'enable' ? [IDENTITY_RELATIVE, `${PROJECT_LAYOUT_PATHS.integration}/binding.json`, PROJECT_LAYOUT_PATHS.generatedCache, OWNERSHIP_RELATIVE] : [],
    replacements: operation === 'disable' ? [`${PROJECT_LAYOUT_PATHS.integration}/binding.json`, OWNERSHIP_RELATIVE] : [],
    deletes: [],
    preserves: ['project-files', IDENTITY_RELATIVE, PROJECT_LAYOUT_PATHS.facts, '.foundation/backups', 'unknown-and-user-modified-files', 'source-code', 'user-data', 'foundation-installation'],
    fileCount: fs.existsSync(target) ? snapshotProtectedProjectData(target).fileCount : 0,
    byteCount: fs.existsSync(target) ? snapshotProtectedProjectData(target).byteCount : 0,
    protectedDataHashes: fs.existsSync(target) ? snapshotProtectedProjectData(target).hashes : {},
    expectedBeforeState: {project: fs.existsSync(target) ? snapshotProtectedProjectData(target) : null, registryHash: registry.fileHash, currentIntegrityHash: context.currentIntegrityHash},
    semantics: operation === 'disable' ? '停止 Foundation 对该项目的管理；不删除项目资料，不卸载 Foundation；保留 disabled integration binding、项目 identity、facts、backups、未知文件和项目代码' : '启用 Foundation 对该项目的显式管理',
  };
  return planIntegrity(seed);
}

function assertPlanSnapshots(plan, context, registry) {
  if (context.currentIntegrityHash !== plan.currentIntegrityHash) throw new LifecycleError('PROJECT_INSTALLATION_CHANGED', 'plan 后 Foundation installation identity 已变化', {stage: 'project-apply'});
  if (registry.fileHash !== plan.registryBeforeHash) throw new LifecycleError('PROJECT_REGISTRY_CHANGED', 'plan 后 project registry 已变化', {stage: 'project-apply'});
  const exists = fs.existsSync(plan.project);
  if (exists !== plan.projectSnapshot.exists) throw new LifecycleError('PROJECT_REPLACED_AFTER_PLAN', 'plan 后项目存在状态已变化', {stage: 'project-apply'});
  if (exists && !sameIdentity(projectIdentity(plan.project), plan.projectSnapshot.identity)) throw new LifecycleError('PROJECT_REPLACED_AFTER_PLAN', 'plan 后项目目录已移动或替换', {stage: 'project-apply'});
  if (exists && plan.projectSnapshot.protected && canonicalStringify(snapshotProtectedProjectData(plan.project)) !== canonicalStringify(plan.projectSnapshot.protected)) throw new LifecycleError('MANAGER_PLAN_STATE_DRIFT', 'plan 后项目完整内容或受保护数据已变化', {stage: 'project-apply'});
  const portable = exists ? portableContext(plan.project) : {hash: null};
  if (portable.hash !== plan.portableBeforeHash) throw new LifecycleError('PROJECT_BINDING_CHANGED', 'plan 后 portable binding 已变化', {stage: 'project-apply'});
}

function fileSnapshot(file) {
  if (!fs.existsSync(file)) return {exists: false};
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new LifecycleError('PROJECT_TRANSACTION_FILE_INVALID', `project authority transaction 拒绝非普通文件：${file}`, {stage: 'project-apply'});
  const bytes = fs.readFileSync(file);
  return {exists: true, mode: stat.mode & 0o777, hash: sha256(bytes), contentBase64: bytes.toString('base64')};
}

function restoreFileSnapshot(file, snapshot) {
  if (!snapshot?.exists) {
    if (fs.existsSync(file)) {
      if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new LifecycleError('PROJECT_TRANSACTION_RECOVERY_MANUAL', `恢复拒绝删除非普通文件：${file}`, {stage: 'project-recovery'});
      fs.rmSync(file);
      fsyncDirectory(path.dirname(file));
    }
    return;
  }
  writeJsonAtomic(file, JSON.parse(Buffer.from(snapshot.contentBase64, 'base64').toString('utf8')), snapshot.mode);
}

function restoreCreatedProjectSnapshot(project, before) {
  if (!before?.createFromTemplate) return;
  if (!fs.existsSync(project)) return;
  if (fs.lstatSync(project).isSymbolicLink() || !fs.statSync(project).isDirectory()) throw new LifecycleError('PROJECT_TRANSACTION_RECOVERY_MANUAL', 'create rollback 拒绝处理被替换或符号链接化的项目目标', {stage: 'project-recovery'});
  if (before.createdProjectIdentity && !sameIdentity(projectIdentity(project), before.createdProjectIdentity)) throw new LifecycleError('PROJECT_TRANSACTION_RECOVERY_MANUAL', 'create rollback 检测到项目目标 identity 已变化', {stage: 'project-recovery'});
  if (!before.projectExisted) {
    fs.rmSync(project, {recursive: true});
    fsyncDirectory(path.dirname(project));
    return;
  }
  for (const name of fs.readdirSync(project)) fs.rmSync(path.join(project, name), {recursive: true});
  fsyncDirectory(project);
}

function projectTransactionPaths(context) {
  const state = path.join(context.root, 'state');
  return {guard: path.join(state, '.project-authority.guard'), journals: path.join(state, 'project-authority-journals')};
}

function projectOwner(operationId, authorization, targetProject) {
  const observed = observeProcessFingerprint(process.pid);
  if (observed.state !== 'observed') throw new LifecycleError('PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', '无法取得 project authority 进程实例指纹', {stage: 'project-apply'});
  return {schemaVersion: '1.0.0', operationId, targetProject, pid: process.pid, processFingerprint: observed.fingerprint, ownerNonce: crypto.randomUUID(), authorization};
}

function acquireProjectGuard(context, operationId, authorization, {recover = false, targetProject = context.root} = {}) {
  const paths = projectTransactionPaths(context);
  if (fs.existsSync(paths.guard)) {
    let owner;
    try { owner = signedPayload(readJson(paths.guard), 'PROJECT_AUTHORITY_GUARD_INVALID', 'project authority guard'); }
    catch (error) { throw new LifecycleError('PROJECT_AUTHORITY_RECOVERY_MANUAL', 'project authority guard 无法验证，保留证据', {stage: 'project-recovery', details: {causeCode: error.code}}); }
    const state = classifyProcessOwner(owner);
    if (state === 'live') throw new LifecycleError('PROJECT_AUTHORITY_LOCKED', 'project authority 正由 live operation 更新', {stage: 'project-apply', retryable: true, details: {operationId: owner.operationId, pid: owner.pid}});
    if (state === 'unavailable') throw new LifecycleError('PROJECT_AUTHORITY_RECOVERY_MANUAL', 'project authority guard 缺少可验证的进程实例证据', {stage: 'project-recovery'});
    if (!recover) throw new LifecycleError('PROJECT_AUTHORITY_RECOVERY_REQUIRED', '存在 dead/stale project authority transaction；必须显式 recover plan', {stage: 'project-recovery', details: {operationId: owner.operationId, ownerState: state}});
    fs.rmSync(paths.guard);
    fsyncDirectory(path.dirname(paths.guard));
  }
  const owner = projectOwner(operationId, authorization, targetProject);
  const document = {...owner, integrity: signTrustedPayload(owner)};
  let descriptor;
  try { descriptor = fs.openSync(paths.guard, 'wx', 0o600); }
  catch (error) { throw new LifecycleError('PROJECT_AUTHORITY_LOCKED', 'project authority guard 被并发取得', {stage: 'project-apply', retryable: true, details: {cause: error.code}}); }
  try { fs.writeFileSync(descriptor, `${JSON.stringify(document, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fsyncDirectory(path.dirname(paths.guard));
  return {file: paths.guard, owner};
}

function releaseProjectGuard(guard) {
  if (!guard || !fs.existsSync(guard.file)) return;
  try {
    const current = signedPayload(readJson(guard.file), 'PROJECT_AUTHORITY_GUARD_INVALID', 'project authority guard');
    if (current.ownerNonce === guard.owner.ownerNonce) { fs.rmSync(guard.file); fsyncDirectory(path.dirname(guard.file)); }
  } catch {}
}

function writeProjectJournal(file, journal, status = journal.status, stage = null) {
  journal.status = status;
  if (stage) journal.steps.push({stage, at: Date.now()});
  writeJsonAtomic(file, {...journal, integrity: signTrustedPayload(journal)});
}

function copyTemplate(source, destination) {
  fs.mkdirSync(destination, {recursive: true});
  for (const entry of fs.readdirSync(source, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new LifecycleError('PROJECT_TEMPLATE_SYMLINK_REJECTED', 'packaged template 不得包含符号链接', {stage: 'project-apply'});
    if (entry.isDirectory()) copyTemplate(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function ensureCreatedProjectFacts(project, projectId, now) {
  const root = path.join(project, '.foundation');
  fs.mkdirSync(path.join(root, 'facts'), {recursive: true});
  fs.mkdirSync(path.join(root, 'generated-cache', 'management-center'), {recursive: true});
  fs.mkdirSync(path.join(root, 'backups'), {recursive: true});
  const identityFile = path.join(project, ...IDENTITY_RELATIVE.split('/'));
  if (!fs.existsSync(identityFile)) writeJsonAtomic(identityFile, {schemaVersion: '1.0.0', layoutVersion: PROJECT_LAYOUT_VERSION, projectId, identityScheme: 'foundation-project-id-v2', name: path.basename(project), governanceMode: 'shadcn-first', uiPolicy: foundationUiPolicyRecord('new'), dataFormatVersion: '0.1.0', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()});
}

function portableBinding(projectId, state) {
  return {schemaVersion: '1.0.0', layoutVersion: PROJECT_LAYOUT_VERSION, bindingVersion: PROJECT_BINDING_VERSION, projectId, identity: {scheme: 'foundation-project-id-v2', value: projectId}, state, product: 'AI Product Foundation Kit', disabledBindingRetained: state === 'disabled'};
}

function writeProjectOwnership(project, projectId, portableFile) {
  const bindingBytes = fs.readFileSync(portableFile);
  const payload = {schemaVersion: '2.0.0', layoutVersion: PROJECT_LAYOUT_VERSION, projectId, ownedLeaves: [{path: `${PROJECT_LAYOUT_PATHS.integration}/binding.json`, kind: 'integration', type: 'file', sha256: sha256(bindingBytes), byteLength: bindingBytes.length}], ownedDirectories: [{path: PROJECT_LAYOUT_PATHS.integration, type: 'directory'}, {path: PROJECT_LAYOUT_PATHS.generatedCache, type: 'directory'}], preserved: [IDENTITY_RELATIVE, PROJECT_LAYOUT_PATHS.facts, '.foundation/backups', 'unknown-and-user-modified-files', 'project-code']};
  const ownership = {...payload, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(payload))}};
  writeJsonAtomic(path.join(project, ...OWNERSHIP_RELATIVE.split('/')), ownership);
}

export function applyProjectAuthorityPlan({plan, now = Date.now()}) {
  validateProjectPlan(plan, now);
  const context = installationContext(plan.installationRoot);
  assertEligibleProject(plan.project, context.root, {mayNotExist: plan.createFromTemplate});
  const transactionState = inspectProjectAuthorityRecovery(context.root);
  if (transactionState.status !== 'clean') throw new LifecycleError(transactionState.status === 'manual-action-required' ? 'PROJECT_AUTHORITY_RECOVERY_MANUAL' : transactionState.status === 'live-operation' ? 'PROJECT_AUTHORITY_LOCKED' : 'PROJECT_AUTHORITY_RECOVERY_REQUIRED', 'project authority transaction 必须先显式恢复', {stage: 'project-recovery', details: transactionState});
  const effect = authorizationEffectForProjectPlan(plan);
  const reservation = reserveExactManagerConfirmationAtBoundary(effect);
  const authorization = publicManagerConfirmationEvidence(reservation);
  let preIntent = null;
  let trustedGuard = null;
  let guard = null;
  let journal = null;
  let journalFile = null;
  let consumed = false;
  try {
    let registry = registryContext(context);
    assertPlanSnapshots(plan, context, registry);
    const portableFile = path.join(plan.project, ...PORTABLE_RELATIVE.split('/'));
    const before = {portable: fileSnapshot(portableFile), identity: fileSnapshot(path.join(plan.project, ...IDENTITY_RELATIVE.split('/'))), ownership: fileSnapshot(path.join(plan.project, ...OWNERSHIP_RELATIVE.split('/'))), registry: fileSnapshot(registry.file), projectExisted: fs.existsSync(plan.project), createFromTemplate: plan.createFromTemplate, createdProjectIdentity: null};
    if (plan.operation === 'enable' && plan.createFromTemplate) {
      const template = installedTemplate(context);
      if (template.path !== plan.templateSnapshot?.path || template.hash !== plan.templateSnapshot?.hash) throw new LifecycleError('PROJECT_TEMPLATE_CHANGED', 'plan 后 installed packaged template 已变化', {stage: 'project-apply'});
    }
    preIntent = writeTrustedPreIntent({intentId: plan.planId, operationClass: effect.operationClass, operation: plan.operation, effect, authorization, planHash: plan.integrity.hash, target: plan.project, beforeState: {authorized: effect.expectedBeforeState, portable: before.portable, registry: before.registry, projectExisted: before.projectExisted}, now});
    operationCheckpoint('after-project-authority-durable-pre-intent');
    trustedGuard = acquireTrustedTargetGuard(preIntent);
    operationCheckpoint('after-project-authority-exclusive-acquire');
    registry = registryContext(context);
    assertPlanSnapshots(plan, context, registry);
    consumeExactManagerConfirmationAtBoundary(reservation, {effectHash: effect.effectHash, intentId: plan.planId, intentPathHash: preIntent.fileHash});
    consumed = true;
    updateTrustedPreIntent(preIntent, 'consumed', {consumedAt: Date.now()});
    operationCheckpoint('after-project-authority-authorization-consume');
    guard = acquireProjectGuard(context, plan.planId, authorization, {targetProject: plan.project});
    journal = {schemaVersion: '1.0.0', operationId: plan.planId, operation: plan.operation, project: plan.project, projectId: plan.projectId, effectHash: effect.effectHash, authorization, plan, before, status: 'planned', outcome: null, steps: [{stage: 'planned', at: Date.now()}]};
    journalFile = path.join(projectTransactionPaths(context).journals, `${plan.planId}.json`);
    writeProjectJournal(journalFile, journal);
    operationCheckpoint('after-project-intent');
    if (plan.operation === 'enable') {
      if (plan.createFromTemplate) {
        const template = installedTemplate(context);
        fs.mkdirSync(plan.project, {recursive: true});
        journal.before.createdProjectIdentity = projectIdentity(plan.project);
        writeProjectJournal(journalFile, journal, 'project-root-created', 'project-root-created');
        copyTemplate(template.path, plan.project);
      }
      ensureCreatedProjectFacts(plan.project, plan.projectId, now);
      const portable = portableBinding(plan.projectId, 'enabled');
      writeJsonAtomic(portableFile, portable);
      writeProjectOwnership(plan.project, plan.projectId, portableFile);
      writeProjectJournal(journalFile, journal, 'portable-written', 'portable-binding-written');
      operationCheckpoint('after-portable-binding');
      const portableHash = sha256(fs.readFileSync(portableFile));
      registry = registryContext(context);
      const payload = structuredClone(registry.payload);
      payload.projects[plan.projectId] = {projectId: plan.projectId, bindingVersion: PROJECT_BINDING_VERSION, state: 'enabled', realPath: plan.project, canonicalPath: canonicalPath(plan.project), projectIdentity: projectIdentity(plan.project), portableBindingHash: portableHash, confirmationEvidence: {confirmationId: authorization.confirmationId || authorization.authorizationId, effectHash: authorization.effectHash, planId: plan.planId, confirmedAt: now}};
      writeJsonAtomic(registry.file, {...payload, integrity: signTrustedPayload(payload)});
      writeProjectJournal(journalFile, journal, 'machine-written', 'machine-registration-written');
      operationCheckpoint('after-machine-registration');
    } else {
      const status = inspectProjectAuthority(plan.project, {installationRoot: context.root});
      if (status.state !== 'enabled' || status.projectId !== plan.projectId) throw new LifecycleError('PROJECT_AUTHORITY_CHANGED', 'disable apply 前项目权限已变化', {stage: 'project-apply'});
      const payload = structuredClone(registry.payload);
      payload.projects[plan.projectId] = {...payload.projects[plan.projectId], state: 'disabled', confirmationEvidence: {confirmationId: authorization.confirmationId || authorization.authorizationId, effectHash: authorization.effectHash, planId: plan.planId, confirmedAt: now}};
      writeJsonAtomic(registry.file, {...payload, integrity: signTrustedPayload(payload)});
      writeProjectJournal(journalFile, journal, 'machine-written', 'machine-registration-disabled');
      operationCheckpoint('after-machine-registration');
      const portable = portableBinding(plan.projectId, 'disabled');
      writeJsonAtomic(portableFile, portable);
      writeProjectOwnership(plan.project, plan.projectId, portableFile);
      writeProjectJournal(journalFile, journal, 'portable-written', 'portable-binding-disabled');
      operationCheckpoint('after-portable-binding');
      const disabledHash = sha256(fs.readFileSync(portableFile));
      const refreshed = registryContext(context);
      const refreshedPayload = structuredClone(refreshed.payload);
      refreshedPayload.projects[plan.projectId].portableBindingHash = disabledHash;
      writeJsonAtomic(refreshed.file, {...refreshedPayload, integrity: signTrustedPayload(refreshedPayload)});
    }
    journal.outcome = 'completed';
    writeProjectJournal(journalFile, journal, 'completed', 'operation-complete');
    updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'completed'});
    return {ok: true, operation: plan.operation, project: plan.project, projectId: plan.projectId, state: plan.operation === 'enable' ? 'enabled' : 'disabled', preserved: plan.preserves, semantics: plan.semantics, authorization: {authorizationId: authorization.authorizationId, effectHash: authorization.effectHash}};
  } catch (error) {
    if (!consumed) {
      try { failExactManagerConfirmationAtBoundary(reservation, {code: error.code || 'PROJECT_AUTHORITY_FAILED', intentWritten: false, intentId: plan.planId}); } catch {}
      if (preIntent) try { updateTrustedPreIntent(preIntent, 'cancelled', {cancelledAt: Date.now(), errorCode: error.code || 'PROJECT_AUTHORITY_FAILED'}); } catch {}
    }
    if (journal && journalFile) {
      try {
        restoreFileSnapshot(path.join(plan.project, ...PORTABLE_RELATIVE.split('/')), journal.before.portable);
        restoreFileSnapshot(path.join(plan.project, ...IDENTITY_RELATIVE.split('/')), journal.before.identity);
        restoreFileSnapshot(path.join(plan.project, ...OWNERSHIP_RELATIVE.split('/')), journal.before.ownership);
        restoreFileSnapshot(path.join(context.root, 'state', 'projects.json'), journal.before.registry);
        restoreCreatedProjectSnapshot(plan.project, journal.before);
        journal.outcome = 'rolled-back';
        writeProjectJournal(journalFile, journal, 'completed', 'rollback-complete');
        if (preIntent) updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'rolled-back', errorCode: error.code || 'PROJECT_AUTHORITY_FAILED'});
      } catch (recoveryError) {
        journal.outcome = 'manual-action-required';
        journal.recoveryError = {code: recoveryError.code || 'PROJECT_TRANSACTION_RECOVERY_FAILED', message: recoveryError.message};
        try { writeProjectJournal(journalFile, journal, 'manual-action-required', 'rollback-failed'); } catch {}
        if (preIntent) try { updateTrustedPreIntent(preIntent, 'manual-action-required', {failedAt: Date.now(), errorCode: error.code || 'PROJECT_AUTHORITY_FAILED', recoveryErrorCode: recoveryError.code || 'PROJECT_TRANSACTION_RECOVERY_FAILED'}); } catch {}
      }
    } else if (consumed && preIntent) {
      try { updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'no-target-write', errorCode: error.code || 'PROJECT_AUTHORITY_FAILED'}); } catch {}
    }
    throw error;
  } finally {
    releaseProjectGuard(guard);
    releaseTrustedTargetGuard(trustedGuard);
  }
}

export function inspectProjectAuthorityRecovery(installationRoot) {
  const context = installationContext(installationRoot);
  const paths = projectTransactionPaths(context);
  const manual = [];
  const pending = [];
  const targetProjects = new Set();
  let live = null;
  if (fs.existsSync(paths.guard)) {
    try {
      const owner = signedPayload(readJson(paths.guard), 'PROJECT_AUTHORITY_GUARD_INVALID', 'project authority guard');
      if (typeof owner.targetProject === 'string' && path.isAbsolute(owner.targetProject)) targetProjects.add(owner.targetProject);
      const ownerState = classifyProcessOwner(owner);
      if (ownerState === 'live') live = {operationId: owner.operationId, pid: owner.pid, processFingerprint: owner.processFingerprint};
      else if (ownerState === 'unavailable') manual.push({code: 'PROCESS_INSTANCE_EVIDENCE_UNAVAILABLE', path: 'state/.project-authority.guard'});
      else pending.push({operationId: owner.operationId, ownerState, path: 'state/.project-authority.guard'});
    } catch (error) { manual.push({code: error.code || 'PROJECT_AUTHORITY_GUARD_INVALID', path: 'state/.project-authority.guard'}); }
  }
  const journals = [];
  if (fs.existsSync(paths.journals)) {
    for (const name of fs.readdirSync(paths.journals).filter((entry) => entry.endsWith('.json')).sort()) {
      const file = path.join(paths.journals, name);
      try {
        const journal = signedPayload(readJson(file), 'PROJECT_AUTHORITY_JOURNAL_INVALID', `project journal ${name}`);
        if (journal.operationId !== name.slice(0, -5)) manual.push({code: 'PROJECT_AUTHORITY_JOURNAL_ID_MISMATCH', path: `state/project-authority-journals/${name}`});
        else if (!['completed'].includes(journal.status)) {
          if (typeof journal.project === 'string' && path.isAbsolute(journal.project)) targetProjects.add(journal.project);
          journals.push({operationId: journal.operationId, operation: journal.operation, project: journal.project, projectId: journal.projectId, status: journal.status, effectHash: journal.effectHash, fileHash: sha256(fs.readFileSync(file)), path: `state/project-authority-journals/${name}`});
        }
      } catch (error) { manual.push({code: error.code || 'PROJECT_AUTHORITY_JOURNAL_INVALID', path: `state/project-authority-journals/${name}`}); }
    }
  }
  const trustedIntents = [...targetProjects].flatMap((target) => inspectTrustedPreIntents({target}).pending || []).filter((entry, index, all) => all.findIndex((candidate) => candidate.fileHash === entry.fileHash) === index);
  if (manual.length) return {schemaVersion: '1.0.0', status: 'manual-action-required', manual, pending, journals, trustedIntents, mutationPerformed: false};
  if (live) return {schemaVersion: '1.0.0', status: 'live-operation', live, manual: [], pending, journals, trustedIntents, mutationPerformed: false};
  if (pending.length || journals.length || trustedIntents.length) return {schemaVersion: '1.0.0', status: 'recovery-required', manual: [], pending, journals, trustedIntents, mutationPerformed: false};
  return {schemaVersion: '1.0.0', status: 'clean', manual: [], pending: [], journals: [], trustedIntents: [], mutationPerformed: false};
}

export function createProjectAuthorityRecoveryPlan({installationRoot, now = Date.now(), ttlMs = 15 * 60 * 1000}) {
  const context = installationContext(installationRoot);
  const recoverySnapshot = inspectProjectAuthorityRecovery(context.root);
  if (recoverySnapshot.status !== 'recovery-required') throw new LifecycleError('PROJECT_AUTHORITY_RECOVERY_NOT_REQUIRED', '当前没有可自动恢复的 project authority transaction', {stage: 'project-recovery'});
  return planIntegrity({
    schemaVersion: '1.0.0',
    bindingVersion: PROJECT_BINDING_VERSION,
    operation: 'recover',
    project: context.root,
    installationRoot: context.root,
    installId: context.current.identity.installId,
    projectId: 'project-authority-recovery',
    createdAt: now,
    expiresAt: now + ttlMs,
    changes: ['restore-exact-portable-binding-before-bytes', 'restore-exact-machine-registration-before-bytes', 'complete-project-authority-journal'],
    preserves: ['project-source', '.foundation/facts', 'assets', 'components', 'user-data'],
    recoverySnapshot,
  });
}

function validateProjectRecoveryPlan(plan, now) {
  if (!plan || plan.operation !== 'recover' || plan.projectId !== 'project-authority-recovery' || !plan.recoverySnapshot) throw new LifecycleError('PROJECT_RECOVERY_PLAN_INVALID', 'project recovery plan schema 无效', {stage: 'project-recovery'});
  const {integrity, ...unsigned} = plan;
  if (integrity?.algorithm !== 'sha256' || integrity.hash !== sha256(canonicalStringify(unsigned))) throw new LifecycleError('PROJECT_RECOVERY_PLAN_TAMPERED', 'project recovery plan 已被改写', {stage: 'project-recovery'});
  if (now > plan.expiresAt) throw new LifecycleError('PROJECT_RECOVERY_PLAN_EXPIRED', 'project recovery plan 已过期', {stage: 'project-recovery'});
}

export function applyProjectAuthorityRecoveryPlan({plan, now = Date.now()}) {
  validateProjectRecoveryPlan(plan, now);
  const context = installationContext(plan.installationRoot);
  const current = inspectProjectAuthorityRecovery(context.root);
  if (sha256(canonicalStringify(current)) !== sha256(canonicalStringify(plan.recoverySnapshot))) throw new LifecycleError('PROJECT_RECOVERY_STATE_CHANGED', 'project recovery state 在 plan 后发生变化', {stage: 'project-recovery'});
  const effect = authorizationEffectForProjectRecoveryPlan(plan);
  const reservation = reserveExactManagerConfirmationAtBoundary(effect);
  const authorization = publicManagerConfirmationEvidence(reservation);
  let preIntent = null;
  let trustedGuard = null;
  const trustedProjectGuards = [];
  let guard = null;
  let consumed = false;
  const recoveryJournalFile = path.join(projectTransactionPaths(context).journals, `${plan.planId}.json`);
  const recoveryJournal = {schemaVersion: '1.0.0', operationId: plan.planId, operation: 'recover', project: context.root, projectId: null, effectHash: effect.effectHash, authorization, plan, before: {}, status: 'planned', outcome: null, steps: [{stage: 'planned', at: Date.now()}]};
  try {
    preIntent = writeTrustedPreIntent({intentId: plan.planId, operationClass: effect.operationClass, operation: 'recover', effect, authorization, planHash: plan.integrity.hash, target: context.root, beforeState: effect.expectedBeforeState, now});
    trustedGuard = acquireTrustedTargetGuard(preIntent);
    const rechecked = inspectProjectAuthorityRecovery(context.root);
    if (sha256(canonicalStringify(rechecked)) !== sha256(canonicalStringify(plan.recoverySnapshot))) throw new LifecycleError('PROJECT_RECOVERY_STATE_CHANGED', '取得恢复互斥权后 project recovery state 已变化', {stage: 'project-recovery', details: {plannedHash: sha256(canonicalStringify(plan.recoverySnapshot)), observedHash: sha256(canonicalStringify(rechecked)), plannedTrusted: (plan.recoverySnapshot.trustedIntents || []).map((entry) => ({intentId: entry.intentId, target: entry.target, status: entry.status, fileHash: entry.fileHash})), observedTrusted: (rechecked.trustedIntents || []).map((entry) => ({intentId: entry.intentId, target: entry.target, status: entry.status, fileHash: entry.fileHash}))}});
    const recoverIntentIds = (plan.recoverySnapshot.trustedIntents || []).map((entry) => entry.intentId);
    const recoveryProjects = [...new Set((plan.recoverySnapshot.journals || []).map((entry) => entry.project).filter((value) => typeof value === 'string' && path.isAbsolute(value)))].sort();
    for (const targetProject of recoveryProjects) trustedProjectGuards.push(acquireTrustedTargetGuard(preIntent, {target: targetProject, recoverIntentIds}));
    consumeExactManagerConfirmationAtBoundary(reservation, {effectHash: effect.effectHash, intentId: plan.planId, intentPathHash: preIntent.fileHash});
    consumed = true;
    updateTrustedPreIntent(preIntent, 'consumed', {consumedAt: Date.now()});
    guard = acquireProjectGuard(context, plan.planId, authorization, {recover: true});
    writeProjectJournal(recoveryJournalFile, recoveryJournal);
    for (const entry of plan.recoverySnapshot.journals) {
      const file = path.join(context.root, ...entry.path.split('/'));
      const journal = signedPayload(readJson(file), 'PROJECT_AUTHORITY_JOURNAL_INVALID', `project journal ${entry.operationId}`);
      if (sha256(fs.readFileSync(file)) !== entry.fileHash || journal.effectHash !== entry.effectHash || journal.operationId !== entry.operationId) throw new LifecycleError('PROJECT_RECOVERY_SCOPE_CHANGED', 'project journal bytes/effect 已变化', {stage: 'project-recovery'});
      restoreFileSnapshot(path.join(journal.project, ...PORTABLE_RELATIVE.split('/')), journal.before.portable);
      restoreFileSnapshot(path.join(context.root, 'state', 'projects.json'), journal.before.registry);
      restoreCreatedProjectSnapshot(journal.project, journal.before);
      journal.outcome = 'rolled-back';
      writeProjectJournal(file, journal, 'completed', 'authorized-recovery-rollback');
    }
    for (const entry of plan.recoverySnapshot.trustedIntents || []) if (entry.status === 'planned') try { failExactManagerConfirmationAtBoundary(entry.authorization, {code: 'AUTHORIZED_RECOVERY_CANCELLED_PRECONSUME_RESERVATION', intentWritten: false, intentId: entry.intentId}); } catch {}
    completeTrustedPreIntentRecovery(plan.recoverySnapshot.trustedIntents || []);
    recoveryJournal.outcome = 'completed';
    writeProjectJournal(recoveryJournalFile, recoveryJournal, 'completed', 'recovery-complete');
    updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'completed'});
    return {ok: true, status: 'recovered', recovered: plan.recoverySnapshot.journals.map((entry) => entry.operationId), authorization: {authorizationId: authorization.authorizationId, effectHash: effect.effectHash}};
  } catch (error) {
    if (!consumed) {
      try { failExactManagerConfirmationAtBoundary(reservation, {code: error.code || 'PROJECT_RECOVERY_FAILED', intentWritten: false, intentId: plan.planId}); } catch {}
      if (preIntent) try { updateTrustedPreIntent(preIntent, 'cancelled', {cancelledAt: Date.now(), errorCode: error.code || 'PROJECT_RECOVERY_FAILED'}); } catch {}
    } else if (preIntent) try { updateTrustedPreIntent(preIntent, 'manual-action-required', {failedAt: Date.now(), errorCode: error.code || 'PROJECT_RECOVERY_FAILED'}); } catch {}
    throw error;
  } finally {
    releaseProjectGuard(guard);
    for (const projectGuard of trustedProjectGuards) releaseTrustedTargetGuard(projectGuard);
    releaseTrustedTargetGuard(trustedGuard);
  }
}

export function assertProjectMutationAuthority(project, {installationRoot, capability} = {}) {
  const target = projectPath(project);
  assertEligibleProject(target, installationRoot);
  const status = inspectProjectAuthority(target, {installationRoot});
  if (status.state !== 'enabled' || status.agreement !== true) throw new LifecycleError('PROJECT_NOT_ENABLED', `项目未通过 portable binding + signed machine registration 双重授权，拒绝 ${capability || 'mutation'}`, {stage: 'project-authority', details: status});
  return {...status, capability};
}

export function createProjectMutationPlan({operation, project, installationRoot, handlerPayload, preserves = ['project-files', '.foundation/facts', 'user-data'], capabilityIds = [], now = Date.now(), ttlMs = 15 * 60 * 1000}) {
  if (typeof operation !== 'string' || !operation) throw new LifecycleError('PROJECT_MUTATION_PLAN_INVALID', 'project mutation plan 必须包含明确 operation', {stage: 'project-mutation-plan'});
  const target = projectPath(project);
  const context = installationContext(installationRoot);
  const authority = assertProjectMutationAuthority(target, {installationRoot: context.root, capability: operation});
  const handler = deriveClosedHandlerBinding({operation, project: target, handlerPayload});
  const seed = {
    schemaVersion: '1.0.0',
    bindingVersion: PROJECT_BINDING_VERSION,
    operation,
    project: target,
    installationRoot: context.root,
    installId: context.current.identity.installId,
    projectId: authority.projectId,
    capabilityIds: [...capabilityIds].sort(),
    actions: handler.actions, creates: handler.creates, changes: handler.changes, deletes: handler.deletes, preserves: [...preserves],
    handler: {handlerId: handler.handlerId, handlerVersion: handler.handlerVersion, payload: handler.payload, payloadHash: handler.payloadHash, allowedWriteSet: handler.allowedWriteSet, beforeStateHash: handler.beforeStateHash},
    projectSnapshot: {identity: projectIdentity(target), portableHash: fs.existsSync(path.join(target, ...PORTABLE_RELATIVE.split('/'))) ? sha256(fs.readFileSync(path.join(target, ...PORTABLE_RELATIVE.split('/')))) : null, protected: snapshotProtectedProjectData(target)},
    authorityState: authority.state,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  return planIntegrity(seed);
}

function validateProjectMutationPlan(plan, now = Date.now()) {
  if (!plan || plan.schemaVersion !== '1.0.0' || typeof plan.operation !== 'string' || !Array.isArray(plan.actions) || !plan.actions.length || typeof plan.project !== 'string' || !plan.projectSnapshot || !plan.handler || !Array.isArray(plan.handler.allowedWriteSet)) throw new LifecycleError('PROJECT_MUTATION_PLAN_INVALID', 'project mutation plan schema 无效', {stage: 'project-mutation-plan'});
  const {integrity, ...unsigned} = plan;
  if (integrity?.algorithm !== 'sha256' || integrity.hash !== sha256(canonicalStringify(unsigned))) throw new LifecycleError('PROJECT_MUTATION_PLAN_TAMPERED', 'project mutation plan 已被改写', {stage: 'project-mutation-plan'});
  if (now > plan.expiresAt) throw new LifecycleError('PROJECT_MUTATION_PLAN_EXPIRED', 'project mutation plan 已过期', {stage: 'project-mutation-plan'});
}

export function applyProjectMutationPlan({plan, now = Date.now()}) {
  validateProjectMutationPlan(plan, now);
  const target = projectPath(plan.project);
  if (!sameIdentity(projectIdentity(target), plan.projectSnapshot.identity)) throw new LifecycleError('PROJECT_REPLACED_AFTER_PLAN', 'project mutation plan 后目录被移动或替换', {stage: 'project-mutation'});
  const authority = assertProjectMutationAuthority(target, {installationRoot: plan.installationRoot, capability: plan.operation});
  if (authority.projectId !== plan.projectId) throw new LifecycleError('PROJECT_AUTHORITY_CHANGED', 'project mutation plan 后项目 authority 已变化', {stage: 'project-mutation'});
  assertClosedHandlerBinding(plan);
  const effect = authorizationEffectForProjectMutationPlan(plan);
  const reservation = reserveExactManagerConfirmationAtBoundary(effect);
  const authorization = publicManagerConfirmationEvidence(reservation);
  const before = snapshotClosedHandlerWrites(target, plan.handler.allowedWriteSet);
  let preIntent = null;
  let trustedGuard = null;
  let journalFile = null;
  let journal = null;
  let consumed = false;
  try {
    preIntent = writeTrustedPreIntent({intentId: plan.planId, operationClass: effect.operationClass, operation: plan.operation, effect, authorization, planHash: plan.integrity.hash, target, beforeState: {authorized: effect.expectedBeforeState, installationRoot: plan.installationRoot, handlerWriteSnapshots: before.snapshots}, now});
    operationCheckpoint('after-project-durable-pre-intent');
    trustedGuard = acquireTrustedTargetGuard(preIntent);
    operationCheckpoint('after-project-exclusive-acquire');
    if (!sameIdentity(projectIdentity(target), plan.projectSnapshot.identity)) throw new LifecycleError('PROJECT_REPLACED_AFTER_PLAN', '取得项目互斥权后目录已变化', {stage: 'project-mutation'});
    const currentAuthority = assertProjectMutationAuthority(target, {installationRoot: plan.installationRoot, capability: plan.operation});
    if (currentAuthority.projectId !== plan.projectId) throw new LifecycleError('PROJECT_AUTHORITY_CHANGED', '取得项目互斥权后 authority 已变化', {stage: 'project-mutation'});
    assertClosedHandlerBinding(plan);
    consumeExactManagerConfirmationAtBoundary(reservation, {effectHash: effect.effectHash, intentId: plan.planId, intentPathHash: preIntent.fileHash});
    consumed = true;
    updateTrustedPreIntent(preIntent, 'consumed', {consumedAt: Date.now()});
    operationCheckpoint('after-project-authorization-consume');
    const base = path.join(plan.installationRoot, 'state', 'project-mutation-journals');
    journalFile = path.join(base, `${plan.planId}.json`);
    journal = {schemaVersion: '1.0.0', operationId: plan.planId, operation: plan.operation, project: target, projectId: plan.projectId, effectHash: effect.effectHash, authorization, planHash: plan.integrity.hash, handler: plan.handler, before: before.snapshots, status: 'executing', outcome: null, createdAt: now};
    writeJsonAtomic(journalFile, {...journal, integrity: signTrustedPayload(journal)});
    operationCheckpoint('before-project-handler-execute');
    const result = executeClosedProjectHandler(plan);
    operationCheckpoint('after-project-handler-execute');
    journal = {...journal, status: 'completed', outcome: 'completed', completedAt: Date.now()};
    writeJsonAtomic(journalFile, {...journal, integrity: signTrustedPayload(journal)});
    updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'completed'});
    return result;
  } catch (error) {
    if (!consumed) {
      try { failExactManagerConfirmationAtBoundary(reservation, {code: error.code || 'PROJECT_MUTATION_FAILED', intentWritten: false, intentId: plan.planId}); } catch {}
      if (preIntent) try { updateTrustedPreIntent(preIntent, 'cancelled', {cancelledAt: Date.now(), errorCode: error.code || 'PROJECT_MUTATION_FAILED'}); } catch {}
    } else {
      try {
        restoreClosedHandlerWrites(target, before.snapshots);
        if (journalFile && journal) {
          journal = {...journal, status: 'completed', outcome: 'rolled-back', failedAt: Date.now(), errorCode: error.code || 'PROJECT_MUTATION_FAILED'};
          writeJsonAtomic(journalFile, {...journal, integrity: signTrustedPayload(journal)});
        }
        if (preIntent) updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'rolled-back', errorCode: error.code || 'PROJECT_MUTATION_FAILED'});
      } catch (recoveryError) {
        if (journalFile && journal) try { writeJsonAtomic(journalFile, {...journal, status: 'manual-action-required', outcome: 'manual-action-required', recoveryError: {code: recoveryError.code || 'PROJECT_MUTATION_RECOVERY_FAILED', message: recoveryError.message}, integrity: signTrustedPayload({...journal, status: 'manual-action-required', outcome: 'manual-action-required', recoveryError: {code: recoveryError.code || 'PROJECT_MUTATION_RECOVERY_FAILED', message: recoveryError.message}})}); } catch {}
        if (preIntent) try { updateTrustedPreIntent(preIntent, 'manual-action-required', {failedAt: Date.now(), errorCode: error.code || 'PROJECT_MUTATION_FAILED', recoveryErrorCode: recoveryError.code || 'PROJECT_MUTATION_RECOVERY_FAILED'}); } catch {}
      }
    }
    throw error;
  } finally {
    releaseTrustedTargetGuard(trustedGuard);
  }
}

export function inspectProjectMutationRecovery(project) {
  const target = projectPath(project);
  const trusted = inspectTrustedPreIntents({target});
  const manual = [...trusted.manual];
  const journals = [];
  for (const entry of trusted.pending) {
    if (entry.status === 'planned') continue;
    const installationRoot = entry.beforeState?.installationRoot;
    if (typeof installationRoot !== 'string' || !path.isAbsolute(installationRoot)) { manual.push({code: 'PROJECT_MUTATION_INSTALLATION_SCOPE_MISSING', intentId: entry.intentId}); continue; }
    const file = path.join(installationRoot, 'state', 'project-mutation-journals', `${entry.intentId}.json`);
    if (!fs.existsSync(file)) { journals.push({intentId: entry.intentId, exists: false}); continue; }
    try {
      const journal = signedPayload(readJson(file), 'PROJECT_MUTATION_JOURNAL_INVALID', `project mutation journal ${entry.intentId}`);
      if (journal.operationId !== entry.intentId || journal.effectHash !== entry.effectHash || journal.planHash !== entry.planHash || journal.project !== target || canonicalStringify(journal.before) !== canonicalStringify(entry.beforeState.handlerWriteSnapshots)) throw new LifecycleError('PROJECT_MUTATION_JOURNAL_SCOPE_MISMATCH', 'project mutation journal 与可信预意图 scope 不匹配', {stage: 'project-mutation-recovery'});
      journals.push({intentId: entry.intentId, exists: true, installationRoot, fileHash: sha256(fs.readFileSync(file)), status: journal.status, outcome: journal.outcome});
    } catch (error) { manual.push({code: error.code || 'PROJECT_MUTATION_JOURNAL_INVALID', intentId: entry.intentId}); }
  }
  const consumed = trusted.pending.filter((entry) => entry.status !== 'planned');
  if (consumed.length > 1) manual.push({code: 'PROJECT_MUTATION_RECOVERY_SCOPE_AMBIGUOUS', intentIds: consumed.map((entry) => entry.intentId)});
  const status = manual.length ? 'manual-action-required' : trusted.status;
  return {...trusted, status, manual, journals};
}

export function createProjectMutationRecoveryPlan({project, now = Date.now(), ttlMs = 15 * 60 * 1000}) {
  const target = projectPath(project);
  const recoverySnapshot = inspectProjectMutationRecovery(target);
  if (recoverySnapshot.status !== 'recovery-required') throw new LifecycleError('PROJECT_MUTATION_RECOVERY_NOT_AVAILABLE', 'project mutation 当前不是可自动恢复状态', {stage: 'project-mutation-recovery', details: recoverySnapshot});
  return planIntegrity({
    schemaVersion: '1.0.0',
    bindingVersion: PROJECT_BINDING_VERSION,
    operation: 'recover-project-mutation',
    project: target,
    projectId: null,
    createdAt: now,
    expiresAt: now + ttlMs,
    actions: ['restore-exact-closed-handler-before-bytes', 'complete-trusted-pre-intent'],
    changes: ['project-mutation-recovery-evidence'],
    preserves: ['all-paths-outside-authorized-handler-write-set', '.foundation/facts-outside-exact-write-set', 'user-data'],
    recoverySnapshot,
  });
}

function validateProjectMutationRecoveryPlan(plan, now) {
  if (!plan || plan.operation !== 'recover-project-mutation' || typeof plan.project !== 'string' || !plan.recoverySnapshot) throw new LifecycleError('PROJECT_MUTATION_RECOVERY_PLAN_INVALID', 'project mutation recovery plan schema 无效', {stage: 'project-mutation-recovery'});
  const {integrity, ...unsigned} = plan;
  if (integrity?.algorithm !== 'sha256' || integrity.hash !== sha256(canonicalStringify(unsigned))) throw new LifecycleError('PROJECT_MUTATION_RECOVERY_PLAN_TAMPERED', 'project mutation recovery plan 已被改写', {stage: 'project-mutation-recovery'});
  if (now > plan.expiresAt) throw new LifecycleError('PROJECT_MUTATION_RECOVERY_PLAN_EXPIRED', 'project mutation recovery plan 已过期', {stage: 'project-mutation-recovery'});
}

export function applyProjectMutationRecoveryPlan({plan, now = Date.now()}) {
  validateProjectMutationRecoveryPlan(plan, now);
  const current = inspectProjectMutationRecovery(plan.project);
  if (canonicalStringify(current) !== canonicalStringify(plan.recoverySnapshot)) throw new LifecycleError('PROJECT_MUTATION_RECOVERY_STATE_CHANGED', 'project mutation recovery scope 在 plan 后变化', {stage: 'project-mutation-recovery'});
  const effect = authorizationEffectForProjectMutationRecoveryPlan(plan);
  const reservation = reserveExactManagerConfirmationAtBoundary(effect);
  const authorization = publicManagerConfirmationEvidence(reservation);
  let preIntent = null;
  let trustedGuard = null;
  let consumed = false;
  try {
    preIntent = writeTrustedPreIntent({intentId: plan.planId, operationClass: effect.operationClass, operation: plan.operation, effect, authorization, planHash: plan.integrity.hash, target: plan.project, beforeState: effect.expectedBeforeState, now});
    verifyTrustedPreIntentScope(plan.recoverySnapshot.pending);
    trustedGuard = acquireTrustedTargetGuard(preIntent, {recoverIntentIds: plan.recoverySnapshot.pending.map((entry) => entry.intentId)});
    verifyTrustedPreIntentScope(plan.recoverySnapshot.pending);
    consumeExactManagerConfirmationAtBoundary(reservation, {effectHash: effect.effectHash, intentId: plan.planId, intentPathHash: preIntent.fileHash});
    consumed = true;
    updateTrustedPreIntent(preIntent, 'consumed', {consumedAt: Date.now()});
    for (const entry of plan.recoverySnapshot.pending) {
      if (entry.status === 'planned') {
        try { failExactManagerConfirmationAtBoundary(entry.authorization, {code: 'AUTHORIZED_PROJECT_MUTATION_RECOVERY_CANCELLED_PRECONSUME_RESERVATION', intentWritten: false, intentId: entry.intentId}); } catch {}
        continue;
      }
      restoreClosedHandlerWrites(plan.project, entry.beforeState.handlerWriteSnapshots);
      const installationRoot = entry.beforeState.installationRoot;
      const journalFile = path.join(installationRoot, 'state', 'project-mutation-journals', `${entry.intentId}.json`);
      if (fs.existsSync(journalFile)) {
        const journal = signedPayload(readJson(journalFile), 'PROJECT_MUTATION_JOURNAL_INVALID', `project mutation journal ${entry.intentId}`);
        const completed = {...journal, status: 'completed', outcome: 'authorized-recovery-rolled-back', recoveredAt: Date.now()};
        writeJsonAtomic(journalFile, {...completed, integrity: signTrustedPayload(completed)});
      }
    }
    const recovered = completeTrustedPreIntentRecovery(plan.recoverySnapshot.pending);
    updateTrustedPreIntent(preIntent, 'completed', {completedAt: Date.now(), outcome: 'completed'});
    return {ok: true, status: 'recovered', project: plan.project, recovered, authorization: {authorizationId: authorization.authorizationId, effectHash: effect.effectHash}};
  } catch (error) {
    if (!consumed) {
      try { failExactManagerConfirmationAtBoundary(reservation, {code: error.code || 'PROJECT_MUTATION_RECOVERY_FAILED', intentWritten: false, intentId: plan.planId}); } catch {}
      if (preIntent) try { updateTrustedPreIntent(preIntent, 'cancelled', {cancelledAt: Date.now(), errorCode: error.code || 'PROJECT_MUTATION_RECOVERY_FAILED'}); } catch {}
    } else if (preIntent) try { updateTrustedPreIntent(preIntent, 'manual-action-required', {failedAt: Date.now(), errorCode: error.code || 'PROJECT_MUTATION_RECOVERY_FAILED'}); } catch {}
    throw error;
  } finally { releaseTrustedTargetGuard(trustedGuard); }
}

export function listProjectAuthorities(installationRoot) {
  const context = installationContext(installationRoot);
  const registry = registryContext(context);
  return Object.values(registry.payload.projects).sort((a, b) => a.projectId.localeCompare(b.projectId)).flatMap((record) => {
    try {
      if (!['enabled', 'disabled'].includes(record.state) || typeof record.realPath !== 'string' || !path.isAbsolute(record.realPath) || !fs.existsSync(record.realPath)) return [];
      const project = projectPath(record.realPath);
      const role = sourceRole(project);
      if (role.role !== 'user-project-candidate' || overlaps(project, context.root)) return [];
      const portable = portableContext(project);
      if (portable.value?.state !== record.state || !recordMatches(record, project, portable)) return [];
      return [{projectId: record.projectId, state: record.state, project, bindingVersion: record.bindingVersion, exists: true}];
    } catch { return []; }
  });
}

export function listProjectAuthorityRecords(installationRoot) {
  const context = installationContext(installationRoot);
  const registry = registryContext(context);
  return Object.values(registry.payload.projects).sort((a, b) => a.projectId.localeCompare(b.projectId)).map((record) => ({
    projectId: record.projectId,
    state: record.state,
    realPath: record.realPath,
    projectIdentity: record.projectIdentity || null,
    bindingVersion: record.bindingVersion,
  }));
}

export function explainProjectAuthorityPlan(plan) {
  return [
    `项目权限计划 ${plan.planId}：${plan.operation === 'enable' ? '启用管理' : '停用管理'}`,
    `准确项目路径：${plan.project}`,
    `Foundation 安装根：${plan.installationRoot}`,
    `变化内容：${plan.changes.join('、')}`,
    `保留项：${plan.preserves.join('、')}`,
    `语义：${plan.semantics}`,
    `计划完整性 SHA-256：${plan.integrity.hash}`,
    '人类授权：尚未取得；AI 只能展示计划，不能生成 apply 凭据',
  ].join('\n');
}

export function projectAuthorityFromNaturalLanguage(text, parameters = {}) {
  const input = String(text || '').trim();
  const disable = /(?:disable|停用|停止管理|取消管理)/iu.test(input);
  const enable = /(?:enable|启用|开始管理|纳入管理)/iu.test(input);
  const ambiguousClose = /(?:关闭|关掉|停掉).*(?:foundation)/iu.test(input) && !disable && !enable;
  if (ambiguousClose || (!enable && !disable)) return {status: 'clarification-required', question: '你要停用哪个项目的 Foundation 管理，还是卸载电脑上的 Foundation？请给出明确对象和项目绝对路径。', applies: false};
  if (!parameters.project || !path.isAbsolute(parameters.project)) return {status: 'clarification-required', question: '请提供要启用或停用管理的项目绝对路径。', applies: false};
  const plan = createProjectAuthorityPlan({operation: disable ? 'disable' : 'enable', ...parameters});
  return {status: 'confirmation-required', entrypoint: 'natural-language-primary', applies: false, plan, explanation: explainProjectAuthorityPlan(plan), nextStep: `确认后仅由底层 CLI project ${plan.operation} apply 执行`};
}
