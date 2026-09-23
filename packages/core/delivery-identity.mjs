import fs from 'node:fs';
import {readFacts} from './facts.mjs';
import {realProject, resolveProjectFile} from './path-boundary.mjs';
import {canonicalStringify, sha256} from './install-contract.mjs';

// Readback identity binds a delivery to its actual project, not its display name.
export function projectDeliveryIdentity({project,current,facts=readFacts(project)}) {
  const root=fs.realpathSync(realProject(project));
  if(!current?.candidateHash || !current?.version)throw new Error('交付读回缺少当前候选身份');
  const evidence=facts.changes.items.flatMap(change=>(change.evidenceIndex || []).map(entry=>{
    let actualSha256=null;
    try {actualSha256=sha256(fs.readFileSync(resolveProjectFile(root,entry.report.path,'验证报告')));}catch{}
    return {taskId:change.id,evidenceId:entry.evidenceId,report:entry.report,actualSha256};
  }));
  return {schemaVersion:'foundation-delivery-identity/1',projectId:facts.foundation.projectId,root,
    version:current.version,candidateHash:current.candidateHash,
    factsRevision:sha256(canonicalStringify(facts)),evidenceRevision:sha256(canonicalStringify(evidence)),
    counts:Object.fromEntries(['pages','components','motions','design-tokens'].map(kind=>[kind,facts[kind].items.length])),evidenceCount:evidence.length};
}

export function assertDeliveryIdentity(expected,actual) {
  for(const key of ['schemaVersion','projectId','root','version','candidateHash','factsRevision','evidenceRevision'])
    if(!expected?.[key] || expected[key]!==actual?.[key])throw new Error(`交付读回不一致：${key}`);
  if(canonicalStringify(expected.counts)!==canonicalStringify(actual.counts)||expected.evidenceCount!==actual.evidenceCount)throw new Error('交付读回不一致：资产或证据数量');
  return true;
}
