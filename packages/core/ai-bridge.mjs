import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {canonicalStringify, sha256} from './install-contract.mjs';
import {inspectCapabilityStatus} from './capability-authority.mjs';
import {inspectProjectAuthority} from './project-authority.mjs';
import {inspectProjectLayout} from './project-layout.mjs';
import {inspectCurrentInstallationAuthority, verifyCurrentInstallationAppAuthority} from './transaction-engine.mjs';
import {
  readFoundationRuntimeDescriptor,
  resolveFoundationCapabilityStateSources,
  validateFoundationRuntimeDescriptor,
  verifyFoundationRuntimeEndpoint,
} from './runtime-descriptor.mjs';

export {readFoundationRuntimeDescriptor, validateFoundationRuntimeDescriptor} from './runtime-descriptor.mjs';

export const BRIDGE_OPERATION_REQUIREMENTS = Object.freeze({
  'lifecycle-inspect': Object.freeze({capabilityRequired: false}),
  'project-skill-use': Object.freeze({capabilityRequired: true}),
  'plugin-use': Object.freeze({capabilityRequired: true}),
});

export const AI_BRIDGE_CAPABILITY = Object.freeze({
  schemaVersion: '1.0.0',
  name: 'foundation-lifecycle',
  versionNeutral: true,
  firstOperationalStep: 'resolve-current-foundation-context-read-only',
  inactiveArtifactBehavior: 'inert-untrusted-reference-only',
  requiresLocalToolPermission: true,
  noPermissionBehavior: 'explain-and-provide-command-only',
  flow: ['inspect', 'request-plan', 'open-foundation-local-manager', 'read-status'],
  commands: {manager: ['inspect', 'request-plan', 'open-manager', 'status']},
  stateChangeContract: {
    genericYesAllowed: false,
    boundPlanRequired: true,
    planHashIsAuthorization: false,
    callerVisibleCredentialAccepted: false,
    managerConfirmationRequired: true,
    trustedHostBrokerReceiptRequired: false,
    confirmationSingleUse: true,
    verifyRequired: true,
    unavailableBehavior: 'inert-read-only',
  },
  projectAuthority: {
    primaryUserEntrypoint: 'natural-language-conversation',
    aiMayApply: false,
    explicitIntentRequired: true,
    ambiguousCloseRequiresClarification: true,
    disableMeaning: 'stop-project-management-preserve-project-and-foundation-facts-not-uninstall',
    flow: ['understand-explicit-object', 'inspect', 'request-exact-plan', 'show-exact-path-changes-preserves', 'open-foundation-local-manager', 'read-status'],
  },
  distribution: {skill: {scope: 'candidate-artifact', status: 'inert-unregistered-inactive'}, plugin: {status: 'upgrade-interface', published: false}},
});

const RECOVERY = Object.freeze({
  BRIDGE_INPUT_INVALID: '只提供 installationRoot、project、operationRequirement 和 capabilityId；不得提供 caller capability status、路径覆盖或 callback',
  FOUNDATION_NOT_HEALTHY: '选择 installed current 且 lifecycle recovery 为 clean 的 Foundation；不要在 inspect 中自动修复',
  FOUNDATION_CURRENT_RECEIPT_INVALID: '通过单独的 exact repair/update plan 恢复 current receipt-owned app/runtime 后重新 inspect',
  RUNTIME_DESCRIPTOR_INVALID: '通过单独的 exact repair/update plan 恢复匹配 current identity 的 runtime descriptor',
  RUNTIME_ENDPOINT_MISSING: '通过单独的 exact repair/update plan 恢复 descriptor-bound endpoint；不得回退到旧 bundled copy',
  RUNTIME_ENDPOINT_UNSAFE: '选择没有绝对路径、..、反斜杠、符号链接或不支持类型的 current runtime endpoint',
  RUNTIME_ENDPOINT_IDENTITY_MISMATCH: '通过单独的 exact repair/update plan 恢复 descriptor/receipt 匹配的 endpoint 内容',
  CAPABILITY_NOT_DECLARED: '为该任务指定 current descriptor 声明的 capabilityId，或使用显式 lifecycle-inspect requirement',
  CAPABILITY_NOT_INSTALLED: '通过独立 capability install plan 和本地管理器确认安装；inspect 不会安装',
  CAPABILITY_STATE_MALFORMED: '通过独立 capability control plan 或 repair 流程处理损坏状态；inspect 不会重写',
  CAPABILITY_STATE_INTEGRITY_INVALID: '验证 Foundation-owned capability state authority，并通过独立确认流程修复；inspect 不会重写',
  CAPABILITY_STATE_SCHEMA_INVALID: '通过单独 manager-confirmed migration/repair plan 更新 capability state schema；inspect 不会兼容性改写',
  CAPABILITY_IDENTITY_MISMATCH: '安装与 current descriptor/receipt identity 匹配的 capability 后重新 inspect',
  CAPABILITY_REGISTRATION_STATE_MALFORMED: '通过独立 capability control plan 或 repair 流程处理损坏 registration state；inspect 不会重写',
  CAPABILITY_REGISTRATION_STATE_INTEGRITY_INVALID: '验证 Foundation-owned registration state authority，并通过独立确认流程修复；inspect 不会重写',
  CAPABILITY_REGISTRATION_IDENTITY_MISMATCH: '通过独立 register plan 建立与 current install、manifest 和本地管理器完全匹配的 registration',
  CAPABILITY_NOT_REGISTERED: '通过独立 capability register plan 和本地管理器确认注册；inspect 不会注册',
  CAPABILITY_INACTIVE: '通过独立 capability activate plan 和本地管理器确认激活；inspect 不会激活',
  CAPABILITY_STATE_UNSAFE: '将 capability state 放回 descriptor 指定的 Foundation-owned 普通文件路径后重新 inspect',
  PROJECT_REQUIRED: '提供本次 project-skill-use 或 projectScoped capability 对应的明确项目绝对路径，然后重新 inspect',
  PROJECT_DISABLED: '通过自然语言请求 exact enable plan，并在 Foundation 本地管理器确认',
  PROJECT_AUTHORITY_MISMATCH: '先只读检查 portable binding 与 signed machine registry 的差异；如确需继续，生成 explicit rebind/enable plan 并在本地管理器确认',
  PROJECT_DATA_INCOMPATIBLE_READ_ONLY: '使用 current runtime 支持的数据格式，或请求单独的 exact migration plan',
});

function inert(reason, details = {}) {
  return Object.freeze({schemaVersion: '1.0.0', state: 'inert', reason, usable: false, mutationPerformed: false, recovery: details.recovery || RECOVERY[reason] || '检查当前 Foundation 安装、endpoint、capability 与项目状态后重新 inspect；不要自动修复或激活', ...details});
}

function failure(error, details = {}) {
  const code = error?.code || 'RUNTIME_DESCRIPTOR_INVALID';
  return inert(code, {...details, recovery: RECOVERY[code] || error?.recovery});
}

function exactBridgeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  return Object.keys(input).every((key) => ['installationRoot', 'project', 'operationRequirement', 'capabilityId'].includes(key));
}

export function resolveFoundationBridgeContext(input = {}) {
  if (!exactBridgeInput(input)) return inert('BRIDGE_INPUT_INVALID');
  const {installationRoot, project = null, capabilityId: requestedCapabilityId = null} = input;
  const operationRequirement = input.operationRequirement || (project || requestedCapabilityId ? 'project-skill-use' : null);
  if (!BRIDGE_OPERATION_REQUIREMENTS[operationRequirement]) return inert('BRIDGE_INPUT_INVALID', {operationRequirement: operationRequirement || null, recovery: '显式使用 lifecycle-inspect、project-skill-use 或 plugin-use；capability-use 不得通过省略参数推断为 ready'});
  if (typeof installationRoot !== 'string' || !path.isAbsolute(installationRoot)) return inert('FOUNDATION_NOT_HEALTHY');

  let authority;
  try { authority = inspectCurrentInstallationAuthority(installationRoot); }
  catch (error) { return failure(error); }
  const {installation, current} = authority;
  const currentIdentityHash = sha256(canonicalStringify(current));
  const base = {currentVersion: current.version, currentIdentityHash, currentReceiptHash: authority.receiptHash, recoveryState: installation.recovery.status};
  const appRoot = path.join(installationRoot, ...current.appPath.split('/'));
  const descriptorFile = path.join(appRoot, 'foundation-runtime-descriptor.json');

  let descriptor;
  try { descriptor = readFoundationRuntimeDescriptor(descriptorFile, {current}); }
  catch (error) { return failure(error, base); }
  const descriptorHash = descriptor.integrity.hash;
  let endpoint;
  try { endpoint = verifyFoundationRuntimeEndpoint({appRoot, descriptor}); }
  catch (error) { return failure(error, {...base, descriptorHash}); }
  try { verifyCurrentInstallationAppAuthority(authority); }
  catch (error) { return failure(error, {...base, descriptorHash, endpointHealth: endpoint}); }

  let stateSources;
  try { stateSources = resolveFoundationCapabilityStateSources({installationRoot, descriptor}); }
  catch (error) { return failure(error, {...base, descriptorHash, endpointHealth: endpoint}); }

  let declaration = null;
  if (BRIDGE_OPERATION_REQUIREMENTS[operationRequirement].capabilityRequired) {
    const bundled = descriptor.capabilityFacts.bundled;
    declaration = requestedCapabilityId ? bundled.find((entry) => entry.capabilityId === requestedCapabilityId) : bundled.length === 1 ? bundled[0] : null;
    if (!declaration) return inert('CAPABILITY_NOT_DECLARED', {...base, descriptorHash, endpointHealth: endpoint, projectId: null, requestedCapabilityId, declaredCapabilityIds: bundled.map((entry) => entry.capabilityId).sort()});
  } else if (requestedCapabilityId) return inert('BRIDGE_INPUT_INVALID', {...base, descriptorHash, endpointHealth: endpoint, recovery: 'lifecycle-inspect 不接受 capabilityId；需要使用 capability 时显式选择 project-skill-use 或 plugin-use'});

  const projectRequired = operationRequirement === 'project-skill-use' || declaration?.projectScoped === true;
  if (projectRequired && !project) return inert('PROJECT_REQUIRED', {...base, descriptorHash, endpointHealth: endpoint, capabilityId: declaration?.capabilityId || null});

  let projectId = null;
  let dataFormat = null;
  let projectAuthority = null;
  let projectAuthorityIdentity = null;
  if (project) {
    projectAuthority = inspectProjectAuthority(project, {installationRoot});
    if ((projectAuthority.state === 'disabled' && projectAuthority.agreement === true && projectAuthority.reason === 'project-disabled') || projectAuthority.reason === 'no-portable-binding') return inert('PROJECT_DISABLED', {...base, descriptorHash, endpointHealth: endpoint, projectId: projectAuthority.projectId || null, projectAuthority});
    if (projectAuthority.state !== 'enabled' || projectAuthority.agreement !== true) return inert('PROJECT_AUTHORITY_MISMATCH', {...base, descriptorHash, endpointHealth: endpoint, projectId: projectAuthority.projectId || null, projectAuthority});
    let layout;
    try { layout = inspectProjectLayout(project); }
    catch { return inert('PROJECT_AUTHORITY_MISMATCH', {...base, descriptorHash, endpointHealth: endpoint, projectAuthority, recovery: '项目 authority 已通过但 identity layout 无法读取；先只读诊断并通过独立 repair plan 修复'}); }
    projectId = layout.projectId;
    if (!projectId || projectId !== projectAuthority.projectId) return inert('PROJECT_AUTHORITY_MISMATCH', {...base, descriptorHash, endpointHealth: endpoint, projectId, projectAuthority});
    projectAuthorityIdentity = projectAuthority.authorityIdentity;
    dataFormat = layout.identity?.dataFormatVersion || layout.identity?.legacyFoundation?.dataFormatVersion || null;
    if (!dataFormat || !descriptor.supportedProjectDataFormats.includes(dataFormat)) return inert('PROJECT_DATA_INCOMPATIBLE_READ_ONLY', {...base, descriptorHash, endpointHealth: endpoint, projectId, projectAuthority, dataFormat, supportedProjectDataFormats: descriptor.supportedProjectDataFormats, compatibility: 'read-only'});
  }

  let capability = Object.freeze({required: false, code: 'CAPABILITY_NOT_REQUIRED', usable: false});
  let capabilityId = null;
  let capabilityActiveIdentity = null;
  if (BRIDGE_OPERATION_REQUIREMENTS[operationRequirement].capabilityRequired) {
    capabilityId = declaration.capabilityId;
    const manifestFile = path.join(endpoint.path, ...declaration.manifestPath.split('/'));
    const relative = path.relative(endpoint.path, manifestFile);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(manifestFile) || fs.lstatSync(manifestFile).isSymbolicLink() || !fs.statSync(manifestFile).isFile()) return inert('CAPABILITY_IDENTITY_MISMATCH', {...base, descriptorHash, endpointHealth: endpoint, projectId, capabilityId});
    capability = inspectCapabilityStatus({installationRoot, manifestFile, project});
    if (capability.capabilityId && (capability.capabilityId !== declaration.capabilityId || capability.type !== declaration.type || capability.version !== declaration.version || capability.projectScoped !== declaration.projectScoped)) capability = {...capability, code: 'CAPABILITY_IDENTITY_MISMATCH', usable: false};
    if (capability.code !== 'CAPABILITY_READY' || capability.usable !== true) return inert(capability.code || 'CAPABILITY_INACTIVE', {...base, descriptorHash, endpointHealth: endpoint, projectId, projectAuthority, capabilityId, capability, capabilityStateSources: stateSources});
    capabilityActiveIdentity = capability.stateIdentity;
  }

  return Object.freeze({
    schemaVersion: '1.0.0',
    state: 'ready',
    usable: true,
    operationRequirement,
    currentVersion: current.version,
    currentIdentityHash,
    currentReceiptHash: authority.receiptHash,
    descriptorHash,
    descriptorHealthIdentity: descriptor.healthIdentity,
    installationHealth: Object.freeze({code: 'FOUNDATION_HEALTHY', recovery: installation.recovery.status, currentIdentityVerified: true, receiptVerified: true, runtimeVerified: true, appVerified: true}),
    endpointHealth: endpoint,
    currentRuleEndpoint: endpoint.path,
    currentRuleEndpointIdentity: endpoint.treeHash,
    supportedProjectDataFormats: descriptor.supportedProjectDataFormats,
    projectId,
    projectAuthority,
    projectAuthorityIdentity,
    dataFormat,
    capabilityId,
    capability,
    capabilityActiveIdentity,
    capabilityStateSources: stateSources,
    mutationPerformed: false,
  });
}

export function openFoundationBridgeTask({resolved}) {
  if (resolved?.state !== 'ready') throw new Error('FOUNDATION_CONTEXT_NOT_READY：bridge 只能为当前 ready context 打开任务');
  return Object.freeze({schemaVersion: '1.0.0', taskContextId: `foundation-task-${crypto.randomUUID()}`, openedAt: Date.now(), state: 'current', binding: {currentVersion: resolved.currentVersion, currentIdentityHash: resolved.currentIdentityHash, currentReceiptHash: resolved.currentReceiptHash || null, descriptorHash: resolved.descriptorHash || null, currentRuleEndpointIdentity: resolved.currentRuleEndpointIdentity || null, projectAuthorityIdentity: resolved.projectAuthorityIdentity || null, capabilityActiveIdentity: resolved.capabilityActiveIdentity || null, operationRequirement: resolved.operationRequirement || null, projectId: resolved.projectId || null, capabilityId: resolved.capabilityId || null}});
}

export function inspectFoundationBridgeTask(task, {resolved}) {
  if (!task?.binding) throw new Error('FOUNDATION_TASK_CONTEXT_INVALID');
  const binding = {currentVersion: resolved?.currentVersion || null, currentIdentityHash: resolved?.currentIdentityHash || null, currentReceiptHash: resolved?.currentReceiptHash || null, descriptorHash: resolved?.descriptorHash || null, currentRuleEndpointIdentity: resolved?.currentRuleEndpointIdentity || null, projectAuthorityIdentity: resolved?.projectAuthorityIdentity || null, capabilityActiveIdentity: resolved?.capabilityActiveIdentity || null, operationRequirement: resolved?.operationRequirement || null, projectId: resolved?.projectId || null, capabilityId: resolved?.capabilityId || null};
  if (resolved?.state !== 'ready' || canonicalStringify(task.binding) !== canonicalStringify(binding)) return {schemaVersion: '1.0.0', taskContextId: task.taskContextId, state: 'stale', action: 'refresh-or-reopen-task', reason: resolved?.reason || 'FOUNDATION_CONTEXT_CHANGED', previous: task.binding, current: binding, mutationPerformed: false};
  return {schemaVersion: '1.0.0', taskContextId: task.taskContextId, state: 'current', binding: task.binding, mutationPerformed: false};
}

export function aiInvocation(operation, phase, parameters = {}) {
  if (!['inspect', 'request-plan', 'open-manager', 'status'].includes(phase)) throw new Error(`AI bridge 不支持阶段：${phase}；AI 不得调用 confirm/apply/recover/purge`);
  return {schemaVersion: '1.0.0', tool: 'foundation-kit', operation, phase, parameters: structuredClone(parameters), aiMayApply: false};
}
