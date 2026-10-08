import {inspectObjectName, objectLocator, shortObjectName, projectObjectContext} from '@foundation/core/object-identity';
const compact = (record = {}) => Object.entries(record).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(', ') || '尚未登记';

export const INSPECTOR_COPY_CATEGORIES = [
  {id: 'full', label: '全量信息'},
  {id: 'identity', label: '定位层级'},
  {id: 'logic', label: '交互'},
  {id: 'layout', label: '布局'},
  {id: 'impact', label: '关联'}
];

export function inspectorRelationDescription(item,model) {
  const name=id=>[...(model.pages || []),...(model.tokens || []),...(model.assets || [])].find(record=>record.id===id||record.assetId===id)?.name || id;
  if(item.type==='uses')return {title:'样式或资产使用',detail:'使用 '+name(item.to)};
  if(item.type==='contains')return {title:'结构关系',detail:'包含 '+name(item.to)};
  const navigation=(model.pages || []).some(page=>page.id===item.from)&&(model.pages || []).some(page=>page.id===item.to);
  return {title:item.event || item.trigger || '已登记关系',detail:(navigation?'从“'+name(item.from)+'”前往“'+name(item.to)+'”':item.result || item.description || name(item.to))+(item.condition?'；条件：'+item.condition:'')+(item.targetState?'；目标状态：'+item.targetState:'')};
}

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
  const name = shortObjectName({label:object.name,role:object.role}).name;
  const normalizedName = String(name || '').toLowerCase();
  const ids=new Set([object.persistentId,object.componentId,object.instanceId,object.bindingId].filter(Boolean));
  const relatedLogic=[...(model.relations || []),...(model.objectRelations || [])].filter(relation=>(!relation.ownerId || relation.ownerId===page?.id || relation.ownerId===asset?.assetId) && (ids.has(relation.from)||ids.has(relation.to)||ids.has(relation.bindingId)||[...(relation.fromBindings || []),...(relation.toBindings || [])].some(id=>ids.has(id))));
  for(const variable of object.usedVariables || []){const tokens=(model.tokens || []).filter(token=>token.cssVariable===variable.name);if(tokens.length===1)relatedLogic.push({id:'uses:'+object.persistentId+':'+tokens[0].id,type:'uses',from:object.persistentId,to:tokens[0].id});}
  const relationCandidates=(model.relations || []).filter(relation=>!relatedLogic.includes(relation) && normalizedName && relation.trigger && normalizedName===String(relation.trigger).toLowerCase());
  object={...object,projectId:model.project?.projectId || object.projectId,contentVersion:object.contentVersion || null,snapshotIssue:object.snapshotIssue || (!object.contentVersion?'page-version-unverified':null)};
  const refs=model.objectReferences;
  object=projectObjectContext(object,refs);
  const locator=objectLocator(object);
  const gaps = [];
  if(inspectObjectName(name).state!=='usable')gaps.push('对象名称缺失或仅含符号；需核对用途后命名');
  if(locator.kind==='persistent'&&!locator.generation)gaps.push('持久 ID 缺少历史世代；跨修订定位不可用');
  if(locator.kind==='temporary')gaps.push('仅有当前会话临时定位，跨修订身份未验证');
  if(!locator.source?.file)gaps.push('源码定位未登记');
  if(object.nameQuality?.state==='duplicate'||object.nameQuality?.state==='inferred'&&object.coverage?.state!=='complete')gaps.push('对象名称为推断或重复，需核对');
  if(!object.coverage?.state || object.coverage.state!=='complete')gaps.push('对象及关系覆盖尚未完整核验');
  if (object.componentId && !asset) gaps.push('组件身份未在资产投影中找到');
  if (asset?.verificationStatus && asset.verificationStatus !== 'verified') gaps.push(`组件验证状态：${asset.verificationStatus}`);
  for (const item of asset?.missing || []) gaps.push(`缺失：${item}`);
  for (const item of asset?.pending || []) gaps.push(`待确认：${item}`);
  const factsUpdatedAt = [model.project?.updatedAt, page?.updatedAt, asset?.updatedAt, ...relatedLogic.map((item) => item.updatedAt)].filter(Boolean).sort().at(-1) || model.relationsVersion || null;
  const registeredComponent = Boolean(asset || object.registeredComponent);
  return {...object, name, page, asset, relatedLogic, relationCandidates, relationState:relatedLogic.length?'matched':ids.size?'no-direct-match':'not-checked', locator, usageLocations: asset?.usedByPages || [], gaps, factsUpdatedAt, revision:model.revision || object.revision,factsVersion: model.revision || model.relationsVersion || factsUpdatedAt, localStructureNote: registeredComponent ? null : '这是当前页面里的普通结构，可定位和修改，但没有被视为缺失组件。', recommendation: inspectorScopeRecommendation({...object, registeredComponent}), suggestedScope: suggestedInspectorScope({...object, registeredComponent})};
}

function locatorEnvelope({project, page, object}) {
  const ancestorChain = object?.ancestorIds?.join(' > ') || object?.path?.join(' > ') || '尚未登记';
  return [
    `project stable identity: ${project?.projectId || project?.id || '尚未登记'}`,
    `project name: ${project?.name || '尚未登记'}`,
    `page: ${page?.id || object?.pageId || '尚未登记'}; route=${page?.preview || page?.route || '尚未登记'}`,
    `object identity: ${JSON.stringify(objectLocator(object))}`,
    '只读补取：foundation-kit project resolve-object --root <安装根> --project <项目根> --input <保存此复制内容的项目内文件>',
    `snapshot revision: ${object?.revision || object?.factsVersion || '尚未核验'}`,
    `object type: ${object?.registeredComponent || object?.componentId ? 'registered component' : 'local page structure'}; role=${object?.role || '尚未登记'}; name=${object?.name || '尚未登记'}`,
    `required ancestor chain: ${ancestorChain}`,
    `facts version timestamp: ${object?.factsUpdatedAt || object?.factsVersion || page?.updatedAt || project?.updatedAt || '尚未登记'}`
  ];
}

const relatedLogicText = (object) => (object?.relatedLogic || []).map((item) => `${item.id}: ${item.from} -> ${item.to}; trigger=${item.trigger || '尚未登记'}; condition=${item.condition || '无条件'}`).join(' | ') || (object?.relationState==='no-direct-match'?'无直接匹配；不证明无逻辑':'未检查明确关系绑定');
const usageText = (object) => (object?.usageLocations || []).map((item) => `${item.pageId}${item.instanceId ? `#${item.instanceId}` : ''}`).join(', ') || '尚未登记';

export function buildInspectorCopyPayload({project, page, object, category = 'full'}) {
  const reference=object?.shortReference;
  const issue=object?.runtimeSnapshotIssue==='内容已更新，请刷新后重新选择并复制'?'（内容已更新，请刷新后重新选择并复制）':object?.runtimeSnapshotIssue==='runtime-synchronizing'?'（正在同步页面，请稍后重新选择）':'（页面快照无法核实）';
  const minimal=`${object?.name || '对象'} ${object?.snapshotIssue?issue:reference || '（对象索引尚未就绪）'}`;
  const logic=(object?.relatedLogic || []).filter(item=>item.trigger||item.event||item.condition||item.result||item.actionType||item.targetState||item.targetEntity);
  const links=(object?.relatedLogic || []).map(item=>({id:item.id,from:item.from,to:item.to,type:item.type || 'relation'}));
  const sections={
    identity:[],
    logic:logic.length?logic.map(item=>JSON.stringify({event:item.event || item.trigger,...(item.semanticState?{evidence:item.semanticState}:{}),condition:item.condition ?? null,state:item.state ?? null,result:item.result ?? item.targetState ?? item.targetEntity ?? item.to,...(item.actionType?{actionType:item.actionType}:{}),...(item.targetState!=null?{targetState:item.targetState}:{}),...(item.targetEntity!=null?{targetEntity:item.targetEntity}:{})})):['无已登记交互'],
    layout:[`布局：${compact(object?.layout)}`,`样式：${compact(object?.style)}`,...(object?.usedVariables?.length?[`变量：${JSON.stringify(object.usedVariables)}`]:[])],
    impact:[...links.map(item=>JSON.stringify(item)),...(object?.usageLocations || []).map(item=>JSON.stringify({pageId:item.pageId,instanceId:item.instanceId || null}))]
  };
  if(!sections.impact.length)sections.impact=['无已登记关联'];
  if(category==='identity')return minimal;
  if(category==='full')return [minimal,...new Set([
    ...(object?.text!=null?[`文字：${object.text}`]:[]),
    ...(object?.nameQuality?[`命名依据：${JSON.stringify({state:object.nameQuality.state,source:object.nameQuality.source})}`]:[]),
    ...(object?.hierarchy?[`层级：${JSON.stringify({parent:object.hierarchy.parent?{name:object.hierarchy.parent.name,reference:object.hierarchy.parent.shortReference,role:object.hierarchy.parent.role}:null,children:(object.hierarchy.children || []).map(child=>({name:child.name,reference:child.shortReference,role:child.role}))})}`]:[]),
    ...(object?.coverage?[`核验：${JSON.stringify(object.coverage)}`]:[]),
    ...(object?.variant?[`变体：${object.variant}`]:[]),
    ...(object?.eventState?[`当前状态：${object.eventState}`]:[]),
    ...(object?.attributes?[`属性：${JSON.stringify(object.attributes)}`]:[]),
    ...(object?.styleLimitations?.length?[`样式核验限制：${JSON.stringify(object.styleLimitations)}`]:[]),
    ...(object?.variableCandidates?.length?[`变量声明候选（不代表实际使用）：${JSON.stringify(object.variableCandidates)}`]:[]),
    ...sections.logic,...sections.layout,...sections.impact,...locatorEnvelope({project,page,object}),`诊断：${(object?.gaps || []).join('；') || '无'}`])].join('\n');
  if(!sections[category])throw new TypeError(`未知检查器复制分类：${category}`);
  return [minimal,...sections[category]].join('\n');
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
