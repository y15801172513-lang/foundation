import path from 'node:path';
import {inspectorSyntax} from './inspector-syntax.mjs';
import fs from 'node:fs';
import {readFacts} from './facts.mjs';
import {realProject,resolveProjectFile} from './path-boundary.mjs';
import {inspectProjectStructure} from './project-coverage.mjs';
import {captureProjectRoundInputs} from './project-context-round.mjs';
import {projectSemanticRevision} from './project-revisions.mjs';
import {sha256} from './install-contract.mjs';

export function parseObjectEnvelope(input) {
  if(typeof input==='object'&&input)return input;
  if(typeof input!=='string'||input.length>65536)throw new Error('对象信封为空或过大');
  const line=input.split('\n').find(line=>line.startsWith('object identity: '));
  try{return JSON.parse(line?line.slice('object identity: '.length):input);}catch{throw new Error('未找到有效对象身份，请复制定位信息');}
}
// Only facts-owned inputs can be returned. The pasted source/path is never authority.
export function resolveProjectObject({project,input}) {
  const root=realProject(project),locator=parseObjectEnvelope(input),facts=readFacts(root);
  const recovery=`在来源浏览器刷新项目「${facts.foundation.name || facts.foundation.projectId}」页面「${locator.pageId || '未登记'}」，重新检查并复制；无需同步其他浏览器。`;
  const result=(state,reason,extra={})=>({state,reason,projectId:facts.foundation.projectId,pageId:locator.pageId || null,dom:{state:'not-bound',reason:'只读源码解析不依赖浏览器会话'},source:{state:'unmapped'},recovery,mutationPerformed:false,...extra});
  if(locator.projectId!==facts.foundation.projectId)return result('invalid','project-mismatch');
  if(locator.kind!=='persistent'||!locator.generation)return result('unresolved','需要持久身份及出生世代；旧临时信封缺少源码身份，无法恢复；请先运行项目 inspector-plan 完成源码身份迁移，再重新选择');
  const page=facts.pages.items.find(page=>page.id===locator.pageId);
  if(!page)return result('removed','page-removed');
  const partMatch=typeof locator.persistentId==='string'?locator.persistentId.match(/^([^#]+)#([A-Z][A-Za-z0-9]*):([A-Za-z0-9]+)$/u):null;
  const sourceObjectId=partMatch?partMatch[1]:locator.persistentId;
  const identities=facts.project.contextLifecycle?.identities || [];
  const records=identities.filter(item=>item.objectId===sourceObjectId&&((item.instanceKey || null)===(locator.instanceKey || null)||!item.instanceKey)&&item.incarnation===locator.generation);
  if(records.length>1)return result('ambiguous','duplicate-identity');
  const identity=records[0];
  if(!identity||identity.state==='removed')return result('removed','object-generation-removed');
  if(identity.state!=='active')return result('stale','object-continuity-unverified');
  const observation=captureProjectRoundInputs(root),version=projectSemanticRevision(facts,observation.files);
  if(!locator.contentVersion||locator.contentVersion!==version)return result('stale','content-version-changed',{currentContentVersion:version});
  const file=observation.files.find(item=>item.path===identity.sourceFile);
  if(!file||file.physical!==identity.sourcePhysical)return result('stale','source-continuity-changed');
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
  if(locator.instanceKey&&!identity.instanceKey) {
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
    total+=bytes.length;if(total>512*1024)return result('resolved','source-context-too-large',{object});
    sources.push({...input,kind:input.path.endsWith('.css')?'style':'source',text:bytes.toString('utf8')});
  }
  return result('resolved',null,{object,renderedPart,identity,contentVersion:version,source:{state:'mapped',files:sources},components:owners.filter(item=>item!==page),page:{id:page.id,name:page.name,route:page.preview},relations:facts.relations.items.filter(item=>item.from===page.id||item.to===page.id)});
}
