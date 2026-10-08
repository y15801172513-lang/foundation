import {sourceContinuityMatches,projectObjectContext,runtimeObservation} from './object-identity.mjs';
import {extractShortReference,projectObjectReferenceProjection} from './project-revisions.mjs';
import {inspectProjectDeliveryFiles} from './project-delivery.mjs';
import path from 'node:path';
import {inspectorSyntax} from './inspector-syntax.mjs';
import fs from 'node:fs';
import {readFacts} from './facts.mjs';
import {realProject,resolveProjectFile} from './path-boundary.mjs';
import {inspectProjectStructure} from './project-coverage.mjs';
import {captureProjectRoundInputs} from './project-context-round.mjs';
import {projectSemanticRevision} from './project-revisions.mjs';
import {sha256,canonicalStringify} from './install-contract.mjs';

export function parseObjectEnvelope(input) {
  if(typeof input==='object'&&input)return input;
  if(typeof input!=='string'||input.length>65536)throw new Error('对象信封为空或过大');
  const line=input.split('\n').find(line=>line.startsWith('object identity: '));
  try{return JSON.parse(line?line.slice('object identity: '.length):input);}catch{throw new Error('未找到有效对象身份，请复制定位信息');}
}
// Only facts-owned inputs can be returned. The pasted source/path is never authority.
export function resolveProjectObject({project,input,installationRoot=null}) {
  const root=realProject(project),facts=readFacts(root),reference=extractShortReference(input);
  const index=facts.project.contextLifecycle?.objectReferences;
  if(reference&&!index)return {state:'unresolved',reason:'reference-index-missing',mutationPerformed:false,recovery:'项目短引用索引缺失；从项目备份恢复或完成同步，不能靠刷新修复'};
  if(reference&&!Object.hasOwn(index.references,reference))return {state:'unknown',reason:'unknown-reference',mutationPerformed:false,recovery:'此引用不在当前项目；请核对已登记项目，不能扫描其他目录'};
  const locator=reference?index.references[reference]:parseObjectEnvelope(input);
  const recovery='内容已更新，请刷新后重新选择并复制';
  const result=(state,reason,extra={})=>{
    if(state==='resolved'&&(canonicalStringify(readFacts(root))!==canonicalStringify(facts)||captureProjectRoundInputs(root).byteDigest!==observation.byteDigest))return {state:'sync-required',reason:'inputs-changed-during-resolution',recovery:'当前输入在解析期间变化；完成同步后自动重试',mutationPerformed:false};
    return {state,reason,projectId:facts.foundation.projectId,pageId:locator.pageId || null,dom:{state:'not-bound',reason:'只读源码解析不依赖浏览器会话'},source:{state:'unmapped'},recovery,mutationPerformed:false,...extra};
  };
  if(locator.projectId!==facts.foundation.projectId)return result('invalid','project-mismatch');
  if(locator.kind!=='persistent'||!locator.generation)return result('unresolved','需要持久身份及出生世代；旧临时信封缺少源码身份，无法恢复；请先运行项目 inspector-plan 完成源码身份迁移，再重新选择');
  const page=facts.pages.items.find(page=>page.id===locator.pageId);
  if(!page)return result('removed','page-removed');
  const observation=captureProjectRoundInputs(root),version=projectSemanticRevision(facts,observation.files);
  if(!locator.contentVersion||locator.contentVersion!==version)return result('stale','content-version-changed',{currentContentVersion:version});
  if(index?.tombstones?.some(item=>item.persistentId===locator.persistentId&&item.generation===locator.generation&&item.pageId===locator.pageId))return result('stale','object-generation-retired');
  const runtime=locator.runtimeVersion?runtimeObservation(index,locator.pageId,locator.runtimeVersion):null;
  if(runtime?.state==='unverified')return result('unresolved','current-runtime-observation-unverified',{recovery:'当前数据身份有歧义；修复重复实例或映射后由运行页面重新同步'});
  if(locator.runtimeVersion&&(!runtime||runtime.state==='stale'||runtime.runtimeVersion!==locator.runtimeVersion))return result('stale','runtime-data-version-changed');
  const mapped=(runtime?.objects || index?.objects)?.filter(item=>item.pageId===locator.pageId&&item.persistentId===locator.persistentId&&item.generation===locator.generation&&(item.instanceKey || null)===(locator.instanceKey || null)) || [];
  if(mapped.length>1)return result('ambiguous','duplicate-source-identity');
  if(locator.runtimeVersion&&(!mapped.length||mapped[0].instanceGeneration!==locator.instanceGeneration))return result('stale','runtime-instance-generation-changed');
  const currentContext=()=>projectObjectContext({projectId:locator.projectId,pageId:locator.pageId,persistentId:locator.persistentId,identityGeneration:locator.generation,instanceId:locator.instanceKey || null,contentVersion:version,runtimeVersion:locator.runtimeVersion || null,shortReference:reference},projectObjectReferenceProjection(facts,inspectProjectDeliveryFiles({project:root,installationRoot})));
  if(mapped[0]?.mode==='static-snapshot') {
    if(index.contentVersion!==version)return result('unresolved','mapping-sync-required',{recovery:'当前索引尚未完成同步；请执行项目同步并重试'});
    const identity=mapped[0],file=observation.files.find(file=>file.path===identity.file);
    if(file?.sha256!==identity.sha256)return result('stale','mapped-source-bytes-changed');
    if(!sourceContinuityMatches(identity,file))return result('stale','source-continuity-changed');
    const object=inspectProjectStructure(root).objects.find(item=>item.file===identity.file&&item.offset===identity.offset&&item.sha256===identity.sha256&&item.tag===identity.tag);
    if(!object)return result('unresolved','current-source-mapping-missing',{recovery:'当前映射无法核实；需要重新同步，不能猜测对象'});
    const paths=new Set([identity.file,...(page.previewBinding?.inputs || []).map(input=>input.path)]);
    const sources=[...paths].map(file=>({path:file,sha256:sha256(fs.readFileSync(resolveProjectFile(root,file))),text:fs.readFileSync(resolveProjectFile(root,file),'utf8')}));
    if(captureProjectRoundInputs(root).byteDigest!==observation.byteDigest)return result('unresolved','input-changed-during-resolution',{recovery:'解析期间输入改变；请重试'});
    return result('resolved',null,{context:currentContext(),reference,runtimeVersion:runtime?.runtimeVersion || null,object:{...object,text:identity.text ?? object.ownText,persistentId:identity.persistentId,incarnation:identity.generation},identity,contentVersion:version,source:{state:'mapped',files:sources},page:{id:page.id,name:page.name,route:page.preview},relations:page.sourceStructure?.relations || []});
  }
  const partMatch=typeof locator.persistentId==='string'?locator.persistentId.match(/^([^#]+)#([A-Z][A-Za-z0-9]*):([A-Za-z0-9]+)$/u):null;
  const sourceObjectId=partMatch?partMatch[1]:locator.persistentId;
  const identities=facts.project.contextLifecycle?.identities || [];
  const records=identities.filter(item=>item.objectId===sourceObjectId&&((item.instanceKey || null)===(locator.instanceKey || null)||!item.instanceKey)&&item.incarnation===locator.generation);
  if(records.length>1)return result('ambiguous','duplicate-identity');
  const identity=records[0];
  if(!identity||identity.state==='removed')return result('removed','object-generation-removed');
  if(identity.state!=='active')return result('stale','object-continuity-unverified');
  const file=observation.files.find(item=>item.path===identity.sourceFile);
  if(!sourceContinuityMatches(identity,file))return result('stale','source-continuity-changed');
  const objects=inspectProjectStructure(root).objects.filter(item=>item.incarnation===identity.incarnation&&item.persistentId===identity.objectId&&(item.instanceKey || null)===(identity.instanceKey || null));
  if(objects.length!==1)return result(objects.length?'ambiguous':'removed',objects.length?'duplicate-source-identity':'object-removed');
  const object=objects[0];
  let renderedPart=null;
  if(partMatch) {
    let maps;try{const raw=object.attributes['data-foundation-render-map'];maps=JSON.parse(raw.startsWith('{')?JSON.parse(raw.slice(1,-1)):raw);}catch{return result('invalid','renderer-mapping-missing');}
    const mapping=maps.find(item=>item.name===partMatch[2]),node=mapping?.nodes?.find(([,attrs])=>attrs.key===partMatch[3]);
    if(!node)return result('removed','renderer-part-removed');
    try{if(sha256(fs.readFileSync(resolveProjectFile(root,mapping.file,'图标定义')))!==mapping.sha256)return result('stale','renderer-definition-changed');}catch{return result('stale','renderer-definition-unavailable');}
    renderedPart={renderer:mapping.name,key:partMatch[3],tag:node[0],attributes:node[1],definition:{file:mapping.file,sha256:mapping.sha256}};
  }
  if(locator.instanceKey&&!identity.instanceKey&&!locator.runtimeVersion) {
    const component=facts.components.items.find(item=>item.id===identity.ownerId);
    const definition=object.attributes['data-foundation-definition'] || component?.assetModel?.binding?.export;
    const scopes=inspectProjectStructure(root).objects.filter(item=>{
      if(item.attributes.foundationInstanceKey!==locator.instanceKey)return false;
      if(item.file===object.file&&item.tag===definition)return true;
      const syntax=inspectorSyntax(fs.readFileSync(resolveProjectFile(root,item.file),'utf8'),item.file),imported=syntax.imports.get(item.tag);
      if(!imported?.module.startsWith('.')||imported.export!==definition)return false;
      const base=path.posix.normalize(path.posix.join(path.posix.dirname(item.file),imported.module));
      return [base,base+'.tsx',base+'.jsx',base+'/index.tsx'].includes(object.file);
    });
    if(scopes.length!==1) {
      let values=[];
      try{const raw=object.attributes['data-foundation-instance-values'];values=JSON.parse(raw?.startsWith('{')?JSON.parse(raw.slice(1,-1)):raw);}catch{}
      if(!Array.isArray(values)||!values.includes(locator.instanceKey))return result(scopes.length?'ambiguous':'removed','component-instance-removed-or-ambiguous');
    }
  }

  const owners=[page,...facts.components.items.filter(item=>item.id===identity.ownerId||item.id===object.componentId)];
  if(identity.ownerId!==page.id&&!owners.some(item=>item.id===identity.ownerId&&item.usageLocations?.some(usage=>usage.pageId===page.id)))return result('ambiguous','page-owner-not-bound');
  const inputs=new Map();
  for(const owner of owners)for(const value of [{path:owner.implementationMapping,sha256:owner.implementationSha256},...(owner.sourceStructure?.inputs || []),...(owner.previewBinding?.inputs || []),...(owner.assetModel?.implementationInputs || []).map(edge=>({path:edge.to,sha256:edge.sha256}))])if(value.path&&value.sha256)inputs.set(value.path,value);
  if(!inputs.has(object.file))return result('resolved','source-mapping-missing',{object});
  const sources=[];let total=0;
  for(const input of inputs.values()) {
    const bytes=fs.readFileSync(resolveProjectFile(root,input.path,'登记源码'));
    if(sha256(bytes)!==input.sha256)return result('stale','mapped-source-bytes-changed');
    const include=!input.path.startsWith('node_modules/')&&total+bytes.length<=512*1024;
    if(include)total+=bytes.length;
    sources.push({...input,kind:input.path.endsWith('.css')?'style':'source',...(include?{text:bytes.toString('utf8')}:{textState:'digest-verified-not-inlined'})});
  }
  if(captureProjectRoundInputs(root).byteDigest!==observation.byteDigest)return result('unresolved','input-changed-during-resolution',{recovery:'解析期间输入改变；请重试'});
  return result('resolved',null,{context:currentContext(),reference,runtimeVersion:runtime?.runtimeVersion || null,object:{...object,text:mapped[0]?.text ?? object.ownText},renderedPart,identity,contentVersion:version,source:{state:'mapped',files:sources},components:owners.filter(item=>item!==page),page:{id:page.id,name:page.name,route:page.preview},relations:facts.relations.items.filter(item=>item.from===page.id||item.to===page.id)});
}
