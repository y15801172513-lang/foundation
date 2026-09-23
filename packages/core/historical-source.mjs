import {assertProjectFileAbsent} from './path-boundary.mjs';
// Disposition preserves the original source identity. It is not evidence that
// the old implementation is current or that a replacement has passed delivery.
export function historicalSourceCurrent(record,sources) {
 const value=record.sourceDisposition,current=new Map(sources.map(source=>[source.path,source.sha256]));
 const exact=input=>typeof input?.path==='string'&&/^[a-f0-9]{64}$/u.test(input.sha256||'')&&current.has(input.path)&&current.get(input.path)===input.sha256;
 return Boolean(value?.state==='superseded'&&record.source==='source-discovery'&&record.id?.startsWith('sync_candidate_')&&value.path===record.implementationMapping&&/^[a-f0-9]{64}$/u.test(value.beforeSha256||'')&&value.beforeSha256===record.implementationSha256&&!current.has(value.path)&&typeof value.reason==='string'&&value.reason.trim()&&exact(value.source)&&Array.isArray(value.replacements)&&value.replacements.length>0&&value.replacements.every(exact));
}
export function validateHistoricalSourceDisposition({project,record,previous,facts,sources}) {
 if(!previous||previous.source!=='source-discovery'||previous.implementationMapping!==record.implementationMapping||previous.implementationSha256!==record.implementationSha256||record.deliveryScope||record.evidenceIndex?.length||record.verificationStatus!=='unverified'||!historicalSourceCurrent(record,sources))throw new Error('历史候选处置需保留原来源与摘要、明确当前替代输入和处置依据，不得伪造可用资产');
 assertProjectFileAbsent(project,record.implementationMapping);
 const pending=facts.project.contextLifecycle?.pendingChanges?.find(change=>change.path===record.implementationMapping);
 const hashes=[pending?.before?.sha256,...(pending?.history||[]).flatMap(event=>[event.before,event.after])];
 if(!hashes.includes(record.implementationSha256)&&previous.sourceDisposition?.beforeSha256!==record.implementationSha256)throw new Error('历史候选缺少可核验的原始观察摘要');
 return true;
}
