import {captureProjectRoundInputs,inspectProjectRound} from './project-context-round.mjs';
import {inspectProjectStructure,inspectStructureCoverage} from './project-coverage.mjs';
import {inspectContentIntegrity} from './content-integrity.mjs';
import {inspectPreviewConfig} from './preview-config.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {sha256,canonicalStringify} from './install-contract.mjs';
import {assertProjectFileAbsent,resolveProjectFile as resolveEvidencePath,realProject} from './path-boundary.mjs';
import {FACT_FILES, readFacts, validateFacts, inspectProjectPreparation} from './facts.mjs';
import {readCurrentFoundationRules} from './rules-delivery.mjs';
import {inspectEvidenceReport,inspectEvidenceImpact,evidenceSubjectFingerprint,factImplementationInputs} from './evidence-impact.mjs';
import {inspectSyncSources} from './source-inventory.mjs';
import {inspectSourceInputIdentity,analyzerVersion} from './source-analysis.mjs';

export const REQUIRED_PREVIEW_CHECKS=['workbench-handshake','object-location','project-reopen'];
export const DELIVERY_DIMENSIONS = ['scope','content','definition','runtime','layout'];
const legitimateNa = value => value?.state==='not-applicable' && typeof value.reason==='string' && value.reason.trim() && typeof value.source==='string' && value.source.trim();

// Single owner of product acceptance. The pure assessment consumes separately
// verified observations; no persisted verified/producer string grants a pass.
export function assessDelivery(facts,{contentIntegrity=null,evidenceResults={},activeTaskId=null,unresolvedIssues=[],structureCoverage=null,changedInputs=[]}={}) {
  const changes=facts.changes?.items || [];
  const ordered=changes.filter(c=>c.deliveryScope).sort((a,b)=>String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || b.id.localeCompare(a.id));
  const change=activeTaskId?ordered.find(c=>c.id===activeTaskId):ordered[0];
  const scope=change?.deliveryScope;
  const issues=[...unresolvedIssues];
  const dimensions=Object.fromEntries(DELIVERY_DIMENSIONS.map(name=>[name,{state:'pending',requirements:[]}]));
  if(scope?.schemaVersion!=='2.0.0') {
    issues.push({id:'delivery:scope:legacy',dimension:'scope',state:'pending',message:'当前任务缺少 2.0 范围与分维证据；旧 verified 保留原含义'});
    return {schemaVersion:'1.0.0',taskId:change?.id || null,scopeRevision:null,...dimensions,aggregate:'pending',issues,contentIntegrity,humanAcceptance:'not-verified'};
  }
  const applicability=deriveDeliveryApplicability(facts,{change,changedInputs});
  const isVisual=applicability.visual;
  contentIntegrity ??= inspectContentIntegrity(facts,{requireCoverage:true,activeTaskId:change.id,affectedIds:applicability.factIds});
  if(isVisual && (!structureCoverage || structureCoverage.state!=='structurally-recorded'))issues.push({id:'delivery:structure-coverage',dimension:'content',state:'pending',message:'实现结构覆盖未完成；不能以已提交 factIds 替代完整范围'});
  if(isVisual && structureCoverage?.semanticCoverage?.state==='pending')issues.push({id:'delivery:semantic-coverage',dimension:'content',state:'pending',message:'实现事件、状态分支或数据关系尚未完整登记，不能整体通过'});
  const factIds=new Set(Object.values(facts).flatMap(d=>d?.items || []).map(item=>item.id));
  const scopedIds=new Set((scope.items || []).flatMap(i=>i.factIds || []));
  for(const id of [...(change.affectedAssets || []),...(change.affectedPages || [])])if(!scopedIds.has(id))issues.push({id:`delivery:${change.id}:unscoped:${id}`,dimension:'scope',state:'failed',message:`实际变化 ${id} 缺少本次需求依据`});
  for(const dimension of DELIVERY_DIMENSIONS) {
    const requirements=[];
    for(const item of scope.items || []) {
      if(item.factIds?.length && item.factIds.every(id=>factIds.has(id)) && legitimateNa(item.applicability) && !isVisual && (scope.sourceRefs || []).some(source=>source.kind!=='unconfirmed-assumption' && (item.sourceRefIds || []).includes(source.id) && source.ref===item.applicability.source)) {requirements.push({requirementId:item.requirementId,state:'not-applicable',reason:item.applicability.reason,source:item.applicability.source});continue;}
      if(!isVisual && item.applicability?.state!=='not-applicable' && !item.requiredEvidenceDimensions?.includes(dimension))continue;
      const sources=(item.sourceRefIds || []).map(id=>scope.sourceRefs?.find(s=>s.id===id));
      let state='pending',reason='缺当前输入上的独立验证证据';
      const evidence=(change.evidenceIndex || []).filter(e=>e.subject?.requirementId===item.requirementId && e.dimensions?.includes(dimension) && e.scopeRevision===scope.revision && e.taskId===scope.taskId);
      const observed=evidence.map(e=>({e,...evidenceResults[e.evidenceId]}));
      let supported=observed.filter(x=>x.state==='verified' && !(['runtime','layout'].includes(dimension) && !['browser-observation','renderer-observation'].includes(x.e.kind)));
      if(isVisual && ['scope','content'].includes(dimension))supported=supported.filter(x=>x.result==='failed'||x.e.kind==='semantic-review'&&x.report?.verifierVersion==='foundation-semantic-contract/2.0.0'&&x.report?.structureDigest===structureCoverage?.sourceDigest);
      if(isVisual && dimension==='runtime') {
        const required=[...REQUIRED_PREVIEW_CHECKS];
        if((facts.components?.items || []).some(asset=>(item.factIds || []).includes(asset.id)&&asset.assetModel?.previewScenarios?.length))required.push('asset-ready');
        const capable=supported.filter(x=>x.report?.verifierVersion==='foundation-browser-checks/2.0.0' && required.every(id=>x.report.checks?.some(check=>check.id===id && check.result==='passed')));
        if(!capable.length)issues.push({id:`delivery:preview:${item.requirementId}`,dimension:'runtime',state:'pending',message:`预览必要能力待核：${required.join('、')}`});
        // Preserve actual failures; only passing observations require all capabilities.
        supported=supported.filter(x=>x.result==='failed'||capable.includes(x));
      }
      if(!item.factIds?.length || item.factIds.some(id=>!factIds.has(id))) {state='failed';reason='需求缺少合法事实引用';}
      else if(!sources.length || sources.some(s=>!s || s.kind==='unconfirmed-assumption'))reason='需求来源尚未确认';
      else if(supported.some(x=>x.result==='failed')) {state='failed';reason='实际验证失败';}
      else if(supported.some(x=>x.result==='passed')) {state='passed';reason='当前精确输入与受控核验通过';}
      else if(['runtime','layout'].includes(dimension) && scope.platform!=='web') {state='blocked';reason=`尚无 ${scope.platform} 实际 renderer 证据`;}
      else if(observed.some(x=>x.state==='invalid')) {state='failed';reason='证据报告无效';}
      requirements.push({requirementId:item.requirementId,state,reason});
      if(state!=='passed')issues.push({id:`delivery:${scope.taskId}:${scope.revision}:${item.requirementId}:${dimension}`,dimension,state,message:reason});
    }
    const states=requirements.map(r=>r.state);
    const state=states.includes('failed')?'failed':states.includes('blocked')?'blocked':states.includes('pending')?'pending':states.includes('passed')?'passed':requirements.length || !isVisual?'not-applicable':'pending';
    dimensions[dimension]={state,requirements};
  }
  if(!contentIntegrity.ready) {dimensions.content.state='pending';issues.push(...contentIntegrity.issues.map(i=>({...i,dimension:'content',state:'pending'})));}
  for(const dimension of DELIVERY_DIMENSIONS)if(issues.some(i=>i.dimension===dimension && i.state==='pending')&&!['failed','blocked'].includes(dimensions[dimension].state))dimensions[dimension].state='pending';
  if(issues.some(i=>i.dimension==='scope'&&i.state==='failed'))dimensions.scope.state='failed';
  const states=Object.values(dimensions).map(d=>d.state);
  const aggregate=states.includes('failed') || issues.some(i=>i.priority==='P0'||i.priority==='P1')?'failed':states.includes('blocked')?'blocked':states.includes('pending')?'pending':'passed';
  return {schemaVersion:'1.0.0',taskId:scope.taskId,scopeRevision:scope.revision,applicability,...dimensions,aggregate,issues,contentIntegrity,humanAcceptance:'not-verified'};
}

// Current scope plus observed implementation dependencies, not historical task platform.
// A caller cannot exempt a changed page by omitting it from factIds or declaring CLI.
export function deriveDeliveryApplicability(facts,{change,changedInputs=[]}={}) {
  const ids=new Set([...(change?.affectedAssets || []),...(change?.affectedPages || []),...(change?.deliveryScope?.items || []).flatMap(item=>item.factIds || [])]);
  const changed=new Set(changedInputs.map(input=>typeof input==='string'?input:input.path));
  const visualKinds=['pages','components','interactions','motions','design-tokens'];
  const impacted=[];
  for(const kind of visualKinds)for(const record of facts[kind]?.items || []) {
    const dependencyChanged=changed.has('.foundation/preview.json')||[...changed].some(file=>/^(?:package(?:-lock)?|[jt]sconfig)\.json$/u.test(file))||changed.has(record.implementationMapping)||factImplementationInputs(record).some(edge=>changed.has(edge.to));
    if(ids.has(record.id)||dependencyChanged){ids.add(record.id);impacted.push({id:record.id,kind,reason:dependencyChanged?'changed-implementation-input':'current-task-reference'});}
  }
  return {visual:impacted.length>0,factIds:[...ids],impacted,source:'current-task-and-implementation-inputs'};
}

// Acceptance belongs to the exact owner observed by each controlled report.
// A multi-owner scope cannot lend one component's evidence to its siblings.
export function hasCurrentOwnerEvidence(ownerId,task,evidenceResults){
  return DELIVERY_DIMENSIONS.every(dimension=>(task.evidenceIndex || []).some(evidence=>evidence.subject?.definitionId===ownerId&&evidence.taskId===task.id&&evidence.scopeRevision===task.deliveryScope?.revision&&evidence.dimensions?.includes(dimension)&&evidenceResults[evidence.evidenceId]?.state==='verified'&&evidenceResults[evidence.evidenceId]?.result==='passed'));
}

// A deletion is an explicit scope item, never inferred as acceptance from absence.
// The reviewer sees the exact observed prior bytes and current reference checks.
export function inspectScopedRemovals({project, facts, requirement, round, observation}) {
  const claims=requirement.removedInputs || [], seen=new Set();
  const records=Object.entries(facts).filter(([kind])=>kind!=='changes').flatMap(([,doc])=>doc?.items || []);
  return claims.map(claim=>{
    if(seen.has(claim.path))throw new Error('删除范围包含重复路径');seen.add(claim.path);
    assertProjectFileAbsent(project,claim.path);
    if(!claim.sourceRefIds.length||claim.sourceRefIds.some(id=>!requirement.sourceRefIds.includes(id)))throw new Error('删除缺当前需求来源');
    const pending=round.pendingChanges.find(change=>change.path===claim.path && !change.after);
    const lastDeletion=pending?.history?.findLast(event=>event.after===null && event.before);
    const accepted=(facts.project.contextLifecycle?.acceptances || []).flatMap(record=>record.removals || []).find(item=>item.path===claim.path && item.beforeSha256===claim.beforeSha256);
    if((lastDeletion?.before || pending?.before?.sha256 || accepted?.beforeSha256)!==claim.beforeSha256)throw new Error('删除缺精确历史字节或摘要已变化');
    if(observation.files.some(file=>file.path===claim.path)||records.some(record=>record.implementationMapping===claim.path||factImplementationInputs(record).some(edge=>edge.to===claim.path)||(record.sourceStructure?.inputs || []).some(input=>input.path===claim.path)))throw new Error('删除目标仍被当前事实引用');
    return {path:claim.path,beforeSha256:claim.beforeSha256,sourceRefIds:[...claim.sourceRefIds]};
  });
}

// Read-only projection. Neither the supplied change list nor a passing result
// grants mutation authority. Facts retain the verified source digest; no second
// delivery database or remembered success flag is maintained.
function fileAt(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(relative)) throw new Error('交付检查需要精确项目相对文件路径');
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`拒绝符号链接：${relative}`); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  if (!fs.lstatSync(cursor).isFile()) throw new Error(`不是普通文件：${relative}`);
  return cursor;
}

export function inspectProjectDeliveryFiles({project, installationRoot=null,changes = [], requirePreview = false, activeTaskId = null} = {}) {
  const root = realProject(project);
  if (!Array.isArray(changes) || typeof requirePreview !== 'boolean') throw new Error('交付检查变化必须为数组，预览要求必须为布尔值');
  const seen = new Set();
  for (const change of changes) {
    if (!change || Object.keys(change).some(key => !['path', 'sha256'].includes(key)) || seen.has(change.path) || !(change.sha256 === null || /^[a-f0-9]{64}$/u.test(change.sha256 || ''))) throw new Error('变化需唯一 path 和当前 SHA-256；删除使用 null');
    fileAt(root, change.path); seen.add(change.path);
  }
  const preparation = inspectProjectPreparation(root), issues = [];
  if (!preparation.factsReady) return {schemaVersion: '1.0.0', state: 'sync-pending', summary: '代码完成情况未核实，Foundation同步待完成', project: root, preparation, issues: preparation.errors, changes, mutationPerformed: false};
  for (const kind of FACT_FILES) fileAt(root, `.foundation/facts/${kind}.json`);
  const facts = readFacts(root);
  const assets = FACT_FILES.flatMap(kind => facts[kind].items.map(item => ({kind, ...item})));
  let preview = null;
  try {
    const file = fileAt(root, '.foundation/preview.json');
    if (file) preview = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) { issues.push({code: 'PREVIEW_UNAVAILABLE', message: error.message}); }

  const currentChange=activeTaskId?facts.changes.items.find(change=>change.id===activeTaskId):facts.changes.items.filter(change=>change.deliveryScope).sort((a,b)=>String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || b.id.localeCompare(a.id))[0];
  const observation=captureProjectRoundInputs(root);
  const round=inspectProjectRound(facts,observation,{taskId:currentChange?.id});
  const actualChanges=round.changes.map(change=>({path:change.path,sha256:change.after?.sha256 || null}));
  const resourceImpact=actualChanges.some(change=>[...(preview?.routes || []),...(preview?.assets || [])].some(entry=>entry.file===change.path));
  const applicability=deriveDeliveryApplicability(facts,{change:currentChange,changedInputs:[...changes,...actualChanges,...(resourceImpact?[{path:'package.json'}]:[])]});
  for(const unknown of round.unknown)issues.push({code:'ROUND_UNACCOUNTED_INPUT',path:unknown.path,message:'存在未归属的当前输入，不能由 N/A 或漏报 changes 豁免'});
  if(!['observed','not-applicable'].includes(round.state))issues.push({code:'ROUND_NOT_CURRENT',message:'缺本次完整 round 观察或输入已变化'});
  const contentIntegrity = inspectContentIntegrity(facts, {requireCoverage: true,activeTaskId:currentChange?.deliveryScope?.schemaVersion==='2.0.0'?currentChange.id:null,affectedIds:applicability.factIds});
  const evidenceResults={},acceptanceInputs=[];
  if(!applicability.visual)for(const item of currentChange?.deliveryScope?.items || [])if(item.applicability?.state==='not-applicable') {
    const source=currentChange.deliveryScope.sourceRefs?.find(source=>source.ref===item.applicability.source && item.sourceRefIds?.includes(source.id));
    try {
      const match=source?.ref?.match(/^(.+)#L([1-9][0-9]*)-L([1-9][0-9]*)$/u);
      if(!match)throw new Error('不适用依据需要当前项目文件及精确行范围');
      const file=fileAt(root,match[1]);if(!file)throw new Error('不适用依据文件不存在');
      const bytes=fs.readFileSync(file),lines=bytes.toString('utf8').split('\n');
      if(Number(match[3])<Number(match[2])||Number(match[3])>lines.length)throw new Error('不适用依据行范围无效');
      acceptanceInputs.push({evidenceId:`applicability:${item.requirementId}`,path:match[1],sha256:sha256(bytes)});
    }catch(error){issues.push({code:'APPLICABILITY_SOURCE_INVALID',requirementId:item.requirementId,message:error.message});}
  }

  let sourceDigest;
  for(const change of facts.changes.items) for(const evidence of change.evidenceIndex || []) {
    const inputs=[];
    for(const asset of [...facts.components.items,...facts.pages.items].filter(a=>a.id===evidence.subject?.definitionId))for(const edge of factImplementationInputs(asset)) {
      try {const file=fileAt(root,edge.to);inputs.push({kind:edge.kind,path:edge.to,sha256:file?sha256(fs.readFileSync(file)):null});}
      catch {inputs.push({kind:edge.kind,path:edge.to,sha256:null});}
    }
    const edges=[...facts.components.items,...facts.pages.items].flatMap(asset=>factImplementationInputs(asset));
    const impact=inspectEvidenceImpact({evidence,edges,changedInputs:inputs.filter(input=>edges.some(edge=>edge.to===input.path&&edge.sha256!==input.sha256)).map(input=>input.path),current:{taskId:change.id,scopeRevision:change.deliveryScope?.revision}});
    const expectedSourceDigest=['browser-observation','semantic-review'].includes(evidence.kind)?(sourceDigest ??= sha256(canonicalStringify(inspectSyncSources(root)))):undefined;
    let reportIdentity=null;
    try {
      const bytes=fs.readFileSync(resolveEvidencePath(root,evidence.report.path)),report=JSON.parse(bytes);
      reportIdentity={sha256:sha256(bytes),semanticSources:(report.semanticInputs?.sources || []).map(source=>({path:source.path,sha256:(()=>{try{return sha256(fs.readFileSync(resolveEvidencePath(root,source.path)));}catch{return null;}})()})),analysisInput:evidence.kind==='source-analysis'?inspectSourceInputIdentity({project:root,entryRoots:report.analysis?.entryRoots}).inputDigest:null};
    }catch{reportIdentity={state:'unavailable'};}
    acceptanceInputs.push({evidenceId:evidence.evidenceId,inputs,sourceDigest:expectedSourceDigest || null,reportIdentity});
    let checked=inputs.length?inspectEvidenceReport({project:root,installationRoot,evidence,expectedInputs:inputs,expectedScopeDigest:sha256(canonicalStringify(change.deliveryScope)),expectedSubjectDigest:evidenceSubjectFingerprint([...facts.components.items,...facts.pages.items].find(a=>a.id===evidence.subject?.definitionId)),...(expectedSourceDigest?{expectedSourceDigest}:{}),...(evidence.kind==='source-analysis'?{expectedEnvironment:{platform:process.platform,architecture:process.arch,node:process.versions.node}}:{})}):{state:'unknown',reason:'缺精确依赖输入'};
    if(impact.state!=='fresh' && checked.state==='verified')checked={state:impact.state,reason:impact.reasons.join('；')};
    if(checked.state==='verified' && evidence.kind==='source-analysis') {
      try{const identity=inspectSourceInputIdentity({project:root,entryRoots:checked.report.analysis.entryRoots});if(identity.inputDigest!==evidence.artifactDigest||evidence.runnerVersion!==analyzerVersion||evidence.verifierVersion!=='foundation-definition/1.1.0')checked={state:'stale',reason:'分析输入或验证器已变化'};}
      catch(error){checked={state:'unknown',reason:error.message};}
    }
    evidenceResults[evidence.evidenceId]=checked;
  }
  const structureInventory=inspectProjectStructure(root);
  const structureCoverage=inspectStructureCoverage(facts,structureInventory);
  const assessment=assessDelivery(facts,{contentIntegrity,evidenceResults,structureCoverage,activeTaskId,changedInputs:[...changes,...actualChanges,...(resourceImpact?[{path:'package.json'}]:[])]});
  const taskAssessment=structuredClone(assessment),acceptanceCandidates=[];
  const currentFiles=new Map(observation.files.map(file=>[file.path,file]));
  for(const task of facts.changes.items.filter(item=>item.deliveryScope?.schemaVersion==='2.0.0')) {
    const candidateAssessment=assessDelivery(facts,{evidenceResults,structureCoverage,activeTaskId:task.id});
    const scoped=new Set(task.deliveryScope.items.flatMap(item=>item.factIds || []));
    const owners=[...facts.pages.items,...facts.components.items].filter(item=>scoped.has(item.id));
    if(candidateAssessment.aggregate!=='passed'||!owners.length||round.unknown.length||!owners.every(owner=>hasCurrentOwnerEvidence(owner.id,task,evidenceResults)))continue;
    const files=[...new Set(owners.flatMap(item=>[item.implementationMapping,...factImplementationInputs(item).map(edge=>edge.to)]))].filter(file=>currentFiles.has(file)).map(file=>({path:file,sha256:currentFiles.get(file).sha256}));
    const removals=[];
    for(const entry of task.evidenceIndex || []) {
      const checked=evidenceResults[entry.evidenceId];
      if(entry.kind!=='semantic-review'||checked?.state!=='verified'||checked.result!=='passed'||!owners.some(owner=>owner.id===entry.subject?.definitionId))continue;
      for(const removal of checked.report.semanticInputs?.removals || [])if(!currentFiles.has(removal.path)) {
        removals.push(removal);files.push({path:removal.path,sha256:null});
      }
    }
    const proof={taskId:task.id,...(removals.length?{removals}:{}),scopeDigest:sha256(canonicalStringify(task.deliveryScope)),factIds:owners.map(item=>item.id),files,evidence:(task.evidenceIndex || []).map(entry=>({evidenceId:entry.evidenceId,report:entry.report}))};
    acceptanceCandidates.push({...proof,proofDigest:sha256(canonicalStringify(proof))});
  }
  const acceptedIds=new Set(acceptanceCandidates.flatMap(record=>record.factIds));
  if(facts.pages.items.length&&facts.pages.items.every(page=>acceptedIds.has(page.id))){
    const files=observation.files.filter(file=>file.kind==='runtime-config'||observation.previewResources.includes(file.path)).map(({path,sha256})=>({path,sha256}));
    const proof={taskId:'@preview-coverage',files,proofs:acceptanceCandidates.map(record=>record.proofDigest)};acceptanceCandidates.push({...proof,proofDigest:sha256(canonicalStringify(proof))});
  }
  const accepted=new Map(acceptanceCandidates.flatMap(record=>record.files.map(file=>[file.path,file.sha256])));
  const pending=new Map(round.pendingChanges.map(change=>[change.path,change]));
  for(const receipt of facts.project.contextLifecycle?.acceptances || [])for(const file of receipt.files)if((!accepted.has(file.path)||accepted.get(file.path)!==(currentFiles.get(file.path)?.sha256 || null))&&!pending.has(file.path))pending.set(file.path,{path:file.path,before:file,after:currentFiles.get(file.path)||null,origin:'acceptance-invalidated',history:[{proofDigest:receipt.proofDigest}]});
  const projectPendingChanges=[...pending.values()].filter(change=>!accepted.has(change.path)||accepted.get(change.path)!==(currentFiles.get(change.path)?.sha256 || null));
  if(projectPendingChanges.length)issues.push({code:'PROJECT_UNACCEPTED_CHANGES',message:'项目存在尚未接受的实际变化；当前任务完成不等于项目已交付',paths:projectPendingChanges.map(change=>change.path)});
  requirePreview ||= applicability.visual;
  if (requirePreview && preview) for (const message of inspectPreviewConfig(root,{facts}).errors) issues.push({code:'PREVIEW_INVALID',message});
  const supported = preview?.schemaVersion === '0.1.0' && preview.mode === 'local-static' && Array.isArray(preview.routes) && Array.isArray(preview.assets);
  for (const message of validateFacts(facts, {projectRoot: root, ...(requirePreview && supported ? {previewConfig: preview} : {})})) issues.push({code: 'FACT_REFERENCE_INVALID', message});
  for (const asset of assets.filter(item => item.implementationMapping && (currentChange?.deliveryScope?.schemaVersion==='2.0.0' ? applicability.factIds.includes(item.id) || seen.has(item.implementationMapping) : !changes.length || seen.has(item.implementationMapping)))) {
    try {
      const file = fileAt(root, asset.implementationMapping);
      if (!file) issues.push({code: 'SOURCE_MISSING', assetId: asset.id, path: asset.implementationMapping});
      else if (!asset.implementationSha256) issues.push({code: 'SOURCE_DIGEST_NOT_RECORDED', assetId: asset.id, path: asset.implementationMapping});
      else if (sha256(fs.readFileSync(file)) !== asset.implementationSha256) issues.push({code: 'SOURCE_STALE', assetId: asset.id, path: asset.implementationMapping});
    } catch (error) { issues.push({code: 'SOURCE_UNSAFE', assetId: asset.id, message: error.message}); }
  }
  for (const change of changes) {
    const file = fileAt(root, change.path), actual = file ? sha256(fs.readFileSync(file)) : null;
    if (actual !== change.sha256) issues.push({code: 'CHANGE_INPUT_STALE', path: change.path, expected: change.sha256, actual});
    const mappings = assets.filter(item => item.implementationMapping === change.path);
    if (change.sha256 !== null && !mappings.length) issues.push({code: 'SOURCE_NOT_REGISTERED', path: change.path});
    if (change.sha256 === null && mappings.length) issues.push({code: 'DELETED_SOURCE_STILL_REFERENCED', path: change.path});
  }
  if (requirePreview && !supported) issues.push({code: 'PREVIEW_NOT_CONNECTED', message: '当前可视页面交付需要工作台预览；保留原技术栈，先核实支持方式'});
  if (requirePreview && supported) for (const entry of [...preview.routes, ...preview.assets]) {
    try { if (!fileAt(root, entry.file)) issues.push({code: 'PREVIEW_SOURCE_MISSING', path: entry.file}); }
    catch (error) { issues.push({code: 'PREVIEW_SOURCE_UNSAFE', message: error.message}); }
  }
  const taskReady=taskAssessment.aggregate==='passed'&&!issues.some(issue=>['APPLICABILITY_SOURCE_INVALID','CHANGE_INPUT_STALE','SOURCE_MISSING','SOURCE_STALE','SOURCE_UNSAFE','SOURCE_DIGEST_NOT_RECORDED','FACT_REFERENCE_INVALID'].includes(issue.code));
  assessment.task={taskId:taskAssessment.taskId,state:taskReady?'passed':taskAssessment.aggregate==='passed'?'pending':taskAssessment.aggregate};
  assessment.project={state:issues.length?'pending':assessment.aggregate,pendingPaths:projectPendingChanges.map(change=>change.path)};
  if(issues.length){assessment.issues=[...(assessment.issues || []),...issues.map(issue=>({...issue,priority:'P1',dimension:'scope'}))];assessment.aggregate='pending';assessment.scope={...(assessment.scope || {}),state:'pending'};}
  return {schemaVersion: '1.0.0', project: root, objectIdentities:(facts.project.contextLifecycle?.identities || []).map(identity=>({...identity,state:identity.state==='active'&&round.current?.end?.files?.some(file=>file.path===identity.sourceFile&&file.physical===identity.sourcePhysical)&&round.physicalDigest===round.current.end.physicalDigest?'active':'unverified'})), state: issues.length ? 'sync-pending' : 'consistent', summary: issues.length ? '代码完成，Foundation同步待完成' : '源码字节、事实引用与所要求的预览映射一致', changes, issues, contentIntegrity, structureCoverage, round,taskReady,taskAssessment,projectPendingChanges,acceptanceCandidates,projectDeliveryReady:!issues.length&&assessment.aggregate==='passed', assessment, evidenceResults, acceptanceInputs, deliveryReady: !issues.length && assessment.aggregate==='passed', preview: {required: requirePreview, state: supported ? assessment.runtime.state==='passed'?'verified-current-capabilities':'configured-not-browser-verified' : 'unavailable'}, semanticAcceptance: 'not-verified', mutationPerformed: false};
}

export function inspectProjectDelivery({installationRoot, project, changes, requirePreview = false, activeTaskId = null} = {}) {
  const rules = readCurrentFoundationRules({installationRoot, project});
  // A renamed/deleted source can invalidate existing facts. This read-only
  // diagnostic must still expose that pending synchronization for an already
  // adopted, identity-checked project; it does not make the rules executable.
  if (!rules.projectRulesReady && !rules.adoption) return {state: 'not-ready', summary: '项目尚未就绪，不能宣称 Foundation 制作交付完成', nextStep: rules.nextStep, mutationPerformed: false};
  return {...inspectProjectDeliveryFiles({project, installationRoot,changes, requirePreview,activeTaskId}), currentIdentityHash: rules.currentIdentityHash, ruleVersion: rules.ruleVersion};
}
