import {humanLabel} from '@foundation/core/human-labels';

const ordered = (items = [], key = (item) => item.id || item.assetId || '') => [...items].sort((left, right) => key(left).localeCompare(key(right)));

export function informationLogicModel({pages = [], relations = [], assets = [], pageId}) {
  const page = pages.find((item) => item.id === pageId) || pages.find((item) => item.entry) || null;
  const pageById = new Map(pages.map((item) => [item.id, item]));
  const decorate = (relation) => ({...relation, fromName: relation.fromName || pageById.get(relation.from)?.name || relation.from, toName: relation.toName || pageById.get(relation.to)?.name || relation.to});
  const related = ordered(relations.filter((item) => item.from === page?.id || item.to === page?.id).map(decorate));
  const used = ordered(assets.filter((asset) => asset.usedByPages?.some((usage) => usage.pageId === page?.id)));
  const changes = ordered([...new Map(used.flatMap((asset) => asset.recentChanges || []).map((change) => [change.id, change])).values()]);
  const gaps = ordered([...new Set([...used.flatMap((asset) => [...(asset.conflicts || []), ...(asset.missing || []), ...(asset.pending || [])]), ...used.filter((asset) => asset.verificationStatus && asset.verificationStatus !== 'verified').map((asset) => `${asset.name}：${humanLabel('verification', asset.verificationStatus)}`)])]);
  return {page, related, incoming: related.filter((item) => item.to === page?.id), outgoing: related.filter((item) => item.from === page?.id), assets: used, changes, gaps};
}

export function previewSidebarModel({pages = [], relations = [], interactions = [], assets = [], pageId}) {
  const page = pages.find((item) => item.id === pageId) || pages.find((item) => item.entry) || pages[0] || null;
  const pageById = new Map(pages.map((item) => [item.id, item]));
  const decorate = (relation) => ({...relation, fromName: relation.fromName || pageById.get(relation.from)?.name || relation.from, toName: relation.toName || pageById.get(relation.to)?.name || relation.to});
  const related = ordered(relations.filter((item) => item.from === page?.id || item.to === page?.id).map(decorate));
  const stateChanges = ordered(interactions.filter((item) => item.pageIds?.includes(page?.id)));
  const gaps = [];
  const gapText = (kind, label, type, item = '') => {
    if (type === 'missing') return `${kind} ${label} 缺少：${item}；影响：当前任务依据不完整；下一步：补录并复核该事实`;
    if (type === 'pending') return `${kind} ${label} 待确认：${item}；影响：当前结论暂不能视为确定；下一步：确认后更新事实`;
    if (type === 'conflict') return `${kind} ${label} 冲突：${item}；影响：当前任务存在互斥依据；下一步：先解决冲突`;
    return `${kind} ${label} 尚未验证${item ? `：${item}` : ''}；影响：运行可信度未确认；下一步：完成验证`;
  };
  if (!page?.verificationStatus) gaps.push(gapText('页面', page?.name || page?.id || '当前页面', 'verification', '验证状态未登记'));
  else if (page.verificationStatus !== 'verified') gaps.push(gapText('页面', page.name || page.id, 'verification', humanLabel('verification', page.verificationStatus)));
  for (const item of page?.missing || []) gaps.push(gapText('页面', page.name || page.id, 'missing', item));
  for (const item of page?.pending || []) gaps.push(gapText('页面', page.name || page.id, 'pending', item));
  for (const item of page?.conflicts || []) gaps.push(gapText('页面', page.name || page.id, 'conflict', item));
  const addEntityGaps = (kind, entity, label = entity.name || entity.id || entity.assetId) => {
    for (const item of entity.missing || []) gaps.push(gapText(kind, label, 'missing', item));
    for (const item of entity.pending || []) gaps.push(gapText(kind, label, 'pending', item));
    for (const item of entity.conflicts || []) gaps.push(gapText(kind, label, 'conflict', item));
    if (!entity.verificationStatus) gaps.push(gapText(kind, label, 'verification', '验证状态未登记'));
    else if (entity.verificationStatus !== 'verified') gaps.push(gapText(kind, label, 'verification', humanLabel('verification', entity.verificationStatus)));
  };
  for (const relation of related) addEntityGaps('关系', relation);
  for (const interaction of stateChanges) addEntityGaps('交互', interaction);
  for (const asset of assets.filter((item) => item.usedByPages?.some((usage) => usage.pageId === page?.id))) addEntityGaps('资产', asset);
  return {page, related, incoming: related.filter((item) => item.to === page?.id), outgoing: related.filter((item) => item.from === page?.id), stateChanges, gaps: [...new Set(gaps)].sort()};
}

export function relationPresentation(relation) {
  const lifecycle = relation.status === 'draft' ? 'draft' : relation.status === 'verified' || relation.verificationStatus === 'verified' ? 'verified' : 'registered';
  const runtimeBinding = ['unbound', 'pending', 'bound', 'verified'].includes(relation.runtimeBinding) ? relation.runtimeBinding : 'unbound';
  const lifecycleLabel = {draft: '关系草稿', registered: '关系已登记', verified: '关系已验证'}[lifecycle];
  const runtimeLabel = {unbound: '触发器未绑定', pending: '触发器待绑定', bound: '触发器已绑定、待验证', verified: '运行跳转已验证'}[runtimeBinding];
  return {lifecycle, lifecycleLabel, runtimeBinding, runtimeLabel};
}

export function logicFlowModel({pages = [], relations = [], currentPageId = null}) {
  const sortedPages = ordered(pages);
  const pageIds = new Set(sortedPages.map((page) => page.id));
  const sortedRelations = ordered(relations.filter((relation) => pageIds.has(relation.from) && pageIds.has(relation.to)));
  const edges = sortedRelations.map((relation) => {
    const presentation = relationPresentation(relation);
    return {id: relation.id, source: relation.from, target: relation.to, sourceHandle: relation.sourceHandle || `relation:${relation.id}:source`, targetHandle: relation.targetHandle || `relation:${relation.id}:target`, type: 'smoothstep', label: `${relation.trigger || '触发尚未登记'} · ${presentation.lifecycleLabel} / ${presentation.runtimeLabel}`, data: {relation, ...presentation}};
  });
  const nodes = sortedPages.map((page, index) => {
    const incoming = edges.filter((edge) => edge.target === page.id);
    const outgoing = edges.filter((edge) => edge.source === page.id);
    const gaps = [];
    if (!page.verificationStatus) gaps.push('验证状态尚未登记');
    else if (page.verificationStatus !== 'verified') gaps.push(humanLabel('verification', page.verificationStatus));
    return {id: page.id, type: 'pageFlow', position: {x: (index % 3) * 390, y: Math.floor(index / 3) * 330}, data: {page, current: page.id === currentPageId, incoming: incoming.map((edge) => ({id: edge.targetHandle, relationId: edge.id})), outgoing: outgoing.map((edge) => ({id: edge.sourceHandle, relationId: edge.id})), gaps}};
  });
  return {nodes, edges};
}

export function isValidPageConnection({connection, pages = [], relations = [], draft = null}) {
  const from = connection?.source; const to = connection?.target;
  const pageIds = new Set(pages.map((page) => page.id));
  if (!from || !to || !pageIds.has(from) || !pageIds.has(to)) return false;
  if (from === to && draft && !(String(draft.trigger || '').trim() && (String(draft.targetState || '').trim() || String(draft.targetEntity || '').trim()))) return false;
  if (!draft) return true;
  const normalized = (value) => String(value || '').trim() || null;
  const candidate = {from, to, trigger: normalized(draft.trigger), condition: normalized(draft.condition), targetState: normalized(draft.targetState), targetEntity: normalized(draft.targetEntity)};
  return !relations.some((relation) => Object.entries(candidate).every(([field, value]) => (relation[field] ?? null) === value));
}

export function filterAssets(assets = [], filters = {}) {
  return ordered(assets.filter((asset) => {
    if (filters.type && asset.assetType !== filters.type) return false;
    if (filters.status && asset.status !== filters.status) return false;
    if (filters.verification && asset.verificationStatus !== filters.verification) return false;
    if (filters.pageId && !asset.usedByPages?.some((usage) => usage.pageId === filters.pageId)) return false;
    return true;
  }));
}
