const array = (value) => Array.isArray(value) ? value : [];
const references = (value) => Array.isArray(value) ? value.filter(Boolean) : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const contains = (value, id) => references(value).includes(id);

export function projectGovernance(project = {}) {
  const mode = project.governanceMode || 'unconfigured';
  if (mode === 'preserve-and-inventory') return {mode, label: '已有项目：保留并盘点', writes: false, inventoryOnly: true, migrationRequiresAuthorization: true, contract: '识别现有体系和重复候选，只输出建议，不移动、不替换、不写入项目组件。'};
  if (mode === 'shadcn-first') return {mode, label: 'Foundation 新项目：shadcn 优先', writes: true, inventoryOnly: false, migrationRequiresAuthorization: false, contract: '先查项目本地组件与资产；有适配 shadcn 基础组件时加入项目 UI 层，再组合业务资产。'};
  return {mode, label: '治理模式未配置', writes: false, inventoryOnly: true, migrationRequiresAuthorization: true, contract: '未显式配置 governanceMode 时禁止资产迁移或组件改写。'};
}

export function projectAssets(facts = {}) {
  const pages = array(facts.pages?.items), changes = array(facts.changes?.items), figma = array(facts.figma?.items), relations = array(facts.relations?.items);
  const componentIds = new Set(array(facts.components?.items).map((item) => item.id));
  const usages = (item) => array(item.usageLocations).length ? item.usageLocations : pages.filter((page) => contains(item.pageIds, page.id) || contains(item.usedByPages, page.id)).map((page) => ({pageId: page.id, pageName: page.name}));
  const make = (item, assetType) => {
    const id = item.id, usageLocations = usages(item);
    const usedByPages = [...new Map(usageLocations.map((usage) => [usage.pageId, {pageId: usage.pageId, pageName: usage.pageName}])).values()].sort((left, right) => left.pageId.localeCompare(right.pageId));
    const relevant = changes.filter((change) => contains(change.affectedAssets, id) || usedByPages.some((usage) => contains(change.affectedPages, usage.pageId)));
    const mapping = figma.find((entry) => entry.assetId === id || entry.id === item.figmaMappingId) || null;
    const impactPages = [...new Set(relevant.flatMap((change) => references(change.affectedPages)).filter((reference) => pages.some((page) => page.id === reference)))].sort();
    const impactComponents = [...new Set(relevant.flatMap((change) => references(change.affectedAssets)).filter((reference) => componentIds.has(reference)))].sort();
    return {assetId: id, id, assetType, name: item.name || item.label || id, status: item.status ?? null, source: item.source ?? null, implementationPath: item.implementationMapping || null, family: item.family || null, variant: item.variant || null, variants: array(item.variants), responsibility: item.responsibility || item.description || item.summary || null, composes: array(item.composes), dependencies: array(item.dependencies), usageLocations, usedByPages, usedByComponents: array(item.usedByComponents), reuseDecision: item.assetDecision || item.decision || null, verificationStatus: item.verificationStatus ?? null, value: item.value ?? null, references: references(item.references || item.aliases), tokenScope: item.scope ?? null, recentChanges: relevant, impactPages, impactComponents, figma: mapping ? {id: mapping.id, nodeId: mapping.nodeId, nodeType: mapping.nodeType, verificationStatus: mapping.verificationStatus} : {status: '未映射'}, conflicts: array(item.conflicts), missing: array(item.missing), pending: array(item.pending), relations: relations.filter((relation) => usedByPages.some((usage) => relation.from === usage.pageId || relation.to === usage.pageId))};
  };
  return [...array(facts.components?.items).map((item) => make(item, 'component')), ...array(facts.interactions?.items).map((item) => make(item, 'interaction')), ...array(facts.motions?.items).map((item) => make(item, 'motion')), ...array(facts['design-tokens']?.items).map((item) => make(item, 'design-token')), ...pages.map((item) => make({...item, pageIds: [item.id]}, 'page'))];
}

export const getAsset = (assets, assetId) => array(assets).find((asset) => asset.assetId === assetId) || null;
export const findAssetsForPage = (assets, pageId) => array(assets).filter((asset) => asset.usedByPages.some((usage) => usage.pageId === pageId));
