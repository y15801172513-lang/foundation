import {currentEvidenceEntries} from './evidence-impact.mjs';
import {sourceContinuityMatches} from './object-identity.mjs';
import {sha256,canonicalStringify} from './install-contract.mjs';
export function businessFact(record) {
  const {updatedAt,implementationSha256,sourceStructure,synchronization,evidenceIndex,verificationEvidence,verificationStatus,contextLifecycle,...content}=record;
  delete content.styleEvidence;
  // Receipts and generated output locations describe a build operation, not
  // business content. Source/dependency digests below bind effective inputs.
  if(content.previewBinding){const {inputs,receipt,...binding}=content.previewBinding;content.previewBinding=binding;}
  if(content.assetModel){const {implementationInputs,...model}=content.assetModel;content.assetModel=model;}
  if(sourceStructure?.semantics&&sourceStructure.semantics.producer!=='foundation-source-semantics/1')content.semantics={nodes:sourceStructure.semantics.nodes?.map(({sourceKeys,sources,...node})=>node),relations:sourceStructure.semantics.relations?.map(({sourceKeys,sources,...edge})=>edge)};
  return content;
}
export function projectSemanticRevision(facts,sourceInputs=[]) {
  const known=new Set(Object.values(facts).flatMap(doc=>(doc?.items || []).flatMap(item=>[item.implementationMapping,...(item.assetModel?.implementationInputs || []).map(edge=>edge.to),...(item.previewBinding?.inputs || []).map(input=>input.path)])));
  const content=Object.fromEntries(Object.entries(facts).filter(([kind])=>!['changes','foundation','delivery','synchronization'].includes(kind)).filter(([,doc])=>Array.isArray(doc?.items)).map(([kind,doc])=>[kind,doc.items.map(businessFact)]));
  const equivalents=facts.project.contextLifecycle?.sourceEquivalences || [];
  return sha256(canonicalStringify({content,sources:sourceInputs.filter(input=>!['document','configuration-empty'].includes(input.kind)&&!input.path.startsWith('.foundation/')).map(({path,semanticSha256,sha256})=>({path,semanticSha256:equivalents.findLast(item=>item.path===path&&item.afterSha256===sha256)?.semanticSha256 || semanticSha256 || sha256})).sort((a,b)=>a.path.localeCompare(b.path))}));
}

import crypto from 'node:crypto';

export const SHORT_REFERENCE_PATTERN = /^F-[A-Za-z0-9_-]{22}$/u;
export function extractShortReference(input) {
  if(typeof input!=='string'||input.length>65536)return null;
  const matches=input.match(/\bF-[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])/gu) || [];
  return matches.length===1?matches[0]:null;
}
const fingerprint=value=>sha256(canonicalStringify(value));
export function projectObjectReferenceProjection(facts,delivery) {
  const index=facts.project.contextLifecycle?.objectReferences;
  if(!index)return null;
  const results=delivery?.evidenceResults || {};
  const entries=currentEvidenceEntries((facts.changes?.items || []).flatMap(task=>task.evidenceIndex || []),results);
  const effective=new Set(entries.map(entry=>entry.evidenceId));
  const projectObject=object=>{
    const checkId='structure_'+sha256(object.file+':'+object.offset).slice(0,16);
    const checks=Object.entries(results).filter(([id,result])=>effective.has(id)&&result.state==='verified'&&result.report?.kind==='semantic-review'&&result.report.structureDigest===delivery.structureCoverage?.sourceDigest&&result.report.checks?.some(check=>check.id===checkId));
    const evidence=checks.some(([,result])=>result.report.checks.some(check=>check.id===checkId&&check.result!=='passed'))?[]:checks.filter(([,result])=>result.result==='passed'&&result.report.checks.some(check=>check.id===checkId&&check.result==='passed'));
    return {...object,coverage:evidence.length?{state:'complete',checkId,evidenceIds:evidence.map(([id])=>id),sourceDigest:delivery.structureCoverage.sourceDigest}:{state:'pending',checkId,reason:'current-object-evidence-missing'}};
  };
  return {...index,objects:index.objects.map(projectObject),runtimeSnapshots:Object.fromEntries(Object.entries(index.runtimeSnapshots || {}).map(([pageId,snapshot])=>[pageId,(()=>{const {documents,...stable}=snapshot;return {...stable,objects:snapshot.objects.map(projectObject),...(snapshot.observations?{observations:Object.fromEntries(Object.entries(snapshot.observations).map(([version,observation])=>[version,{...observation,objects:observation.objects.map(projectObject)}]))}:{})};})()]))};
}
// This projection is committed by the existing signed project round transaction.
// Offsets bind an exact source snapshot; they are never identity across edits.
export function prepareObjectReferences(facts,inventory,files,{randomBytes=crypto.randomBytes}={}) {
  const previous=facts.project.contextLifecycle?.objectReferences;
  const version=projectSemanticRevision(facts,files);
  const references={...(previous?.references || {})},objects=[],pending=[];
  const existing=new Map(Object.entries(references).map(([key,value])=>[fingerprint(value),key]));
  const issue=locator=>{
    const digest=fingerprint(locator);if(existing.has(digest))return existing.get(digest);
    for(let attempt=0;attempt<8;attempt++) {
      const key='F-'+randomBytes(16).toString('base64url');
      if(!SHORT_REFERENCE_PATTERN.test(key))throw new Error('短引用随机源格式无效');
      if(Object.hasOwn(references,key))continue;
      references[key]=locator;existing.set(digest,key);return key;
    }
    throw new Error('短引用连续碰撞；保留原索引，不覆盖记录');
  };
  for(const page of facts.pages.items) {
    const bound=new Set([page.implementationMapping,...(page.sourceStructure?.inputs || []).map(input=>input.path),...facts.components.items.filter(c=>c.usageLocations?.some(u=>u.pageId===page.id)).map(c=>c.implementationMapping)]);
    for(const source of inventory.objects.filter(object=>bound.has(object.file))) {
      const lifetime=(facts.project.contextLifecycle?.identities || []).find(item=>item.state==='active'&&item.incarnation===source.incarnation&&item.objectId===source.persistentId);
      let persistentId=source.persistentId,generation=source.incarnation,mode='source-lifetime';
      if(!lifetime) {
        // Local JSX calls render their already anchored definition's DOM. They
        // are not an extra DOM node and must not create an impossible ID task.
        const imports=inventory.definitionImports?.[source.file] || {},namespace=source.tag.split('.');
        const imported=imports[source.tag] || (namespace.length===2&&imports[namespace[0]]?.name==='*'?{file:imports[namespace[0]].file,name:namespace[1]}:null);
        if(/^[A-Z]/u.test(source.tag)&&inventory.objects.some(node=>node.file===(imported?.file || source.file)&&node.attributes?.['data-foundation-definition']===(imported?.name || source.tag)&&(facts.project.contextLifecycle?.identities || []).some(identity=>identity.state==='active'&&identity.incarnation===node.incarnation)))continue;
        if(!source.file.endsWith('.html')) {pending.push({pageId:page.id,file:source.file,line:source.line,reason:'需要执行当前 inspector-plan 的源码身份适配'});continue;}
        mode='static-snapshot';
        const file=files.find(file=>file.path===source.file);
        const old=previous?.objects?.find(item=>sourceContinuityMatches(item,file)&&item.mode===mode&&item.pageId===page.id&&item.file===source.file&&item.sha256===source.sha256&&item.offset===source.offset&&item.tag===source.tag);
        persistentId=old?.persistentId || 'object-'+crypto.randomUUID();generation=old?.generation || crypto.randomUUID();
      }
      let dynamicInstances=false;
      for(let ancestor=source;ancestor;ancestor=ancestor.parent?inventory.objects.find(item=>item.key===ancestor.parent):null)if(ancestor.attributes?.['data-foundation-instance-key']?.startsWith('{')){dynamicInstances=true;break;}
      const values=(()=>{try{const raw=source.attributes['data-foundation-instance-values'];return JSON.parse(raw?.startsWith('{')?JSON.parse(raw.slice(1,-1)):raw);}catch{return null;}})();
      const definition=source.attributes['data-foundation-definition'];
      const calls=definition?inventory.objects.filter(call=>call.tag===definition&&call.attributes.foundationInstanceKey&&!call.attributes.foundationInstanceKey.startsWith('{')).map(call=>call.attributes.foundationInstanceKey):[];
      const instances=Array.isArray(values)?values:calls.length?[...new Set(calls)]:[source.instanceKey || null];
      for(const instanceKey of instances) {
        const locator={schemaVersion:'foundation-object/1',projectId:facts.foundation.projectId,pageId:page.id,kind:'persistent',persistentId,generation,instanceKey,contentVersion:version};
        const reference=issue(locator);
        objects.push({dynamicInstances,line:source.line,text:source.ownText || null,sourceIdentityPhysical:files.find(file=>file.path===source.file)?.identityPhysical || null,sourcePhysical:files.find(file=>file.path===source.file)?.physical || null,pageId:page.id,file:source.file,sha256:source.sha256,offset:source.offset,tag:source.tag,persistentId,generation,instanceKey,reference,mode});
        if(mode==='source-lifetime')try {
          const raw=source.attributes['data-foundation-render-map'],maps=JSON.parse(raw?.startsWith('{')?JSON.parse(raw.slice(1,-1)):raw);
          for(const map of maps)for(const [tag,attrs] of map.nodes || []) {
            const partId=persistentId+'#'+map.name+':'+attrs.key;
            objects.push({dynamicInstances,line:source.line,sourceIdentityPhysical:files.find(file=>file.path===source.file)?.identityPhysical || null,sourcePhysical:files.find(file=>file.path===source.file)?.physical || null,pageId:page.id,file:source.file,sha256:source.sha256,offset:source.offset,tag,persistentId:partId,generation,instanceKey,reference:issue({...locator,persistentId:partId}),mode});
          }
        }catch{}

      }
    }
  }
  const active=new Set(objects.map(item=>item.generation));
  const tombstones=[...new Map([...(previous?.tombstones || []),...(previous?.objects || []).filter(item=>!active.has(item.generation)).map(({persistentId,generation,pageId})=>({persistentId,generation,pageId,reason:'source-continuity-not-proven'}))].map(item=>[item.generation,item])).values()];
  return {schemaVersion:'foundation-object-references/1',contentVersion:version,objects,references,tombstones,pending,runtimeSnapshots:previous?.contentVersion===version?previous.runtimeSnapshots || {}:{}};
}

export function instrumentStaticObjects(text,pageId,index) {
  const digest=sha256(text),objects=(index?.objects || []).filter(item=>item.pageId===pageId&&item.mode==='static-snapshot'&&item.sha256===digest);
  for(const object of [...objects].sort((a,b)=>b.offset-a.offset)) {
    const opening=text.slice(object.offset).match(/^<[a-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/iu)?.[0];
    if(!opening||!opening.startsWith('<'+object.tag))throw new Error('预览对象映射与源码字节不一致');
    const clean=opening.replace(/\s+data-foundation-(?:object-id|incarnation|reference)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gu,'');
    const inserted=clean.slice(0,object.tag.length+1)+` data-foundation-object-id="${object.persistentId}" data-foundation-incarnation="${object.generation}" data-foundation-reference="${object.reference}"`+clean.slice(object.tag.length+1);
    text=text.slice(0,object.offset)+inserted+text.slice(object.offset+opening.length);
  }
  return text;
}
