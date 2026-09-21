import {inspectObjectName, objectLocator} from '@foundation/core/object-identity';
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
  const structures=[...(page?.sourceStructure?.objects || []),...(asset?.contentFact?.sourceStructure?.objects || [])];
  const bindings=object.persistentId?structures.filter(item=>item.persistentId===object.persistentId&&(!object.instanceId||item.instanceKey===object.instanceId)&&(!object.identityGeneration||item.incarnation===object.identityGeneration)):[];
  const mapped=bindings.length===1?bindings[0]:null;
  const name = asset?.name || mapped?.name || object.name || object.role;
  if(mapped)object={...object,sourceLocation:{file:mapped.file,line:mapped.line,offset:mapped.offset,sha256:mapped.sha256,source:'current-facts-source-structure'}};
  const normalizedName = String(name || '').toLowerCase();
  const ids=new Set([object.persistentId,object.componentId,object.instanceId,object.bindingId].filter(Boolean));
  const relatedLogic=[...(model.relations || []),...(model.objectRelations || [])].filter(relation=>(!relation.ownerId || relation.ownerId===page?.id || relation.ownerId===asset?.assetId) && (ids.has(relation.from)||ids.has(relation.to)||ids.has(relation.bindingId)||[...(relation.fromBindings || []),...(relation.toBindings || [])].some(id=>ids.has(id))));
  const relationCandidates=(model.relations || []).filter(relation=>!relatedLogic.includes(relation) && normalizedName && relation.trigger && normalizedName===String(relation.trigger).toLowerCase());
  const locator=objectLocator(object);
  const gaps = [];
  if(inspectObjectName(name).state!=='usable')gaps.push('对象名称缺失或仅含符号；需核对用途后命名');
  if(locator.kind==='persistent'&&!locator.generation)gaps.push('持久 ID 缺少历史世代；跨修订定位不可用');
  if(locator.kind==='temporary')gaps.push('仅有当前会话临时定位，跨修订身份未验证');
  if(!locator.source?.file)gaps.push('源码定位未登记');
  if(object.nameQuality?.state==='inferred'||object.nameQuality?.state==='duplicate')gaps.push('对象名称为推断或重复，需核对');
  if(!object.coverage?.state || object.coverage.state!=='complete')gaps.push('对象及关系覆盖尚未完整核验');
  if (object.componentId && !asset) gaps.push('组件身份未在资产投影中找到');
  if (asset?.verificationStatus && asset.verificationStatus !== 'verified') gaps.push(`组件验证状态：${asset.verificationStatus}`);
  for (const item of asset?.missing || []) gaps.push(`缺失：${item}`);
  for (const item of asset?.pending || []) gaps.push(`待确认：${item}`);
  const factsUpdatedAt = [model.project?.updatedAt, page?.updatedAt, asset?.updatedAt, ...relatedLogic.map((item) => item.updatedAt)].filter(Boolean).sort().at(-1) || model.relationsVersion || null;
  const registeredComponent = Boolean(asset || object.registeredComponent);
  return {...object, name: asset?.name || name, page, asset, relatedLogic, relationCandidates, relationState:relatedLogic.length?'matched':ids.size?'no-direct-match':'not-checked', locator, usageLocations: asset?.usedByPages || [], gaps, factsUpdatedAt, revision:model.revision || object.revision,factsVersion: model.revision || model.relationsVersion || factsUpdatedAt, localStructureNote: registeredComponent ? null : '这是当前页面里的普通结构，可定位和修改，但没有被视为缺失组件。', recommendation: inspectorScopeRecommendation({...object, registeredComponent}), suggestedScope: suggestedInspectorScope({...object, registeredComponent})};
}

function locatorEnvelope({project, page, object}) {
  const ancestorChain = object?.ancestorIds?.join(' > ') || object?.path?.join(' > ') || '尚未登记';
  return [
    `project stable identity: ${project?.projectId || project?.id || '尚未登记'}`,
    `project name: ${project?.name || '尚未登记'}`,
    `page: ${page?.id || object?.pageId || '尚未登记'}; route=${page?.preview || page?.route || '尚未登记'}`,
    `object identity: ${JSON.stringify(objectLocator(object))}`,
    `source location: ${JSON.stringify(object?.sourceLocation || {state:'unknown'})}`,
    `snapshot revision: ${object?.revision || object?.factsVersion || '尚未核验'}`,
    `object type: ${object?.registeredComponent || object?.componentId ? 'registered component' : 'local page structure'}; role=${object?.role || '尚未登记'}; name=${object?.name || '尚未登记'}`,
    `required ancestor chain: ${ancestorChain}`,
    `facts version timestamp: ${object?.factsUpdatedAt || object?.factsVersion || page?.updatedAt || project?.updatedAt || '尚未登记'}`
  ];
}

const relatedLogicText = (object) => (object?.relatedLogic || []).map((item) => `${item.id}: ${item.from} -> ${item.to}; trigger=${item.trigger || '尚未登记'}; condition=${item.condition || '无条件'}`).join(' | ') || (object?.relationState==='no-direct-match'?'无直接匹配；不证明无逻辑':'未检查明确关系绑定');
const usageText = (object) => (object?.usageLocations || []).map((item) => `${item.pageId}${item.instanceId ? `#${item.instanceId}` : ''}`).join(', ') || '尚未登记';

export function buildInspectorCopyPayload({project, page, object, category = 'full'}) {
  const envelope = locatorEnvelope({project, page, object});
  const recommendation = object?.recommendation || inspectorScopeRecommendation(object);
  const sections = {
    identity: [`hierarchy path: ${object?.path?.join(' > ') || '尚未登记'}`, `component identity: ${object?.componentId || '普通页面结构'}; instance=${object?.instanceId || '无'}`],
    logic: [`related logic: ${relatedLogicText(object)}`],
    layout: [`layout summary: ${compact(object?.layout)}`, `style summary: ${compact(object?.style)}`],
    impact: [`known usage: ${usageText(object)}`, `impact recommendation: ${recommendation.label}; ${recommendation.impact}; confidence=${recommendation.confidence}`, `gaps: ${(object?.gaps || []).join('；') || '未完成命名、定位、关系与覆盖核验'}`]
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
    ...locatorEnvelope({project,page,object}),
    `project: ${project?.name || '尚未登记'} (${project?.projectId || '尚未登记'})`,
    `page: ${page?.name || '尚未登记'} (${page?.id || '尚未登记'}), route=${page?.preview || page?.route || '尚未登记'}`,
    `object: ${object?.name || '尚未登记'}; role=${object?.role || '尚未登记'}; component=${object?.componentId || '普通 DOM'}; instance=${object?.instanceId || '无'}`,
    `hierarchy: ${hierarchy}`,
    `scope: ${scope}`,
    `related logic: ${logic}`,
    `layout summary: ${compact(object?.layout)}`,
    `style summary: ${compact(object?.style)}`,
    `known usage: ${usage}`,
    `gaps: ${(object?.gaps || []).join('；') || '未完成命名、定位、关系与覆盖核验'}`,
    `modification target: ${target.trim() || '请填写具体修改目标'}`
  ].join('\n');
}
