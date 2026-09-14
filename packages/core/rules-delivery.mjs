import fs from 'node:fs';
import path from 'node:path';
import {resolveFoundationBridgeContext} from './ai-bridge.mjs';
import {LifecycleError} from './install-contract.mjs';
import {inspectProjectPreparation} from './facts.mjs';
import {effectiveProjectPolicy} from './ui-policy.mjs';

const fail = (code, message) => { throw new LifecycleError(code, message, {stage: 'foundation-rules'}); };

// A diagnostic workspace may display existing facts without adopting rules.
// No previous rule/policy is used when current rules cannot be verified. The
// strict CLI reader still fails, and mutation authority remains independently
// enforced by the existing manager and exact-handler gates.
export function readProjectPolicyForDisplay(options) {
  try { return readCurrentFoundationRules(options).effectivePolicy; }
  catch (error) {
    if (!String(error.code || '').startsWith('RULES_')) throw error;
    return {version: null, governanceMode: 'unconfigured', classification: 'unknown', authority: 'current-rules-unavailable-no-fallback', state: 'unavailable', executable: false, ruleVersion: null, adoptedRuleVersion: null, currentIdentityHash: null, endpointIdentity: null, exceptions: [], reason: error.code, message: error.message};
  }
}

// The endpoint is accepted only after the existing installed receipt and complete
// descriptor tree verification. A caller-supplied version or boolean is not proof.
export function readCurrentFoundationRules({installationRoot, project = null} = {}) {
  const bridge = resolveFoundationBridgeContext({installationRoot, ...(project ? {project} : {}), operationRequirement: 'lifecycle-inspect'});
  if (!bridge.usable || bridge.state !== 'ready') fail('RULES_CURRENT_UNAVAILABLE', '当前安装或项目绑定不可用；不回退到旧规则或源码');
  const directory = path.join(bridge.currentRuleEndpoint, 'rules');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')); }
  catch { fail('RULES_MANIFEST_UNAVAILABLE', '当前安装未提供可读的制作规范清单，需要独立更新或修复'); }
  const keys = ['schemaVersion', 'ruleVersion', 'adoptionSchemaVersion', 'supportedDataFormats', 'documents', 'compatibility'];
  if (Object.keys(manifest).length !== keys.length || keys.some(key => !(key in manifest)) || manifest.schemaVersion !== '1.0.0' || manifest.adoptionSchemaVersion !== '1.0.0' || !/^1\.\d+\.\d+$/u.test(manifest.ruleVersion) || JSON.stringify(manifest.documents) !== '["foundation-making.md","lifecycle-guide.md"]' || !Array.isArray(manifest.supportedDataFormats) || manifest.compatibility !== 'same-rule-major-and-adoption-schema') fail('RULES_MANIFEST_INCOMPATIBLE', '制作规范格式或主版本不兼容；保持只读，不自动迁移');
  if (project && !manifest.supportedDataFormats.includes(bridge.dataFormat)) fail('RULES_DATA_INCOMPATIBLE', '规则不支持本项目数据格式；保留资料，单独评估迁移');
  const documents = manifest.documents.map(name => ({name, path: path.join(directory, name), content: fs.readFileSync(path.join(directory, name), 'utf8')}));
  let adoption = null;
  if (project) {
    const file = path.join(project, '.foundation/identity/rules-adoption.json');
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('RULES_ADOPTION_UNSAFE', '项目采用记录不是普通文件');
      adoption = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (adoption.schemaVersion !== manifest.adoptionSchemaVersion || adoption.ruleMajor !== 1 || adoption.projectId !== bridge.projectId || adoption.installationRoot !== installationRoot || !Array.isArray(adoption.exceptions)) fail('RULES_ADOPTION_INCOMPATIBLE', '项目采用记录与当前身份或规则不兼容；保留例外，停止规则执行');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const preparation = project ? inspectProjectPreparation(project) : null;
  const policy = project ? effectiveProjectPolicy({identity: preparation.identity, adoption, ruleVersion: manifest.ruleVersion, programVersion: bridge.currentVersion, currentIdentityHash: bridge.currentIdentityHash, endpointIdentity: bridge.currentRuleEndpointIdentity, factsReady: preparation.factsReady}) : null;
  if (policy?.state === 'incompatible') fail('RULES_ADOPTION_INCOMPATIBLE', '采用策略与项目身份/技术栈不兼容，保留并停止');
  const nextStep = !project ? {action: 'select-project', message: '选择精确项目，单独确认接入'}
    : preparation.state === 'blocked' ? {action: 'resolve-conflict', message: '保留原文件，先核实列出的事实冲突', errors: preparation.errors}
    : !preparation.factsReady ? {action: 'confirm-project-preparation', operation: 'foundation-skeleton-and-facts-create', handlerPayload: {includePreview: false}, missing: preparation.missing, message: '说明补齐文件清单，通过现有管理器单独确认后重新检查；不覆盖项目代码、规则或预览'}
    : !adoption ? {action: 'confirm-rules-adoption', operation: 'project-rules-adopt', message: '明确技术栈并单独确认采用规则；已有项目保持原技术栈'}
    : {action: 'read-current-rules', message: '读取本次返回的规则、有效策略与项目例外；修改仍需对应批准'};
  return {ok: true, schemaVersion: '1.0.0', programVersion: bridge.currentVersion, ruleVersion: manifest.ruleVersion, adoptionSchemaVersion: manifest.adoptionSchemaVersion, dataFormatVersion: bridge.dataFormat || null, currentIdentityHash: bridge.currentIdentityHash, endpointIdentity: bridge.currentRuleEndpointIdentity, adoption, projectEnabled: Boolean(project), rulesAvailable: true, preparation, effectivePolicy: policy, nextStep, projectRulesReady: Boolean(policy?.executable), documents, mutationPerformed: false, hostDiscoveryVerified: false};
}
