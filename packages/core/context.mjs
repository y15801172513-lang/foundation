import {humanLabel} from './human-labels.mjs';
import {foundationUiPolicyRecord} from './ui-policy.mjs';

function usageMatches(component, {instanceId, pageId}) {
  return (component.usageLocations || []).some((usage) => (!instanceId || usage.instanceId === instanceId) && (!pageId || usage.pageId === pageId));
}

const hasPurpose = (item) => Boolean(item?.responsibility || item?.description || item?.summary);

function scopeGaps(item) {
  const missing = [...(item?.missing || [])];
  if (!hasPurpose(item) && !missing.includes('用途尚未登记')) missing.push('用途尚未登记');
  if (!item?.verificationStatus && !missing.includes('验证状态尚未登记')) missing.push('验证状态尚未登记');
  return {missing: missing.sort(), pending: [...(item?.pending || [])].sort(), conflicts: [...(item?.conflicts || [])].sort(), unverified: item?.verificationStatus && item.verificationStatus !== 'verified' ? [item.verificationStatus] : []};
}

export function buildContextRecord({project, pages = [], relations = [], assets = [], selection = null, pageId, mode = 'page_building', scope = 'page'}) {
  const page = pages.find((item) => item.id === pageId) || pages.find((item) => item.entry) || null;
  const pageById = new Map(pages.map((item) => [item.id, item]));
  const assetById = new Map(assets.map((item) => [item.assetId || item.id, item]));
  const selectedAsset = selection?.asset || selection?.component || null;
  const asset = selectedAsset ? assets.find((item) => item.assetId === selectedAsset.assetId || item.assetId === selectedAsset.id || item.id === selectedAsset.id) || selectedAsset : null;
  const assetScope = scope === 'component' || scope === 'asset';
  const pageAssets = assetScope ? [] : assets.filter((item) => item.usedByPages?.some((usage) => usage.pageId === page?.id)).sort((left, right) => left.assetId.localeCompare(right.assetId));
  const relationPageIds = assetScope ? new Set((asset?.usedByPages || []).map((usage) => usage.pageId)) : new Set(page?.id ? [page.id] : []);
  const related = relations.filter((item) => relationPageIds.has(item.from) || relationPageIds.has(item.to)).sort((left, right) => left.id.localeCompare(right.id));
  const scopedAssets = assetScope && asset ? [asset] : pageAssets;
  const changes = [...new Map(scopedAssets.flatMap((item) => item.recentChanges || []).map((item) => [item.id, item])).values()].sort((left, right) => left.id.localeCompare(right.id));
  const usagePages = assetScope ? (asset?.usedByPages || []).map((usage) => usage.pageId) : [];
  const selfComponents = assetScope && asset?.assetType === 'component' ? [asset.assetId] : [];
  const impactPages = [...new Set([...scopedAssets.flatMap((item) => item.impactPages || []), ...usagePages])].sort();
  const impactComponents = [...new Set([...scopedAssets.flatMap((item) => item.impactComponents || []), ...selfComponents])].sort();
  const gaps = scopeGaps(assetScope ? asset : page);
  const uiPolicy = project?.uiPolicy || foundationUiPolicyRecord(project?.governanceMode === 'shadcn-first' ? 'new' : 'existing');
  return {scope, project, uiPolicy, page, asset, selection, mode, pageAssets, relations: related, interactions: related.map((item) => ({id: item.id, trigger: item.trigger, condition: item.condition, from: item.from, to: item.to})), recentChanges: changes, impactPages, impactComponents, figmaImpact: asset?.figma || {status: '未映射'}, ...gaps, factsVersion: project?.dataFormatVersion || 'unknown', pageById, assetById};
}

const valueOrUnknown = (value) => value || 'unknown';
const list = (values = []) => [...values].filter(Boolean).sort().join(',') || 'none';
const pageLabel = (record, pageId) => record.pageById?.get(pageId)?.name || pageId || '尚未登记';
const assetLabel = (record, assetId) => record.assetById?.get(assetId)?.name || assetId || '尚未登记';

export function contextPlainText(record) {
  const base = [
    `scope: ${valueOrUnknown(record.scope)}`,
    `project name: ${valueOrUnknown(record.project?.name)}`,
    `project id: ${valueOrUnknown(record.project?.projectId)}`,
    `facts version: ${valueOrUnknown(record.factsVersion)}`,
    `ui policy version: ${valueOrUnknown(record.uiPolicy?.version)}`,
    `ui governance mode: ${valueOrUnknown(record.uiPolicy?.governanceMode)}`,
    `ui classification: ${valueOrUnknown(record.uiPolicy?.classification)}`,
    `work mode: ${valueOrUnknown(record.mode)}`,
    `page: ${valueOrUnknown(record.page?.id)}`,
    `page name: ${valueOrUnknown(record.page?.name)}`,
    `route: ${valueOrUnknown(record.page?.route || record.page?.preview)}`,
    ...(record.page?.route && record.page?.preview !== record.page.route ? [`preview route: ${valueOrUnknown(record.page.preview)}`] : []),
    `page implementation: ${valueOrUnknown(record.page?.implementationMapping)}`,
    `page status: ${valueOrUnknown(record.page?.status)}`,
    `page verification: ${valueOrUnknown(record.page?.verificationStatus)}`
  ];
  if (record.scope === 'component' || record.scope === 'asset') base.push(
    `asset id: ${record.asset?.assetId || record.asset?.id || 'none'}`,
    `asset name: ${valueOrUnknown(record.asset?.name)}`,
    `asset type: ${valueOrUnknown(record.asset?.assetType || record.asset?.type)}`,
    `variant: ${valueOrUnknown(record.selection?.variant || record.asset?.variant)}`,
    `instance id: ${valueOrUnknown(record.selection?.instanceId)}`,
    `event id: ${valueOrUnknown(record.selection?.eventId)}`,
    `implementation: ${valueOrUnknown(record.asset?.implementationPath || record.asset?.implementationMapping)}`,
    `dependencies: ${list(record.asset?.dependencies)}`,
    `composes: ${list(record.asset?.composes)}`,
    `used by pages: ${list((record.asset?.usedByPages || []).map((item) => item.pageId))}`
  );
  else base.push(`page assets: ${list((record.pageAssets || []).map((item) => item.assetId || item.id))}`);
  const relations = [...(record.relations || [])].sort((left, right) => left.id.localeCompare(right.id)).map((item) => `${item.id}; from=${item.from}; to=${item.to}; trigger=${item.trigger || 'unknown'}; condition=${item.condition || 'unknown'}`);
  const changes = [...(record.recentChanges || [])].sort((left, right) => left.id.localeCompare(right.id)).map((item) => `${item.id}; summary=${item.summary || item.label || 'unknown'}; updatedAt=${item.updatedAt || 'unknown'}`);
  return [...base, `relations: ${relations.join(' | ') || 'none'}`, `changes: ${changes.join(' | ') || 'none'}`, `impact pages: ${list(record.impactPages)}`, `impact components: ${list(record.impactComponents)}`, `figma: ${record.figmaImpact?.nodeId || record.figmaImpact?.status || 'unmapped'}`, `missing: ${list(record.missing)}`, `pending: ${list(record.pending)}`, `conflicts: ${list(record.conflicts)}`, `unverified: ${list(record.unverified)}`].join('\n');
}

export function contextHumanView(record) {
  const isAsset = record.scope === 'component' || record.scope === 'asset';
  const subject = isAsset ? record.asset : record.page;
  const title = subject?.name || (isAsset ? '未选择资产' : '未选择页面');
  const purpose = hasPurpose(subject) ? subject.responsibility || subject.description || subject.summary : '用途尚未登记。';
  const status = humanLabel('status', subject?.status);
  const actions = (record.interactions || []).map((item) => `${pageLabel(record, item.from)}：${item.trigger || '尚未登记操作'}；${item.condition || '尚未登记条件'}后进入${pageLabel(record, item.to)}。`);
  const related = (record.relations || []).map((item) => `${pageLabel(record, item.from)} → ${pageLabel(record, item.to)}（${item.trigger || '尚未登记触发'}）`);
  const changes = (record.recentChanges || []).map((item) => `${item.label || item.id}：${item.summary || '已登记变化，尚无摘要。'}${item.updatedAt ? `（${item.updatedAt}）` : ''}`);
  const impacts = [
    ...(record.impactPages || []).map((id) => `页面：${pageLabel(record, id)}`),
    ...(record.impactComponents || []).map((id) => `组件/资产：${assetLabel(record, id)}`),
    `Figma：${record.figmaImpact?.nodeId ? `已映射节点 ${record.figmaImpact.nodeId}` : humanLabel('figma', record.figmaImpact?.status)}`
  ];
  const gaps = [...(record.missing || []).map((item) => `缺失：${item}`), ...(record.pending || []).map((item) => `待确认：${item}`), ...(record.conflicts || []).map((item) => `冲突：${item}`), ...(record.unverified || []).map((item) => `未验证：${humanLabel('verification', item)}`)];
  const technical = [
    `稳定 ID：${isAsset ? record.asset?.assetId || record.asset?.id || '尚未登记' : record.page?.id || '尚未登记'}`,
    `实现路径：${isAsset ? record.asset?.implementationPath || record.asset?.implementationMapping || '尚未登记' : record.page?.implementationMapping || '尚未登记'}`,
    `facts 版本：${record.factsVersion || '尚未登记'}`,
    `验证状态：${humanLabel('verification', subject?.verificationStatus)}`
  ];
  if (isAsset && subject?.assetType === 'design-token') technical.push(`令牌值：${subject.value ?? '尚未登记'}`, `引用：${subject.references?.join('、') || '尚未登记'}`, `适用范围：${humanLabel('scope', subject.tokenScope)}`);
  return {
    identity: {title, summary: `${title}：${purpose} 当前状态：${status}。`, status},
    sections: [
      {id: 'actions', title: '用户可以做什么', items: actions.length ? actions : ['尚未登记可执行操作。']},
      {id: 'related', title: '和哪里有关', items: related.length ? related : ['尚未登记直接关系。']},
      {id: 'changes', title: '最近发生了什么', items: changes.length ? changes : ['尚未登记最近变化。']},
      {id: 'impact', title: '修改会影响什么', items: impacts.length ? impacts : ['尚未登记影响范围。']},
      {id: 'gaps', title: '还没确认什么', items: gaps.length ? gaps : ['尚未发现缺失、待确认、冲突或未验证项。']},
      {id: 'technical', title: '技术信息', items: technical, collapsed: true}
    ]
  };
}

export function contextHumanText(record) {
  const view = contextHumanView(record);
  const section = (id) => view.sections.find((item) => item.id === id)?.items.join('、') || '尚未登记';
  return {page: view.identity.summary, selection: record.asset ? `当前组件：${view.identity.title}。` : '当前未选择组件。', usage: record.asset ? section('related') : '', interaction: section('actions'), impact: section('impact')};
}

export function resolveComponentSelection(components = [], selection = {}) {
  const {componentId, instanceId = null, variant = null, pageId = null, eventId = null} = selection;
  if (!componentId) return null;
  const declared = components.find((component) => component.id === componentId);
  if (!declared) return null;
  const familyCandidates = components.filter((component) => component.family === declared.family);
  const candidates = familyCandidates.length ? familyCandidates : [declared];
  const exactUsage = candidates.find((component) => component.variant === variant && usageMatches(component, {instanceId, pageId}));
  const exactVariant = candidates.find((component) => component.variant === variant);
  const declaredUsage = usageMatches(declared, {instanceId, pageId});
  const component = exactUsage || exactVariant || (declaredUsage ? declared : candidates.find((item) => usageMatches(item, {instanceId, pageId})) || declared);
  const resolvedVariant = variant || component.variant || (component.variants || []).find(Boolean) || 'unknown';
  return {component, componentId: component.id, instanceId, variant: resolvedVariant, pageId, eventId};
}

export function buildContextText({project, pages, relations, component, selection = null, mode = 'page_building', pageId}) {
  const page = pages.find((item) => item.id === pageId) || pages.find((item) => item.entry);
  const incoming = relations.filter((item) => item.to === page?.id);
  const outgoing = relations.filter((item) => item.from === page?.id);
  const lines = [`project name: ${project.name}`, `project id: ${project.projectId}`, `work mode: ${mode}`, `current page: ${page?.name || '尚未建立'} (${page?.id || 'unknown'})`, `real route: ${page?.route || page?.preview || 'unknown'}`, ...(page?.route && page?.preview !== page.route ? [`preview route: ${page.preview || 'unknown'}`] : []), `implementation mapping: ${page?.implementationMapping || 'unknown'}`];
  if (component) lines.push(`selected component: ${component.name} / ${component.family} / ${component.id}`, `variant: ${selection?.variant || component.variant || 'unknown'}`, `instance id: ${selection?.instanceId || 'unknown'}`, `component page: ${selection?.pageId || 'unknown'}`, `implementation mapping: ${component.implementationMapping || 'unknown'}`, `usage locations: ${(component.usageLocations || []).map((usage) => `${usage.pageName}(${usage.instanceId})`).join(', ') || 'unknown'}`);
  else lines.push('selected component: none');
  lines.push(`incoming relations: ${incoming.map((item) => `${item.fromName || item.from} -> ${item.toName || item.to}; trigger=${item.trigger || 'unknown'}; condition=${item.condition || 'unknown'}`).join(' | ') || 'none'}`, `outgoing relations: ${outgoing.map((item) => `${item.fromName || item.from} -> ${item.toName || item.to}; trigger=${item.trigger || 'unknown'}; condition=${item.condition || 'unknown'}`).join(' | ') || 'none'}`, `status: ${component?.status || page?.status || 'unknown'}`, `verification status: ${component?.verificationStatus || page?.verificationStatus || 'unknown'}`, `pending/unknown/conflict: ${component?.pending || page?.pending || 'none'}`, 'request hint: 修改前先读取这些稳定 ID 对应的当前事实');
  return lines.join('\n');
}
