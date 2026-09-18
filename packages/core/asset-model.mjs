const rows = facts => facts.components?.items || [];

export const COMPONENT_DELIVERY_CAPABILITY='component-delivery/1';
export const SEMANTIC_REVIEW_CAPABILITY='semantic-review/1';
export function requiredFactCapabilities(facts) {
  const result=rows(facts).some(asset=>asset.assetModel) || (facts.changes?.items || []).some(change=>change.deliveryScope?.schemaVersion==='2.0.0')?[COMPONENT_DELIVERY_CAPABILITY]:[];
  if((facts.changes?.items || []).some(c=>c.evidenceIndex?.some(e=>e.kind==='semantic-review'&&e.runnerVersion==='foundation-semantic-review/1.0.0')))result.push(SEMANTIC_REVIEW_CAPABILITY);
  return result;
}

export function factMigrationImpact(before,after) {
  return ['components','changes'].flatMap(kind=>(after[kind]?.items || []).flatMap(item=>{
    const old=before[kind]?.items?.find(row=>row.id===item.id);
    if(!old)return [];
    const upgraded=kind==='components'?!old.assetModel&&item.assetModel:old.deliveryScope?.schemaVersion==='1.0.0'&&item.deliveryScope?.schemaVersion==='2.0.0';
    return upgraded?[{kind,id:item.id,from:kind==='components'?'legacy-unreviewed':'scope-1',to:kind==='components'?'asset-model-1':'scope-2',requiredCapability:COMPONENT_DELIVERY_CAPABILITY,preservedFields:Object.keys(old).filter(key=>!['assetModel','deliveryScope','updatedAt','implementationSha256'].includes(key))}]:[];
  }));
}

export function resolveAssetBinding(facts, observation) {
  const definitions = observation?.definitions || [];
  const resolved = rows(facts).map(asset=>{
    const binding = asset.assetModel?.binding;
    if(!binding)return {assetId:asset.id,state:'legacy-unreviewed',definition:null};
    const candidates = definitions.filter(d=>d.file===binding.file && d.anchor===binding.anchor && d.declarationKind===binding.declarationKind && (binding.export === null || d.exports.includes(binding.export)));
    if(candidates.length!==1)return {assetId:asset.id,state:candidates.length?'conflict':'unresolved',definition:null};
    const definition = candidates[0];
    return {assetId:asset.id,state:'bound',definition,usages:(observation.usages || []).filter(u=>u.definitionId===definition.bindingId)};
  });
  for(const entry of resolved)if(entry.definition) {
    const conflicts=resolved.filter(other=>other!==entry && other.definition?.bindingId===entry.definition.bindingId);
    if(conflicts.length){entry.state='conflict';entry.conflictsWith=conflicts.map(other=>other.assetId);}
  }
  return resolved;
}

export function inspectReuseDecision(decision, before, after) {
  const issues = [];
  const add = (code,message) => issues.push({code,message,decisionId:decision.id});
  if(!decision.search?.paths?.length || !decision.search?.inputDigest || !decision.reason || !decision.requirementId)add('DECISION_BASIS_MISSING','复用决定缺检索范围、当前输入或需求来源');
  if(decision.kind==='new' && (!decision.responsibility || (decision.candidateIds || []).some(id=>!decision.rejectedCandidates?.some(c=>c.assetId===id && c.reason))))add('NEW_RESPONSIBILITY_MISSING','新定义需独立职责和已有候选不适用理由');
  if(decision.beforeDigest && decision.beforeDigest!==before?.inputDigest)add('DECISION_INPUT_STALE','决定的修改前输入已变化');
  if(decision.afterDigest && decision.afterDigest!==after?.inputDigest)add('DECISION_INPUT_STALE','决定的修改后输入已变化');
  for(const expected of decision.expectedUsages || []) {
    const actual=(after?.usages || []).filter(u=>u.definitionId===expected.definitionId && u.file===expected.file && u.role===(expected.role || 'source-use'));
    if(actual.length<(expected.minimum || 1))add('DECISION_NOT_APPLIED',`预期真实调用未出现：${expected.file}`);
  }
  if(['same-instance','variant','composition','base-update'].includes(decision.kind)) {
    if(!decision.expectedUsages?.length)add('DECISION_NOT_APPLIED','复用决定未绑定预期真实调用');
    const oldIds=new Set((before?.definitions || []).map(d=>d.bindingId));
    const usedIds=new Set((decision.expectedUsages || []).map(u=>u.definitionId));
    const reused=(before?.definitions || []).filter(d=>usedIds.has(d.bindingId));
    for(const fresh of after?.definitions || [])if(!oldIds.has(fresh.bindingId) && reused.some(d=>d.bodyHash===fresh.bodyHash))add('DECISION_NOT_APPLIED',`复用却复制了同体声明：${fresh.bindingId}`);
  }
  const targets=[...new Set((decision.expectedUsages || []).map(use=>use.definitionId))];
  const coverage=targets.map(id=>({definitionId:id,...after?.definitions?.find(d=>d.bindingId===id)?.coverage}));
  const unknown=targets.length?coverage.some(item=>item.state!=='proven-static'):after?.coverage?.state!=='complete';
  return {decisionId:decision.id,state:issues.length?'decision-not-applied':unknown?'unknown':'applied-static',runtime:'unknown',coverage,issues};
}

export function inspectAssetReferences(facts) {
  const issues=[];
  const assets=rows(facts),ids=new Set(assets.map(a=>a.id));
  const allIds=new Set(Object.values(facts).flatMap(d=>d?.items || []).map(x=>x.id));
  const bindings=new Map();
  for(const asset of assets) {
    const model=asset.assetModel;if(!model)continue;
    if(model.binding?.file!==asset.implementationMapping)issues.push(`${asset.id}: binding.file 与 implementationMapping 不一致`);
    const key=JSON.stringify(model.binding && [model.binding.file,model.binding.anchor,model.binding.declarationKind]);
    if(bindings.has(key))issues.push(`${asset.id}: 同一声明已由 ${bindings.get(key)} 持有`);bindings.set(key,asset.id);
    for(const slot of model.slots || [])if(!ids.has(slot.componentId) || !asset.composes?.includes(slot.componentId))issues.push(`${asset.id}: slot 需引用同一 composes 定义`);
    for(const [label,values,key]of [['场景',model.previewScenarios || [],'id'],['状态',model.states || [],'id'],['变体轴',model.variantAxes || [],'key']])if(new Set(values.map(v=>v[key])).size!==values.length)issues.push(`${asset.id}: ${label}身份重复`);
    for(const scenario of model.previewScenarios || []) {
      if(scenario.definitionId!==asset.id || (scenario.kind==='instance'&&!scenario.instanceId) || (scenario.instanceId && !asset.usageLocations?.some(u=>u.instanceId===scenario.instanceId)))issues.push(`${asset.id}: 预览目标或实例不匹配`);
      if(scenario.state && !model.states?.some(state=>state.id===scenario.state))issues.push(`${asset.id}: 预览状态未登记`);
      for(const [key,value]of Object.entries(scenario.variantValues || {}))if(!model.variantAxes?.some(axis=>axis.key===key&&axis.values.includes(value)))issues.push(`${asset.id}: 预览变体配置未登记`);
    }
  }
  for(const change of facts.changes?.items || [])if(change.deliveryScope?.schemaVersion==='2.0.0') {
    const scope=change.deliveryScope,sourceIds=new Set((scope.sourceRefs || []).map(x=>x.id)),requirementIds=new Set();
    if(scope.taskId!==change.id)issues.push(`${change.id}: taskId 必须绑定同一 changes 记录`);
    for(const item of scope.items || []) {
      if(requirementIds.has(item.requirementId))issues.push(`${change.id}: requirementId 重复`);requirementIds.add(item.requirementId);
      if(item.factIds?.some(id=>!allIds.has(id)))issues.push(`${change.id}: requirement 引用了不存在的事实`);
      if(item.sourceRefIds?.some(id=>!sourceIds.has(id)))issues.push(`${change.id}: requirement 来源引用不存在`);
    }
    for(const decision of change.reuseDecisions || [])if(!requirementIds.has(decision.requirementId) || decision.scopeRevision!==scope.revision || decision.candidateIds?.some(id=>!ids.has(id)) || (decision.assetId&&!ids.has(decision.assetId)) || decision.rejectedCandidates?.some(candidate=>!ids.has(candidate.assetId)))issues.push(`${change.id}: 决定引用或 scope revision 无效`);
    for(const evidence of change.evidenceIndex || [])if(evidence.taskId!==scope.taskId || evidence.scopeRevision!==scope.revision || (evidence.subject?.definitionId && !ids.has(evidence.subject.definitionId)))issues.push(`${change.id}: 证据任务、修订或定义引用无效`);
  }
  return issues;
}
