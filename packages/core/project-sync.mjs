import {evidenceRetryPredecessors,currentEvidenceEntries} from './evidence-impact.mjs';
import {historicalSourceCurrent} from './historical-source.mjs';
import {discoverStyleAssets} from './style-assets.mjs';
import {planStaticPreview} from './static-preview-plan.mjs';
import {inspectorSyntax} from './inspector-syntax.mjs';
import {verifyWebPreviewBuild} from './web-preview-build.mjs';
import {prepareSourceScene} from './source-scene.mjs';
import {captureProjectRoundInputs,inspectProjectRound,prepareRoundTransition} from './project-context-round.mjs';
import {inspectProjectStructure,inspectStructureCoverage,attachObservedStructure} from './project-coverage.mjs';
import {inspectSyncSources} from './source-inventory.mjs';
export {inspectSyncSources} from './source-inventory.mjs';
import crypto from 'node:crypto';
import {signTrustedPayload,verifyTrustedPayload} from './trusted-authority.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {sha256, canonicalStringify, LifecycleError} from './install-contract.mjs';
import {analyzeSources,analyzeSourcesInWorker,inspectSourceInputIdentity} from './source-analysis.mjs';
import {realProject} from './path-boundary.mjs';
import {readFacts, inspectProjectPreparation} from './facts.mjs';
import {inspectProjectAuthority, createProjectMutationPlan, applyProjectMutationPlan, inspectProjectMutationRecovery, createProjectMutationRecoveryPlan, applyProjectMutationRecoveryPlan} from './project-authority.mjs';
import {PROJECT_RULE_GUIDE} from './project-rules.mjs';
import {readCurrentFoundationRules} from './rules-delivery.mjs';
import {inspectScopedRemovals,inspectProjectDeliveryFiles} from './project-delivery.mjs';
import {resolveAssetBinding} from './asset-model.mjs';
import {resolveProjectFile} from './path-boundary.mjs';
import {browserRequirementDigest,evidenceInputFingerprint,evidenceSubjectFingerprint,factImplementationInputs} from './evidence-impact.mjs';

// Shared dependencies invalidate every registered consumer, while local inputs
// affect only their owner. Unknown/unregistered usage still remains a coverage gap.
export function inspectFactSourceImpact(record,sources) {
  if(historicalSourceCurrent(record,sources))return {state:'unchanged',changed:[],fingerprint:sha256('historical-source-disposition')};
  const current=new Map(sources.map(source=>[source.path,source.sha256]));
  const edges=[{to:record.implementationMapping,sha256:record.implementationSha256},...factImplementationInputs(record)].filter(edge=>edge.to);
  const changed=[...new Map(edges.filter(edge=>(current.get(edge.to) || null)!==(edge.sha256 || null)).map(edge=>[edge.to,{path:edge.to,previous:edge.sha256 || null,current:current.get(edge.to) || null}])).values()].sort((a,b)=>a.path.localeCompare(b.path));
  return {state:changed.length?'pending':'unchanged',changed,fingerprint:sha256(canonicalStringify(changed))};
}

// Only built-in checks can obtain an execution receipt. Callers supply targets,
// never callbacks, executable commands, claimed results or verifier identities.
export async function verifyProjectDefinition({project,installationRoot,entryRoots,taskId,assetId,requirementId}) {
  const observation=await analyzeProjectSources({project,installationRoot,entryRoots});
  const facts=readFacts(project),task=facts.changes.items.find(item=>item.id===taskId);
  const scope=task?.deliveryScope,requirement=scope?.items?.find(item=>item.requirementId===requirementId);
  const asset=[...facts.components.items,...facts.pages.items].find(item=>item.id===assetId);
  if(scope?.schemaVersion!=='2.0.0'||!requirement?.factIds?.includes(assetId)||(!asset?.assetModel&&!asset?.sourceStructure))throw new Error('验证目标必须属于当前任务范围且具有定义绑定');
  const inputs=factImplementationInputs(asset).map(edge=>({kind:edge.kind,path:edge.to,sha256:sha256(fs.readFileSync(resolveProjectFile(project,edge.to,'验证输入')))}));
  const pageBound=!asset.assetModel && observation.inputs?.some(input=>input.path===asset.implementationMapping && input.sha256===asset.implementationSha256);
  const binding=pageBound?{state:'bound',definition:{coverage:{state:'proven-static',scope:'exact-page-source-file-only',limitations:['HTML 结构与语义不由声明绑定证明']}}}:resolveAssetBinding(facts,observation).find(item=>item.assetId===assetId);
  const complete=binding?.definition?.coverage?.state==='proven-static'&&inputs.length>0&&factImplementationInputs(asset).every(edge=>edge.coverage==='complete');
  const result=binding?.state!=='bound'?'failed':complete?'passed':'pending';
  const report={kind:'source-analysis',taskId,scopeRevision:scope.revision,scopeDigest:sha256(canonicalStringify(scope)),subjectDigest:evidenceSubjectFingerprint(asset),subject:{requirementId,definitionId:assetId},inputFingerprint:evidenceInputFingerprint(inputs),artifactDigest:observation.inputDigest,environment:{platform:process.platform,architecture:process.arch,node:process.versions.node},runnerVersion:observation.analyzerVersion,verifierVersion:'foundation-definition/1.1.0',checkIds:['definition-binding'],dimensions:['definition'],result,checks:[{id:'definition-binding',result,bindingState:binding?.state || 'unresolved'}],limitations:['只证明受控静态定义绑定，不证明语义、运行、布局或真人接受'],analysis:{inputDigest:observation.inputDigest,entryRoots,coverage:observation.coverage,subjectCoverage:binding?.definition?.coverage || null}};
  const current=inspectProjectAuthority(project,{installationRoot});
  if(!current.agreement||current.state!=='enabled'||inspectSourceInputIdentity({project,entryRoots}).inputDigest!==observation.inputDigest||readFacts(project).changes.items.find(item=>item.id===taskId)?.deliveryScope?.revision!==scope.revision)throw new Error('验证收据签发前目标已改变');
  report.supersedes=evidenceRetryPredecessors(task,report);
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


function currentMappedSources(project,facts){
  const sources=inspectSyncSources(project),known=new Set(sources.map(input=>input.path));
  for(const item of Object.values(facts).flatMap(document=>document?.items || []))for(const file of [item.implementationMapping,...factImplementationInputs(item).map(edge=>edge.to),...(item.evidenceIndex || []).map(evidence=>evidence.report?.path),item.sourceDisposition?.source?.path,...(item.sourceDisposition?.replacements||[]).map(input=>input.path)])if(file&&!known.has(file))try{const bytes=fs.readFileSync(resolveProjectFile(project,file));sources.push({path:file,sha256:sha256(bytes)});known.add(file);}catch{}
  return sources.sort((a,b)=>a.path.localeCompare(b.path));
}
function isRegisteredEvidence(facts,source) {
  return facts.changes.items.some(task=>task.evidenceIndex?.some(entry=>entry.report?.path===source.path&&entry.report.sha256===source.sha256));
}

// Discovery records are provisional ownership questions, not extra deliverables.
// Once the exact bytes belong to a page/asset closure, that owner's evidence
// remains responsible for acceptance. The historical question stays readable.
export function currentSourceOwners(facts,source) {
  return ['pages','components','motions','design-tokens'].flatMap(kind=>(facts[kind]?.items || []).filter(item=>
    item.implementationMapping===source.path&&item.implementationSha256===source.sha256 ||
    [...(item.sourceStructure?.inputs || []),...(item.previewBinding?.inputs || [])].some(input=>input.path===source.path&&input.sha256===source.sha256) ||
    factImplementationInputs(item).some(input=>input.to===source.path&&input.sha256===source.sha256)
  ).map(item=>item.id)).sort();
}

// Source calls are usage evidence, not a claim that a conditional instance ran.
// Keep authored usage records; replace only this producer's exact observations.
export function componentSourceUsages(project,facts,inventory,sources) {
  const components=facts.components.items.filter(item=>item.assetModel);
  const roots=facts.pages.items.map(page=>page.implementationMapping).filter(file=>/\.[cm]?[jt]sx?$/u.test(file || ''));
  if(!components.length||!roots.length)return [];
  const observation=analyzeSourcesInWorker({project,entryRoots:[...new Set(roots)]});
  const bindings=resolveAssetBinding(facts,observation),records=[];
  for(const asset of components){
    const binding=bindings.find(item=>item.assetId===asset.id);if(binding?.state!=='bound')continue;
    const usages=[];
    for(const use of binding.usages.filter(use=>use.role==='source-use')){
      const object=inventory.objects.find(object=>object.file===use.file&&`use:${object.file}:${object.offset}`===use.bindingId);
      for(const page of facts.pages.items.filter(page=>page.implementationMapping===use.file||[...(page.sourceStructure?.inputs || []),...(page.previewBinding?.inputs || [])].some(input=>input.path===use.file))){
        const instance=object?.attributes.foundationInstanceKey;
        const configuration=Object.fromEntries((asset.assetModel.configuration || []).flatMap(({key,kind})=>{const value=object?.attributes[key];return kind==='string'&&typeof value==='string'&&!value.startsWith('{')?[[key,value]]:[];}));
        usages.push({pageId:page.id,pageName:page.name,bindingId:use.bindingId,path:use.file,line:use.line,sourceSha256:sources.find(source=>source.path===use.file)?.sha256,role:'source-use',coverage:'static-not-runtime',producer:'foundation-source-usage/1',...(instance&&!instance.startsWith('{')?{instanceId:instance}:{}),configuration});
      }
    }
    const authored=(asset.usageLocations || []).filter(use=>use.producer!=='foundation-source-usage/1');
    const usageLocations=[...authored,...usages.filter(use=>!authored.some(old=>old.pageId===use.pageId&&old.bindingId===use.bindingId))];
    if(canonicalStringify(usageLocations)!==canonicalStringify(asset.usageLocations || []))records.push({...asset,usageLocations,verificationStatus:'unverified',assetModel:{...asset.assetModel,implementationInputs:asset.assetModel.implementationInputs.map(edge=>({...edge,sha256:sources.find(source=>source.path===edge.to)?.sha256 || edge.sha256}))},synchronization:{state:'source-derived',reason:'按当前源码登记精确调用位置；实际呈现与业务用途仍由当前任务核验'}});
  }
  return records;
}

// Work returned to the current task is concrete and resumable. This is an
// implementation-preservation scope, not a fabricated user product requirement.
export function automaticReviewTasks(project,facts,sources,generatedAt,inventory=inspectProjectStructure(project)) {
  const tasks=[];
  for(const page of facts.pages.items.filter(page=>page.implementationMapping&&page.preview)) {
    const assets=[...facts['design-tokens'].items,...facts.motions.items].filter(asset=>asset.pageIds?.includes(page.id));
    const inputDigest=sha256(canonicalStringify({inputs:sources.filter(source=>source.path===page.implementationMapping || page.previewBinding?.inputs?.some(input=>input.path===source.path) || page.sourceStructure?.inputs?.some(input=>input.path===source.path)),producer:'foundation-content-workflow/4'}));
    const id='review_'+page.id,old=facts.changes.items.find(item=>item.id===id);
    const synchronization={state:'source-derived',reason:'核验任务由当前源码范围生成；是否完成仍由各批当前签名证据决定'};
    if(old?.automaticReview?.inputDigest===inputDigest){
      if(old.synchronization?.state==='pending')tasks.push({...old,synchronization});
      continue;
    }
    const checks=[{id:'page_visible',action:'visible',selector:'body'}];
    const viewports=[{width:320,height:812},{width:390,height:844},{width:1280,height:900}];
    for(const asset of assets) {
      if(asset.cssVariable) {
        const definitions=asset.styleEvidence?.definitions || [],base=definitions.find(d=>!d.conditions.length);
        if(!base?.selector)continue;
        const expectedByViewport={};
        for(const viewport of viewports) {
          let value=base.value;
          for(const definition of definitions)if(definition.selector===base.selector&&definition.conditions.length&&definition.conditions.every(condition=>{
            if(condition.name!=='media')return false;
            const width=condition.params.match(/^\(max-width:\s*([0-9]+)px\)$/u);return width&&viewport.width<=Number(width[1]);
          }))value=definition.value;
          expectedByViewport[viewport.width+'x'+viewport.height]=value;
        }
        checks.push({id:asset.id,action:'css',selector:base.selector,attribute:asset.cssVariable,expected:base.value,expectedByViewport});
      } else if(asset.animationName) {
        for(const [i,use] of (asset.styleEvidence?.uses || []).entries())if(use.selector) {
          const noPreference=use.conditions.length===1&&use.conditions[0].name==='media'&&/^\(prefers-reduced-motion:\s*no-preference\)$/u.test(use.conditions[0].params);
          if(!use.conditions.length||noPreference)checks.push({id:asset.id+'_'+i,action:'css',selector:use.selector,attribute:'animation-name',expected:asset.animationName,reducedMotion:'no-preference'});
          if(noPreference)checks.push({id:asset.id+'_disabled_'+i,action:'css',selector:use.selector,attribute:'animation-name',expected:'none',reducedMotion:'reduce'});
          if(use.value==='none'&&use.conditions.length===1&&use.conditions[0].name==='media'&&/^\(prefers-reduced-motion:\s*reduce\)$/u.test(use.conditions[0].params))checks.push({id:asset.id+'_reduced_'+i,action:'css',selector:use.selector,attribute:'animation-name',expected:'none',reducedMotion:'reduce'});
        }
      }
    }
    const source=page.implementationMapping+'#L1-L'+fs.readFileSync(resolveProjectFile(project,page.implementationMapping),'utf8').split('\n').length;
    const scope={schemaVersion:'2.0.0',taskId:id,revision:(old?.deliveryScope?.revision || 0)+1,sourceRefs:[{id:'existing',kind:'necessary-inference',ref:source,text:'接入既有内容，保持当前实现并核验结构、样式和实际运行；业务需求仍由当前任务审阅'}],deliverable:'既有页面接入与当前内容核验',platform:'web',depth:'presentation',included:['当前页面内容、实际变量和动效使用'],excluded:['未声明业务功能','不存在的组件或交互'],layoutPolicy:{mode:'adaptive',source,viewports},items:[{requirementId:'existing_content',description:'核验现有源码与页面展示、变量、动效及适用性',sourceRefIds:['existing'],factIds:[page.id,...assets.map(asset=>asset.id)],applicability:{state:'required',source:'existing'},requiredEvidenceDimensions:['scope','content','definition','runtime','layout'],browserChecks:[]}]};
    const requirement=scope.items[0];
    const inputFiles=new Set([page.implementationMapping,...(page.previewBinding?.inputs || []).map(input=>input.path),...(page.sourceStructure?.inputs || []).map(input=>input.path)]);
    const semanticKeys=[...inventory.objects,...(inventory.obligations || [])].filter(item=>inputFiles.has(item.file)).map(item=>item.key);
    const batchCount=Math.max(Math.ceil(checks.length/50),Math.ceil(semanticKeys.length/45),1);
    const semanticBatches={};
    scope.items=Array.from({length:batchCount},(_,batch)=>{
      const requirementId=batch===0?'existing_content':'existing_content_'+(batch+1);
      semanticBatches[requirementId]=semanticKeys.slice(batch*45,(batch+1)*45);
      const browserChecks=checks.slice(batch*50,(batch+1)*50);
      return {...requirement,requirementId,browserChecks:browserChecks.length?browserChecks:[checks[0]]};
    });
    tasks.push({...old,...(old?{evidenceHistory:[...(old.evidenceHistory || []),...(old.evidenceIndex || [])],previousScopes:[...(old.previousScopes || []),old.deliveryScope],evidenceIndex:[]}:{}),id,name:'接入核验 · '+page.name,status:'draft',source:'source-analysis',verificationStatus:'unverified',synchronization,implementationMapping:page.implementationMapping,affectedPages:[page.id],updatedAt:generatedAt,automaticReview:{producer:'foundation-content-workflow/4',inputDigest,batches:scope.items.length,semanticBatches,limitations:[]},deliveryScope:scope});
  }
  return tasks;
}

export function contentWorkQueue(facts,delivery,coverage,{project=null}={}) {
  const work=[];
  for(const task of facts.changes.items.filter(task=>task.automaticReview))for(const requirement of task.deliveryScope.items) {
    const page=facts.pages.items.find(page=>requirement.factIds.includes(page.id));if(!page)continue;
    const requests={taskId:task.id,assetId:page.id,requirementId:requirement.requirementId};
    if(page.previewBinding?.producer==='foundation-web-build-required/1'||/\.[jt]sx$/u.test(page.implementationMapping)&&page.previewBinding?.producer!=='foundation-web-build/1')work.push({step:'build-preview',...requests,pageId:page.id,reason:'current-build-required',requiresBuildAuthorization:true});
    else if(project&&page.previewBinding?.producer==='foundation-web-build/1')try{verifyWebPreviewBuild({project,facts,page});}catch(error){work.push({step:'build-preview',...requests,pageId:page.id,reason:error.message,requiresBuildAuthorization:true});}
    const evidence=currentEvidenceEntries(task.evidenceIndex || [],delivery.evidenceResults).filter(entry=>entry.taskId===task.id&&entry.scopeRevision===task.deliveryScope.revision&&entry.subject?.requirementId===requirement.requirementId&&entry.subject?.definitionId===page.id);
    const passed=kind=>!evidence.some(entry=>entry.kind===kind&&delivery.evidenceResults?.[entry.evidenceId]?.state==='verified'&&delivery.evidenceResults[entry.evidenceId].result==='failed')&&evidence.some(entry=>entry.kind===kind&&delivery.evidenceResults?.[entry.evidenceId]?.state==='verified'&&delivery.evidenceResults[entry.evidenceId].result==='passed');
    if(!passed('source-analysis'))work.push({step:'verify-definition',...requests,entryRoots:[page.implementationMapping]});
    if(!passed('browser-observation'))work.push({step:'verify-browser',...requests,scenarioId:'page'});
    if(!passed('semantic-review'))work.push({step:'prepare-semantic-review',...requests,responsibility:'当前 Codex 任务阅读精确材料、实际核验后 submit-semantic-review；不能程序代填通过'});
  }
  for(const item of facts.project.contextLifecycle?.objectReferences?.pending || [])work.push({step:'inspector-plan',...item});
  for(const task of facts.changes.items.filter(task=>task.automaticReview?.limitations?.length))work.push({step:'review-content',taskId:task.id,reasons:task.automaticReview.limitations});
  if(!work.length&&delivery.contentIntegrity?.ready===false)work.push({step:'review-content',issues:delivery.contentIntegrity.issues,responsibility:'当前任务依据精确源码补齐真实内容，不改写验证结果'});
  if(!work.length&&coverage.state!=='structurally-recorded')work.push({step:'sync',reason:'结构映射仍未完整'});
  if(!work.length&&!delivery.deliveryReady)work.push({step:'review-delivery',issues:delivery.issues,assessment:delivery.assessment?.aggregate,responsibility:'当前任务继续处理交付缺口；工作队列为空不代表已完成'});
  return work.map(item=>{
    const task=facts.changes.items.find(task=>task.id===item.taskId);
    const version=facts.project.contextLifecycle?.objectReferences?.contentVersion || null;
    const scopeRevision=task?.deliveryScope?.revision || null;
    const predecessors={'verify-definition':[],'verify-browser':['build-preview','verify-definition'],'prepare-semantic-review':['build-preview','verify-definition','verify-browser']};
    return {...item,contentVersion:version,scopeRevision,objectScope:item.assetId?[item.assetId]:item.pageId?[item.pageId]:[],idempotencyKey:sha256(canonicalStringify({item,version,scopeRevision})),prerequisites:predecessors[item.step] || [],execution:{command:'project '+({'review-content':'delivery-check','review-delivery':'delivery-check'}[item.step] || item.step),requiresActiveTask:true},completion:{kind:'current-source-bound-evidence',requirementId:item.requirementId || null}};
  });
}

function remainingAttempts(installationRoot,projectId,attempts,facts,sources) {
  return attempts.filter(item=>{
    try {
      const file=path.join(attemptDirectory(installationRoot,projectId),item.attemptId+'.json');
      if(fs.lstatSync(file).isSymbolicLink())return true;
      const {integrity,...failed}=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!verifyTrustedPayload(failed,integrity))return true;
      if(!failed.automatic) {
        // Exact successful replay of the intent, not of its authorization:
        // Compare submitted business fields and inputs. The handler refreshes
        // updatedAt on every commit; exact evidence additions are append-only.
        // The signed historical failure itself is never modified.
        const documents=failed.payload?.documents || [];
        if(!documents.length||failed.payload.preview||failed.payload.roundTransition)return true;
        const fieldsPresent=documents.every(document=>
          (document.upserts || []).every(record=>{
            const current=facts[document.kind]?.items?.find(item=>item.id===record.id);
            return current&&Object.entries(record).every(([key,value])=>key==='updatedAt'?true:key==='evidenceIndex'&&document.kind==='changes'&&Array.isArray(value)?value.every(entry=>current.evidenceIndex?.some(saved=>canonicalStringify(saved)===canonicalStringify(entry))):canonicalStringify(value)===canonicalStringify(current[key]));
          })&&(document.removes || []).every(id=>!facts[document.kind]?.items?.some(item=>item.id===id)));
        const bytesPresent=(failed.payload.sources || []).every(input=>sha256(fs.readFileSync(resolveProjectFile(failed.project,input.path)))===input.sha256);
        // Registration completion is separate from whether that evidence is
        // still current. An exact, authenticated report already in the facts
        // proves its registration happened, even if an incidental captured
        // guide later changed. Delivery independently revalidates all inputs.
        const registeredReports=documents.every(document=>document.kind==='changes'&&
          !(document.removes || []).length&&document.upserts?.length&&
          document.upserts.every(record=>record.evidenceIndex?.length&&record.evidenceIndex.every(entry=>{
            const bytes=fs.readFileSync(resolveProjectFile(failed.project,entry.report.path));
            if(sha256(bytes)!==entry.report.sha256)return false;
            const {foundationReceipt,...body}=JSON.parse(bytes),{integrity,...receipt}=foundationReceipt || {};
            return body.taskId===record.id&&receipt.purpose==='foundation-evidence-run'&&
              receipt.project===realProject(failed.project)&&receipt.reportDigest===sha256(canonicalStringify(body))&&
              verifyTrustedPayload(receipt,integrity);
          })));
        return !(fieldsPresent&&(bytesPresent||registeredReports));
      }
      const upserts=(failed.payload?.documents || []).flatMap(doc=>(doc.upserts || []).map(record=>({kind:doc.kind,record})));
      return !upserts.length||!upserts.every(({kind,record})=>{
        const current=facts[kind]?.items?.find(item=>item.id===record.id);
        return current&&current.source==='source-analysis'&&current.implementationSha256===sources.find(source=>source.path===current.implementationMapping)?.sha256;
      });
    }catch{return true;}
  });
}

export function inspectProjectSync({project, installationRoot}) {
  const authority = inspectProjectAuthority(project, {installationRoot});
  const authorization = authority.state === 'disabled' ? 'revoked' : authority.continuousSync?.state || 'not-granted';
  const preparation = inspectProjectPreparation(project);
  if (!preparation.factsReady) return {authorization, state:'pending', preparation, pending:preparation.errors, mutationPerformed:false};
  const facts = readFacts(project), sources = currentMappedSources(project,facts);
  const records = Object.values(facts).flatMap(document => document?.items || []);
  const coverage=inspectStructureCoverage(facts,inspectProjectStructure(project,{installationRoot}));
  const semanticPending=records.filter(item=>item.synchronization?.state==='pending'||item.sourceDisposition&&!historicalSourceCurrent(item,sources));
  const coveragePending=coverage.state!=='structurally-recorded'||semanticPending.length>0;
  const pending = sources.filter(source => !isRegisteredEvidence(facts,source)&&!records.some(item => item.implementationMapping === source.path && item.implementationSha256 === source.sha256 || item.sourceStructure?.inputs?.some(input=>input.path===source.path&&input.sha256===source.sha256) || factImplementationInputs(item).some(input=>input.to===source.path&&input.sha256===source.sha256)||item.sourceDisposition?.source?.path===source.path&&item.sourceDisposition.source.sha256===source.sha256));
  const delivery = inspectProjectDeliveryFiles({project,installationRoot});
  const last = authority.projectId ? latestAttempt(installationRoot,authority.projectId) : null;
  const workQueue=contentWorkQueue(facts,delivery,coverage,{project});
  const synchronizationPending=Boolean(pending.length||coveragePending||last?.unresolvedAttempts?.length||last&&['failed','conflict','executing'].includes(last.state));
  if(!workQueue.length&&synchronizationPending)workQueue.push({step:'sync',reason:'current-sync-obligations',pending,semanticPending:semanticPending.map(item=>item.id),unresolvedAttempts:last?.unresolvedAttempts || [],contentVersion:facts.project.contextLifecycle?.objectReferences?.contentVersion || null,scopeRevision:null,objectScope:[],idempotencyKey:sha256(canonicalStringify({pending,semanticPending:semanticPending.map(item=>item.id),attempts:last?.unresolvedAttempts || []})),prerequisites:[],completion:{kind:'current-synchronization-settled'},execution:{command:'project sync',requiresActiveTask:true}});
  return {workQueue,completion:{ready:delivery.deliveryReady===true&&workQueue.length===0,requiresActiveTask:workQueue.length>0,backgroundWorker:false},authorization, revision:authority.continuousSync?.revision || null, lastAttempt: last ? {attemptId:last.attemptId,state:last.state,error:last.error || null} : null, state: last && ['failed','conflict','executing'].includes(last.state) ? (last.state === 'executing' ? 'pending' : last.state) : last?.unresolvedAttempts?.length || pending.length || coveragePending || delivery.state !== 'consistent' ? 'pending' : 'latest', syncState: pending.length || coveragePending || delivery.state !== 'consistent' ? 'pending' : 'latest', coverage, semanticPending:semanticPending.map(item=>item.id), nextStep:workQueue[0] || (coveragePending?'核对需求和实现结构，生成精确语义批次；文件候选不是制作完成':null), acceptanceState:delivery.assessment?.aggregate || 'pending', pending, unresolvedAttempts:last?.unresolvedAttempts || [], delivery, mutationPerformed:false};
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

function settleProjectObservation({project,installationRoot,now,action='observe'}) {
  const facts=readFacts(project),taskId=facts.project.contextLifecycle?.rounds?.find(round=>round.id===facts.project.contextLifecycle.currentRoundId)?.taskId || 'automatic';
  const roundTransition=prepareRoundTransition({project,facts,taskId,action,installationRoot,now});
  if(canonicalStringify(roundTransition.content)===canonicalStringify(facts.project))return false;
  const plan=createProjectMutationPlan({operation:'asset-facts-batch',project,installationRoot,handlerPayload:{documents:[],sources:[],scope:'自动观察与精确验收归属；不是将同步当成接受',generatedAt:new Date(now).toISOString(),roundTransition},now});
  if(!plan.continuousSyncRevision)throw new Error('观察提交前持续授权失效');
  applyProjectMutationPlan({plan,now});return true;
}

export function synchronizeProject({project, installationRoot, handlerPayload = null, roundAction = null, taskId = null, identityActions = [], trigger = 'task', now = Date.now()} = {}) {
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
  let attempt = null,committed=false;
  try {
    let payload = handlerPayload;
    if(roundAction==='begin')payload={documents:[],sources:[],scope:'程序保存任务开始基线',generatedAt:new Date(now).toISOString()};
    if (!payload) {
      const facts = readFacts(project), sources = currentMappedSources(project,facts);
      const documents = [], generatedAt = new Date(now).toISOString();
      const inventory=inspectProjectStructure(project,{installationRoot}),discovered=new Map(),previewPlans=[],discoveryProblems=new Map();
      const previewFile=path.join(project,'.foundation/preview.json'),preview=fs.existsSync(previewFile)?JSON.parse(fs.readFileSync(previewFile)):{};
      const webEntries=new Map(),webShells=new Set();
      // Some existing Vite projects keep their authored HTML entry in build/;
      // only an exact module link to a parsed React mount promotes such a file.
      for(const source of captureProjectRoundInputs(project).files.filter(item=>item.path.endsWith('.html')&&!item.path.startsWith('.foundation/'))) {
        const text=fs.readFileSync(resolveProjectFile(project,source.path),'utf8');
        for(const tag of text.matchAll(/<script\b[^>]*>/giu)) {
          const module=/\btype\s*=\s*["']module["']/iu.test(tag[0]),src=tag[0].match(/\bsrc\s*=\s*["']([^"']+)["']/iu)?.[1];
          if(!module||!src||!/^\.?\.?\/?[^?#]*\.[jt]sx$/u.test(src)||src.startsWith('/'))continue;
          const entry=path.posix.normalize(path.posix.join(path.posix.dirname(source.path),src));
          if(!sources.some(input=>input.path===entry))continue;
          const syntax=inspectorSyntax(fs.readFileSync(resolveProjectFile(project,entry),'utf8'),entry);
          if(syntax.valid&&syntax.mounts.length===1){webEntries.set(entry,source.path);webShells.add(source.path);}
        }
      }
      for(const source of sources){
        const objects=inventory.objects.filter(object=>object.file===source.path);
        const existingPage=facts.pages.items.find(item=>item.implementationMapping===source.path);
        if(!objects.length||webShells.has(source.path)||facts.components.items.some(item=>item.implementationMapping===source.path)||existingPage&&existingPage.source!=='source-analysis')continue;
        const id='source_'+sha256(source.path).slice(0,20),common={id,name:objects[0].name || source.path,status:'draft',source:'source-analysis',verificationStatus:'unverified',implementationMapping:source.path,updatedAt:generatedAt};
        if(webEntries.has(source.path)) {
          const observation=analyzeSourcesInWorker({project,entryRoots:[source.path,webEntries.get(source.path)]}),route=existingPage?.preview || '/preview/'+id+'/';
          const html=fs.readFileSync(resolveProjectFile(project,webEntries.get(source.path)),'utf8'),title=html.match(/<title\b[^>]*>([^<]+)<\/title>/iu)?.[1]?.trim();
          const name=existingPage?.name&&!/^\{/u.test(existingPage.name)?existingPage.name:title || objects.find(object=>object.name&&!/^\{/u.test(object.name))?.name || source.path;
          const navigationUnknown=observation.inputs.filter(input=>!input.path.startsWith('node_modules/')&&!inventory.runtimeSources.some(runtime=>runtime.path===input.path)).some(input=>/\.(?:html|[cm]?[jt]sx?)$/u.test(input.path)&&/(?:\bhref\s*=|\blocation\b|\b(?:navigate|router|history)\b|\bwindow\s*\.\s*open\s*\()/iu.test(fs.readFileSync(resolveProjectFile(project,input.path),'utf8')));
          const navigationApplicability=existingPage?.navigationApplicability&&existingPage.navigationApplicability.producer!=='foundation-web-source/1'?existingPage.navigationApplicability:navigationUnknown?{state:'unknown',source:source.path,reason:'源码闭包存在导航线索，当前任务需核实',producer:'foundation-web-source/1'}:{state:'not-applicable',source:source.path+'#L1-L1',reason:'当前应用源码闭包未声明链接或路由操作；仍需当前语义核验',producer:'foundation-web-source/1'};
          const record={...common,...existingPage,entryType:existingPage?.entryType || 'preview-route',name,navigationApplicability,description:existingPage?.description || '由真实 React 挂载入口发现的页面；语义及运行待核。',entry:existingPage?.entry??(!facts.pages.items.length),preview:route,states:existingPage?.states || ['default'],previewBinding:existingPage?.previewBinding?.producer==='foundation-web-build/1'?existingPage.previewBinding:{producer:'foundation-web-build-required/1',htmlEntry:webEntries.get(source.path),inputs:observation.inputs},synchronization:{state:'source-derived',reason:'已识别 React 挂载与源码闭包；需当前可信构建及语义核验'}};
          if(!existingPage||existingPage.entryType!==record.entryType||existingPage.name!==name||canonicalStringify(existingPage.navigationApplicability)!==canonicalStringify(navigationApplicability)||existingPage.implementationSha256!==source.sha256||canonicalStringify(existingPage.previewBinding)!==canonicalStringify(record.previewBinding))discovered.set(source.path,{kind:'pages',record});
        }
        else if(source.path.endsWith('.html'))try{
          if(existingPage?.previewBinding?.producer==='foundation-web-build/1')continue;
          if(!authority.continuousSync.includePreview||preview.mode!=='local-static')throw new Error('本项目尚未授权或配置静态预览');
          const plan=planStaticPreview({project,file:source.path,id:existingPage?.id || id,config:{...preview,routes:[...(preview.routes || []),...previewPlans.flatMap(item=>item.routes)],assets:[...(preview.assets || []),...previewPlans.flatMap(item=>item.assets)]}});
          for(const input of plan.inputs){const index=sources.findIndex(source=>source.path===input.path);if(index<0)sources.push(input);else sources[index]=input;}
          const navigationUnknown=plan.inputs.some(input=>/\.(?:html|[cm]?js)$/u.test(input.path)&&/(?:\bhref\s*=|\blocation\b|\b(?:navigate|router|history)\b|\bwindow\s*\.\s*open\s*\()/iu.test(fs.readFileSync(resolveProjectFile(project,input.path),'utf8')));
          const navigationApplicability=existingPage?.navigationApplicability?.producer!=='foundation-static-preview/1'&&existingPage?.navigationApplicability?existingPage.navigationApplicability:navigationUnknown?{state:'unknown',source:source.path,reason:'存在导航或动态路由线索，需核实',producer:'foundation-static-preview/1'}:{state:'not-applicable',source:source.path+'#L1-L1',reason:'当前受支持静态资源闭包未声明链接或路由操作；仍需当前语义核验',producer:'foundation-static-preview/1'};
          const record={...common,...existingPage,entryType:existingPage?.entryType || 'preview-route',description:existingPage?.description || `静态 HTML 页面 ${source.path}；通过 ${plan.route} 查看当前内容。接入保留原实现，业务用途由当前任务核验。`,navigationApplicability,entry:existingPage?.entry??(!facts.pages.items.length&&![...discovered.values()].some(item=>item.kind==='pages')),preview:plan.route,previewBinding:{producer:'foundation-static-preview/1',inputs:plan.inputs},states:existingPage?.states || ['default'],synchronization:{state:'source-derived',reason:'自动提取结构、确定路由与标准桥接；需求意义与运行仍待核'}};
          const changed=!existingPage||existingPage.entryType!==record.entryType||!existingPage.description||existingPage.implementationSha256!==source.sha256||canonicalStringify(existingPage.previewBinding)!==canonicalStringify(record.previewBinding)||existingPage.preview!==record.preview;
          if(changed){discovered.set(source.path,{kind:'pages',record});previewPlans.push(plan);}
        }catch(error){discoveryProblems.set(source.path,error.message);}
        else if(/\.[jt]sx$/u.test(source.path)){
          const observation=analyzeSourcesInWorker({project,entryRoots:[source.path]}),definitions=observation.definitions.filter(d=>d.file===source.path&&d.exports.length&&['function','variable'].includes(d.declarationKind));
          // Multiple exported owners require explicit source ownership, never guess.
          if(definitions.length===1){const d=definitions[0];discovered.set(source.path,{kind:'components',record:{...common,name:d.name,family:id,assetModel:{schemaVersion:'1.0.0',kind:'local',responsibility:'源码导出 '+d.name+'；业务职责待核',reuseScope:'local',binding:{file:d.file,export:d.exports[0],declarationKind:d.declarationKind,anchor:d.anchor,line:d.line},configuration:[],slots:[],variantAxes:[],states:[],previewScenarios:[{id:'definition',kind:'definition',definitionId:id}],implementationInputs:observation.inputs.map(input=>({kind:'source',from:id,to:input.path,sha256:input.sha256,discovery:'source-analysis',coverage:observation.coverage.state==='complete'?'complete':'partial'}))},synchronization:{state:'source-derived',reason:'自动提取当前导出及结构；业务意义与运行待核'}}});}
        }
      }
      for(const item of discoverStyleAssets(project,sources,{...facts,pages:{...facts.pages,items:[...new Map([...facts.pages.items,...[...discovered.values()].filter(item=>item.kind==='pages').map(item=>item.record)].map(item=>[item.id,item])).values()]}},generatedAt))discovered.set(item.record.id,item);
      for(const item of discovered.values())if(item.record.assetModel)try{const asset=item.record,scene=prepareSourceScene({project,facts:{...facts,components:{items:[...facts.components.items,...[...discovered.values()].filter(item=>item.kind==='components').map(item=>item.record)]}},asset,scenario:asset.assetModel.previewScenarios[0]});asset.assetModel.implementationInputs=scene.plan.inputs.map(input=>({kind:'source',from:asset.id,to:input.path,sha256:input.sha256,discovery:'source-scene-closure',coverage:'complete'}));}catch{}
      const usageFacts={...facts};
      for(const kind of ['pages','components'])usageFacts[kind]={...facts[kind],items:[...new Map([...facts[kind].items,...[...discovered.values()].filter(item=>item.kind===kind).map(item=>item.record)].map(item=>[item.id,item])).values()]};
      for(const record of componentSourceUsages(project,usageFacts,inventory,sources))discovered.set(record.implementationMapping,{kind:'components',record});
      for (const kind of ['pages','components','interactions','motions','changes','design-tokens','relations']) {
        const upserts = [...discovered.values()].filter(item=>item.kind===kind).map(item=>item.record);
        for (const item of facts[kind].items) {
          if(discovered.has(item.id)||discovered.get(item.implementationMapping)?.kind===kind)continue;
          const source = sources.find(source => source.path === item.implementationMapping);
          if(kind==='changes'&&item.source==='source-discovery'&&source&&isRegisteredEvidence(facts,source)) {
            upserts.push({...item,source:'foundation-evidence-record',synchronization:{state:'source-derived',reason:'精确摘要匹配已登记核验报告；保留历史记录，不作为业务源码候选'}});continue;
          }
          if(kind==='changes'&&item.source==='source-discovery'&&source) {
            const ownerIds=currentSourceOwners(facts,source);
            if(ownerIds.length){
              const synchronization={state:'source-derived',observedSha256:source.sha256,ownerIds,reason:'当前精确源码已属于页面或资产闭包；是否完成由归属对象的当前证据决定'};
              if(canonicalStringify(item.synchronization)!==canonicalStringify(synchronization))upserts.push({...item,synchronization});
              continue;
            }
          }
          const impact=inspectFactSourceImpact(item,sources);
          if(item.implementationMapping&&!source)continue; // Missing bytes stay readable and pending; never fabricate a source claim.
          if (item.implementationMapping && impact.changed.length && !(item.synchronization?.state==='pending' && item.synchronization.impactFingerprint===impact.fingerprint || item.synchronization?.state==='pending' && impact.changed.every(change=>item.synchronization.changedInputs?.some(old=>old.path===change.path&&old.current===change.current)))) {
            const derivable=source&&['pages','components'].includes(kind)&&(!item.sourceStructure?.semantics||item.sourceStructure.semantics.producer==='foundation-source-semantics/1');
            upserts.push({...item,...(derivable&&item.assetModel?{assetModel:{...item.assetModel,implementationInputs:item.assetModel.implementationInputs.map(edge=>({...edge,sha256:sources.find(source=>source.path===edge.to)?.sha256 || edge.sha256}))}}:{}),verificationStatus:'unverified',synchronization:{state:derivable?'source-derived':'pending',observedSha256:source?.sha256 || null,impactFingerprint:impact.fingerprint,changedInputs:impact.changed,reason:derivable?'已按当前源码重新整理；语义接受与运行待核':source?'源码或共享依赖变化，语义与运行待核':'源码已删除，映射失效；保留原事实待核',trigger}});
          }
        }
        if (kind === 'changes') for (const source of sources) {
          if(isRegisteredEvidence(facts,source))continue;
          const mapped = Object.values(facts).some(document => document?.items?.some(item => item.implementationMapping === source.path || item.sourceStructure?.inputs?.some(input=>input.path===source.path)));
          if (!mapped && !discovered.has(source.path) && ![...discovered.values()].some(item=>item.record.assetModel?.implementationInputs?.some(input=>input.to===source.path))) upserts.push({id:`sync_candidate_${sha256(source.path).slice(0,20)}`,name:source.path,status:'draft',source:'source-discovery',verificationStatus:'unverified',implementationMapping:source.path,updatedAt:generatedAt,synchronization:{state:'pending',reason:discoveryProblems.get(source.path) || '发现未登记源码；业务用途与任务范围待核',trigger}});
        }
        if (upserts.length) documents.push({kind,expectedSha256:sha256(fs.readFileSync(path.join(project,`.foundation/facts/${kind}.json`))),upserts});
      }
      const merged={...facts};
      for(const document of documents)merged[document.kind]={...facts[document.kind],items:[...new Map([...facts[document.kind].items,...document.upserts].map(item=>[item.id,item])).values()]};
      const reviewTasks=automaticReviewTasks(project,merged,sources,generatedAt,inventory);
      if(reviewTasks.length){let changes=documents.find(doc=>doc.kind==='changes');if(!changes){changes={kind:'changes',expectedSha256:sha256(fs.readFileSync(path.join(project,'.foundation/facts/changes.json'))),upserts:[]};documents.push(changes);}changes.upserts=[...new Map([...changes.upserts,...reviewTasks].map(item=>[item.id,item])).values()];}
      unresolvedAttempts=remainingAttempts(installationRoot,authority.projectId,unresolvedAttempts,facts,sources);
      if (!documents.length && !roundAction) {
        if (previousAttempt && !interruptedCompleted && (['failed','conflict','executing'].includes(previousAttempt.state)||canonicalStringify(previousAttempt.unresolvedAttempts || [])!==canonicalStringify(unresolvedAttempts))) recordAttempt(installationRoot,{attemptId:`${Date.now()}-${crypto.randomUUID()}`,projectId:authority.projectId,project,revision:authority.continuousSync.revision,trigger,state:'completed',unresolvedAttempts,discovery:'current-inputs-no-change',completedAt:Date.now()});
        const observed=settleProjectObservation({project,installationRoot,now});return {...inspectProjectSync({project,installationRoot}),prepared,mutationPerformed:observed};
      }
      payload = {documents,sources,scope:'自动发现并登记源码变化；未知内容保留待核，不声明运行通过',generatedAt,...(previewPlans.length?{preview:{expectedSha256:sha256(fs.readFileSync(previewFile)),routes:previewPlans.flatMap(item=>item.routes),assets:[...new Map(previewPlans.flatMap(item=>item.assets).map(entry=>[entry.path,entry])).values()]}}:{})};
    }
    payload=JSON.parse(JSON.stringify(attachObservedStructure(payload,inspectProjectStructure(project,{installationRoot}),readFacts(project))));
    if(roundAction)payload.roundTransition=prepareRoundTransition({project,facts:readFacts(project),taskId,action:roundAction,identityActions,installationRoot,now});
    attempt = {attemptId:`${Date.now()}-${crypto.randomUUID()}`,projectId:authority.projectId,project,revision:authority.continuousSync.revision,unresolvedAttempts,payload,trigger,automatic:!handlerPayload&&!roundAction,state:'executing',createdAt:Date.now()};
    recordAttempt(installationRoot,attempt);
    const plan = createProjectMutationPlan({operation:'asset-facts-batch',project,installationRoot,handlerPayload:payload,now});
    if (!plan.continuousSyncRevision) throw new LifecycleError('PROJECT_SYNC_AUTHORITY_REQUIRED','提交前持续授权失效');
    attempt = {...attempt,plan};
    recordAttempt(installationRoot,attempt);
    const result = applyProjectMutationPlan({plan,now});committed=true;
    recordAttempt(installationRoot,{...attempt,unresolvedAttempts:remainingAttempts(installationRoot,authority.projectId,unresolvedAttempts,readFacts(project),currentMappedSources(project,readFacts(project))),state:'completed',planId:plan.planId,planHash:plan.integrity.hash,completedAt:Date.now()});
    // A batch may change preview mappings. Close against the committed outputs,
    // then evaluate acceptance; the pre-write snapshot cannot represent them.
    if(roundAction==='finish')settleProjectObservation({project,installationRoot,now,action:'finish'});
    settleProjectObservation({project,installationRoot,now});
    return {...inspectProjectSync({project,installationRoot}),planId:plan.planId,planHash:plan.integrity.hash,result,prepared,mutationPerformed:true};
  } catch (error) {
    if (attempt) recordAttempt(installationRoot,{...attempt,state:'failed',error:{code:error.code || 'PROJECT_SYNC_FAILED',message:error.message},failedAt:Date.now()});
    return {authorization:inspectProjectAuthority(project,{installationRoot}).continuousSync?.state || 'not-granted',state:/CHANGED|CONFLICT|LOCK|DRIFT/u.test(error.code || '') ? 'conflict' : 'failed',pending:initial.pending, error:{code:error.code || 'PROJECT_SYNC_FAILED',message:error.message},summary:committed?'完整事实代已提交，但同步回读失败；保留待核':'源码保留；下次任务或打开时重新核对，不能视为同步最新',mutationPerformed:committed};
  }
}

// Historical reports remain in the index; only current evidence for this exact
// owner can support a new review. Another owner's pass cannot lend authority.
export function currentSemanticEvidence(task,requirementId,assetId,evidenceResults) {
  return currentEvidenceEntries(task.evidenceIndex || [],evidenceResults).filter(entry=>entry.subject?.requirementId===requirementId&&entry.subject?.definitionId===assetId&&['source-analysis','browser-observation'].includes(entry.kind)&&evidenceResults?.[entry.evidenceId]?.state==='verified'&&evidenceResults[entry.evidenceId].result==='passed');
}

// Persist only reports signed by a built-in verifier. Immutable files can be
// orphaned by an interruption; the exact facts transaction is safe to retry.
export function persistProjectEvidence({project,installationRoot,result}) {
  const root=realProject(project),authority=inspectProjectAuthority(root,{installationRoot});
  if(authority.state!=='enabled'||authority.continuousSync?.state!=='active')throw new Error('证据登记需要当前持续同步授权');
  const report=result?.report,{foundationReceipt,...body}=report || {},{integrity,...receipt}=foundationReceipt || {};
  if(receipt.purpose!=='foundation-evidence-run'||receipt.project!==root||receipt.reportDigest!==sha256(canonicalStringify(body))||!verifyTrustedPayload(receipt,integrity))throw new Error('拒绝登记非程序签发或已改写的验证报告');
  const facts=readFacts(root),task=facts.changes.items.find(item=>item.id===report.taskId);
  if(!task||task.deliveryScope?.revision!==report.scopeRevision||(report.kind==='browser-observation'?browserRequirementDigest(task.deliveryScope,report.subject?.requirementId):sha256(canonicalStringify(task.deliveryScope)))!==report.scopeDigest)throw new Error('报告对应的任务范围已变化');
  const text=JSON.stringify(report,null,2)+'\n',hash=sha256(text),relative='.foundation/generated-cache/evidence/'+hash+'.json';
  let directory=root;
  for(const segment of ['.foundation','generated-cache','evidence']){directory=path.join(directory,segment);const stat=fs.lstatSync(directory,{throwIfNoEntry:false});if(stat?.isSymbolicLink())throw new Error('证据目录拒绝符号链接');if(!stat)fs.mkdirSync(directory);}
  const file=path.join(directory,hash+'.json');
  if(fs.existsSync(file)){if(fs.lstatSync(file).isSymbolicLink()||sha256(fs.readFileSync(file))!==hash)throw new Error('不可变报告路径冲突');}
  else fs.writeFileSync(file,text,{flag:'wx',mode:0o600});
  const fields=['kind','subject','taskId','scopeRevision','inputFingerprint','artifactDigest','environment','runnerVersion','verifierVersion','checkIds','dimensions','result','limitations'];
  const entry={...Object.fromEntries(fields.map(key=>[key,report[key]])),evidenceId:'evidence_'+hash,report:{path:relative,sha256:hash}};
  if(task.evidenceIndex?.some(item=>item.evidenceId===entry.evidenceId))return {state:'already-registered',evidenceId:entry.evidenceId,mutationPerformed:false};
  const record={...task,evidenceIndex:[...(task.evidenceIndex || []),entry]};
  const sources=[...new Map([...captureProjectRoundInputs(root).files.map(({path,sha256})=>({path,sha256})),...record.evidenceIndex.map(evidence=>({path:evidence.report.path,sha256:sha256(fs.readFileSync(resolveProjectFile(root,evidence.report.path)))}))].map(input=>[input.path,input])).values()];
  return synchronizeProject({project:root,installationRoot,handlerPayload:{scope:'登记当前内置核验的真实报告；历史失败保留',generatedAt:new Date().toISOString(),sources,documents:[{kind:'changes',expectedSha256:sha256(fs.readFileSync(resolveProjectFile(root,'.foundation/facts/changes.json'))),upserts:[record]}]}});
}

// Semantic judgments remain attributable review, not browser or human acceptance.
// Preparation fixes the questions and the exact material the reviewer must read.
export function prepareProjectSemanticReview({project,installationRoot,taskId,assetId,requirementId}) {
  const authority=inspectProjectAuthority(project,{installationRoot});
  const rules=readCurrentFoundationRules({project,installationRoot});
  if(authority.state!=='enabled'||!authority.agreement||!rules.currentIdentityHash||!rules.factCapabilities?.includes('semantic-review/1'))throw new Error('语义核验需要当前已启用的项目权限与 semantic-review/1 能力');
  const facts=readFacts(project),task=facts.changes.items.find(t=>t.id===taskId),scope=task?.deliveryScope;
  const requirement=scope?.items?.find(item=>item.requirementId===requirementId),asset=[...facts.components.items,...facts.pages.items].find(a=>a.id===assetId);
  if(scope?.schemaVersion!=='2.0.0'||!requirement?.factIds?.includes(assetId)||(!asset?.assetModel&&!asset?.sourceStructure))throw new Error('语义核验目标必须属于当前范围');
  if(requirement.removedInputs?.length&&!rules.factCapabilities.includes('deletion-review/1'))throw new Error('当前运行时缺少 deletion-review/1 能力');
  const sources=(scope.sourceRefs || []).map(source=>{
    if(source.kind==='unconfirmed-assumption')throw new Error('需求来源未确认，不能准备可信语义核验');
    const match=source.ref.match(/^(.+)#L([1-9][0-9]*)-L([1-9][0-9]*)$/u);
    if(!match)throw new Error('语义需求来源需项目内精确文件及行范围：path#L1-L2');
    const file=resolveProjectFile(project,match[1],'语义需求来源'),bytes=fs.readFileSync(file),lines=bytes.toString('utf8').split('\n');
    const start=Number(match[2]),end=Number(match[3]);if(end<start||end>lines.length)throw new Error('需求来源行范围无效');
    return {...source,path:match[1],startLine:start,endLine:end,sha256:sha256(bytes),excerpt:lines.slice(start-1,end).join('\n')};
  });
  const delivery=inspectProjectDeliveryFiles({project,installationRoot});
  const evidence=currentSemanticEvidence(task,requirementId,assetId,delivery.evidenceResults);
  if(!evidence.some(e=>e.kind==='source-analysis')||!evidence.some(e=>e.kind==='browser-observation'))throw new Error('语义核验必须引用已持久化的定义与实际运行证据');
  // The same delivery reader checks receipts, inputs, build, environment and versions.
  for(const entry of evidence)if(delivery.evidenceResults?.[entry.evidenceId]?.state!=='verified'||delivery.evidenceResults[entry.evidenceId].result!=='passed')throw new Error('语义核验的实现或运行证据未通过当前输入核验');
  const covered=[...new Set(requirement.factIds)].sort();
  const inventory=inspectProjectStructure(project,{installationRoot});
  const structureCoverage=inspectStructureCoverage(facts,inventory);
  if(structureCoverage.state!=='structurally-recorded')throw new Error('语义审阅前存在实现对象未登记或旧定位；先同步当前结构');
  if(structureCoverage.semanticCoverage?.state==='pending')throw new Error('语义审阅前仍缺结构化事件、状态分支或关系；先同步有来源的语义模型');
  const checks=[
    {id:'requirements-implemented',dimension:'scope',expected:requirement.description,factIds:covered},
    {id:'changes-justified',dimension:'scope',expected:'实际变化逐项有当前需求依据；未增加范围外功能',factIds:[...new Set([...(task.affectedAssets || []),...(task.affectedPages || [])])].sort()},
    {id:'content-depth',dimension:'content',expected:`按 ${scope.depth} 深度交付；静态展示不得声称真实业务成功`,factIds:covered},
    {id:'failure-recovery',dimension:'content',expected:'核对需求要求的失败、空态与恢复；不适用须以需求和运行证据说明',factIds:covered},
    {id:'preserved-content',dimension:'content',expected:'核对局部修改不应改变的既有内容、二级页面与数据',factIds:covered},
  ];
  const selectedKeys=task.automaticReview?.semanticBatches?.[requirementId];
  const inputFiles=new Set([asset.implementationMapping,...factImplementationInputs(asset).map(input=>input.to),...(asset.sourceStructure?.inputs || []).map(input=>input.path)]);
  const selected=item=>inputFiles.has(item.file)&&(!selectedKeys||selectedKeys.includes(item.key));
  for(const object of inventory.objects.filter(selected))checks.push({id:`structure_${sha256(object.key).slice(0,16)}`,dimension:'content',expected:`核对实现对象及需求依据：${JSON.stringify(object)}；说明名称、用途、状态与数据影响；静态推断未知不得填通过`,factIds:covered});
  for(const obligation of (inventory.obligations || []).filter(selected))checks.push({id:`semantic_${sha256(obligation.key).slice(0,16)}`,dimension:'content',expected:`核对实现分支及其结构化关系：${JSON.stringify(obligation)}`,factIds:covered});
  const observation=captureProjectRoundInputs(project);
  const removals=inspectScopedRemovals({project,facts,requirement,observation,round:inspectProjectRound(facts,observation)});
  for(const removal of removals)checks.push({id:`removed_${sha256(removal.path).slice(0,16)}`,dimension:'scope',expected:`核对精确删除及当前需求依据：${JSON.stringify(removal)}；确认替代或保留能力、当前引用和运行证据`,factIds:covered,sourceRefIds:removal.sourceRefIds});
  const scoped=new Set(scope.items.flatMap(item=>item.factIds));
  if(checks.some(check=>!check.factIds.length)||checks[1].factIds.some(id=>!scoped.has(id)))throw new Error('实际变化存在范围外或未说明的对象');
  const inputs=factImplementationInputs(asset).map(edge=>({kind:edge.kind,path:edge.to,sha256:sha256(fs.readFileSync(resolveProjectFile(project,edge.to,'语义实现输入')))}));
  if(!inputs.length)throw new Error('语义核验缺实现输入');
  const plan={schemaVersion:'1.0.0',purpose:'foundation-semantic-review',project:realProject(project),taskId,assetId,requirementId,scopeRevision:scope.revision,scopeDigest:sha256(canonicalStringify(scope)),subjectDigest:evidenceSubjectFingerprint(asset),sourceDigest:sha256(canonicalStringify(inspectSyncSources(project))),currentIdentityHash:rules.currentIdentityHash,authorityRevision:authority.continuousSync?.revision || null,inputs,sources,evidence,checks,...(removals.length?{removals}:{}),structureInventory:inventory,implementation:covered.map(id=>Object.values(facts).flatMap(doc=>doc?.items || []).find(item=>item.id===id)).filter(Boolean)};
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
    if(!check||check.expected!==expected.expected||canonicalStringify([...check.coveredFactIds].sort())!==canonicalStringify(expected.factIds)||check.evidenceIds.some(id=>!knownEvidence.has(id))||check.sourceRefIds.some(id=>!knownSources.has(id))||(expected.sourceRefIds || []).some(id=>!check.sourceRefIds.includes(id)))throw new Error('语义审阅缺准确期望、引用或覆盖');
    if(!check.evidenceIds.some(id=>plan.evidence.find(e=>e.evidenceId===id)?.kind==='browser-observation'))throw new Error('语义检查必须引用实际运行观察');
    return {...check,dimension:expected.dimension,result:check.judgment};
  });
  const result=checks.some(c=>c.result==='failed')?'failed':checks.some(c=>c.result==='pending')?'pending':'passed';
  const report={kind:'semantic-review',taskId:plan.taskId,scopeRevision:plan.scopeRevision,scopeDigest:plan.scopeDigest,subjectDigest:plan.subjectDigest,sourceDigest:plan.sourceDigest,subject:{requirementId:plan.requirementId,definitionId:plan.assetId},inputFingerprint:evidenceInputFingerprint(plan.inputs),artifactDigest:plan.planDigest || fresh.planDigest,environment:{reviewKind:review.reviewer.kind,identityAuthentication:'self-reported-not-authenticated'},runnerVersion:'foundation-semantic-review/1.0.0',verifierVersion:'foundation-semantic-contract/2.0.0',structureDigest:plan.structureInventory.sourceDigest,checkIds:checks.map(c=>c.id),dimensions:['scope','content'],result,checks,reviewer:review.reviewer,semanticInputs:{...(plan.removals?.length?{removals:plan.removals}:{}),sources:plan.sources,evidence:plan.evidence,currentIdentityHash:plan.currentIdentityHash,factIds:plan.implementation.map(item=>item.id),factsDigest:sha256(canonicalStringify(plan.implementation))},limitations:['语义判断由所列审阅者负责；收据只证明受控路径、引用覆盖和精确输入一致','审阅者名称为自述，不是身份认证；不证明真人接受']};
  report.supersedes=evidenceRetryPredecessors(readFacts(project).changes.items.find(task=>task.id===plan.taskId),report);
  const run={purpose:'foundation-evidence-run',project:realProject(project),reportDigest:sha256(canonicalStringify(report))};
  const signed={...report,foundationReceipt:{...run,integrity:signTrustedPayload(run)}},reportText=JSON.stringify(signed,null,2)+'\n';
  return {report:signed,reportText,reportSha256:sha256(reportText),mutationPerformed:false};
}
