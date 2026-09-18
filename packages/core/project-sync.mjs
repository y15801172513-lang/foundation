import {inspectSyncSources} from './source-inventory.mjs';
export {inspectSyncSources} from './source-inventory.mjs';
import crypto from 'node:crypto';
import {signTrustedPayload,verifyTrustedPayload} from './trusted-authority.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {sha256, canonicalStringify, LifecycleError} from './install-contract.mjs';
import {analyzeSources,inspectSourceInputIdentity} from './source-analysis.mjs';
import {realProject} from './path-boundary.mjs';
import {readFacts, inspectProjectPreparation} from './facts.mjs';
import {inspectProjectAuthority, createProjectMutationPlan, applyProjectMutationPlan, inspectProjectMutationRecovery, createProjectMutationRecoveryPlan, applyProjectMutationRecoveryPlan} from './project-authority.mjs';
import {PROJECT_RULE_GUIDE} from './project-rules.mjs';
import {readCurrentFoundationRules} from './rules-delivery.mjs';
import {inspectProjectDeliveryFiles} from './project-delivery.mjs';
import {resolveAssetBinding} from './asset-model.mjs';
import {resolveProjectFile} from './path-boundary.mjs';
import {evidenceInputFingerprint,evidenceSubjectFingerprint} from './evidence-impact.mjs';

// Only built-in checks can obtain an execution receipt. Callers supply targets,
// never callbacks, executable commands, claimed results or verifier identities.
export async function verifyProjectDefinition({project,installationRoot,entryRoots,taskId,assetId,requirementId}) {
  const observation=await analyzeProjectSources({project,installationRoot,entryRoots});
  const facts=readFacts(project),task=facts.changes.items.find(item=>item.id===taskId);
  const scope=task?.deliveryScope,requirement=scope?.items?.find(item=>item.requirementId===requirementId);
  const asset=facts.components.items.find(item=>item.id===assetId);
  if(scope?.schemaVersion!=='2.0.0'||!requirement?.factIds?.includes(assetId)||!asset?.assetModel)throw new Error('验证目标必须属于当前任务范围且具有定义绑定');
  const inputs=(asset.assetModel.implementationInputs || []).map(edge=>({kind:edge.kind,path:edge.to,sha256:sha256(fs.readFileSync(resolveProjectFile(project,edge.to,'验证输入')))}));
  const binding=resolveAssetBinding(facts,observation).find(item=>item.assetId===assetId);
  const complete=binding?.definition?.coverage?.state==='proven-static'&&inputs.length>0&&(asset.assetModel.implementationInputs || []).every(edge=>edge.coverage==='complete');
  const result=binding?.state!=='bound'?'failed':complete?'passed':'pending';
  const report={kind:'source-analysis',taskId,scopeRevision:scope.revision,scopeDigest:sha256(canonicalStringify(scope)),subjectDigest:evidenceSubjectFingerprint(asset),subject:{requirementId,definitionId:assetId},inputFingerprint:evidenceInputFingerprint(inputs),artifactDigest:observation.inputDigest,environment:{platform:process.platform,architecture:process.arch,node:process.versions.node},runnerVersion:observation.analyzerVersion,verifierVersion:'foundation-definition/1.1.0',checkIds:['definition-binding'],dimensions:['definition'],result,checks:[{id:'definition-binding',result,bindingState:binding?.state || 'unresolved'}],limitations:['只证明受控静态定义绑定，不证明语义、运行、布局或真人接受'],analysis:{inputDigest:observation.inputDigest,entryRoots,coverage:observation.coverage,subjectCoverage:binding?.definition?.coverage || null}};
  const current=inspectProjectAuthority(project,{installationRoot});
  if(!current.agreement||current.state!=='enabled'||inspectSourceInputIdentity({project,entryRoots}).inputDigest!==observation.inputDigest||readFacts(project).changes.items.find(item=>item.id===taskId)?.deliveryScope?.revision!==scope.revision)throw new Error('验证收据签发前目标已改变');
  const receipt={purpose:'foundation-evidence-run',project:realProject(project),reportDigest:sha256(canonicalStringify(report))};
  const signed={...report,foundationReceipt:{...receipt,integrity:signTrustedPayload(receipt)}};
  const reportText=JSON.stringify(signed,null,2)+'\n';
  return {report:signed,reportText,reportSha256:sha256(reportText),mutationPerformed:false};
}

// Explicit task-bound analysis only. GET projections never call this path.
// The bounded installation-owned cache stores observations, never product Facts.
export async function analyzeProjectSources({project,installationRoot,entryRoots,signal}) {
  const authority=inspectProjectAuthority(project,{installationRoot});
  const rules=readCurrentFoundationRules({project,installationRoot});
  if(authority.state!=='enabled'||!authority.agreement||!rules.currentIdentityHash)throw new LifecycleError('PROJECT_ANALYSIS_AUTHORITY_REQUIRED','源码分析需要当前安装与项目身份');
  const root=fs.realpathSync(installationRoot),exact=realProject(project);
  const directory=path.join(root,'state','analysis-cache',authority.projectId);
  let cursor=root;
  for(const part of path.relative(root,directory).split(path.sep)){cursor=path.join(cursor,part);if(fs.existsSync(cursor)&&(fs.lstatSync(cursor).isSymbolicLink()||fs.realpathSync(cursor)!==cursor))throw new Error('分析缓存路径不安全');}
  const file=path.join(directory,'index.json');
  let previous=null;
  if(fs.existsSync(file)) {
    if(fs.lstatSync(file).isSymbolicLink())throw new Error('分析缓存不能是符号链接');
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    const {integrity,...receipt}=saved.observationReceipt || {};
    const {observationReceipt,...result}=saved;
    if(!verifyTrustedPayload(receipt,integrity)||receipt.project!==exact||receipt.resultDigest!==sha256(canonicalStringify(result)))throw new Error('分析缓存被改写；保留待核');
    previous=result;
  }
  const identity=inspectSourceInputIdentity({project:exact,entryRoots});
  const result=previous?.inputDigest===identity.inputDigest?{...previous,metrics:{...previous.metrics,persistentCacheHit:true}}:await analyzeSources({project:exact,entryRoots,previousIndex:previous,signal});
  if(signal?.aborted||!result.inputDigest)return result;
  const current=inspectProjectAuthority(exact,{installationRoot:root});
  if(current.projectId!==authority.projectId||current.state!=='enabled'||!current.agreement||current.continuousSync?.revision!==authority.continuousSync?.revision||inspectSourceInputIdentity({project:exact,entryRoots}).inputDigest!==result.inputDigest)throw new Error('分析完成前项目、授权或输入发生变化；未保存缓存');
  const receipt={purpose:'foundation-source-observation',project:exact,physicalIdentity:{device:String(fs.statSync(exact).dev),inode:String(fs.statSync(exact).ino)},projectId:authority.projectId,entryRoots,analyzerVersion:result.analyzerVersion,inputDigest:result.inputDigest,resultDigest:sha256(canonicalStringify(result))};
  const output={...result,observationReceipt:{...receipt,integrity:signTrustedPayload(receipt)}};
  const bytes=JSON.stringify(output);
  if(Buffer.byteLength(bytes)>16*1024*1024)return {...result,cacheState:'capacity-exceeded'};
  fs.mkdirSync(directory,{recursive:true});
  const temporary=path.join(directory,`${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});fs.renameSync(temporary,file);
  return output;
}

function attemptDirectory(installationRoot, projectId) {
  if (!/^[a-zA-Z0-9_-]+$/u.test(projectId || '')) throw new Error('同步项目标识无效');
  const directory = path.join(installationRoot,'state','project-sync-attempts',projectId);
  let ancestor = directory;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (fs.realpathSync(ancestor) !== ancestor || fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('同步日志路径不安全');
  return directory;
}
function latestAttempt(installationRoot, projectId) {
  const directory = attemptDirectory(installationRoot,projectId);
  if (!fs.existsSync(directory)) return null;
  const names = fs.readdirSync(directory).filter(name=>name.endsWith('.json')).sort().reverse();
  if (!names.length) return null;
  const file=path.join(directory,names[0]);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('同步日志不能是符号链接');
  const {integrity,...record} = JSON.parse(fs.readFileSync(file,'utf8'));
  if (!verifyTrustedPayload(record,integrity) || record.projectId !== projectId) throw new Error('同步日志完整性无效');
  return record;
}
function recordAttempt(installationRoot, record) {
  const authority = inspectProjectAuthority(record.project,{installationRoot});
  if (authority.projectId !== record.projectId || authority.continuousSync?.revision !== record.revision || authority.continuousSync?.state !== 'active') throw new LifecycleError('PROJECT_SYNC_AUTHORITY_REQUIRED','写同步日志前授权失效；保留此前待处理记录');
  const directory=attemptDirectory(installationRoot,record.projectId);
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,record.attemptId+'.json'),temporary=file+'.tmp';
  const descriptor=fs.openSync(temporary,'wx',0o600);
  try {fs.writeFileSync(descriptor,JSON.stringify({...record,integrity:signTrustedPayload(record)},null,2)+'\n');fs.fsyncSync(descriptor);} finally {fs.closeSync(descriptor);}
  fs.renameSync(temporary,file);
}


export function inspectProjectSync({project, installationRoot}) {
  const authority = inspectProjectAuthority(project, {installationRoot});
  const authorization = authority.state === 'disabled' ? 'revoked' : authority.continuousSync?.state || 'not-granted';
  const preparation = inspectProjectPreparation(project);
  if (!preparation.factsReady) return {authorization, state:'pending', preparation, pending:preparation.errors, mutationPerformed:false};
  const facts = readFacts(project), sources = inspectSyncSources(project);
  const records = Object.values(facts).flatMap(document => document?.items || []);
  const pending = sources.filter(source => !records.some(item => item.implementationMapping === source.path && item.implementationSha256 === source.sha256));
  const delivery = inspectProjectDeliveryFiles({project,installationRoot});
  const last = authority.projectId ? latestAttempt(installationRoot,authority.projectId) : null;
  return {authorization, revision:authority.continuousSync?.revision || null, lastAttempt: last ? {attemptId:last.attemptId,state:last.state,error:last.error || null} : null, state: last && ['failed','conflict','executing'].includes(last.state) ? (last.state === 'executing' ? 'pending' : last.state) : last?.unresolvedAttempts?.length || pending.length || delivery.state !== 'consistent' ? 'pending' : 'latest', syncState: pending.length || delivery.state !== 'consistent' ? 'pending' : 'latest', acceptanceState:delivery.assessment?.aggregate || 'pending', pending, unresolvedAttempts:last?.unresolvedAttempts || [], delivery, mutationPerformed:false};
}

export function continueProjectPreparation({project, installationRoot}) {
  const steps = [];
  try {
    const authority = inspectProjectAuthority(project, {installationRoot}), grant = authority.continuousSync;
    if (grant?.state !== 'active') return {ok:false, state:'authorization-required', steps};
    const preparation = inspectProjectPreparation(project);
    if (preparation.state === 'blocked') throw new Error(preparation.errors.join('；'));
    if (!preparation.factsReady || grant.includePreview && preparation.preview.state === 'absent') {
      const plan = createProjectMutationPlan({operation:'foundation-skeleton-and-facts-create', project, installationRoot, handlerPayload:{includePreview:grant.includePreview, generatedAt:new Date().toISOString()}});
      const result = applyProjectMutationPlan({plan});
      steps.push({step:'preparation',state:'completed',planId:plan.planId,result});
    } else steps.push({step:'preparation',state:'verified-skipped'});
    const rules = readCurrentFoundationRules({project, installationRoot});
    if (!rules.adoption || rules.adoption.guideSha256 !== sha256(PROJECT_RULE_GUIDE)) {
      const plan = createProjectMutationPlan({operation:'project-rules-adopt',project,installationRoot,handlerPayload:{installationRoot,technology:grant.technology,generatedAt:new Date().toISOString()}});
      const result = applyProjectMutationPlan({plan});
      steps.push({step:'adoption',state:'completed',planId:plan.planId,result});
    } else steps.push({step:'adoption',state:'verified-skipped'});
    const current = readCurrentFoundationRules({project,installationRoot});
    return {ok:current.projectRulesReady,state:current.projectRulesReady ? 'ready' : 'pending',summary:current.projectRulesReady ? '可以开始制作；业务内容和预览另行验证' : '准备待核',steps};
  } catch (error) { return {ok:false,state:'failed',steps,error:{code:error.code || 'PROJECT_PREPARATION_FAILED',message:error.message},preserved:'前序已完成步骤与源码；下一次触发重读后接续'}; }
}

export function synchronizeProject({project, installationRoot, handlerPayload = null, trigger = 'task', now = Date.now()} = {}) {
  const authority = inspectProjectAuthority(project,{installationRoot});
  if (authority.state === 'enabled' && authority.continuousSync?.state === 'active') {
    const recovery = inspectProjectMutationRecovery(project);
    if (recovery.status === 'recovery-required') {
      try { applyProjectMutationRecoveryPlan({plan:createProjectMutationRecoveryPlan({project}),continuous:true}); }
      catch(error) { return {authorization:'active',state:'conflict',error:{code:error.code,message:error.message},mutationPerformed:false}; }
    } else if (recovery.status !== 'clean') return {authorization:'active',state:recovery.status === 'live-operation' ? 'in-progress' : 'conflict',recovery,mutationPerformed:false};
  }
  const previousAttempt = authority.projectId ? latestAttempt(installationRoot,authority.projectId) : null;
  // Only an interrupted exact plan may be replayed. Failed payloads are evidence, not fresh inputs.
  let unresolvedAttempts = previousAttempt?.unresolvedAttempts || [];
  let interruptedCompleted = false;
  if (previousAttempt?.state === 'executing' && previousAttempt.plan && previousAttempt.revision === authority.continuousSync?.revision && authority.continuousSync?.state === 'active') {
    try {
      const result = applyProjectMutationPlan({plan:previousAttempt.plan});
      recordAttempt(installationRoot,{...previousAttempt,state:'completed',completedAt:Date.now(),result});
      interruptedCompleted = true;
    } catch { /* Re-read and build a fresh exact plan below; never consume old human evidence. */ }
  }
  if (previousAttempt && !interruptedCompleted && ['failed','conflict','executing'].includes(previousAttempt.state)) {
    unresolvedAttempts = [...new Map([...unresolvedAttempts, {attemptId:previousAttempt.attemptId, state:'pending', scope:previousAttempt.payload?.scope, reason:'旧批次未完成；保留原始输入与语义供复核，不自动合并', error:previousAttempt.error || null}].map(item=>[item.attemptId,item])).values()];
  }
  const initial = inspectProjectSync({project,installationRoot});
  if (initial.authorization !== 'active') return {...initial, state:'stopped', summary:'持续同步未授予或已撤销；打开不恢复', mutationPerformed:false};
  const prepared = handlerPayload && fs.existsSync(path.join(project,'.foundation/identity/rules-adoption.json')) ? {ok:true,steps:[],state:'verified-existing-adoption'} : continueProjectPreparation({project,installationRoot});
  if (!prepared.ok) return {authorization:'active',state:'failed',prepared,mutationPerformed:prepared.steps.some(step => step.state === 'completed')};
  let attempt = null;
  try {
    let payload = handlerPayload;
    if (!payload) {
      const facts = readFacts(project), sources = inspectSyncSources(project);
      const documents = [], generatedAt = new Date(now).toISOString();
      for (const kind of ['pages','components','interactions','motions','changes','design-tokens','relations']) {
        const upserts = [];
        for (const item of facts[kind].items) {
          const source = sources.find(source => source.path === item.implementationMapping);
          if (source && source.sha256 !== item.implementationSha256) upserts.push({...item,verificationStatus:'unverified',synchronization:{state:'pending',reason:'外部源码变化，语义与运行待核',trigger}});
        }
        if (kind === 'changes') for (const source of sources) {
          const mapped = Object.values(facts).some(document => document?.items?.some(item => item.implementationMapping === source.path));
          if (!mapped) upserts.push({id:`sync_candidate_${sha256(source.path).slice(0,20)}`,name:source.path,status:'draft',source:'source-discovery',verificationStatus:'unverified',implementationMapping:source.path,updatedAt:generatedAt,synchronization:{state:'pending',reason:'发现未登记源码；业务用途与任务范围待核',trigger}});
        }
        if (upserts.length) documents.push({kind,expectedSha256:sha256(fs.readFileSync(path.join(project,`.foundation/facts/${kind}.json`))),upserts});
      }
      if (!documents.length) {
        if (previousAttempt && !interruptedCompleted && ['failed','conflict','executing'].includes(previousAttempt.state)) recordAttempt(installationRoot,{attemptId:`${Date.now()}-${crypto.randomUUID()}`,projectId:authority.projectId,project,revision:authority.continuousSync.revision,trigger,state:'completed',unresolvedAttempts,discovery:'current-inputs-no-change',completedAt:Date.now()});
        return {...inspectProjectSync({project,installationRoot}),prepared,mutationPerformed:false};
      }
      payload = {documents,sources,scope:'自动发现并登记源码变化；未知内容保留待核，不声明运行通过',generatedAt};
    }
    attempt = {attemptId:`${Date.now()}-${crypto.randomUUID()}`,projectId:authority.projectId,project,revision:authority.continuousSync.revision,unresolvedAttempts,payload,trigger,state:'executing',createdAt:Date.now()};
    recordAttempt(installationRoot,attempt);
    const plan = createProjectMutationPlan({operation:'asset-facts-batch',project,installationRoot,handlerPayload:payload,now});
    if (!plan.continuousSyncRevision) throw new LifecycleError('PROJECT_SYNC_AUTHORITY_REQUIRED','提交前持续授权失效');
    attempt = {...attempt,plan};
    recordAttempt(installationRoot,attempt);
    const result = applyProjectMutationPlan({plan,now});
    recordAttempt(installationRoot,{...attempt,state:'completed',planId:plan.planId,planHash:plan.integrity.hash,completedAt:Date.now()});
    return {...inspectProjectSync({project,installationRoot}),planId:plan.planId,planHash:plan.integrity.hash,result,prepared,mutationPerformed:true};
  } catch (error) {
    if (attempt) recordAttempt(installationRoot,{...attempt,state:'failed',error:{code:error.code || 'PROJECT_SYNC_FAILED',message:error.message},failedAt:Date.now()});
    return {authorization:inspectProjectAuthority(project,{installationRoot}).continuousSync?.state || 'not-granted',state:/CHANGED|CONFLICT|LOCK|DRIFT/u.test(error.code || '') ? 'conflict' : 'failed',pending:initial.pending, error:{code:error.code || 'PROJECT_SYNC_FAILED',message:error.message},summary:'源码保留；下次任务或打开时重新核对，不能视为同步最新',mutationPerformed:false};
  }
}

// Semantic judgments remain attributable review, not browser or human acceptance.
// Preparation fixes the questions and the exact material the reviewer must read.
export function prepareProjectSemanticReview({project,installationRoot,taskId,assetId,requirementId}) {
  const authority=inspectProjectAuthority(project,{installationRoot});
  const rules=readCurrentFoundationRules({project,installationRoot});
  if(authority.state!=='enabled'||!authority.agreement||!rules.currentIdentityHash||!rules.factCapabilities?.includes('semantic-review/1'))throw new Error('语义核验需要当前已启用的项目权限与 semantic-review/1 能力');
  const facts=readFacts(project),task=facts.changes.items.find(t=>t.id===taskId),scope=task?.deliveryScope;
  const requirement=scope?.items?.find(item=>item.requirementId===requirementId),asset=facts.components.items.find(a=>a.id===assetId);
  if(scope?.schemaVersion!=='2.0.0'||!requirement?.factIds?.includes(assetId)||!asset?.assetModel)throw new Error('语义核验目标必须属于当前范围');
  const sources=(scope.sourceRefs || []).map(source=>{
    if(source.kind==='unconfirmed-assumption')throw new Error('需求来源未确认，不能准备可信语义核验');
    const match=source.ref.match(/^(.+)#L([1-9][0-9]*)-L([1-9][0-9]*)$/u);
    if(!match)throw new Error('语义需求来源需项目内精确文件及行范围：path#L1-L2');
    const file=resolveProjectFile(project,match[1],'语义需求来源'),bytes=fs.readFileSync(file),lines=bytes.toString('utf8').split('\n');
    const start=Number(match[2]),end=Number(match[3]);if(end<start||end>lines.length)throw new Error('需求来源行范围无效');
    return {...source,path:match[1],startLine:start,endLine:end,sha256:sha256(bytes),excerpt:lines.slice(start-1,end).join('\n')};
  });
  const evidence=(task.evidenceIndex || []).filter(e=>e.subject?.requirementId===requirementId&&['source-analysis','browser-observation'].includes(e.kind));
  if(!evidence.some(e=>e.kind==='source-analysis')||!evidence.some(e=>e.kind==='browser-observation'))throw new Error('语义核验必须引用已持久化的定义与实际运行证据');
  // The same delivery reader checks receipts, inputs, build, environment and versions.
  const delivery=inspectProjectDeliveryFiles({project,installationRoot});
  for(const entry of evidence)if(delivery.evidenceResults?.[entry.evidenceId]?.state!=='verified'||delivery.evidenceResults[entry.evidenceId].result!=='passed')throw new Error('语义核验的实现或运行证据未通过当前输入核验');
  const covered=[...new Set(requirement.factIds)].sort();
  const checks=[
    {id:'requirements-implemented',dimension:'scope',expected:requirement.description,factIds:covered},
    {id:'changes-justified',dimension:'scope',expected:'实际变化逐项有当前需求依据；未增加范围外功能',factIds:[...new Set([...(task.affectedAssets || []),...(task.affectedPages || [])])].sort()},
    {id:'content-depth',dimension:'content',expected:`按 ${scope.depth} 深度交付；静态展示不得声称真实业务成功`,factIds:covered},
    {id:'failure-recovery',dimension:'content',expected:'核对需求要求的失败、空态与恢复；不适用须以需求和运行证据说明',factIds:covered},
    {id:'preserved-content',dimension:'content',expected:'核对局部修改不应改变的既有内容、二级页面与数据',factIds:covered},
  ];
  const scoped=new Set(scope.items.flatMap(item=>item.factIds));
  if(checks.some(check=>!check.factIds.length)||checks[1].factIds.some(id=>!scoped.has(id)))throw new Error('实际变化存在范围外或未说明的对象');
  const inputs=(asset.assetModel.implementationInputs || []).map(edge=>({kind:edge.kind,path:edge.to,sha256:sha256(fs.readFileSync(resolveProjectFile(project,edge.to,'语义实现输入')))}));
  if(!inputs.length)throw new Error('语义核验缺实现输入');
  const plan={schemaVersion:'1.0.0',purpose:'foundation-semantic-review',project:realProject(project),taskId,assetId,requirementId,scopeRevision:scope.revision,scopeDigest:sha256(canonicalStringify(scope)),subjectDigest:evidenceSubjectFingerprint(asset),sourceDigest:sha256(canonicalStringify(inspectSyncSources(project))),currentIdentityHash:rules.currentIdentityHash,authorityRevision:authority.continuousSync?.revision || null,inputs,sources,evidence,checks,implementation:covered.map(id=>Object.values(facts).flatMap(doc=>doc?.items || []).find(item=>item.id===id)).filter(Boolean)};
  // Exclude review evidence from the semantic input so persisting its own receipt
  // cannot invalidate it. Scope and the actual implementation remain bound.
  const planDigest=sha256(canonicalStringify(plan));
  const receipt={purpose:'foundation-semantic-plan',project:plan.project,planDigest};
  return {plan,planDigest,planReceipt:{...receipt,integrity:signTrustedPayload(receipt)},mutationPerformed:false};
}

export async function submitProjectSemanticReview({project,installationRoot,prepared,review}) {
  const {inspectFactContract}=await import('./fact-contracts.mjs');
  const errors=inspectFactContract('semanticReview',review);if(errors.length)throw new Error('语义审阅结构无效：'+errors.map(e=>e.message).join('；'));
  const {integrity,...receipt}=prepared?.planReceipt || {};
  if(receipt.purpose!=='foundation-semantic-plan'||receipt.project!==realProject(project)||receipt.planDigest!==prepared.planDigest||sha256(canonicalStringify(prepared.plan))!==prepared.planDigest||!verifyTrustedPayload(receipt,integrity)||review.planDigest!==prepared.planDigest)throw new Error('语义计划或精确审阅输入无效');
  const fresh=prepareProjectSemanticReview({project,installationRoot,taskId:prepared.plan.taskId,assetId:prepared.plan.assetId,requirementId:prepared.plan.requirementId});
  if(fresh.planDigest!==prepared.planDigest)throw new Error('语义计划已过期，必须重新读取需求和证据');
  const plan=fresh.plan,knownEvidence=new Set(plan.evidence.map(e=>e.evidenceId)),knownSources=new Set(plan.sources.map(s=>s.id));
  if(new Set(review.checks.map(c=>c.id)).size!==plan.checks.length||review.checks.length!==plan.checks.length)throw new Error('语义检查遗漏或重复');
  const checks=plan.checks.map(expected=>{
    const check=review.checks.find(c=>c.id===expected.id);
    if(!check||check.expected!==expected.expected||canonicalStringify([...check.coveredFactIds].sort())!==canonicalStringify(expected.factIds)||check.evidenceIds.some(id=>!knownEvidence.has(id))||check.sourceRefIds.some(id=>!knownSources.has(id)))throw new Error('语义审阅缺准确期望、引用或覆盖');
    if(!check.evidenceIds.some(id=>plan.evidence.find(e=>e.evidenceId===id)?.kind==='browser-observation'))throw new Error('语义检查必须引用实际运行观察');
    return {...check,dimension:expected.dimension,result:check.judgment};
  });
  const result=checks.some(c=>c.result==='failed')?'failed':checks.some(c=>c.result==='pending')?'pending':'passed';
  const report={kind:'semantic-review',taskId:plan.taskId,scopeRevision:plan.scopeRevision,scopeDigest:plan.scopeDigest,subjectDigest:plan.subjectDigest,sourceDigest:plan.sourceDigest,subject:{requirementId:plan.requirementId,definitionId:plan.assetId},inputFingerprint:evidenceInputFingerprint(plan.inputs),artifactDigest:plan.planDigest || fresh.planDigest,environment:{reviewKind:review.reviewer.kind,identityAuthentication:'self-reported-not-authenticated'},runnerVersion:'foundation-semantic-review/1.0.0',verifierVersion:'foundation-semantic-contract/1.0.0',checkIds:checks.map(c=>c.id),dimensions:['scope','content'],result,checks,reviewer:review.reviewer,semanticInputs:{sources:plan.sources,evidence:plan.evidence,currentIdentityHash:plan.currentIdentityHash,factIds:plan.implementation.map(item=>item.id),factsDigest:sha256(canonicalStringify(plan.implementation))},limitations:['语义判断由所列审阅者负责；收据只证明受控路径、引用覆盖和精确输入一致','审阅者名称为自述，不是身份认证；不证明真人接受']};
  const run={purpose:'foundation-evidence-run',project:realProject(project),reportDigest:sha256(canonicalStringify(report))};
  const signed={...report,foundationReceipt:{...run,integrity:signTrustedPayload(run)}},reportText=JSON.stringify(signed,null,2)+'\n';
  return {report:signed,reportText,reportSha256:sha256(reportText),mutationPerformed:false};
}
