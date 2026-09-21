import {sha256,canonicalStringify} from './install-contract.mjs';
export function businessFact(record) {
  const {updatedAt,implementationSha256,sourceStructure,synchronization,evidenceIndex,verificationEvidence,verificationStatus,contextLifecycle,...content}=record;
  if(content.previewBinding){const {inputs,...binding}=content.previewBinding;content.previewBinding=binding;}
  if(content.assetModel){const {implementationInputs,...model}=content.assetModel;content.assetModel=model;}
  if(sourceStructure?.semantics&&sourceStructure.semantics.producer!=='foundation-source-semantics/1')content.semantics={nodes:sourceStructure.semantics.nodes?.map(({sourceKeys,sources,...node})=>node),relations:sourceStructure.semantics.relations?.map(({sourceKeys,sources,...edge})=>edge)};
  return content;
}
export function projectSemanticRevision(facts,sourceInputs=[]) {
  const known=new Set(Object.values(facts).flatMap(doc=>(doc?.items || []).flatMap(item=>[item.implementationMapping,...(item.assetModel?.implementationInputs || []).map(edge=>edge.to),...(item.previewBinding?.inputs || []).map(input=>input.path)])));
  const content=Object.fromEntries(Object.entries(facts).filter(([kind])=>!['changes','foundation','delivery','synchronization'].includes(kind)).filter(([,doc])=>Array.isArray(doc?.items)).map(([kind,doc])=>[kind,doc.items.map(businessFact)]));
  return sha256(canonicalStringify({content,sources:sourceInputs.filter(input=>input.kind!=='document'&&known.has(input.path)).map(({path,semanticSha256})=>({path,semanticSha256}))}));
}
