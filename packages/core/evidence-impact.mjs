import fs from 'node:fs';
import {readFacts} from './facts.mjs';
import path from 'node:path';
import os from 'node:os';
import {sha256,canonicalStringify} from './install-contract.mjs';
import {resolveProjectFile} from './path-boundary.mjs';
import {verifyTrustedPayload} from './trusted-authority.mjs';
import {inspectSourceInputIdentity,analyzerVersion} from './source-analysis.mjs';

export function verifySourceObservation({project,observation,current=false}) {
  const {observationReceipt,...result}=observation || {};
  const {integrity,...receipt}=observationReceipt || {};
  if(!integrity||receipt.purpose!=='foundation-source-observation'||receipt.project!==fs.realpathSync(project)||receipt.analyzerVersion!==analyzerVersion||receipt.resultDigest!==sha256(canonicalStringify(result))||!verifyTrustedPayload(receipt,integrity))throw new Error('源码观察缺少受控分析收据或内容已改变');
  const stat=fs.statSync(project);if(receipt.physicalIdentity?.device!==String(stat.dev)||receipt.physicalIdentity?.inode!==String(stat.ino))throw new Error('源码观察的项目物理身份已变化');
  if(current && inspectSourceInputIdentity({project,entryRoots:receipt.entryRoots}).inputDigest!==receipt.inputDigest)throw new Error('源码观察后的实际输入已改变');
  return result;
}

export function evidenceInputFingerprint(inputs) {
  return sha256(canonicalStringify(inputs));
}
export function evidenceSubjectFingerprint(asset) {
  return sha256(canonicalStringify({assetModel:asset?.assetModel || null,composes:asset?.composes || [],usageLocations:asset?.usageLocations || []}));
}

// Typed dependency reachability is deliberately separate from product composes.
// An incomplete edge cannot certify independence, even when no changed path was found.
export function inspectEvidenceImpact({evidence,edges=[],changedInputs=[],current={}}) {
  const changed=new Set(changedInputs.map(x=>typeof x==='string'?x:x.path));
  const reached=new Set([evidence.subject?.definitionId,evidence.subject?.scenarioId,evidence.subject?.instanceId].filter(Boolean));
  let growing=true;const used=[];
  while(growing) {growing=false;for(const edge of edges)if(reached.has(edge.from) && !used.includes(edge)){used.push(edge);if(!reached.has(edge.to)){reached.add(edge.to);growing=true;}}}
  const staleFields=['scopeRevision','taskId','artifactDigest','inputFingerprint','runnerVersion','verifierVersion'].filter(key=>current[key]!==undefined && evidence[key]!==current[key]);
  if(current.environment && canonicalStringify(current.environment)!==canonicalStringify(evidence.environment))staleFields.push('environment');
  const affected=[...changed].filter(x=>reached.has(x));
  const reasons=[...staleFields.map(x=>`${x} 已变化`),...affected.map(x=>`输入已变化：${x}`)];
  const unknown=!used.length || used.some(e=>e.coverage!=='complete') || current.coverage==='partial';
  return {state:reasons.length?'stale':unknown?'unknown':'fresh',dimensions:evidence.dimensions || [],reasons:reasons.length?reasons:unknown?['依赖覆盖不完整，无法证明当前证据独立且新鲜']:[],inputs:[...reached].sort()};
}

export function inspectEvidenceReport({project,installationRoot,evidence,expectedInputs,expectedScopeDigest,expectedSubjectDigest,expectedSourceDigest,expectedArtifactDigest,expectedEnvironment,expectedVerifierVersion,expectedRunnerVersion}) {
  try {
    const file=resolveProjectFile(project,evidence.report.path,'验证报告');
    const bytes=fs.readFileSync(file);
    if(sha256(bytes)!==evidence.report.sha256)throw new Error('报告字节摘要不匹配');
    const report=JSON.parse(bytes);
    if(expectedScopeDigest && report.scopeDigest!==expectedScopeDigest)return {state:'stale',reason:'任务范围的实际内容已变化'};
    if(expectedSubjectDigest && report.subjectDigest!==expectedSubjectDigest)return {state:'stale',reason:'定义、组成或使用位置已变化'};
    if(expectedSourceDigest && report.sourceDigest!==expectedSourceDigest)return {state:'stale',reason:'项目源码或样式已变化，保守重验当前运行场景'};
    for(const key of ['taskId','scopeRevision','inputFingerprint','artifactDigest','runnerVersion','verifierVersion','kind','result'])if(report[key]!==evidence[key])throw new Error(`报告 ${key} 不匹配`);
    if(canonicalStringify(report.dimensions)!==canonicalStringify(evidence.dimensions)||canonicalStringify(report.checkIds)!==canonicalStringify(evidence.checkIds))throw new Error('报告检查与证据维度不匹配');
    if(canonicalStringify(report.subject)!==canonicalStringify(evidence.subject) || canonicalStringify(report.environment)!==canonicalStringify(evidence.environment))throw new Error('报告对象或运行环境不匹配');
    const selected=evidence.checkIds.map(id=>report.checks?.find(check=>check.id===id));
    if(!selected.length||selected.some(check=>!check||!['passed','failed','pending','blocked'].includes(check.result)))throw new Error('报告缺实际检查结果');
    const aggregate=selected.some(check=>check.result==='failed')?'failed':selected.some(check=>check.result==='blocked')?'blocked':selected.some(check=>check.result==='pending')?'pending':'passed';
    if(aggregate!==evidence.result)throw new Error('报告检查聚合结果不匹配');
    if(expectedInputs && evidenceInputFingerprint(expectedInputs)!==evidence.inputFingerprint)return {state:'stale',reason:'当前精确输入已变化'};
    for(const [key,value] of Object.entries({artifactDigest:expectedArtifactDigest,environment:expectedEnvironment,verifierVersion:expectedVerifierVersion,runnerVersion:expectedRunnerVersion}))if(value!==undefined && canonicalStringify(evidence[key])!==canonicalStringify(value))return {state:'stale',reason:`当前 ${key} 已变化`};
    const {integrity,...receipt}=report.foundationReceipt || {};
    if(!integrity)return {state:'external-unverified',reason:'导入报告未由 Foundation 受控执行路径独立核验'};
    const {foundationReceipt,...reportContent}=report;
    if(!verifyTrustedPayload(receipt,integrity) || receipt.purpose!=='foundation-evidence-run' || receipt.project!==fs.realpathSync(project) || receipt.reportDigest!==sha256(canonicalStringify(reportContent)))throw new Error('运行收据不可信或未绑定当前报告');
    if(evidence.kind==='human-acceptance')return {state:'external-unverified',reason:'工程执行收据不证明真人接受'};
    if(evidence.kind==='browser-observation') {
      if(!installationRoot)return {state:'unknown',reason:'缺当前安装上下文，无法核验浏览器构建代际'};
      if(report.currentFileSha256!==sha256(fs.readFileSync(path.join(installationRoot,'state/current.json')))||report.previewConfigSha256!==sha256(fs.readFileSync(resolveProjectFile(project,'.foundation/preview.json','预览配置'))))return {state:'stale',reason:'安装或预览配置已变化'};
      for(const input of report.artifactFiles || [])if(sha256(fs.readFileSync(resolveProjectFile(project,input.path,'构建证据输入')))!==input.sha256)return {state:'stale',reason:'构建资源已变化'};
      if(!report.artifactFiles?.length||evidence.runnerVersion!=='foundation-cdp/1.0.0'||evidence.verifierVersion!=='foundation-browser-checks/1.0.0')return {state:'unknown',reason:'构建输入或验证器缺失'};
      if(report.environment.browserExecutable?.sha256!==sha256(fs.readFileSync(report.environment.browserExecutable?.path)))return {state:'stale',reason:'浏览器执行文件已变化'};
      if(report.environment.platform!==process.platform||report.environment.architecture!==process.arch||report.environment.osRelease!==os.release())return {state:'stale',reason:'运行环境已变化'};
    }
    if(evidence.kind==='semantic-review') {
      if(evidence.runnerVersion!=='foundation-semantic-review/1.0.0'||evidence.verifierVersion!=='foundation-semantic-contract/1.0.0'||canonicalStringify(evidence.dimensions)!==canonicalStringify(['scope','content']))return {state:'unknown',reason:'语义核验合同或版本不受支持'};
      if(!report.semanticInputs?.sources?.length||!report.semanticInputs?.evidence?.length)return {state:'invalid',reason:'语义收据缺需求与实现引用'};
      const currentFacts=readFacts(project);
      const reviewedFacts=(report.semanticInputs.factIds || []).map(id=>Object.values(currentFacts).flatMap(doc=>doc?.items || []).find(item=>item.id===id)).filter(Boolean);
      if(!report.semanticInputs.factIds?.length||sha256(canonicalStringify(reviewedFacts))!==report.semanticInputs.factsDigest)return {state:'stale',reason:'审阅涉及的产品事实已变化'};
      for(const source of report.semanticInputs.sources)if(sha256(fs.readFileSync(resolveProjectFile(project,source.path,'语义需求来源')))!==source.sha256)return {state:'stale',reason:'语义需求原文已改变'};
      for(const dependency of report.semanticInputs.evidence) {
        if(!['source-analysis','browser-observation'].includes(dependency.kind))return {state:'invalid',reason:'语义核验不能循环引用审阅报告'};
        const checked=inspectEvidenceReport({project,installationRoot,evidence:dependency,expectedScopeDigest,expectedSubjectDigest,expectedSourceDigest:dependency.kind==='browser-observation'?expectedSourceDigest:undefined,expectedInputs});
        if(checked.state!=='verified'||checked.result!=='passed')return {state:checked.state==='invalid'?'invalid':'stale',reason:'语义核验依赖的实际证据已失效'};
        if(dependency.kind==='source-analysis'&&inspectSourceInputIdentity({project,entryRoots:checked.report.analysis.entryRoots}).inputDigest!==dependency.artifactDigest)return {state:'stale',reason:'语义核验依赖的静态输入已变化'};
      }
    }
    return {state:'verified',result:evidence.result,report};
  }catch(error){return {state:'invalid',reason:`证据校验失败：${error.message}`};}
}
