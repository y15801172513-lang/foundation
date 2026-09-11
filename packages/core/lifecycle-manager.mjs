import crypto from 'node:crypto';
import fs from 'node:fs';
import {closedProjectHandlerCatalog} from './project-mutation-handlers.mjs';
import path from 'node:path';

import {
  authorizationEffectForCapabilityPlan,
  authorizationEffectForLifecyclePlan,
  authorizationEffectForProjectMutationPlan,
  authorizationEffectForProjectMutationRecoveryPlan,
  authorizationEffectForProjectPlan,
  authorizationEffectForProjectRecoveryPlan,
} from './human-authorization.mjs';
import {canonicalStringify, createLifecyclePlan, LifecycleError, sha256, validateLifecyclePlan} from './install-contract.mjs';
import {inspectInstallation} from './transaction-engine.mjs';
import {createProjectAuthorityPlan, createProjectAuthorityRecoveryPlan, createProjectMutationPlan, createProjectMutationRecoveryPlan, inspectProjectAuthority, listProjectAuthorityRecords} from './project-authority.mjs';
import {createCapabilityPlan} from './capability-authority.mjs';
import {resolveFoundationBridgeContext} from './ai-bridge.mjs';
import {authorizationEffectForNormalUninstallCompositePlan, authorizationEffectForNormalUninstallProjectPlan, authorizationEffectForProjectLayoutPlan, authorizationEffectsForNormalUninstallCompositePlan, createNormalUninstallCompositePlan, createNormalUninstallProjectPlan, createProjectDataPurgePlan, createProjectLayoutMigrationPlan, snapshotProtectedProjectData} from './project-layout.mjs';
import {authorizationEffectForOfferPreferencePlan, createOfferPreferencePlan} from './offer-consent.mjs';
import {currentManagerStateRoot} from './runtime-surface.mjs';
import {classifyProcessOwner, observeProcessFingerprint} from './process-owner.mjs';
import {lifecycleFeedback} from './lifecycle-feedback.mjs';

export const LOCAL_LIFECYCLE_MANAGER_VERSION = '1.0.0';
export const LOCAL_LIFECYCLE_AI_SURFACE = Object.freeze({
  schemaVersion: LOCAL_LIFECYCLE_MANAGER_VERSION,
  operations: Object.freeze(['inspect', 'request-plan', 'open-manager', 'status']),
  forbidden: Object.freeze(['confirm', 'apply', 'recover', 'purge', 'reopen-decline']),
  managerStateWrites: Object.freeze(['request-plan', 'open-manager']),
  targetMutationOperations: Object.freeze([]),
  threatLimitation: '轻量确认可减少支持入口中的意外和含糊操作，但不以加密方式证明人在场，不防御拥有同一用户 shell、文件系统或浏览器自动化能力的进程；本机 HTTP 传输不是针对同一用户攻击者的安全边界。',
});

const schema = (properties, required = []) => Object.freeze({type: 'object', additionalProperties: false, properties: Object.freeze(properties), required: Object.freeze(required)});
const error = (code, retryable, recovery) => Object.freeze({code, retryable, recovery});

export const LOCAL_LIFECYCLE_AI_TOOLS = Object.freeze({
  inspect: Object.freeze({
    name: 'Foundation:inspect',
    description: '纯只读检查当前 Foundation 安装健康、明确项目管理/兼容状态、capability 状态与已记录 residual，不创建计划或写入任何字节。',
    input: schema({installationRoot: {type: 'string', description: '待检查的绝对安装根'}, project: {type: 'string', description: 'project-skill-use 必需；plugin-use 在 capability projectScoped 或调用方指定项目时必需验证；lifecycle-inspect 可选的明确项目绝对路径'}, operationRequirement: {type: 'string', enum: ['lifecycle-inspect', 'project-skill-use', 'plugin-use'], description: '显式说明本次只读检查：project-skill-use 必须给出项目，plugin-use 按 descriptor 的 projectScoped 声明决定'}, capabilityId: {type: 'string', description: '只允许 project-skill-use/plugin-use 使用；必须由 current descriptor 和 Foundation-owned state 验证的 capability identity'}}),
    output: schema({installation: {type: 'object'}, bridge: {type: 'object'}, project: {type: 'object'}, capability: {type: 'object'}, unresolvedResiduals: {type: 'array'}, mutationPerformed: {const: false}}, ['mutationPerformed']),
    errors: Object.freeze([
      error('FOUNDATION_NOT_HEALTHY', true, '选择 installed current 且 lifecycle recovery clean 的 Foundation 后重试'),
      error('FOUNDATION_CURRENT_RECEIPT_INVALID', true, '通过单独 exact repair/update plan 恢复 current receipt-owned app/runtime'),
      error('RUNTIME_ENDPOINT_MISSING', true, '通过单独 exact repair/update plan 恢复 descriptor-bound endpoint'),
      error('RUNTIME_ENDPOINT_UNSAFE', false, '拒绝绝对路径、..、反斜杠、符号链接与不支持类型'),
      error('RUNTIME_ENDPOINT_IDENTITY_MISMATCH', true, '恢复 descriptor/receipt 匹配的 endpoint 内容'),
      error('PROJECT_REQUIRED', false, '提供 project-skill-use 或 projectScoped capability 对应的明确项目绝对路径'),
      error('PROJECT_DISABLED', true, '通过自然语言请求 exact enable plan，并在 Foundation 本地管理器确认'),
      error('PROJECT_AUTHORITY_MISMATCH', true, '先只读检查 portable binding 和 signed machine registry；需要时请求 explicit rebind/enable plan'),
      error('CAPABILITY_STATE_SCHEMA_INVALID', true, '通过独立 manager-confirmed migration/repair plan 更新 state schema'),
      error('CAPABILITY_REGISTRATION_IDENTITY_MISMATCH', true, '通过独立 register plan 建立与 current identity 完全匹配的 registration'),
      error('CAPABILITY_INACTIVE', true, '通过独立 capability activate plan 和本地管理器确认；inspect 不会激活'),
      error('PROJECT_PATH_INVALID', false, '提供一个明确的绝对项目路径'),
    ]),
  }),
  'request-plan': Object.freeze({
    name: 'Foundation:request-plan',
    description: '根据一个明确结构化意图计算并验证 exact plan，只把它原子保存到 Foundation-owned pending manager state，返回不透明 planRef 和效果摘要；不修改任何目标。',
    input: schema({operation: {type: 'string', description: '明确的 lifecycle/project/capability operation'}, parameters: {type: 'object', description: '该 operation 的受约束结构化参数'}}, ['operation', 'parameters']),
    output: schema({planRef: {type: 'string'}, summary: {type: 'object'}, expiresAt: {type: 'integer'}, mutationPerformed: {const: false}, managerStateMutationPerformed: {const: true}}, ['planRef', 'summary', 'expiresAt', 'mutationPerformed', 'managerStateMutationPerformed']),
    errors: Object.freeze([error('MANAGER_OPERATION_UNSUPPORTED', false, '改用已列出的 exact operation 或先 inspect'), error('MANAGER_RUNTIME_STATE_UNAVAILABLE', true, '从当前 healthy Foundation 安装重新运行'), error('MANAGER_PLAN_INVALID', true, '刷新只读状态并重新请求计划')]),
  }),
  'open-manager': Object.freeze({
    name: 'Foundation:open-manager',
    description: '只接受 request-plan 返回的不透明 planRef，解析内部 exact plan 并建立 Foundation 本地管理器预览会话；不接受 plan JSON、路径覆盖、action 或 callback。',
    input: schema({planRef: {type: 'string', pattern: '^foundation-plan-[0-9a-f]{64}$'}}, ['planRef']),
    output: schema({planRef: {type: 'string'}, sessionId: {type: 'string'}, state: {const: 'preview'}, mutationPerformed: {const: false}, managerStateMutationPerformed: {const: true}}, ['planRef', 'sessionId', 'state', 'mutationPerformed', 'managerStateMutationPerformed']),
    errors: Object.freeze([error('MANAGER_PLAN_REF_INVALID', false, '使用同一次 request-plan 返回的完整 planRef'), error('MANAGER_PLAN_NOT_FOUND', true, '重新 request-plan 后再打开'), error('MANAGER_PLAN_EXPIRED', true, '刷新状态并生成新计划')]),
  }),
  status: Object.freeze({
    name: 'Foundation:status',
    description: '按不透明 planRef 纯只读返回 pending、preview、executing、completed、failed、cancelled 或 expired 以及 exact result/recovery guidance；不会重试或恢复。',
    input: schema({planRef: {type: 'string', pattern: '^foundation-plan-[0-9a-f]{64}$'}}, ['planRef']),
    output: schema({planRef: {type: 'string'}, state: {type: 'string'}, result: {type: 'object'}, recovery: {type: 'string'}, mutationPerformed: {const: false}}, ['planRef', 'state', 'mutationPerformed']),
    errors: Object.freeze([error('MANAGER_PLAN_REF_INVALID', false, '使用 request-plan 返回的完整 planRef'), error('MANAGER_PLAN_NOT_FOUND', true, '确认当前 runtime 后重新 request-plan')]),
  }),
});

function managerError(code, message, details = {}) {
  return new LifecycleError(code, message, {stage: 'local-lifecycle-manager', retryable: code === 'MANAGER_PLAN_STATE_DRIFT', recovery: '刷新只读检查与 exact plan，然后重新打开 Foundation 本地管理器', details});
}

function nearestExisting(value) {
  let cursor = value;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
  return cursor;
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertStateRoot(value, {plan = null} = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw managerError('MANAGER_STATE_ROOT_INVALID', 'manager stateRoot 必须是绝对路径');
  const root = path.resolve(value);
  if (root === path.parse(root).root) throw managerError('MANAGER_STATE_ROOT_INVALID', 'manager stateRoot 不得是文件系统根目录');
  const repository = path.resolve(import.meta.dirname, '../..');
  const repositoryTemporary = path.join(repository, '.tmp');
  const controlledRoots = [plan?.installationRoot, plan?.targetRoot]
    .filter((entry) => typeof entry === 'string' && path.isAbsolute(entry))
    .map((entry) => path.join(path.resolve(entry), 'state', 'local-manager'));
  let currentOwned = null;
  try { currentOwned = currentManagerStateRoot(); } catch {}
  const bootstrapOwned = plan?.bootstrap?.managerState?.path;
  if (plan && root !== currentOwned && root !== bootstrapOwned && !within(repositoryTemporary, root) && !controlledRoots.some((entry) => within(entry, root))) {
    throw managerError('MANAGER_STATE_ROOT_OUTSIDE_CONTROLLED_STATE', 'manager session 只能保存在 Foundation 安装 state/local-manager 或仓库隔离 .tmp 内');
  }
  const existing = nearestExisting(root);
  if (!existing || fs.lstatSync(existing).isSymbolicLink() || fs.realpathSync(existing) !== existing) throw managerError('MANAGER_STATE_ROOT_SYMLINK', 'manager stateRoot 或其已存在祖先拒绝符号链接/别名路径');
  return root;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

function planHash(plan) {
  const hash = plan?.integrity?.hash;
  if (!/^[0-9a-f]{64}$/u.test(hash || '')) throw managerError('MANAGER_PLAN_INVALID', 'exact plan 缺少有效完整性哈希');
  const {integrity, ...unsigned} = plan;
  if (hash !== sha256(canonicalStringify(unsigned))) throw managerError('MANAGER_PLAN_TAMPERED', 'exact plan 已被改写');
  return hash;
}

export function managerEffectForPlan(plan) {
  if (plan?.operation === 'offer-preference-update') return authorizationEffectForOfferPreferencePlan(plan);
  if (plan?.operation === 'normal-uninstall-project-detach') return authorizationEffectForNormalUninstallProjectPlan(plan);
  if (plan?.operation === 'normal-uninstall') return authorizationEffectForNormalUninstallCompositePlan(plan);
  if (['project-layout-migrate', 'project-data-purge'].includes(plan?.operation)) return authorizationEffectForProjectLayoutPlan(plan);
  if (['install', 'update', 'repair', 'rollback', 'uninstall', 'recover'].includes(plan?.operation) && plan?.targetRoot) return authorizationEffectForLifecyclePlan(plan);
  if (['enable', 'disable'].includes(plan?.operation) && plan?.bindingVersion) return authorizationEffectForProjectPlan(plan);
  if (['install', 'register', 'activate', 'deactivate', 'uninstall', 'recover'].includes(plan?.operation) && plan?.capabilityId) return authorizationEffectForCapabilityPlan(plan);
  if (plan?.operation === 'project-authority-recover') return authorizationEffectForProjectRecoveryPlan(plan);
  if (plan?.operation === 'project-mutation-recover') return authorizationEffectForProjectMutationRecoveryPlan(plan);
  if (plan?.handler && plan?.project) return authorizationEffectForProjectMutationPlan(plan);
  throw managerError('MANAGER_PLAN_UNSUPPORTED', `本地管理器不支持该 plan：${plan?.operation || 'unknown'}`);
}

function managerSubEffectsForPlan(plan) {
  return plan?.operation === 'normal-uninstall' ? authorizationEffectsForNormalUninstallCompositePlan(plan) : [];
}

function stringList(plan, ...keys) {
  return [...new Set(keys.flatMap((key) => Array.isArray(plan?.[key]) ? plan[key] : []).filter((value) => typeof value === 'string'))];
}

function targetRoots(effect) {
  return [...new Set((effect.targets || []).map((target) => target.path).filter(Boolean))];
}

function projectIdentitiesForPlan(plan) {
  const compositeEntries = plan?.projectPlan?.accessible;
  const detachEntries = plan?.accessible;
  const entries = Array.isArray(compositeEntries) ? compositeEntries : Array.isArray(detachEntries) ? detachEntries : plan?.project ? [{projectId: plan.projectId, realPath: plan.project, expectedBeforeState: plan.expectedBeforeState || plan.projectSnapshot?.protected}] : [];
  return entries.map((entry) => ({
    projectId: entry.projectId || null,
    path: entry.realPath || entry.project || null,
    expectedBeforeHash: entry.expectedBeforeState?.completeProjectHash || entry.expectedBeforeState?.hashes?.project || null,
  })).filter((entry) => entry.path);
}

export function createPendingLocalManagerSession({plan, stateRoot, now = Date.now()}) {
  const root = assertStateRoot(stateRoot, {plan});
  const hash = planHash(plan);
  if (!Number.isInteger(plan.expiresAt) || now > plan.expiresAt) throw managerError('MANAGER_PLAN_EXPIRED', 'exact plan 已过期');
  const effect = managerEffectForPlan(plan);
  const subEffects = managerSubEffectsForPlan(plan);
  const sessionId = `manager-session-${crypto.randomUUID()}`;
  const session = {
    schemaVersion: LOCAL_LIFECYCLE_MANAGER_VERSION,
    sessionId,
    operationId: plan.operationId || plan.planId,
    operation: plan.operation,
    planHash: hash,
    effectHash: effect.effectHash,
    effect,
    subEffects,
    targetRoots: targetRoots(effect),
    projectIdentities: projectIdentitiesForPlan(plan),
    creates: stringList(plan, 'creates'),
    replacements: stringList(plan, 'replacements', 'changes'),
    deletes: stringList(plan, 'deletes', 'removals'),
    preserves: stringList(plan, 'preserves'),
    fileCount: Number.isInteger(plan.fileCount) ? plan.fileCount : Number(plan.candidate?.fileCount || 0),
    byteCount: Number.isInteger(plan.byteCount) ? plan.byteCount : Number(plan.candidate?.bytes || plan.impact?.diskBytes || 0),
    protectedDataHashes: plan.protectedDataHashes || {},
    residuals: Array.isArray(plan.residuals) ? plan.residuals : [],
    expectedBeforeState: plan.expectedBeforeState || effect.expectedBeforeState,
    installationRoot: plan.targetRoot || plan.installationRoot || plan.lifecyclePlan?.targetRoot || null,
    lifecycleMode: plan.mode || plan.lifecyclePlan?.mode || null,
    currentVersion: plan.currentVersion || plan.lifecyclePlan?.currentVersion || null,
    targetVersion: plan.targetVersion || plan.lifecyclePlan?.targetVersion || plan.migration?.to || null,
    sourceIdentity: plan.candidate?.manifestHash || plan.migration?.from || null,
    ...(plan.hostCleanup ? {hostCleanup:plan.hostCleanup} : {}),
    createdAt: now,
    expiresAt: plan.expiresAt,
    state: 'pending',
    owner: {pid: process.pid, processFingerprint: observeProcessFingerprint(process.pid).fingerprint},
    recordLocation: plan.bootstrap ? path.join(root, 'terminal', `${sessionId}.json`) : path.join(root, 'sessions', `${sessionId}.json`),
    singleUse: true,
    confirmationAction: `confirm-${plan.operation}`,
    threatLimitation: LOCAL_LIFECYCLE_AI_SURFACE.threatLimitation,
    bootstrapPreview: plan.bootstrap || null,
  };
  const sessionFile = path.join(root, 'sessions', `${sessionId}.json`);
  const planFile = path.join(root, 'plans', `${sessionId}.json`);
  atomicJson(planFile, plan);
  atomicJson(sessionFile, session);
  return {session, sessionFile, planFile, stateRoot: root};
}

export function writeLocalManagerSession(record, updates) {
  const current = JSON.parse(fs.readFileSync(record.sessionFile, 'utf8'));
  const next = {...current, ...updates};
  atomicJson(record.sessionFile, next);
  record.session = next;
  return next;
}

export function readLocalLifecycleStatus({stateRoot, sessionId}) {
  const root = assertStateRoot(stateRoot);
  if (typeof sessionId !== 'string' || !/^manager-session-[0-9a-f-]+$/u.test(sessionId)) throw managerError('MANAGER_SESSION_ID_INVALID', 'manager sessionId 无效');
  const file = path.join(root, 'sessions', `${sessionId}.json`);
  if (!fs.existsSync(file)) return {schemaVersion: LOCAL_LIFECYCLE_MANAGER_VERSION, sessionId, state: 'not-found', mutationPerformed: false};
  const session = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {...visibleLocalManagerSession(session), mutationPerformed: false};
}

export function visibleLocalManagerSession(session, now = Date.now()) {
  let state = session.state;
  if (['executing', 'consumed'].includes(state) && classifyProcessOwner(session.owner) !== 'live') state = 'verification-required';
  if (state === 'pending' && now > session.expiresAt) state = 'expired';
  else if (state === 'pending' && session.owner && classifyProcessOwner(session.owner) !== 'live') state = 'verification-required';
  const visible = {...session, state, recordedState: session.state};
  return {...visible, feedback: lifecycleFeedback(visible)};
}

export function revalidateLocalManagerPlan(plan, {now = Date.now(), consumedEffectHashes = []} = {}) {
  planHash(plan);
  if (now > plan.expiresAt) throw managerError('MANAGER_CONFIRMATION_EXPIRED', 'manager confirmation 已过期');
  if (['project-layout-migrate', 'project-data-purge'].includes(plan.operation)) {
    const current = snapshotProtectedProjectData(plan.project);
    if (canonicalStringify(current) !== canonicalStringify(plan.expectedBeforeState)) throw managerError('MANAGER_PLAN_STATE_DRIFT', '项目路径、内容、identity、facts 或 expected-before 已变化', {expected: plan.expectedBeforeState.completeProjectHash, actual: current.completeProjectHash});
    return {ok: true};
  }
  if (plan.operation === 'normal-uninstall-project-detach') {
    for (const entry of plan.accessible) {
      const current = snapshotProtectedProjectData(entry.realPath);
      if (canonicalStringify(current) !== canonicalStringify(entry.expectedBeforeState)) throw managerError('MANAGER_PLAN_STATE_DRIFT', `normal uninstall 前项目已变化：${entry.projectId}`);
    }
    return {ok: true};
  }
  if (plan.operation === 'normal-uninstall') {
    const [projectEffect] = authorizationEffectsForNormalUninstallCompositePlan(plan);
    if (!consumedEffectHashes.includes(projectEffect.effectHash)) {
      for (const entry of plan.projectPlan.accessible) {
        const current = snapshotProtectedProjectData(entry.realPath);
        if (canonicalStringify(current) !== canonicalStringify(entry.expectedBeforeState)) throw managerError('MANAGER_PLAN_STATE_DRIFT', `normal uninstall 前项目已变化：${entry.projectId}`);
      }
    }
    const validation = validateLifecyclePlan(plan.lifecyclePlan, {now});
    if (!validation.ok) throw managerError(validation.error.code, validation.error.message, validation.error);
    return {ok: true};
  }
  if (plan.projectSnapshot?.protected && plan.project) {
    const current = snapshotProtectedProjectData(plan.project);
    if (canonicalStringify(current) !== canonicalStringify(plan.projectSnapshot.protected)) throw managerError('MANAGER_PLAN_STATE_DRIFT', '项目完整内容或 protected-data hashes 已变化', {expected: plan.projectSnapshot.protected.completeProjectHash, actual: current.completeProjectHash});
  }
  const validation = validateLifecyclePlan(plan, {now});
  if (plan.targetRoot && !validation.ok) throw managerError(validation.error.code, validation.error.message, validation.error);
  return {ok: true};
}

export function inspectLocalLifecycle({installationRoot, project = null, operationRequirement = null, capabilityId = null} = {}) {
  const result = {schemaVersion: LOCAL_LIFECYCLE_MANAGER_VERSION, aiSurface: LOCAL_LIFECYCLE_AI_SURFACE, supportedProjectOperations: closedProjectHandlerCatalog(), supportedLifecycleOptions: {update:['cleanupAcquisition'],updateCleanupExecutor:'confirmed-update-engine'}, mutationPerformed: false};
  if (installationRoot) result.installation = inspectInstallation(installationRoot);
  if (project) result.project = inspectProjectAuthority(project, {installationRoot});
  if (installationRoot) {
    result.bridge = resolveFoundationBridgeContext({installationRoot, project, operationRequirement: operationRequirement || (project || capabilityId ? 'project-skill-use' : 'lifecycle-inspect'), ...(capabilityId ? {capabilityId} : {})});
    if (result.bridge.capability) result.capability = result.bridge.capability;
  }
  return result;
}

function exactInput(value, allowed, code = 'MANAGER_REQUEST_INPUT_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw managerError(code, '输入必须是结构化 object');
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw managerError(code, `输入包含不允许字段：${unexpected.join(', ')}`);
}

function buildRequestedPlan(operation, parameters) {
  exactInput(parameters, [
    'profile', 'mode', 'targetRoot', 'sandboxRoot', 'currentVersion', 'targetVersion', 'candidate', 'extensions', 'aiBridge', 'recoverySnapshot',
    'project', 'installationRoot', 'createFromTemplate', 'rebind', 'manifestFile', 'projects', 'resultFile', 'decision', 'settingsFile',
    'handlerOperation', 'handlerPayload', 'preserves', 'capabilityIds', 'now', 'ttlMs', 'connectCodex', 'cleanupAcquisition',
  ]);
  const clean = structuredClone(parameters);
  if (['install', 'update', 'repair', 'rollback', 'uninstall', 'recover'].includes(operation)) {
    const lifecyclePlan = createLifecyclePlan({operation, ...clean});
    if (operation === 'uninstall' && fs.existsSync(path.join(lifecyclePlan.targetRoot, 'state', 'codex-skill-registration.json'))) throw managerError('CODEX_SKILL_DISCONNECT_REQUIRED', '请先单独请求 capability-uninstall 并确认 Codex Skill 停用范围，再卸载 Foundation');
    if (operation !== 'uninstall') return lifecyclePlan;
    const projects = Array.isArray(clean.projects) ? clean.projects : listProjectAuthorityRecords(clean.targetRoot);
    return createNormalUninstallCompositePlan({lifecyclePlan, projects, resultFile: clean.resultFile, now: clean.now});
  }
  if (['enable', 'disable'].includes(operation)) return createProjectAuthorityPlan({operation, ...clean});
  if (operation === 'project-layout-migrate') return createProjectLayoutMigrationPlan(clean);
  if (operation === 'project-data-purge') return createProjectDataPurgePlan(clean);
  if (operation === 'normal-uninstall-project-detach') return createNormalUninstallProjectPlan(clean);
  if (['capability-install', 'capability-register', 'capability-activate', 'capability-deactivate', 'capability-uninstall', 'capability-recover'].includes(operation)) return createCapabilityPlan({operation: operation.slice('capability-'.length), ...clean});
  if (operation === 'offer-preference-update') return createOfferPreferencePlan(clean);
  if (operation === 'project-authority-recover') return createProjectAuthorityRecoveryPlan(clean);
  if (operation === 'project-mutation-recover') return createProjectMutationRecoveryPlan(clean);
  if (operation === 'project-mutation') return createProjectMutationPlan({operation: clean.handlerOperation, ...clean});
  throw managerError('MANAGER_OPERATION_UNSUPPORTED', `request-plan 不支持 operation：${operation}`, {supported: ['install', 'update', 'repair', 'rollback', 'uninstall', 'recover', 'enable', 'disable', 'project-layout-migrate', 'project-data-purge', 'normal-uninstall-project-detach', 'capability-*', 'offer-preference-update', 'project-authority-recover', 'project-mutation-recover', 'project-mutation']});
}

function validatePlanRef(planRef, requiredCode = 'MANAGER_PLAN_REF_INVALID') {
  if (typeof planRef !== 'string' || !/^foundation-plan-[0-9a-f]{64}$/u.test(planRef)) throw managerError(requiredCode, '需要 request-plan 返回的完整不透明 planRef');
  return planRef;
}

function pendingFile(root, planRef) {
  return path.join(root, 'pending', `${planRef}.json`);
}

function readPending(root, planRef) {
  const file = pendingFile(root, planRef);
  if (!fs.existsSync(file)) throw managerError('MANAGER_PLAN_NOT_FOUND', '当前 Foundation runtime 中找不到该 pending plan；请重新 request-plan');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.planRef !== planRef || planHash(record.plan) !== record.planHash) throw managerError('MANAGER_PLAN_TAMPERED', 'pending exact plan 完整性不匹配；请重新 request-plan');
  return {file, record};
}

function planSummary(plan) {
  const effect = managerEffectForPlan(plan);
  return Object.freeze({operation: plan.operation, operationId: plan.operationId || plan.planId, planHash: plan.integrity.hash, targetRoots: targetRoots(effect), creates: stringList(plan, 'creates'), replacements: stringList(plan, 'replacements', 'changes'), deletes: stringList(plan, 'deletes', 'removals'), preserves: stringList(plan, 'preserves'), fileCount: Number.isInteger(plan.fileCount) ? plan.fileCount : Number(plan.candidate?.fileCount || 0), byteCount: Number.isInteger(plan.byteCount) ? plan.byteCount : Number(plan.candidate?.bytes || plan.impact?.diskBytes || 0), residuals: Array.isArray(plan.residuals) ? structuredClone(plan.residuals) : []});
}

function storeRequestedPlan({operation, parameters = {}} = {}) {
  if (typeof operation !== 'string' || !operation) throw managerError('MANAGER_OPERATION_REQUIRED', 'request-plan 需要一个明确 operation');
  const requestParameters = structuredClone(parameters);
  if (operation === 'uninstall' && !Array.isArray(requestParameters.projects)) requestParameters.projects = listProjectAuthorityRecords(requestParameters.targetRoot);
  const plan = buildRequestedPlan(operation, requestParameters);
  planHash(plan);
  const stateRoot = assertStateRoot(currentManagerStateRoot(), {plan});
  const planRef = `foundation-plan-${crypto.randomBytes(32).toString('hex')}`;
  const record = {schemaVersion: LOCAL_LIFECYCLE_MANAGER_VERSION, planRef, planHash: plan.integrity.hash, operation: plan.operation, requestParameters, createdAt: Date.now(), expiresAt: plan.expiresAt, state: 'pending', plan};
  atomicJson(pendingFile(stateRoot, planRef), record);
  return {stateRoot, plan, record, publicResult: {schemaVersion: LOCAL_LIFECYCLE_MANAGER_VERSION, planRef, summary: planSummary(plan), expiresAt: plan.expiresAt, aiMayApply: false, next: 'open-manager', mutationPerformed: false, managerStateMutationPerformed: true}};
}

export function requestLocalLifecyclePlan(input = {}) {
  return storeRequestedPlan(input).publicResult;
}

export function resolveLocalManagerPlanRefForInternalHost(input = {}) {
  exactInput(input, ['planRef'], 'MANAGER_OPEN_INPUT_INVALID');
  const planRef = validatePlanRef(input.planRef, input.planRef === undefined ? 'MANAGER_PLAN_REF_REQUIRED' : 'MANAGER_PLAN_REF_INVALID');
  const stateRoot = assertStateRoot(currentManagerStateRoot());
  const {file, record: pending} = readPending(stateRoot, planRef);
  if (Date.now() > pending.expiresAt) throw managerError('MANAGER_PLAN_EXPIRED', 'pending exact plan 已过期；请刷新检查并生成新计划');
  if (pending.state !== 'pending') throw managerError('MANAGER_PLAN_ALREADY_OPENED', '该 planRef 已建立 manager session；请只读查询 status', {state: pending.state, sessionId: pending.sessionId || null});
  const session = createPendingLocalManagerSession({plan: pending.plan, stateRoot});
  const updated = {...pending, state: 'preview', openedAt: Date.now(), sessionId: session.session.sessionId};
  atomicJson(file, updated);
  return {schemaVersion: LOCAL_LIFECYCLE_MANAGER_VERSION, planRef, sessionId: session.session.sessionId, state: 'preview', mutationPerformed: false, managerStateMutationPerformed: true, internal: {record: session, plan: pending.plan, stateRoot, pendingFile: file}};
}

export function openLocalLifecycleManagerPlan(input = {}) {
  const {internal: _internal, ...result} = resolveLocalManagerPlanRefForInternalHost(input);
  return result;
}

export function replaceDriftedLocalManagerPreviewForInternalHost(input = {}) {
  exactInput(input, ['planRef'], 'MANAGER_DRIFT_REPLAN_INPUT_INVALID');
  const planRef = validatePlanRef(input.planRef);
  const stateRoot = assertStateRoot(currentManagerStateRoot());
  const {record: previous} = readPending(stateRoot, planRef);
  if (previous.state !== 'preview' || !previous.requestParameters) throw managerError('MANAGER_DRIFT_REPLAN_UNAVAILABLE', '旧 preview 不包含可重新验证的原始 exact intent；请重新 request-plan');
  const parameters = structuredClone(previous.requestParameters);
  delete parameters.now;
  const replacement = storeRequestedPlan({operation: previous.operation, parameters});
  const opened = resolveLocalManagerPlanRefForInternalHost({planRef: replacement.publicResult.planRef});
  return {previousPlanRef: planRef, ...opened};
}

export function readLocalLifecycleOperationStatus(input = {}) {
  exactInput(input, ['planRef'], 'MANAGER_STATUS_INPUT_INVALID');
  const planRef = validatePlanRef(input.planRef, input.planRef === undefined ? 'MANAGER_PLAN_REF_REQUIRED' : 'MANAGER_PLAN_REF_INVALID');
  const stateRoot = assertStateRoot(currentManagerStateRoot());
  const {record: pending} = readPending(stateRoot, planRef);
  if (!pending.sessionId) return {schemaVersion: LOCAL_LIFECYCLE_MANAGER_VERSION, planRef, state: Date.now() > pending.expiresAt ? 'expired' : 'pending', expiresAt: pending.expiresAt, mutationPerformed: false, recovery: Date.now() > pending.expiresAt ? '刷新 inspect 并请求新计划' : null};
  const session = readLocalLifecycleStatus({stateRoot, sessionId: pending.sessionId});
  const visibleSessionState = session.state === 'pending' && pending.state === 'preview' ? 'preview' : session.state;
  const state = Date.now() > pending.expiresAt && ['pending', 'preview'].includes(visibleSessionState) ? 'expired' : visibleSessionState;
  return {schemaVersion: LOCAL_LIFECYCLE_MANAGER_VERSION, planRef, sessionId: pending.sessionId, state, result: session.result || null, failure: session.failure || null, feedback: session.feedback, recordLocation: session.recordLocation, expiresAt: pending.expiresAt, mutationPerformed: false, recovery: ['failed','verification-required'].includes(state) ? session.failure?.recovery || '只读核实当前安装与操作记录，不自动重试' : state === 'expired' ? '刷新 inspect 并生成新计划' : null};
}
