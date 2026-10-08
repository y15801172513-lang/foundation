import fs from 'node:fs';
import crypto from 'node:crypto';
import {readFacts} from './facts.mjs';
import {realProject,resolveProjectFile} from './path-boundary.mjs';
import {captureProjectRoundInputs} from './project-context-round.mjs';
import {projectSemanticRevision} from './project-revisions.mjs';
import {sha256,canonicalStringify} from './install-contract.mjs';
import {signTrustedPayload} from './trusted-authority.mjs';
import {synchronizeProject} from './project-sync.mjs';
import {verifyWebPreviewBuild} from './web-preview-build.mjs';

const digest=value=>sha256(canonicalStringify(value));
function commitRuntimeObservation({root,installationRoot,facts,observation,index,runtimeSnapshots,references=index.references}) {
  const content={...facts.project,contextLifecycle:{...facts.project.contextLifecycle,objectReferences:{...index,references,runtimeSnapshots}}};
  const value={purpose:'foundation-project-round/1',project:root,action:'observe',taskId:'runtime-object-snapshot',factsDigest:digest(facts),expectedSha256:sha256(fs.readFileSync(resolveProjectFile(root,'.foundation/facts/project.json'))),observation,content};
  return synchronizeProject({project:root,installationRoot,handlerPayload:{documents:[],sources:[],scope:'登记当前可信预览的明确运行观察，保留旧引用',generatedAt:new Date().toISOString(),roundTransition:{...value,integrity:signTrustedPayload(value)}}});
}
// A document owns its cursor, never a global data version. Observation records
// and copy keys are shared only while current, and are never silently rebound.
export function registerRuntimeObjectSnapshot({project,installationRoot,pageId,contentVersion,previousRuntimeVersion=null,documentId='legacy',requestSequence=1,observationScope='document-local',objects}) {
  const root=realProject(project),facts=readFacts(root),page=facts.pages.items.find(page=>page.id===pageId);
  const observation=captureProjectRoundInputs(root),version=projectSemanticRevision(facts,observation.files),index=facts.project.contextLifecycle?.objectReferences;
  if(!page||!index||index.contentVersion!==version)return {state:'sync-required',reason:'current-index-not-ready'};
  if(contentVersion!==version)return {state:'stale',reason:'content-version-changed'};
  if(page.previewBinding?.producer==='foundation-web-build/1')verifyWebPreviewBuild({project:root,facts,page});
  else if(page.previewBinding?.producer!=='foundation-static-preview/1')return {state:'unverified',reason:'page-producer-unverified'};
  if(!Array.isArray(objects)||objects.length>2000||Buffer.byteLength(JSON.stringify(objects))>2*1024*1024)throw new Error('运行对象快照超出边界');
  if(observationScope!=='document-local')return {state:'unverified',reason:'external-data-version-not-supported'};
  if(typeof documentId!=='string'||!documentId||documentId.length>128||!Number.isSafeInteger(requestSequence)||requestSequence<1)return {state:'unverified',reason:'invalid-document-cursor'};
  const pageSnapshot=index.runtimeSnapshots?.[pageId];
  const observations=structuredClone(pageSnapshot?.observations || (pageSnapshot?{[pageSnapshot.runtimeVersion]:pageSnapshot}:{}));
  const documents={...(pageSnapshot?.documents || {})},cursor=documents[documentId];
  const current=cursor?observations[cursor.runtimeVersion]:previousRuntimeVersion?observations[previousRuntimeVersion]:null;
  if(cursor&&requestSequence<cursor.requestSequence)return {state:'stale-observation',reason:'late-document-message'};
  const seen=new Set(),records=[];
  const save=(snapshot,references=index.references)=>commitRuntimeObservation({root,installationRoot,facts,observation,index,references,runtimeSnapshots:{...index.runtimeSnapshots,[pageId]:{...snapshot,schemaVersion:'foundation-runtime-observations/2',observations,documents}}});
  const heldByOther=version=>Object.entries(documents).some(([id,value])=>id!==documentId&&value.runtimeVersion===version&&!value.invalid);

  try {
  for(const item of objects) {
    if(typeof item.persistentId!=='string'||typeof item.generation!=='string'||item.instanceKey!==null&&(typeof item.instanceKey!=='string'||!item.instanceKey||item.instanceKey.length>256)||typeof item.text!=='string'||item.text.length>65536)throw new Error('运行对象快照字段无效');
    const key=JSON.stringify([item.persistentId,item.generation,item.instanceKey]);
    if(seen.has(key))throw new Error('运行对象实例键重复，不能按次序猜身份');seen.add(key);
    const templates=index.objects.filter(source=>source.pageId===pageId&&source.persistentId===item.persistentId&&source.generation===item.generation&&((source.instanceKey || null)===item.instanceKey||source.dynamicInstances&&source.instanceKey===null));
    if(templates.length!==1)throw new Error('运行对象没有唯一的当前源码定义');
    if(!item.attributes||typeof item.attributes!=='object'||Array.isArray(item.attributes)||Object.entries(item.attributes).some(([key,value])=>typeof value!=='string'||key.length>128||value.length>65536))throw new Error('运行属性快照无效');
    records.push({persistentId:item.persistentId,generation:item.generation,instanceKey:item.instanceKey,text:item.text,attributes:item.attributes,parent:item.parent || null,tag:templates[0].tag,source:templates[0]});
  }
  }catch(error) {
    if(current) {
      documents[documentId]={runtimeVersion:current.runtimeVersion,requestSequence,invalid:true};
      if(!heldByOther(current.runtimeVersion))observations[current.runtimeVersion]={...current,state:'unverified',reason:error.message};
      const result=save(observations[current.runtimeVersion]);
      if(['failed','conflict','stopped','in-progress'].includes(result.state))return {state:'sync-required',reason:'invalid-observation-commit-pending'};
    }
    return {state:'unverified',reason:error.message};
  }
  const observationDigest=digest({contentVersion,objects:records.map(({source,...item})=>item)});
  if(cursor&&requestSequence===cursor.requestSequence&&current?.observationDigest!==observationDigest&&!cursor.invalid)return {state:'stale-observation',reason:'reused-document-sequence'};
  if(cursor&&previousRuntimeVersion!==cursor.runtimeVersion&&current?.observationDigest!==observationDigest)return {state:'sync-required',reason:'document-cursor-mismatch',documentRuntimeVersion:cursor.runtimeVersion};
  const reusable=Object.values(observations).find(item=>item.observationDigest===observationDigest&&!['stale','unverified'].includes(item.state)&&(!current||current.runtimeVersion===item.runtimeVersion));
  const retire=nextVersion=>{
    if(current&&current.runtimeVersion!==nextVersion&&!heldByOther(current.runtimeVersion))observations[current.runtimeVersion]={...current,state:'stale',reason:'document-state-advanced'};
  };
  if(reusable) {
    retire(reusable.runtimeVersion);
    documents[documentId]={runtimeVersion:reusable.runtimeVersion,requestSequence};
    const result=save(reusable);
    if(['failed','conflict','stopped','in-progress'].includes(result.state))return {state:'sync-required',reason:'observation-commit-pending'};
    return {state:'bound',contentVersion,runtimeVersion:reusable.runtimeVersion,observationScope,objects:reusable.objects};
  }
  const sequence=Math.max(0,...Object.values(observations).map(item=>item.sequence || 0))+1;
  const runtimeVersion=digest({contentVersion,observationDigest,sequence});
  const instanceLifetimes={...(current?.instanceLifetimes || {})};
  const currentKeys=new Set(records.map(record=>JSON.stringify([record.persistentId,record.generation,record.instanceKey])));
  for(const [key,life] of Object.entries(instanceLifetimes))if(!currentKeys.has(key))instanceLifetimes[key]={...life,state:'not-rendered'};
  const references={...index.references},mapped=records.map(record=>{
    const instanceKey=JSON.stringify([record.persistentId,record.generation,record.instanceKey]),prior=instanceLifetimes[instanceKey];
    const instanceGeneration=current?.state!=='unverified'&&prior?.state==='rendered'?prior.generation:crypto.randomUUID();
    instanceLifetimes[instanceKey]={generation:instanceGeneration,state:'rendered',scope:'observed-render-instance'};
    let reference;for(let i=0;i<8;i++){const candidate='F-'+crypto.randomBytes(16).toString('base64url');if(!Object.hasOwn(references,candidate)){reference=candidate;break;}}
    if(!reference)throw new Error('运行引用碰撞，未覆盖旧引用');
    const locator={schemaVersion:'foundation-object/1',projectId:facts.foundation.projectId,pageId,kind:'persistent',persistentId:record.persistentId,generation:record.generation,instanceKey:record.instanceKey,instanceGeneration,contentVersion,runtimeVersion};
    references[reference]=locator;
    return {...record.source,instanceKey:record.instanceKey,instanceGeneration,text:record.text,attributes:record.attributes,parent:record.parent,reference,runtimeVersion};
  });
  const snapshot={contentVersion,runtimeVersion,sequence,observationDigest,instanceLifetimes,objects:mapped,state:'current',observationScope,source:'explicit-document-local-observation',businessDataAuthority:'source-input-closure-only'};
  retire(runtimeVersion);observations[runtimeVersion]=snapshot;
  documents[documentId]={runtimeVersion,requestSequence};
  const result=save(snapshot,references);
  if(['failed','conflict','stopped','in-progress'].includes(result.state))return {state:'sync-required',reason:result.error?.message || result.state};
  const saved=readFacts(root).project.contextLifecycle.objectReferences.runtimeSnapshots?.[pageId];
  if(saved?.documents?.[documentId]?.runtimeVersion!==runtimeVersion)return {state:'sync-required',reason:'snapshot-not-current-after-commit'};
  return {state:'bound',contentVersion,runtimeVersion,observationScope,objects:mapped};
}
