import {assetAdmission} from './asset-admission.mjs';
import {inspectContentIntegrity} from './content-integrity.mjs';
const array = (value) => Array.isArray(value) ? value : [];
const references = (value) => Array.isArray(value) ? value.filter(Boolean) : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const contains = (value, id) => references(value).includes(id);

// Read-only display projection: a recorded decision is not an execution receipt.
// Only the delivery owner's current task and checked definition evidence can
// establish the corresponding current states. Candidate lists are search history.
export function assetReuseSummary(item, facts = {}) {
  const assessment = facts.delivery?.assessment;
  const changes = array(facts.changes?.items);
  const task = changes.find(change => change.id === assessment?.taskId);
  const scope = task?.deliveryScope;
  const binding = item.assetModel?.binding;
  const bindingId = binding?.file && binding?.anchor ? `${binding.file}#${binding.anchor}` : null;
  const associated = decision => decision.assetId ? decision.assetId === item.id : Boolean(bindingId && array(decision.expectedUsages).some(use => use.definitionId === bindingId));
  const records = changes.flatMap(change => array(change.reuseDecisions).filter(associated).map(decision => ({taskId: change.id, decision})))
    .sort((a, b) => a.taskId.localeCompare(b.taskId) || a.decision.id.localeCompare(b.decision.id));
  const currentTask = scope?.schemaVersion === '2.0.0' && scope.taskId === task.id && scope.revision === assessment?.scopeRevision;
  const decisions = records.map(({taskId, decision}) => {
    const requirement = array(scope?.items).find(row => row.requirementId === decision.requirementId);
    const current = currentTask && taskId === task.id && decision.scopeRevision === scope.revision;
    const state = !current ? 'stale' : !array(requirement?.factIds).includes(item.id) ? 'unknown' : 'registered';
    return {taskId, scopeRevision: decision.scopeRevision, requirementId: decision.requirementId, state, decision};
  });
  const registered = decisions.filter(entry => entry.state === 'registered');
  const conflicting = registered.some((entry, index) => registered.some((other, otherIndex) => otherIndex !== index &&
    (entry.decision.id === other.decision.id || entry.requirementId === other.requirementId && entry.decision.kind !== other.decision.kind)));
  // Definition evidence does not prove the before/after reuse decision. Keep that
  // distinction explicit rather than upgrading a registration to applied-static.
  const definitionVerified = registered.length > 0 && !conflicting && registered.every(entry => array(task.evidenceIndex).some(evidence => {
    const checked = facts.delivery?.evidenceResults?.[evidence.evidenceId];
    return evidence.kind === 'source-analysis' && evidence.taskId === task.id && evidence.scopeRevision === scope.revision &&
      evidence.subject?.definitionId === item.id && evidence.subject?.requirementId === entry.requirementId &&
      array(evidence.dimensions).includes('definition') && checked?.state === 'verified' && checked.result === 'passed' &&
      (!entry.decision.afterDigest || entry.decision.afterDigest === evidence.artifactDigest);
  }));
  const state = !currentTask ? 'unknown' : conflicting ? 'conflict' : registered.length ? 'registered' : decisions.some(entry => entry.state === 'unknown') ? 'unknown' : decisions.length ? 'stale' : 'not-registered';
  const kindLabels = {'same-instance':'沿用实例', variant:'变体', composition:'组合', 'base-update':'基础定义修改', new:'新定义', local:'局部实现', 'not-asset':'不作为资产'};
  const registrationLabel = state === 'registered' ? `复用决定已登记（${registered.length === 1 ? kindLabels[registered[0].decision.kind] || '类型待核' : `${registered.length}项`}）`
    : state === 'conflict' ? '多个复用决定存在冲突，待核'
    : state === 'stale' ? '仅有历史复用决定，当前修订待登记'
    : state === 'unknown' ? '当前任务或复用决定关联待核' : '尚未登记复用判断';
  return {state, taskId: assessment?.taskId || null, scopeRevision: assessment?.scopeRevision ?? null,
    label: registered.length && item.assetModel ? `${registrationLabel} · ${definitionVerified ? '定义已静态核实' : '定义静态核实待核'}` : registrationLabel,
    definitionVerification: definitionVerified ? 'verified' : 'pending',
    limitation: '登记不等于决定已落实；定义静态证据不替代复用前后检查、运行或真人接受。', decisions};
}

export function projectGovernance(project = {}) {
  const policy = project.effectivePolicy;
  if (policy && !policy.executable) return {mode: 'unconfigured', label: policy.state === 'not-adopted' ? '项目规则尚未采用' : '项目尚未准备就绪', writes: false, inventoryOnly: true, migrationRequiresAuthorization: true, contract: '先从当前安装检查项目准备和采用状态；此页面不授予修改权限。'};
  const mode = policy?.governanceMode || project.governanceMode || 'unconfigured';
  if (mode === 'preserve-and-inventory') return {mode, label: '已有项目：保留并盘点', writes: false, inventoryOnly: true, migrationRequiresAuthorization: true, contract: '识别现有体系和重复候选，只输出建议，不移动、不替换、不写入项目组件。'};
  if (mode === 'shadcn-first') return {mode, label: 'Foundation 新项目：shadcn 优先', writes: true, inventoryOnly: false, migrationRequiresAuthorization: false, contract: '先查项目本地组件与资产；有适配 shadcn 基础组件时加入项目 UI 层，再组合业务资产。'};
  return {mode, label: '治理模式未配置', writes: false, inventoryOnly: true, migrationRequiresAuthorization: true, contract: '未显式配置 governanceMode 时禁止资产迁移或组件改写。'};
}

export function projectAssets(facts = {}) {
  const pages = array(facts.pages?.items), changes = array(facts.changes?.items), figma = array(facts.figma?.items), relations = array(facts.relations?.items);
  const integrity = inspectContentIntegrity(facts);
  const componentIds = new Set(array(facts.components?.items).map((item) => item.id));
  const usages = (item) => array(item.usageLocations).length ? item.usageLocations : pages.filter((page) => contains(item.pageIds, page.id) || contains(item.usedByPages, page.id)).map((page) => ({pageId: page.id, pageName: page.name}));
  const make = (item, assetType) => {
    const reuseSummary = assetReuseSummary(item, facts);
    const id = item.id, usageLocations = usages(item);
    const usedByPages = [...new Map(usageLocations.map((usage) => [usage.pageId, {pageId: usage.pageId, pageName: usage.pageName}])).values()].sort((left, right) => left.pageId.localeCompare(right.pageId));
    const relevant = changes.filter((change) => contains(change.affectedAssets, id) || usedByPages.some((usage) => contains(change.affectedPages, usage.pageId)));
    const mapping = figma.find((entry) => entry.assetId === id || entry.id === item.figmaMappingId) || null;
    const impactPages = [...new Set(relevant.flatMap((change) => references(change.affectedPages)).filter((reference) => pages.some((page) => page.id === reference)))].sort();
    const impactComponents = [...new Set(relevant.flatMap((change) => references(change.affectedAssets)).filter((reference) => componentIds.has(reference)))].sort();
    const admission=assetAdmission(item,facts,{contentIssues:integrity.issues.filter(issue=>issue.objectId===id)});
    return {...item, admission, deliveryAssessment:facts.delivery?.assessment || null, assetModelState:item.assetModel?'declared-not-runtime-verified':'legacy-unreviewed', contentFact: item, contentIssues: integrity.issues.filter(issue => issue.objectId === id), assetId: id, id, assetType, name: item.name || item.label || id, status: item.status ?? null, source: item.source ?? null, implementationPath: item.implementationMapping || null, previewRoute: item.previewRoute || null, family: item.family || null, variant: item.variant || null, variants: array(item.variants), responsibility: item.assetModel?.responsibility || item.responsibility || item.description || item.summary || null, composes: array(item.composes), dependencies: array(item.dependencies), usageLocations, usedByPages, usedByComponents: array(item.usedByComponents), reuseSummary, reuseDecision: reuseSummary.label, declaredVerificationStatus:item.verificationStatus ?? null, verificationStatus:admission.state==='available'?'verified':'unverified', value: item.value ?? null, references: references(item.references || item.aliases), tokenScope: item.scope ?? null, recentChanges: relevant, impactPages, impactComponents, figma: mapping ? {id: mapping.id, nodeId: mapping.nodeId, nodeType: mapping.nodeType, verificationStatus: mapping.verificationStatus} : {status: '未映射'}, conflicts: array(item.conflicts), missing: [...array(item.missing), ...integrity.issues.filter(issue => issue.objectId === id).map(issue => issue.message)], pending: array(item.pending), relations: relations.filter((relation) => usedByPages.some((usage) => relation.from === usage.pageId || relation.to === usage.pageId))};
  };
  return [...array(facts.components?.items).map((item) => make(item, 'component')), ...array(facts.interactions?.items).map((item) => make(item, 'interaction')), ...array(facts.motions?.items).map((item) => make(item, 'motion')), ...array(facts['design-tokens']?.items).map((item) => make(item, 'design-token')), ...pages.map((item) => make({...item, pageIds: [item.id]}, 'page'))];
}

export const getAsset = (assets, assetId) => array(assets).find((asset) => asset.assetId === assetId) || null;
export const findAssetsForPage = (assets, pageId) => array(assets).filter((asset) => asset.usedByPages.some((usage) => usage.pageId === pageId));
