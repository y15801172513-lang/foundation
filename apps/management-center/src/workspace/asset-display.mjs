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

export function selectAssetScenario(asset,selection={},fallbackId='') {
  const scenarios=asset?.assetModel?.previewScenarios || [];
  if(selection?.scenarioId)return scenarios.find(s=>s.id===selection.scenarioId);
  if(selection?.instanceId)return scenarios.find(s=>s.kind==='instance'&&s.instanceId===selection.instanceId);
  return scenarios.find(s=>s.id===fallbackId) || scenarios.find(s=>s.kind==='definition') || scenarios[0];
}

export function assetPreviewContract(asset,{scenario}={}) {
  if (!asset) return {status: 'missing-context', reason: '尚未选择资产。'};
  if(asset.assetType==='design-token')return {status:'token',reason:'专用设计变量样例'};
  if(asset.assetType==='page') {
    const route=asset.preview || asset.route;
    return typeof route==='string'&&route.startsWith('/')&&!route.startsWith('//')&&!/[?#\s\\]/u.test(route)?{status:'page',route}:{status:'missing-context',reason:'页面缺少实际路由'};
  }
  if(asset.assetType==='motion') {
    const route=asset.previewRoute;
    return typeof route==='string'&&route.startsWith('/')&&!route.startsWith('//')&&!/[?#\s\\]/u.test(route)?{status:'iframe',route}:{status:'missing-context',reason:'动效尚未登记真实运行场景；保留缺口，不能视为已交付'};
  }
  if (asset.assetType !== 'component') return {status: 'unsupported', reason: `${ASSET_TYPE_CAPABILITIES[asset.assetType]?.label || '此类资产'}当前没有可安全运行的组件预览。`};
  if(asset.assetModel && (!scenario || scenario.definitionId!==asset.assetId || scenario.kind==='instance' && !asset.usageLocations?.some(usage=>usage.instanceId===scenario.instanceId)))return {status:'missing-context',reason:'该定义未登记匹配的隔离预览场景；请在页面中查看实际使用。'};
  if (!asset.implementationPath) return {status: 'missing-context', reason: '组件尚未登记实现路径，无法确认真实实现。'};
  const route=asset.assetModel?asset.scenarioRoutes?.[scenario.id]:asset.previewRoute;
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || /[?#\s\\]/u.test(route)) return {status: 'missing-context', reason: asset.sceneLimitations?.[scenario?.id] || '缺少由当前源码定义生成的独立场景；可在页面中核验实际使用。'};
  return {status: 'iframe', route};
}

export function tokenDisplayContract(asset, assets = []) {
  const visited=new Set();let current=asset;
  while(current?.alias) {
    if(visited.has(current.assetId || current.id))return {state:'unknown',reason:'变量别名循环，请核对来源'};
    visited.add(current.assetId || current.id);
    current=assets.find(a=>(a.assetId || a.id)===current.alias);
    if(!current)return {state:'unknown',reason:'变量别名目标不存在'};
  }
  const type=current?.tokenType || current?.type;
  if(!['color','font-family','spacing','font-size','line-height','radius','duration'].includes(type)||typeof current?.value!=='string'||!current.value.trim())return {state:'unknown',reason:'变量类型或实际值尚未登记'};
  if(/var\(|url\(|[;{}]/u.test(current.value))return {state:'unknown',reason:'主题或资源依赖未解析，需在页面环境核验'};
  return {state:'sample',type,value:current.value,source:current.source || '来源待核',semantic:visited.size>0};
}

export function assetScenarioVariantValues(asset,scenario,selection={}) {
  const usage=(asset?.usageLocations || []).find(u=>scenario?.configurationRef===u.bindingId || scenario?.instanceId&&scenario.instanceId===u.instanceId);
  const selected=selection?.scenarioId===scenario?.id?selection?.variantValues || {}:{};
  return Object.fromEntries((asset?.assetModel?.variantAxes || []).map(axis=>{
    const values=[selected[axis.key],scenario?.variantValues?.[axis.key],usage?.configuration?.[axis.key],axis.values[0]];
    return [axis.key,values.find(value=>axis.values.includes(value))];
  }));
}
