export function assetDisplayRecord(asset = {}) {
  const usedByPages = Array.isArray(asset.usedByPages) ? asset.usedByPages : [];
  return {
    id: asset.assetId || asset.id || null,
    implementationPath: asset.implementationPath || null,
    usedByPages,
    usageLabel: usedByPages.map((usage) => usage.pageName || usage.pageId).filter(Boolean).join('、') || '未登记',
  };
}

export const ASSET_TYPE_CAPABILITIES = Object.freeze({
  all: {label: '全部类型', filters: ['status', 'verification', 'pageId'], listFields: ['assetType', 'responsibility']},
  page: {label: '页面', filters: ['status', 'verification'], listFields: ['responsibility']},
  component: {label: '组件', filters: ['status', 'verification', 'pageId'], listFields: ['responsibility', 'variant']},
  motion: {label: '动效', filters: ['status', 'verification', 'pageId'], listFields: ['responsibility', 'variant']},
  'design-token': {label: '设计变量（颜色、间距等）', filters: ['status', 'verification', 'pageId'], listFields: ['value', 'tokenScope']}
});

export const EMPTY_ASSET_FILTERS = Object.freeze({type: 'all', status: 'all', verification: 'all', pageId: 'all'});

export function publicAssets(assets = []) {
  return assets.filter((asset) => Object.hasOwn(ASSET_TYPE_CAPABILITIES, asset.assetType) && asset.assetType !== 'all');
}

const valuesFor = (assets, field) => {
  const values = field === 'pageId' ? assets.flatMap((asset) => asset.usedByPages || []).map((usage) => usage.pageId) : assets.map((asset) => asset[field]);
  return [...new Set(values.filter(Boolean))].sort();
};

export function assetFilterPlan(assets = [], type = 'all') {
  const visible = publicAssets(assets);
  const normalizedType = Object.hasOwn(ASSET_TYPE_CAPABILITIES, type) ? type : 'all';
  const base = normalizedType === 'all' ? visible : visible.filter((asset) => asset.assetType === normalizedType);
  const options = {};
  const activeFilters = ASSET_TYPE_CAPABILITIES[normalizedType].filters.filter((field) => {
    const values = valuesFor(base, field);
    if (values.length < 2) return false;
    options[field] = values;
    return true;
  });
  const typeOptions = Object.entries(ASSET_TYPE_CAPABILITIES).map(([value, capability]) => {
    const count = value === 'all' ? visible.length : visible.filter((asset) => asset.assetType === value).length;
    return {value, count, disabled: value !== 'all' && count === 0, label: value === 'all' ? `${capability.label}（${count}）` : count ? `${capability.label}（${count}）` : `${capability.label}（0，暂无登记）`};
  });
  return {type: normalizedType, base, activeFilters, options, typeOptions};
}

export function changeAssetFilters(filters = EMPTY_ASSET_FILTERS, change, plan = null) {
  if (change.field === 'type') return {...EMPTY_ASSET_FILTERS, type: change.value};
  const next = {...EMPTY_ASSET_FILTERS, ...filters, [change.field]: change.value};
  if (!plan) return next;
  for (const field of ['status', 'verification', 'pageId']) {
    if (!plan.activeFilters.includes(field) || (next[field] !== 'all' && !plan.options[field]?.includes(next[field]))) next[field] = 'all';
  }
  return next;
}

export function normalizeAssetFilters(filters = EMPTY_ASSET_FILTERS, plan) {
  return changeAssetFilters(filters, {field: 'status', value: filters.status || 'all'}, plan);
}

export function visibleAssetSelection(selectedAsset, visibleAssets = []) {
  if (!selectedAsset) return null;
  return visibleAssets.find((asset) => asset.assetId === selectedAsset.assetId) || null;
}

const FIELD_LABELS = {responsibility: '用途', variant: '默认变体', value: '值', tokenScope: '作用范围', assetType: '类型'};

export function comparableAssetFields(asset = {}) {
  const fields = ASSET_TYPE_CAPABILITIES[asset.assetType]?.listFields || [];
  return fields.flatMap((key) => asset[key] ? [{key, label: FIELD_LABELS[key] || key, value: String(asset[key])}] : []);
}

export function assetPreviewContract(asset) {
  if (!asset) return {status: 'missing-context', reason: '尚未选择资产。'};
  if (asset.assetType !== 'component') return {status: 'unsupported', reason: `${ASSET_TYPE_CAPABILITIES[asset.assetType]?.label || '此类资产'}当前没有可安全运行的组件预览。`};
  if (!asset.implementationPath) return {status: 'missing-context', reason: '组件尚未登记实现路径，无法确认真实实现。'};
  return {status: 'iframe', route: '/events'};
}
