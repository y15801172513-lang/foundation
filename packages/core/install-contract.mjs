import crypto from 'node:crypto';
import path from 'node:path';
import {assertTrustedCandidatePath, deriveTrustedLifecycleAuthority, snapshotTrustedTarget} from './trusted-authority.mjs';
import {currentRuntimeIdentity} from './runtime-surface.mjs';
import {snapshotUpdateInputs} from './update-input-inventory.mjs';

const compatibility = Object.freeze({major: 'reject', minor: 'forward-compatible'});
const schema = (name) => Object.freeze({name, schemaVersion: '1.0.0', compatibility, unknownFields: 'ignore-non-security-critical'});

export const INSTALL_CONTRACT_SCHEMAS = Object.freeze({
  supportMatrix: schema('foundation.support-matrix'),
  releaseManifest: schema('foundation.release-manifest'),
  installPlan: schema('foundation.install-plan'),
  operationJournal: schema('foundation.operation-journal'),
  ownershipReceipt: schema('foundation.ownership-receipt'),
  extensionManifest: schema('foundation.extension-manifest'),
  structuredError: schema('foundation.structured-error'),
  capabilityStatus: schema('foundation.capability-status'),
  projectBinding: schema('foundation.project-binding'),
  projectRegistration: schema('foundation.project-registration'),
  projectAuthorityPlan: schema('foundation.project-authority-plan'),
  humanAuthorizationEffect: schema('foundation.human-authorization-effect'),
  humanAuthorizationReceipt: schema('foundation.human-authorization-receipt'),
  capabilityManifest: schema('foundation.capability-manifest'),
  capabilityReceipt: schema('foundation.capability-receipt'),
  capabilityRegistration: schema('foundation.capability-registration'),
  offerPreference: schema('foundation.offer-preference'),
});

export const LIFECYCLE_PROFILES = Object.freeze({
  recommended: Object.freeze({label: '推荐安装', runtime: true, managementCenter: true, aiBridge: true, extensions: ['shadcn']}),
  core: Object.freeze({label: '只装核心', runtime: true, managementCenter: true, aiBridge: false, extensions: []}),
  custom: Object.freeze({label: '自定义', runtime: true, managementCenter: true, aiBridge: 'selectable', extensions: []}),
});

export class LifecycleError extends Error {
  constructor(code, message, {stage = 'contract', retryable = false, recovery = '请检查计划后重试', details = {}} = {}) {
    super(message);
    this.name = 'LifecycleError';
    this.code = code;
    this.stage = stage;
    this.retryable = retryable;
    this.recovery = recovery;
    this.details = details;
  }

  toJSON() {
    return {schemaVersion: INSTALL_CONTRACT_SCHEMAS.structuredError.schemaVersion, code: this.code, stage: this.stage, retryable: this.retryable, message: this.message, recovery: this.recovery, details: this.details};
  }
}

export function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return crypto.createHash('sha256').update(input).digest('hex');
}

function actionsFor({operation, mode, extensions, aiBridge}) {
  if (operation === 'install') return ['validate-candidate', 'stage', 'install-private-runtime', 'install-application', 'executable-health-check', 'write-path-shim', 'switch-current', ...(aiBridge ? ['retain-inert-ai-capability-artifact'] : []), ...extensions.map((name) => `extension-plan:${name}`)];
  if (operation === 'update') return ['validate-current', 'validate-candidate', 'stage', 'health-check', 'switch-current', 'retain-rollback'];
  if (operation === 'repair') return ['verify-owned-files', 'quarantine-modified', 'restore-owned-files', 'health-check'];
  if (operation === 'rollback') return ['validate-retained-version', 'integrity-check', 'health-check', 'switch-current'];
  if (operation === 'uninstall') return ['inventory-owned-files', 'show-delete-scope', `remove:${mode}`, 'preserve-user-projects', 'write-uninstall-result'];
  if (operation === 'recover') return ['inspect-authorized-journal-scope', 'recover-exact-journals', 'verify-recovered-state'];
  throw new LifecycleError('OPERATION_UNSUPPORTED', `不支持的生命周期操作：${operation}`);
}

export function createLifecyclePlan({operation, profile = 'core', mode = null, targetRoot, sandboxRoot, currentVersion = null, targetVersion = null, installIdentity = 'current-user', candidate = null, extensions, aiBridge, recoverySnapshot = null, cleanupAcquisition = false, now = Date.now(), ttlMs = 15 * 60 * 1000}) {
  if(typeof cleanupAcquisition!=='boolean'||cleanupAcquisition&&operation!=='update')throw new LifecycleError('CLEANUP_INTENT_INVALID','本次获取清理仅作为更新计划的意向，不是执行批准');
  if (!LIFECYCLE_PROFILES[profile]) throw new LifecycleError('PROFILE_INVALID', `未知安装方式：${profile}`);
  if (operation === 'uninstall' && !['app-only', 'app-and-runtime', 'full'].includes(mode)) throw new LifecycleError('UNINSTALL_MODE_INVALID', '卸载必须明确选择 app-only、app-and-runtime 或 full');
  if (['install', 'update', 'repair'].includes(operation) && (!candidate?.path || !/^[0-9a-f]{64}$/u.test(candidate.manifestHash || ''))) throw new LifecycleError('CANDIDATE_REQUIRED', `${operation} 计划需要绑定已验证候选包`);
  const authority = deriveTrustedLifecycleAuthority();
  const {platform, arch} = currentRuntimeIdentity();
  const trustedTarget = snapshotTrustedTarget(targetRoot, authority);
  const target = trustedTarget.target;
  const sandbox = sandboxRoot ? path.resolve(sandboxRoot) : authority.trustedRootRealPath;
  if (candidate?.path) assertTrustedCandidatePath(candidate.path, authority);
  const selectedExtensions = [...(extensions ?? LIFECYCLE_PROFILES[profile].extensions)].sort();
  const selectedAiBridge = profile === 'recommended' ? true : profile === 'core' ? false : aiBridge === true;
  const installId = `install-${sha256(canonicalStringify({targetRelative: trustedTarget.targetRelative, platform, arch, installIdentity})).slice(0, 24)}`;
  const seed = {
    schemaVersion: INSTALL_CONTRACT_SCHEMAS.installPlan.schemaVersion,
    operation,
    profile,
    mode,
    targetRoot: target,
    sandboxRoot: sandbox,
    sandboxRootAuthority: 'advisory-only',
    authority: {
      ...authority,
      targetRelative: trustedTarget.targetRelative,
      targetSnapshot: trustedTarget.snapshot,
    },
    currentVersion,
    targetVersion,
    installIdentity,
    installId,
    platform,
    arch,
    createdAt: now,
    expiresAt: now + ttlMs,
    candidate: candidate ? {
      path: path.resolve(candidate.path),
      manifestHash: candidate.manifestHash,
      runtimeHash: candidate.runtimeHash || null,
      bytes: Number(candidate.bytes || 0),
      version: candidate.version || targetVersion,
      acquisition: candidate.acquisition || 'local-ingestion',
      remoteAcquisition: 'pending',
    } : null,
    extensions: selectedExtensions,
    selection: {privateRuntime: true, foundationCore: true, managementCenter: true, aiBridge: selectedAiBridge, extensions: selectedExtensions},
    actions: actionsFor({operation, mode, extensions: selectedExtensions, aiBridge: selectedAiBridge}),
    recoverySnapshot,
    ...(cleanupAcquisition ? {hostCleanup:snapshotUpdateInputs(candidate,target)} : {}),
    impact: {
      diskBytes: Number(candidate?.bytes || 0),
      downloadBytes: 0,
      networkRequired: false,
      administratorRequired: false,
      modifiesUserProjects: false,
      rollback: ['install', 'update', 'repair'].includes(operation) ? 'journal-and-previous-current' : 'ownership-receipt-only',
    },
  };
  const planId = `plan-${sha256(canonicalStringify(seed)).slice(0, 24)}`;
  const unsigned = {...seed, planId};
  const hash = sha256(canonicalStringify(unsigned));
  return {...unsigned, integrity: {algorithm: 'sha256', hash}};
}

export function validateLifecyclePlan(plan, {now = Date.now()} = {}) {
  try {
    if (!plan || plan.schemaVersion !== INSTALL_CONTRACT_SCHEMAS.installPlan.schemaVersion) throw new LifecycleError('PLAN_SCHEMA_UNSUPPORTED', '计划 schema 不受支持');
    const {integrity, ...unsigned} = plan;
    const expected = sha256(canonicalStringify(unsigned));
    if (!integrity || integrity.algorithm !== 'sha256' || integrity.hash !== expected) throw new LifecycleError('PLAN_TAMPERED', '计划内容或完整性哈希已被改写', {stage: 'plan-validation'});
    if (now > plan.expiresAt) throw new LifecycleError('PLAN_EXPIRED', '计划已过期，请重新生成', {stage: 'plan-validation', retryable: true, recovery: '重新运行对应的 plan 命令'});
    const authority = deriveTrustedLifecycleAuthority();
    if (plan.authority?.mode !== authority.mode || plan.authority?.repositoryRealPath !== authority.repositoryRealPath || plan.authority?.trustedRootRealPath !== authority.trustedRootRealPath || plan.authority?.authorityStateRoot !== authority.authorityStateRoot || plan.authority?.authorityStateBoundaryRoot !== authority.authorityStateBoundaryRoot || plan.authority?.installRoot !== authority.installRoot || plan.authority?.candidateRootRealPath !== authority.candidateRootRealPath) throw new LifecycleError('TRUSTED_AUTHORITY_CHANGED', 'Foundation source/candidate/installed authority 与计划不一致', {stage: 'plan-validation'});
    return {ok: true, plan};
  } catch (error) {
    const normalized = error instanceof LifecycleError ? error : new LifecycleError('PLAN_INVALID', error.message);
    return {ok: false, error: normalized.toJSON()};
  }
}

export function explainLifecyclePlan(plan) {
  const profile = LIFECYCLE_PROFILES[plan.profile]?.label || plan.profile;
  const operation = {install: '安装', update: '更新', repair: '修复', rollback: '回退', uninstall: '卸载'}[plan.operation] || plan.operation;
  const keep = plan.operation === 'uninstall'
    ? ({'app-only': '保留私有运行环境、AI/组件接入、缓存日志、恢复归属状态和用户产品项目', 'app-and-runtime': '删除当前安装独占的私有运行环境；保留 AI/组件接入、缓存日志、恢复归属状态和用户产品项目', full: '删除当前安装拥有的 operational state；仅保留最小结果、被修改/未知归属文件、外部共享 runtime 和用户产品项目'}[plan.mode])
    : '用户产品项目和 .foundation/facts 始终不变';
  return [
    `计划 ${plan.planId}：${operation}（${profile}）`,
    `写入位置：${plan.targetRoot}`,
    `目标版本：${plan.targetVersion || '不适用'}；当前版本：${plan.currentVersion || '未安装'}`,
    `安装内容：Foundation 核心、管理中心、私有运行环境${plan.selection.aiBridge ? '、惰性 AI capability artifact（不注册、不激活）' : ''}${plan.extensions.length ? `、组件适配计划（${plan.extensions.join('、')}，默认不激活）` : ''}`,
    `下载量：${plan.impact.downloadBytes} 字节；预计新增磁盘：${plan.impact.diskBytes} 字节`,
    `联网：${plan.impact.networkRequired ? '需要' : '不需要'}；管理员权限：${plan.impact.administratorRequired ? '需要' : '不需要'}`,
    `候选获取：${plan.candidate ? '本地候选摄取' : '不适用'}；远程下载：pending（本候选阶段未实现）`,
    `会不会改用户项目：${plan.impact.modifiesUserProjects ? '会' : '不会'}`,
    `失败恢复：${plan.impact.rollback}`,
    `保留内容：${keep}`,
    `计划完整性 SHA-256：${plan.integrity.hash}`,
    '人类授权：尚未取得；计划本身、哈希、AI 文本或通用确认都不能授权 apply',
  ].join('\n');
}
