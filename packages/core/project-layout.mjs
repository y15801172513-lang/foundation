import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {authorizationEffectForLifecyclePlan, createAuthorizationEffect} from './human-authorization.mjs';
import {canonicalStringify, LifecycleError, sha256, validateLifecyclePlan} from './install-contract.mjs';
import {
  consumeExactManagerConfirmation,
  failExactManagerConfirmation,
  publicManagerConfirmationReference,
  reserveExactManagerConfirmation,
} from './manager-confirmation.mjs';
import {applyLifecyclePlan} from './transaction-engine.mjs';
import {executeProjectTransaction} from './project-transaction.mjs';
import {signTrustedPayload, verifyTrustedPayload} from './trusted-authority.mjs';

export const PROJECT_LAYOUT_VERSION = '2.0.0';
export const PROJECT_LAYOUT_PATHS = Object.freeze({
  identity: '.foundation/identity/project.json',
  facts: '.foundation/facts',
  integration: '.foundation/integration',
  generatedCache: '.foundation/generated-cache',
  ownership: '.foundation/ownership.json',
});

const LEGACY = Object.freeze([
  '.foundation/foundation.json',
  '.foundation/project-binding.json',
  '.foundation/generated',
  '.foundation/backups',
]);

function fail(code, message, details = {}) {
  throw new LifecycleError(code, message, {stage: 'project-layout', retryable: false, recovery: '重新只读检查项目布局并生成新的 exact manager plan', details});
}

function projectRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail('PROJECT_PATH_NOT_ABSOLUTE', 'project layout 必须使用绝对项目路径');
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || fs.lstatSync(resolved).isSymbolicLink() || !fs.statSync(resolved).isDirectory() || fs.realpathSync(resolved) !== resolved) fail('PROJECT_REALPATH_UNSTABLE', 'project layout 拒绝缺失、符号链接或不稳定目录', {project: resolved});
  return resolved;
}

function relativePath(root, absolute) {
  return path.relative(root, absolute).replaceAll(path.sep, '/');
}

function walk(root, current = root) {
  if (!fs.existsSync(current)) return [];
  const currentStat = fs.lstatSync(current);
  if (currentStat.isSymbolicLink()) return [{path: path.basename(current), type: 'symlink', target: fs.readlinkSync(current)}];
  if (currentStat.isFile()) {
    const bytes = fs.readFileSync(current);
    return [{path: path.basename(current), type: 'file', bytes: bytes.length, sha256: sha256(bytes)}];
  }
  if (!currentStat.isDirectory()) return [{path: path.basename(current), type: 'unsupported'}];
  const records = [];
  for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
    const absolute = path.join(current, entry.name);
    const relative = relativePath(root, absolute);
    if (entry.isSymbolicLink()) records.push({path: relative, type: 'symlink', target: fs.readlinkSync(absolute)});
    else if (entry.isDirectory()) records.push(...walk(root, absolute));
    else if (entry.isFile()) {
      const bytes = fs.readFileSync(absolute);
      records.push({path: relative, type: 'file', bytes: bytes.length, sha256: sha256(bytes)});
    } else records.push({path: relative, type: 'unsupported'});
  }
  return records;
}

function treeSnapshot(root) {
  const records = walk(root);
  return {exists: fs.existsSync(root), fileCount: records.filter((entry) => entry.type === 'file').length, byteCount: records.reduce((total, entry) => total + (entry.bytes || 0), 0), hash: sha256(canonicalStringify(records)), records};
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function ownershipDocument(payload) {
  return {...payload, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(payload))}};
}

function validateOwnershipDocument(document, {projectId}) {
  if (!document) return {state: 'missing', ownedLeaves: [], ownedDirectories: []};
  const {integrity, ...payload} = document;
  const structural = payload.schemaVersion === '2.0.0'
    && payload.layoutVersion === PROJECT_LAYOUT_VERSION
    && payload.projectId === projectId
    && Array.isArray(payload.ownedLeaves)
    && Array.isArray(payload.ownedDirectories)
    && payload.ownedLeaves.every((entry) => typeof entry?.path === 'string' && entry.type === 'file' && Number.isInteger(entry.byteLength) && /^[0-9a-f]{64}$/u.test(entry.sha256 || ''));
  if (!structural || integrity?.algorithm !== 'sha256' || integrity.hash !== sha256(canonicalStringify(payload))) return {state: 'tampered', ownedLeaves: [], ownedDirectories: []};
  return {state: 'valid', payload, ownedLeaves: payload.ownedLeaves, ownedDirectories: payload.ownedDirectories};
}

function removableTopology(root) {
  const records = [];
  for (const relativeRoot of [PROJECT_LAYOUT_PATHS.integration, PROJECT_LAYOUT_PATHS.generatedCache]) {
    const absoluteRoot = path.join(root, ...relativeRoot.split('/'));
    if (!fs.existsSync(absoluteRoot)) { records.push({path: relativeRoot, type: 'missing'}); continue; }
    const visit = (absolute, relative) => {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) { records.push({path: relative, type: 'symlink', target: fs.readlinkSync(absolute)}); return; }
      if (stat.isDirectory()) {
        records.push({path: relative, type: 'directory'});
        for (const name of fs.readdirSync(absolute).sort((a, b) => a.localeCompare(b, 'en'))) visit(path.join(absolute, name), `${relative}/${name}`);
        return;
      }
      if (!stat.isFile()) { records.push({path: relative, type: 'unsupported'}); return; }
      const bytes = fs.readFileSync(absolute);
      records.push({path: relative, type: 'file', byteLength: bytes.length, sha256: sha256(bytes)});
    };
    visit(absoluteRoot, relativeRoot);
  }
  return records;
}

function classifyRemovableOwnership(root, ownership, projectId) {
  const validated = validateOwnershipDocument(ownership, {projectId});
  const current = removableTopology(root);
  const byPath = new Map(validated.ownedLeaves.map((entry) => [entry.path, entry]));
  const classification = [];
  for (const entry of current) {
    if (entry.type === 'directory') continue;
    if (entry.type === 'missing') { classification.push({...entry, classification: 'missing'}); continue; }
    if (entry.type === 'symlink' || entry.type === 'unsupported') { classification.push({...entry, classification: 'unsafe-type-or-symlink'}); continue; }
    const owned = byPath.get(entry.path);
    if (!owned) classification.push({...entry, classification: 'unknown-or-untracked'});
    else if (owned.type === entry.type && owned.byteLength === entry.byteLength && owned.sha256 === entry.sha256) classification.push({...entry, classification: 'verified-owned-current-match', kind: owned.kind});
    else classification.push({...entry, classification: 'owned-but-modified', expected: owned});
  }
  for (const owned of validated.ownedLeaves) if (!current.some((entry) => entry.path === owned.path)) classification.push({path: owned.path, type: owned.type, classification: 'missing', expected: owned});
  const removableLeaves = classification.filter((entry) => entry.classification === 'verified-owned-current-match').map((entry) => entry.path);
  const removableDirectories = validated.state === 'valid' ? validated.ownedDirectories
    .filter((directory) => current.some((entry) => entry.path === directory.path && entry.type === 'directory'))
    .filter((directory) => !classification.some((entry) => entry.path.startsWith(`${directory.path}/`) && !['verified-owned-current-match', 'missing'].includes(entry.classification)))
    .map((entry) => entry.path).sort((a, b) => b.split('/').length - a.split('/').length) : [];
  return {manifestState: validated.state, manifest: validated.payload || null, currentTopology: current, classification, removableLeaves, removableDirectories};
}

function presentUnknown(root) {
  const foundation = path.join(root, '.foundation');
  if (!fs.existsSync(foundation)) return [];
  const known = new Set(['identity', 'facts', 'integration', 'generated-cache', 'ownership.json', 'foundation.json', 'project-binding.json', 'generated', 'backups']);
  return fs.readdirSync(foundation).filter((name) => !known.has(name)).sort().map((name) => `.foundation/${name}`);
}

export function inspectProjectLayout(project) {
  const root = projectRoot(project);
  const identityFile = path.join(root, ...PROJECT_LAYOUT_PATHS.identity.split('/'));
  const ownershipFile = path.join(root, ...PROJECT_LAYOUT_PATHS.ownership.split('/'));
  const identity = fs.existsSync(identityFile) ? readJson(identityFile) : null;
  const ownership = fs.existsSync(ownershipFile) ? readJson(ownershipFile) : null;
  const legacyPresent = LEGACY.filter((relative) => fs.existsSync(path.join(root, ...relative.split('/'))));
  const unknown = presentUnknown(root);
  const ownershipValidation = validateOwnershipDocument(ownership, {projectId: identity?.projectId});
  const v2 = identity?.schemaVersion === '1.0.0' && identity?.layoutVersion === PROJECT_LAYOUT_VERSION && typeof identity?.projectId === 'string'
    && ownershipValidation.state === 'valid';
  return Object.freeze({
    schemaVersion: '1.0.0',
    layoutVersion: v2 ? PROJECT_LAYOUT_VERSION : null,
    state: v2 ? 'current' : legacyPresent.length || fs.existsSync(path.join(root, '.foundation')) ? 'legacy' : 'unmanaged',
    project: root,
    projectId: identity?.projectId || readJson(path.join(root, '.foundation', 'foundation.json'))?.projectId || readJson(path.join(root, '.foundation', 'project-binding.json'))?.projectId || null,
    identity,
    ownership,
    legacy: {present: legacyPresent},
    unknown,
    preserved: [PROJECT_LAYOUT_PATHS.identity, PROJECT_LAYOUT_PATHS.facts, '.foundation/backups', ...legacyPresent, ...unknown, 'project-code'],
    snapshot: treeSnapshot(root),
    mutationPerformed: false,
  });
}

export function snapshotProtectedProjectData(project) {
  const root = projectRoot(project);
  const selected = {
    project: treeSnapshot(root),
    identity: treeSnapshot(path.join(root, '.foundation', 'identity')),
    facts: treeSnapshot(path.join(root, '.foundation', 'facts')),
    backups: treeSnapshot(path.join(root, '.foundation', 'backups')),
    legacyIdentity: treeSnapshot(path.join(root, '.foundation', 'foundation.json')),
  };
  return Object.freeze({schemaVersion: '1.0.0', project: root, hashes: Object.fromEntries(Object.entries(selected).map(([name, value]) => [name, value.hash])), fileCount: selected.project.fileCount, byteCount: selected.project.byteCount, completeProjectHash: selected.project.hash});
}

function withIntegrity(seed, prefix) {
  const operationId = `${prefix}-${sha256(canonicalStringify(seed)).slice(0, 24)}`;
  const unsigned = {...seed, operationId, planId: operationId};
  return Object.freeze({...unsigned, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(unsigned))}});
}

function legacyIdentity(layout, root) {
  const legacyFoundation = readJson(path.join(root, '.foundation', 'foundation.json')) || {};
  const legacyBinding = readJson(path.join(root, '.foundation', 'project-binding.json')) || {};
  return {
    projectId: layout.projectId || `project-${crypto.randomUUID()}`,
    name: legacyFoundation.name || path.basename(root),
    dataFormatVersion: legacyFoundation.dataFormatVersion || '0.1.0',
    state: ['enabled', 'disabled'].includes(legacyBinding.state) ? legacyBinding.state : 'disabled',
    legacyFoundation,
  };
}

export function createProjectLayoutMigrationPlan({project, now = Date.now(), ttlMs = 15 * 60 * 1000}) {
  const root = projectRoot(project);
  const layout = inspectProjectLayout(root);
  if (layout.state === 'current') fail('PROJECT_LAYOUT_ALREADY_CURRENT', 'project layout 已是当前版本');
  const identity = legacyIdentity(layout, root);
  const expectedBeforeState = snapshotProtectedProjectData(root);
  const creates = [PROJECT_LAYOUT_PATHS.identity, `${PROJECT_LAYOUT_PATHS.integration}/binding.json`, PROJECT_LAYOUT_PATHS.ownership];
  const preserves = [PROJECT_LAYOUT_PATHS.facts, '.foundation/backups', ...layout.legacy.present, ...layout.unknown, 'project-code'];
  return withIntegrity({
    schemaVersion: '1.0.0', operationClass: 'foundation-project-layout', operation: 'project-layout-migrate', project: root, projectId: identity.projectId,
    createdAt: now, expiresAt: now + ttlMs, creates, replacements: [], deletes: [], preserves,
    fileCount: expectedBeforeState.fileCount, byteCount: expectedBeforeState.byteCount, protectedDataHashes: expectedBeforeState.hashes, expectedBeforeState,
    migration: {from: 'legacy-or-unversioned', to: PROJECT_LAYOUT_VERSION, identity: {schemaVersion: '1.0.0', layoutVersion: PROJECT_LAYOUT_VERSION, projectId: identity.projectId, name: identity.name, dataFormatVersion: identity.dataFormatVersion, identityScheme: 'foundation-project-id-v2'}, integrationState: identity.state, legacyDisposition: 'preserve-in-place'},
  }, 'project-layout-plan');
}

function purgeInventory(root) {
  const candidates = [PROJECT_LAYOUT_PATHS.identity, PROJECT_LAYOUT_PATHS.facts, '.foundation/backups', '.foundation/foundation.json'];
  return candidates.flatMap((relative) => {
    const absolute = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(absolute)) return [];
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail('PROJECT_PURGE_SYMLINK_REJECTED', `purge 拒绝符号链接：${relative}`);
    return stat.isDirectory() ? walk(root, absolute) : [{path: relative, type: 'file', bytes: stat.size, sha256: sha256(fs.readFileSync(absolute))}];
  }).filter((entry) => entry.type === 'file').sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
}

export function createProjectDataPurgePlan({project, now = Date.now(), ttlMs = 5 * 60 * 1000}) {
  const root = projectRoot(project);
  const layout = inspectProjectLayout(root);
  const inventory = purgeInventory(root);
  const expectedBeforeState = snapshotProtectedProjectData(root);
  return withIntegrity({
    schemaVersion: '1.0.0', operationClass: 'foundation-project-data-purge', operation: 'project-data-purge', highRisk: true,
    project: root, projectId: layout.projectId, createdAt: now, expiresAt: now + ttlMs,
    creates: [], replacements: [], deletes: inventory.map((entry) => entry.path), preserves: [PROJECT_LAYOUT_PATHS.integration, PROJECT_LAYOUT_PATHS.generatedCache, ...layout.unknown, 'project-code'],
    fileCount: inventory.length, byteCount: inventory.reduce((total, entry) => total + entry.bytes, 0), protectedDataHashes: expectedBeforeState.hashes, expectedBeforeState,
    inventory, backupRecommended: true, backupExportAction: 'export-project-data-backup-before-confirmation', confirmationPhrase: `永久删除项目 ${layout.projectId || path.basename(root)} 的 identity/facts/backups`,
  }, 'project-purge-plan');
}

function identityMatches(record, project) {
  if (!record?.projectIdentity) return true;
  const stat = fs.statSync(project);
  return String(stat.dev) === String(record.projectIdentity.device) && String(stat.ino) === String(record.projectIdentity.inode) && (record.projectIdentity.kind || 'directory') === (stat.isDirectory() ? 'directory' : 'other');
}

export function createNormalUninstallProjectPlan({projects = [], resultFile = null, now = Date.now(), ttlMs = 15 * 60 * 1000}) {
  const accessible = [];
  const residuals = [];
  for (const record of projects) {
    const target = path.resolve(record.realPath || '');
    if (!record.realPath || !path.isAbsolute(record.realPath) || !fs.existsSync(target)) {
      residuals.push({projectId: record.projectId || null, lastKnownPath: record.realPath || null, reason: 'PROJECT_UNAVAILABLE', recovery: '重新连接项目后重装 Foundation 并运行 detach，或按 residual report 手工检查 owned integration'});
      continue;
    }
    let layout;
    try { layout = inspectProjectLayout(target); }
    catch (error) { residuals.push({projectId: record.projectId || null, lastKnownPath: record.realPath, reason: error.code || 'PROJECT_UNSAFE_TO_DETACH', recovery: '不要猜测路径；恢复项目可访问性后重新生成计划'}); continue; }
    if ((record.projectId && layout.projectId && record.projectId !== layout.projectId) || !identityMatches(record, target)) {
      residuals.push({projectId: record.projectId || layout.projectId, lastKnownPath: record.realPath, reason: 'PROJECT_IDENTITY_MISMATCH', recovery: '核对 stable project identity 后重新生成 detach plan'});
      continue;
    }
    const projectId = record.projectId || layout.projectId;
    const ownershipFile = path.join(target, ...PROJECT_LAYOUT_PATHS.ownership.split('/'));
    const ownership = fs.existsSync(ownershipFile) ? readJson(ownershipFile) : null;
    const classified = classifyRemovableOwnership(target, ownership, projectId);
    if (classified.manifestState !== 'valid') residuals.push({projectId, lastKnownPath: target, path: PROJECT_LAYOUT_PATHS.ownership, classification: 'unknown-or-untracked', reason: classified.manifestState === 'missing' ? 'OWNERSHIP_MANIFEST_MISSING' : 'OWNERSHIP_MANIFEST_TAMPERED', recovery: '保留全部 integration/cache；重新安装并由 Foundation 重建当前 leaf-exact ownership 后再规划 detach'});
    for (const entry of classified.classification.filter((item) => !['verified-owned-current-match', 'missing'].includes(item.classification))) {
      residuals.push({projectId, lastKnownPath: target, path: entry.path, classification: entry.classification, reason: entry.classification === 'owned-but-modified' ? 'OWNED_LEAF_MODIFIED' : entry.classification === 'unsafe-type-or-symlink' ? 'UNSAFE_TYPE_OR_SYMLINK' : 'UNKNOWN_OR_UNTRACKED', recovery: '保留该路径；用户核对或重新生成 Foundation-owned 内容后再规划'});
    }
    const expectedBeforeState = snapshotProtectedProjectData(target);
    accessible.push({projectId, realPath: target, layoutState: layout.state, manifestState: classified.manifestState, removeOwned: classified.removableLeaves, removeEmptyDirectories: classified.removableDirectories, ownershipClassification: classified.classification, removableTopology: classified.currentTopology, removableTopologyHash: sha256(canonicalStringify(classified.currentTopology)), ownershipBeforeHash: fs.existsSync(ownershipFile) ? sha256(fs.readFileSync(ownershipFile)) : null, preserves: [PROJECT_LAYOUT_PATHS.identity, PROJECT_LAYOUT_PATHS.facts, '.foundation/backups', ...layout.unknown, ...classified.classification.filter((entry) => !['verified-owned-current-match', 'missing'].includes(entry.classification)).map((entry) => entry.path), 'project-code'], expectedBeforeState});
  }
  const removalRecords = accessible.flatMap((entry) => entry.ownershipClassification.filter((item) => item.classification === 'verified-owned-current-match').map((item) => ({projectId: entry.projectId, realPath: entry.realPath, ...item})));
  return withIntegrity({schemaVersion: '1.0.0', operationClass: 'foundation-normal-uninstall-project-detach', operation: 'normal-uninstall-project-detach', status: residuals.length ? 'decision-required' : 'ready', allowedDecisions: residuals.length ? ['cancel-no-change', 'continue-accessible-with-residuals'] : ['confirm-exact-operation'], accessible, residuals, resultFile: resultFile ? path.resolve(resultFile) : null, creates: resultFile ? [path.resolve(resultFile)] : [], replacements: [], removals: accessible.flatMap((entry) => entry.removeOwned.map((relative) => `${entry.realPath}/${relative}`)), preserves: ['project-code', '.foundation/identity', '.foundation/facts', '.foundation/backups', 'unknown-and-user-modified-files', ...residuals.map((entry) => entry.path).filter(Boolean)], fileCount: removalRecords.length, byteCount: removalRecords.reduce((sum, entry) => sum + (entry.byteLength || 0), 0), protectedDataHashes: Object.fromEntries(accessible.map((entry) => [entry.projectId, entry.expectedBeforeState.hashes])), expectedBeforeState: {projects: accessible.map((entry) => ({projectId: entry.projectId, realPath: entry.realPath, snapshot: entry.expectedBeforeState, removableTopologyHash: entry.removableTopologyHash, ownershipBeforeHash: entry.ownershipBeforeHash})), residuals}, createdAt: now, expiresAt: now + ttlMs, resultWhenContinued: residuals.length ? 'UNINSTALLED_WITH_PROJECT_RESIDUALS' : 'UNINSTALLED'}, 'normal-uninstall-detach-plan');
}

export function createNormalUninstallCompositePlan({lifecyclePlan, projects = [], resultFile = null, now = Date.now()}) {
  const lifecycleValidation = validateLifecyclePlan(lifecyclePlan, {now});
  if (!lifecycleValidation.ok || lifecyclePlan.operation !== 'uninstall') fail('NORMAL_UNINSTALL_LIFECYCLE_PLAN_INVALID', 'normal uninstall composite 必须包含有效的 Foundation uninstall plan');
  const coordinatorStateRoot = path.join(path.dirname(lifecyclePlan.targetRoot), '.foundation-lifecycle-coordinator', sha256(path.resolve(lifecyclePlan.targetRoot)).slice(0, 20));
  const durableResultFile = resultFile ? path.resolve(resultFile) : path.join(coordinatorStateRoot, 'project-residuals.json');
  const projectPlan = createNormalUninstallProjectPlan({projects, resultFile: durableResultFile, now, ttlMs: Math.max(1, lifecyclePlan.expiresAt - now)});
  const registry = uninstallRegistrySnapshot(lifecyclePlan.targetRoot, lifecyclePlan.installId);
  return withIntegrity({
    schemaVersion: '1.0.0', operationClass: 'foundation-normal-uninstall-composite', operation: 'normal-uninstall',
    lifecyclePlan, projectPlan, registry, installationRoot: lifecyclePlan.targetRoot, targetRoot: lifecyclePlan.targetRoot, coordinatorStateRoot,
    currentVersion: lifecyclePlan.currentVersion, targetVersion: null, sourceIdentity: lifecyclePlan.installId,
    status: projectPlan.status, allowedDecisions: projectPlan.allowedDecisions,
    creates: [coordinatorStateRoot, ...projectPlan.creates], replacements: ['detach-registered-project-owned-integration-and-cache', 'remove-foundation-owned-application-runtime-bridge-cache-log-state', ...(registry.exists ? [registry.file] : [])],
    registryEffect: '卸载后机器项目索引全部停用，保留历史状态；不可访问项目文件不改写，仍报告残留',
    deletes: [...projectPlan.removals, `foundation-installation:${lifecyclePlan.mode}`], preserves: projectPlan.preserves,
    fileCount: projectPlan.fileCount, byteCount: projectPlan.byteCount, protectedDataHashes: projectPlan.protectedDataHashes,
    expectedBeforeState: {projects: projectPlan.expectedBeforeState, registry, lifecycle: authorizationEffectForLifecyclePlan(lifecyclePlan).expectedBeforeState},
    residuals: projectPlan.residuals, createdAt: now, expiresAt: Math.min(lifecyclePlan.expiresAt, projectPlan.expiresAt),
  }, 'normal-uninstall-composite-plan');
}

function uninstallRegistrySnapshot(root, installId) {
  const file = path.join(root, 'state', 'projects.json');
  if (!fs.existsSync(file)) return {file, exists: false, fileHash: null, installId};
  if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile() || fs.realpathSync(file) !== file) fail('UNINSTALL_REGISTRY_INVALID', '卸载项目索引路径不可信');
  const bytes = fs.readFileSync(file);
  const {integrity, ...payload} = JSON.parse(bytes);
  if (!verifyTrustedPayload(payload, integrity) || payload.installId !== installId || payload.schemaVersion !== '1.0.0' || !payload.projects || Array.isArray(payload.projects)) fail('UNINSTALL_REGISTRY_INVALID', '卸载项目索引身份或完整性不符');
  return {file, exists: true, fileHash: sha256(bytes), installId};
}

function retireUninstallRegistry(plan, checkpoint) {
  if (!plan.registry.exists) return;
  if (canonicalStringify(uninstallRegistrySnapshot(plan.installationRoot, plan.registry.installId)) !== canonicalStringify(plan.registry)) fail('MANAGER_PLAN_STATE_DRIFT', '卸载项目索引已变化');
  const {integrity, ...payload} = readJson(plan.registry.file);
  const detached = new Set(plan.projectPlan.accessible.map(entry => entry.projectId));
  for (const [id, record] of Object.entries(payload.projects)) payload.projects[id] = {...record, state: 'disabled', uninstallHistory: {operationId: plan.planId, previousState: record.state, projectDetach: detached.has(id) ? 'completed' : 'unverified-residual', currentAuthority: false}};
  checkpoint('before-project-registry-retired');
  writeAtomic(plan.registry.file, {...payload, integrity: signTrustedPayload(payload)});
  checkpoint('after-project-registry-retired');
}

export function authorizationEffectForProjectLayoutPlan(plan) {
  return createAuthorizationEffect({
    operationClass: plan.operationClass,
    operation: plan.operation,
    planId: plan.planId,
    planHash: plan.integrity?.hash,
    projectId: plan.projectId,
    targets: [{kind: 'product-project', id: plan.projectId, path: plan.project, canonicalPath: plan.project, identity: null}],
    actions: [plan.operation], creates: plan.creates, changes: plan.replacements, deletes: plan.deletes, preserves: plan.preserves,
    expectedBeforeState: plan.expectedBeforeState,
  });
}

export function authorizationEffectForNormalUninstallProjectPlan(plan, registry = null) {
  return createAuthorizationEffect({
    operationClass: plan.operationClass,
    operation: plan.operation,
    planId: plan.planId,
    planHash: plan.integrity?.hash,
    targets: [...plan.accessible.map((entry) => ({kind: 'product-project', id: entry.projectId, path: entry.realPath, canonicalPath: entry.realPath, identity: null})), ...(plan.resultFile ? [{kind: 'uninstall-residual-result', id: null, path: plan.resultFile, canonicalPath: plan.resultFile, identity: null}] : []), ...(registry?.exists ? [{kind: 'installation-project-registry', id: registry.installId, path: registry.file, canonicalPath: registry.file, identity: null}] : [])],
    actions: ['detach-owned-project-integration-and-cache', 'preserve-project-data', ...(plan.residuals.length ? ['write-residual-report'] : [])],
    creates: plan.creates,
    changes: registry?.exists ? [registry.file] : [],
    deletes: plan.removals,
    preserves: plan.preserves,
    expectedBeforeState: registry ? {...plan.expectedBeforeState, registry} : plan.expectedBeforeState,
  });
}

export function authorizationEffectsForNormalUninstallCompositePlan(plan) {
  return [authorizationEffectForNormalUninstallProjectPlan(plan.projectPlan, plan.registry), authorizationEffectForLifecyclePlan(plan.lifecyclePlan)];
}

export function authorizationEffectForNormalUninstallCompositePlan(plan) {
  const children = authorizationEffectsForNormalUninstallCompositePlan(plan);
  return createAuthorizationEffect({
    operationClass: plan.operationClass,
    operation: plan.operation,
    planId: plan.planId,
    planHash: plan.integrity?.hash,
    installId: plan.lifecyclePlan.installId,
    targets: children.flatMap((effect) => effect.targets),
    actions: ['detach-exact-accessible-project-set', 'remove-foundation-owned-installation', ...(plan.residuals.length ? ['persist-project-residual-report'] : [])],
    creates: plan.creates,
    changes: plan.replacements,
    deletes: plan.deletes,
    preserves: plan.preserves,
    expectedBeforeState: {...plan.expectedBeforeState, childEffectHashes: children.map((effect) => effect.effectHash)},
  });
}

function validatePlan(plan, now = Date.now()) {
  if (!plan || !['project-layout-migrate', 'project-data-purge'].includes(plan.operation) || plan.schemaVersion !== '1.0.0') fail('PROJECT_LAYOUT_PLAN_INVALID', 'project layout plan schema 无效');
  const {integrity, ...unsigned} = plan;
  if (integrity?.algorithm !== 'sha256' || integrity.hash !== sha256(canonicalStringify(unsigned))) fail('PROJECT_LAYOUT_PLAN_TAMPERED', 'project layout plan 已被改写');
  if (now > plan.expiresAt) fail('PROJECT_LAYOUT_PLAN_EXPIRED', 'project layout plan 已过期');
  const current = snapshotProtectedProjectData(plan.project);
  if (canonicalStringify(current) !== canonicalStringify(plan.expectedBeforeState)) fail('MANAGER_PLAN_STATE_DRIFT', 'project layout expected-before 已变化，拒绝写入');
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx', mode: 0o600});
  fs.renameSync(temporary, file);
}

function snapshotTargets(root, relatives) {
  return relatives.map((relative) => {
    const absolute = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(absolute)) return {relative, exists: false};
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail('PROJECT_LAYOUT_SYMLINK_REJECTED', `layout mutation 拒绝符号链接：${relative}`);
    if (stat.isFile()) return {relative, exists: true, type: 'file', data: fs.readFileSync(absolute), mode: stat.mode & 0o777};
    return {relative, exists: true, type: 'directory', records: walk(root, absolute).map((entry) => ({...entry, data: entry.type === 'file' ? fs.readFileSync(path.join(root, ...entry.path.split('/'))) : null}))};
  });
}

function restoreTargets(root, snapshots) {
  for (const snapshot of snapshots) {
    const absolute = path.join(root, ...snapshot.relative.split('/'));
    fs.rmSync(absolute, {recursive: true, force: true});
    if (!snapshot.exists) continue;
    if (snapshot.type === 'file') { fs.mkdirSync(path.dirname(absolute), {recursive: true}); fs.writeFileSync(absolute, snapshot.data, {mode: snapshot.mode}); continue; }
    for (const record of snapshot.records) if (record.type === 'file') { const file = path.join(root, ...record.path.split('/')); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, record.data); }
  }
}

function applyMigration(plan, checkpoint = () => {}) {
  const root = plan.project;
  const identity = plan.migration.identity;
  const binding = {schemaVersion: '1.0.0', layoutVersion: PROJECT_LAYOUT_VERSION, bindingVersion: PROJECT_LAYOUT_VERSION, projectId: plan.projectId, identity: {scheme: 'foundation-project-id-v2', value: plan.projectId}, state: plan.migration.integrationState, product: 'AI Product Foundation Kit', disabledBindingRetained: plan.migration.integrationState === 'disabled'};
  const bindingBytes = Buffer.from(`${JSON.stringify(binding, null, 2)}\n`);
  const ownership = ownershipDocument({schemaVersion: '2.0.0', layoutVersion: PROJECT_LAYOUT_VERSION, projectId: plan.projectId, ownedLeaves: [{path: `${PROJECT_LAYOUT_PATHS.integration}/binding.json`, kind: 'integration', type: 'file', sha256: sha256(bindingBytes), byteLength: bindingBytes.length}], ownedDirectories: [{path: PROJECT_LAYOUT_PATHS.integration, type: 'directory'}, {path: PROJECT_LAYOUT_PATHS.generatedCache, type: 'directory'}], preserved: [PROJECT_LAYOUT_PATHS.identity, PROJECT_LAYOUT_PATHS.facts, '.foundation/backups', 'unknown-and-user-modified-files']});
  checkpoint('before-identity-write'); writeAtomic(path.join(root, ...PROJECT_LAYOUT_PATHS.identity.split('/')), identity); checkpoint('after-identity-write');
  checkpoint('before-binding-write'); writeAtomic(path.join(root, ...PROJECT_LAYOUT_PATHS.integration.split('/'), 'binding.json'), binding); checkpoint('after-binding-write');
  checkpoint('before-cache-directory');
  fs.mkdirSync(path.join(root, ...PROJECT_LAYOUT_PATHS.generatedCache.split('/')), {recursive: true});
  checkpoint('after-cache-directory');
  checkpoint('before-ownership-write'); writeAtomic(path.join(root, ...PROJECT_LAYOUT_PATHS.ownership.split('/')), ownership); checkpoint('after-ownership-write');
  return {ok: true, status: 'migrated', project: root, projectId: plan.projectId, layoutVersion: PROJECT_LAYOUT_VERSION, preserved: plan.preserves};
}

function pruneEmptyParents(root, relatives) {
  const protectedRoot = path.join(root, '.foundation');
  const candidates = new Set();
  for (const relative of relatives) {
    let cursor = path.dirname(path.join(root, ...relative.split('/')));
    while (cursor !== root && cursor !== protectedRoot && cursor.startsWith(`${root}${path.sep}`)) { candidates.add(cursor); cursor = path.dirname(cursor); }
    if (cursor === protectedRoot) candidates.add(cursor);
  }
  for (const directory of [...candidates].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length)) if (fs.existsSync(directory) && fs.lstatSync(directory).isDirectory() && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
}

function applyPurge(plan, checkpoint = () => {}) {
  for (const record of plan.inventory) {
    const file = path.join(plan.project, ...record.path.split('/'));
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile() || sha256(fs.readFileSync(file)) !== record.sha256) fail('MANAGER_PLAN_STATE_DRIFT', `purge inventory 已变化：${record.path}`);
  }
  for (const record of plan.inventory) {
    const file = path.join(plan.project, ...record.path.split('/'));
    checkpoint(`before-delete:${record.path}`);
    fs.unlinkSync(file);
    checkpoint(`after-delete:${record.path}`);
  }
  pruneEmptyParents(plan.project, plan.inventory.map((entry) => entry.path));
  return {ok: true, status: 'project-data-purged', project: plan.project, projectId: plan.projectId, deletedFiles: plan.fileCount, deletedBytes: plan.byteCount, preserved: plan.preserves};
}

export function applyProjectLayoutPlan({plan, now = Date.now(), transactionStateRoot = null}) {
  validatePlan(plan, now);
  const effect = authorizationEffectForProjectLayoutPlan(plan);
  const reservation = reserveExactManagerConfirmation(effect);
  const authorization = publicManagerConfirmationReference(reservation);
  const targets = plan.operation === 'project-layout-migrate'
    ? [...new Set([...plan.creates, PROJECT_LAYOUT_PATHS.generatedCache])]
    : [PROJECT_LAYOUT_PATHS.identity, PROJECT_LAYOUT_PATHS.facts, '.foundation/backups', '.foundation/foundation.json'];
  if (!transactionStateRoot) fail('PROJECT_TRANSACTION_STATE_REQUIRED', 'manager internal execution 缺少 Foundation-owned transaction state');
  return executeProjectTransaction({
    operationId: plan.planId,
    operation: plan.operation,
    planHash: plan.integrity.hash,
    expectedBeforeState: plan.expectedBeforeState,
    stateRoot: transactionStateRoot,
    scopes: [{root: plan.project, paths: targets}],
    consume: () => consumeExactManagerConfirmation(reservation, {effectHash: effect.effectHash, intentId: plan.planId, intentPathHash: sha256(canonicalStringify({planHash: plan.integrity.hash, before: plan.expectedBeforeState}))}),
    apply: ({checkpoint}) => plan.operation === 'project-layout-migrate' ? applyMigration(plan, checkpoint) : applyPurge(plan, checkpoint),
    verify: (result) => {
      if (plan.operation === 'project-layout-migrate') {
        const current = inspectProjectLayout(plan.project);
        if (current.state !== 'current' || current.projectId !== plan.projectId) fail('PROJECT_TRANSACTION_POSTCONDITION_FAILED', 'layout migration 后状态未达到 v2 current');
        return {state: current.state, projectId: current.projectId, completeProjectHash: current.snapshot.hash};
      }
      for (const record of plan.inventory) if (fs.existsSync(path.join(plan.project, ...record.path.split('/')))) fail('PROJECT_TRANSACTION_POSTCONDITION_FAILED', `purge leaf 仍存在：${record.path}`);
      return {deletedFiles: result.deletedFiles, postProjectHash: treeSnapshot(plan.project).hash};
    },
    completion: {confirmation: {confirmationId: authorization.confirmationId, effectHash: authorization.effectHash}},
  });
}

function validateNormalUninstallPlan(plan, now) {
  if (!plan || plan.operation !== 'normal-uninstall-project-detach' || !Array.isArray(plan.accessible) || !Array.isArray(plan.residuals)) fail('NORMAL_UNINSTALL_PLAN_INVALID', 'normal uninstall project plan 无效');
  const {integrity, ...unsigned} = plan;
  if (integrity?.algorithm !== 'sha256' || integrity.hash !== sha256(canonicalStringify(unsigned))) fail('NORMAL_UNINSTALL_PLAN_TAMPERED', 'normal uninstall project plan 已被改写');
  if (now > plan.expiresAt) fail('NORMAL_UNINSTALL_PLAN_EXPIRED', 'normal uninstall project plan 已过期');
  for (const entry of plan.accessible) {
    const current = snapshotProtectedProjectData(entry.realPath);
    if (canonicalStringify(current) !== canonicalStringify(entry.expectedBeforeState)) fail('MANAGER_PLAN_STATE_DRIFT', `normal uninstall 前项目已变化：${entry.projectId}`);
    const topology = removableTopology(entry.realPath);
    if (sha256(canonicalStringify(topology)) !== entry.removableTopologyHash) fail('MANAGER_PLAN_STATE_DRIFT', `normal uninstall removable topology 已变化：${entry.projectId}`);
    const ownershipFile = path.join(entry.realPath, ...PROJECT_LAYOUT_PATHS.ownership.split('/'));
    const ownershipHash = fs.existsSync(ownershipFile) ? sha256(fs.readFileSync(ownershipFile)) : null;
    if (ownershipHash !== entry.ownershipBeforeHash) fail('MANAGER_PLAN_STATE_DRIFT', `normal uninstall ownership manifest 已变化：${entry.projectId}`);
    for (const relative of entry.removeOwned) {
      const record = entry.ownershipClassification.find((item) => item.path === relative && item.classification === 'verified-owned-current-match');
      const file = path.join(entry.realPath, ...relative.split('/'));
      if (!record || !fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) fail('MANAGER_PLAN_STATE_DRIFT', `planned deletion leaf 类型已变化：${relative}`);
      const bytes = fs.readFileSync(file);
      if (bytes.length !== record.byteLength || sha256(bytes) !== record.sha256) fail('MANAGER_PLAN_STATE_DRIFT', `planned deletion leaf bytes 已变化：${relative}`);
    }
  }
}

function detachScopes(plan) {
  const scopes = plan.accessible.map((entry) => {
    const covered = (leaf) => entry.removeEmptyDirectories.some((directory) => leaf.startsWith(`${directory}/`));
    return {root: entry.realPath, paths: [...entry.removeEmptyDirectories, ...entry.removeOwned.filter((leaf) => !covered(leaf)), PROJECT_LAYOUT_PATHS.ownership]};
  });
  if (plan.resultFile) scopes.push({root: path.dirname(plan.resultFile), paths: [path.basename(plan.resultFile)]});
  return scopes;
}

function performNormalUninstallDetach(plan, now, checkpoint = () => {}) {
  validateNormalUninstallPlan(plan, now);
  for (const entry of plan.accessible) {
    for (const relative of entry.removeOwned) {
      const file = path.join(entry.realPath, ...relative.split('/'));
      checkpoint(`before-delete:${entry.projectId}:${relative}`);
      fs.unlinkSync(file);
      checkpoint(`after-delete:${entry.projectId}:${relative}`);
    }
    for (const relative of entry.removeEmptyDirectories) {
      const directory = path.join(entry.realPath, ...relative.split('/'));
      if (fs.existsSync(directory) && fs.lstatSync(directory).isDirectory() && fs.readdirSync(directory).length === 0) {
        checkpoint(`before-rmdir:${entry.projectId}:${relative}`);
        fs.rmdirSync(directory);
        checkpoint(`after-rmdir:${entry.projectId}:${relative}`);
      }
    }
    const ownershipFile = path.join(entry.realPath, ...PROJECT_LAYOUT_PATHS.ownership.split('/'));
    if (entry.manifestState === 'valid' && entry.ownershipBeforeHash && fs.existsSync(ownershipFile) && sha256(fs.readFileSync(ownershipFile)) === entry.ownershipBeforeHash) {
      const remaining = entry.ownershipClassification.filter((item) => item.classification === 'owned-but-modified').map((item) => ({path: item.path, classification: item.classification, expected: item.expected, observed: {type: item.type, sha256: item.sha256, byteLength: item.byteLength}}));
      const ownership = ownershipDocument({schemaVersion: '2.0.0', layoutVersion: PROJECT_LAYOUT_VERSION, projectId: entry.projectId, state: 'detached-by-normal-uninstall', ownedLeaves: [], ownedDirectories: [], residualOwnership: remaining, preserved: entry.preserves});
      checkpoint(`before-ownership-detached:${entry.projectId}`);
      writeAtomic(ownershipFile, ownership);
      checkpoint(`after-ownership-detached:${entry.projectId}`);
    }
  }
  const result = {schemaVersion: '1.0.0', status: plan.residuals.length ? 'UNINSTALLED_WITH_PROJECT_RESIDUALS' : 'UNINSTALLED', operationId: plan.planId, completedAt: now, detachedProjectIds: plan.accessible.map((entry) => entry.projectId), residuals: plan.residuals, preserves: plan.preserves, containsSecret: false, recovery: plan.residuals.length ? '重新连接项目或修复 leaf-exact ownership 后重装 Foundation 并运行 exact detach；不得删除 residual 中的用户/未知字节' : null};
  if (plan.resultFile) { checkpoint('before-residual-result'); writeAtomic(plan.resultFile, result); checkpoint('after-residual-result'); }
  return result;
}

function verifyDetachPostconditions(plan, result) {
  for (const entry of plan.accessible) {
    for (const relative of entry.removeOwned) if (fs.existsSync(path.join(entry.realPath, ...relative.split('/')))) fail('PROJECT_TRANSACTION_POSTCONDITION_FAILED', `verified-owned leaf 未删除：${relative}`);
    const current = snapshotProtectedProjectData(entry.realPath);
    for (const key of ['identity', 'facts', 'backups', 'legacyIdentity']) if (current.hashes[key] !== entry.expectedBeforeState.hashes[key]) fail('PROJECT_TRANSACTION_POSTCONDITION_FAILED', `normal uninstall 改变 protected ${key}：${entry.projectId}`);
    for (const residual of plan.residuals.filter((item) => item.projectId === entry.projectId && item.path && ![PROJECT_LAYOUT_PATHS.ownership].includes(item.path))) if (!fs.existsSync(path.join(entry.realPath, ...residual.path.split('/')))) fail('PROJECT_TRANSACTION_POSTCONDITION_FAILED', `residual path 未保留：${residual.path}`);
  }
  if (plan.resultFile && (!fs.existsSync(plan.resultFile) || readJson(plan.resultFile)?.status !== result.status)) fail('PROJECT_TRANSACTION_POSTCONDITION_FAILED', 'durable residual/result 未写入 exact target');
  return {status: result.status, projects: plan.accessible.map((entry) => ({projectId: entry.projectId, postHash: treeSnapshot(entry.realPath).hash}))};
}

export function applyNormalUninstallProjectPlan({plan, decision = 'confirm-exact-operation', now = Date.now(), transactionStateRoot = null}) {
  validateNormalUninstallPlan(plan, now);
  if (plan.residuals.length && !['cancel-no-change', 'continue-accessible-with-residuals'].includes(decision)) fail('NORMAL_UNINSTALL_DECISION_REQUIRED', '存在不可访问项目；只能取消或继续 exact accessible set');
  if (decision === 'cancel-no-change') return {ok: true, status: 'CANCELLED_NO_CHANGE', mutationPerformed: false, residuals: plan.residuals};
  if (plan.residuals.length && !plan.resultFile) fail('UNINSTALL_RESIDUAL_RESULT_PATH_REQUIRED', '继续 residual uninstall 必须绑定 application removal 后仍保留的 resultFile');
  const effect = authorizationEffectForNormalUninstallProjectPlan(plan);
  const reservation = reserveExactManagerConfirmation(effect);
  const reference = publicManagerConfirmationReference(reservation);
  if (!transactionStateRoot) fail('PROJECT_TRANSACTION_STATE_REQUIRED', 'manager internal detach 缺少 Foundation-owned transaction state');
  const result = executeProjectTransaction({operationId: plan.planId, operation: plan.operation, planHash: plan.integrity.hash, expectedBeforeState: plan.expectedBeforeState, stateRoot: transactionStateRoot, scopes: detachScopes(plan), consume: () => consumeExactManagerConfirmation(reservation, {effectHash: effect.effectHash, intentId: plan.planId, intentPathHash: sha256(canonicalStringify(plan.expectedBeforeState))}), apply: ({checkpoint}) => performNormalUninstallDetach(plan, now, checkpoint), verify: (value) => verifyDetachPostconditions(plan, value), completion: {confirmationId: reference.confirmationId, effectHash: reference.effectHash}});
  return {...result, confirmationId: reference.confirmationId};
}

function snapshotAbsoluteFile(file) {
  if (!file || !fs.existsSync(file)) return {file, exists: false};
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) fail('UNINSTALL_RESIDUAL_RESULT_TARGET_INVALID', 'residual result target 必须是普通文件或不存在');
  return {file, exists: true, data: fs.readFileSync(file), mode: stat.mode & 0o777};
}

function restoreAbsoluteFile(snapshot) {
  if (!snapshot.file) return;
  if (!snapshot.exists) { fs.rmSync(snapshot.file, {force: true}); return; }
  fs.mkdirSync(path.dirname(snapshot.file), {recursive: true});
  fs.writeFileSync(snapshot.file, snapshot.data, {mode: snapshot.mode});
}

function validateNormalUninstallCompositePlan(plan, now) {
  if (!plan || plan.operation !== 'normal-uninstall' || plan.operationClass !== 'foundation-normal-uninstall-composite' || !plan.lifecyclePlan || !plan.projectPlan) fail('NORMAL_UNINSTALL_COMPOSITE_PLAN_INVALID', 'normal uninstall composite plan 无效');
  const {integrity, ...unsigned} = plan;
  if (integrity?.algorithm !== 'sha256' || integrity.hash !== sha256(canonicalStringify(unsigned))) fail('NORMAL_UNINSTALL_COMPOSITE_PLAN_TAMPERED', 'normal uninstall composite plan 已被改写');
  if (now > plan.expiresAt) fail('NORMAL_UNINSTALL_COMPOSITE_PLAN_EXPIRED', 'normal uninstall composite plan 已过期');
  const lifecycleValidation = validateLifecyclePlan(plan.lifecyclePlan, {now});
  if (!lifecycleValidation.ok || plan.lifecyclePlan.operation !== 'uninstall' || plan.lifecyclePlan.targetRoot !== plan.installationRoot) fail('NORMAL_UNINSTALL_LIFECYCLE_PLAN_INVALID', 'composite 内 Foundation uninstall plan 已失效');
  validateNormalUninstallPlan(plan.projectPlan, now);
  if (!plan.registry || canonicalStringify(uninstallRegistrySnapshot(plan.installationRoot, plan.registry.installId)) !== canonicalStringify(plan.registry)) fail('MANAGER_PLAN_STATE_DRIFT', '卸载项目索引快照不符；重新请求计划');
}

export function applyNormalUninstallCompositePlan({plan, decision = 'confirm-exact-operation', now = Date.now()}) {
  validateNormalUninstallCompositePlan(plan, now);
  if (plan.projectPlan.residuals.length && decision === 'cancel-no-change') return {ok: true, status: 'CANCELLED_NO_CHANGE', mutationPerformed: false, residuals: plan.projectPlan.residuals};
  if (plan.projectPlan.residuals.length && decision !== 'continue-accessible-with-residuals') fail('NORMAL_UNINSTALL_DECISION_REQUIRED', '存在 residual；只能取消或继续 exact accessible set');
  const [projectEffect] = authorizationEffectsForNormalUninstallCompositePlan(plan);
  const reservation = reserveExactManagerConfirmation(projectEffect);
  const reference = publicManagerConfirmationReference(reservation);
  const result = executeProjectTransaction({
    operationId: plan.planId,
    operation: plan.operation,
    planHash: plan.integrity.hash,
    expectedBeforeState: plan.expectedBeforeState,
    stateRoot: plan.coordinatorStateRoot,
    scopes: [...detachScopes(plan.projectPlan), {root: plan.installationRoot, paths: ['state/projects.json']}],
    consume: () => consumeExactManagerConfirmation(reservation, {effectHash: projectEffect.effectHash, intentId: plan.planId, intentPathHash: sha256(canonicalStringify(plan.expectedBeforeState))}),
    apply: ({checkpoint}) => {
      const projectResult = performNormalUninstallDetach(plan.projectPlan, now, checkpoint);
      retireUninstallRegistry(plan, checkpoint);
      checkpoint('projects-detached', {projectResult});
      const lifecycleResult = applyLifecyclePlan({plan: plan.lifecyclePlan, now});
      const composite = {
      ok: true,
      status: plan.projectPlan.residuals.length ? 'UNINSTALLED_WITH_PROJECT_RESIDUALS' : 'UNINSTALLED',
      operationId: plan.planId,
      projectResult,
      lifecycleResult,
      residuals: plan.projectPlan.residuals,
      preserved: plan.preserves,
      coordinatorStateRoot: plan.coordinatorStateRoot,
      cleanupAfterVerifiedStatusRead: true,
      };
      checkpoint('lifecycle-complete', {resumeResult: composite});
      return composite;
    },
    verify: (value) => ({...verifyDetachPostconditions(plan.projectPlan, value.projectResult), lifecycleStatus: value.lifecycleResult.status, coordinatorState: 'durable-until-verified-status'}),
    completion: {confirmationId: reference.confirmationId, effectHash: reference.effectHash, finalCleanup: 'after-verified-status-read'},
    recoveryPolicy: {before: 'byte-exact-rollback', resumeAfterCheckpoint: 'lifecycle-complete', neverBroadenPlan: true},
  });
  return {...result, confirmationId: reference.confirmationId};
}
