const compact = (record = {}) => Object.entries(record).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(', ') || '尚未登记';

export const INSPECTOR_COPY_CATEGORIES = [
  {id: 'full', label: '完整对象上下文'},
  {id: 'identity', label: '身份与层级'},
  {id: 'logic', label: '相关逻辑'},
  {id: 'layout', label: '布局与样式'},
  {id: 'impact', label: '使用、影响与缺口'}
];

export function suggestedInspectorScope(object, target = '') {
  if (/只改(这里|当前|这个)|仅当前|单个实例/u.test(target)) return object?.instanceId ? 'instance' : 'local layout candidate';
  return object?.registeredComponent || object?.componentId ? 'component asset' : 'local layout candidate';
}

export function inspectorScopeRecommendation(object) {
  if (object?.registeredComponent || object?.componentId) return {label: '建议修改组件资产', rationale: '这是已登记组件，修改资产可保持同类实例一致。', impact: '会影响该组件的其他已知使用位置，请结合使用范围复核。', confidence: '高'};
  return {label: '建议只修改当前位置', rationale: '这是页面内的普通结构，未发现可复用组件身份。', impact: '优先限制在当前页面和当前层级，避免扩大影响范围。', confidence: '中'};
}

export function enrichInspectorObject(object, model) {
  if (!object) return null;
  const page = model.pages?.find((item) => item.id === object.pageId) || null;
  const asset = model.assets?.find((item) => item.assetId === object.componentId) || null;
  const name = object.name || asset?.name || object.role;
  const normalizedName = String(name || '').toLowerCase();
  const relatedLogic = (model.relations || []).filter((relation) => {
    if (relation.from !== object.pageId && relation.to !== object.pageId) return false;
    const trigger = String(relation.trigger || '').toLowerCase();
    return trigger && (normalizedName.includes(trigger) || trigger.includes(normalizedName));
  });
  const gaps = [];
  if (object.componentId && !asset) gaps.push('组件身份未在资产投影中找到');
  if (asset?.verificationStatus && asset.verificationStatus !== 'verified') gaps.push(`组件验证状态：${asset.verificationStatus}`);
  for (const item of asset?.missing || []) gaps.push(`缺失：${item}`);
  for (const item of asset?.pending || []) gaps.push(`待确认：${item}`);
  const factsUpdatedAt = [model.project?.updatedAt, page?.updatedAt, asset?.updatedAt, ...relatedLogic.map((item) => item.updatedAt)].filter(Boolean).sort().at(-1) || model.relationsVersion || null;
  const registeredComponent = Boolean(asset || object.registeredComponent);
  return {...object, name: asset?.name || name, page, asset, relatedLogic, usageLocations: asset?.usedByPages || [], gaps, factsUpdatedAt, factsVersion: model.relationsVersion || factsUpdatedAt, localStructureNote: registeredComponent ? null : '这是当前页面里的普通结构，可定位和修改，但没有被视为缺失组件。', recommendation: inspectorScopeRecommendation({...object, registeredComponent}), suggestedScope: suggestedInspectorScope({...object, registeredComponent})};
}

function locatorEnvelope({project, page, object}) {
  const ancestorChain = object?.ancestorIds?.join(' > ') || object?.path?.join(' > ') || '尚未登记';
  return [
    `project stable identity: ${project?.projectId || project?.id || '尚未登记'}`,
    `project name: ${project?.name || '尚未登记'}`,
    `page: ${page?.id || object?.pageId || '尚未登记'}; route=${page?.preview || page?.route || '尚未登记'}`,
    `object stable identity: ${object?.inspectorId || object?.instanceId || object?.componentId || '尚未登记'}`,
    `object type: ${object?.registeredComponent || object?.componentId ? 'registered component' : 'local page structure'}; role=${object?.role || '尚未登记'}; name=${object?.name || '尚未登记'}`,
    `required ancestor chain: ${ancestorChain}`,
    `facts version timestamp: ${object?.factsUpdatedAt || object?.factsVersion || page?.updatedAt || project?.updatedAt || '尚未登记'}`
  ];
}

const relatedLogicText = (object) => (object?.relatedLogic || []).map((item) => `${item.id}: ${item.from} -> ${item.to}; trigger=${item.trigger || '尚未登记'}; condition=${item.condition || '无条件'}`).join(' | ') || '无直接匹配逻辑';
const usageText = (object) => (object?.usageLocations || []).map((item) => `${item.pageId}${item.instanceId ? `#${item.instanceId}` : ''}`).join(', ') || '尚未登记';

export function buildInspectorCopyPayload({project, page, object, category = 'full'}) {
  const envelope = locatorEnvelope({project, page, object});
  const recommendation = object?.recommendation || inspectorScopeRecommendation(object);
  const sections = {
    identity: [`hierarchy path: ${object?.path?.join(' > ') || '尚未登记'}`, `component identity: ${object?.componentId || '普通页面结构'}; instance=${object?.instanceId || '无'}`],
    logic: [`related logic: ${relatedLogicText(object)}`],
    layout: [`layout summary: ${compact(object?.layout)}`, `style summary: ${compact(object?.style)}`],
    impact: [`known usage: ${usageText(object)}`, `impact recommendation: ${recommendation.label}; ${recommendation.impact}; confidence=${recommendation.confidence}`, `gaps: ${(object?.gaps || []).join('；') || '未发现已知缺口'}`]
  };
  const selected = category === 'full' ? [...sections.identity, ...sections.logic, `scope recommendation: ${recommendation.label}; rationale=${recommendation.rationale}; confidence=${recommendation.confidence}`, ...sections.layout, ...sections.impact] : sections[category];
  if (!selected) throw new TypeError(`未知检查器复制分类：${category}`);
  const label = INSPECTOR_COPY_CATEGORIES.find((item) => item.id === category)?.label || category;
  return [`Foundation 检查对象上下文 · ${label}`, ...envelope, ...selected].join('\n');
}

export function buildInspectorTaskContext({project, page, object, target = ''}) {
  const scope = suggestedInspectorScope(object, target);
  const hierarchy = object?.path?.join(' > ') || '尚未登记';
  const logic = relatedLogicText(object);
  const usage = usageText(object);
  return [
    'Foundation 对象修改任务',
    `project: ${project?.name || '尚未登记'} (${project?.projectId || '尚未登记'})`,
    `page: ${page?.name || '尚未登记'} (${page?.id || '尚未登记'}), route=${page?.preview || page?.route || '尚未登记'}`,
    `object: ${object?.name || '尚未登记'}; role=${object?.role || '尚未登记'}; component=${object?.componentId || '普通 DOM'}; instance=${object?.instanceId || '无'}`,
    `hierarchy: ${hierarchy}`,
    `scope: ${scope}`,
    `related logic: ${logic}`,
    `layout summary: ${compact(object?.layout)}`,
    `style summary: ${compact(object?.style)}`,
    `known usage: ${usage}`,
    `gaps: ${(object?.gaps || []).join('；') || '未发现已知缺口'}`,
    `modification target: ${target.trim() || '请填写具体修改目标'}`
  ].join('\n');
}
