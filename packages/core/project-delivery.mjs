import {inspectContentIntegrity} from './content-integrity.mjs';
import {inspectPreviewConfig} from './preview-config.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {sha256,canonicalStringify} from './install-contract.mjs';
import {resolveProjectFile as resolveEvidencePath,realProject} from './path-boundary.mjs';
import {FACT_FILES, readFacts, validateFacts, inspectProjectPreparation} from './facts.mjs';
import {readCurrentFoundationRules} from './rules-delivery.mjs';
import {inspectEvidenceReport,inspectEvidenceImpact,evidenceSubjectFingerprint} from './evidence-impact.mjs';
import {inspectSyncSources} from './source-inventory.mjs';
import {inspectSourceInputIdentity,analyzerVersion} from './source-analysis.mjs';

export const DELIVERY_DIMENSIONS = ['scope','content','definition','runtime','layout'];
const legitimateNa = value => value?.state==='not-applicable' && typeof value.reason==='string' && value.reason.trim() && typeof value.source==='string' && value.source.trim();

// Single owner of product acceptance. The pure assessment consumes separately
// verified observations; no persisted verified/producer string grants a pass.
export function assessDelivery(facts,{contentIntegrity=inspectContentIntegrity(facts,{requireCoverage:true}),evidenceResults={},activeTaskId=null,unresolvedIssues=[]}={}) {
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
  const factIds=new Set(Object.values(facts).flatMap(d=>d?.items || []).map(item=>item.id));
  const scopedIds=new Set((scope.items || []).flatMap(i=>i.factIds || []));
  for(const id of [...(change.affectedAssets || []),...(change.affectedPages || [])])if(!scopedIds.has(id))issues.push({id:`delivery:${change.id}:unscoped:${id}`,dimension:'scope',state:'failed',message:`实际变化 ${id} 缺少本次需求依据`});
  for(const dimension of DELIVERY_DIMENSIONS) {
    const requirements=[];
    for(const item of scope.items || []) {
      if(legitimateNa(item.applicability)) {requirements.push({requirementId:item.requirementId,state:'not-applicable',reason:item.applicability.reason,source:item.applicability.source});continue;}
      if(!item.requiredEvidenceDimensions?.includes(dimension))continue;
      const sources=(item.sourceRefIds || []).map(id=>scope.sourceRefs?.find(s=>s.id===id));
      let state='pending',reason='缺当前输入上的独立验证证据';
      const evidence=(change.evidenceIndex || []).filter(e=>e.subject?.requirementId===item.requirementId && e.dimensions?.includes(dimension) && e.scopeRevision===scope.revision && e.taskId===scope.taskId);
      const observed=evidence.map(e=>({e,...evidenceResults[e.evidenceId]}));
      const supported=observed.filter(x=>x.state==='verified' && !(['runtime','layout'].includes(dimension) && !['browser-observation','renderer-observation'].includes(x.e.kind)));
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
    const state=states.includes('failed')?'failed':states.includes('blocked')?'blocked':states.includes('pending')?'pending':states.includes('passed')?'passed':requirements.length?'not-applicable':'pending';
    dimensions[dimension]={state,requirements};
  }
  if(!contentIntegrity.ready) {dimensions.content.state='pending';issues.push(...contentIntegrity.issues.map(i=>({...i,dimension:'content',state:'pending'})));}
  if(issues.some(i=>i.dimension==='scope'&&i.state==='failed'))dimensions.scope.state='failed';
  const states=Object.values(dimensions).map(d=>d.state);
  const aggregate=states.includes('failed') || issues.some(i=>i.priority==='P0'||i.priority==='P1')?'failed':states.includes('blocked')?'blocked':states.includes('pending')?'pending':'passed';
  return {schemaVersion:'1.0.0',taskId:scope.taskId,scopeRevision:scope.revision,...dimensions,aggregate,issues,contentIntegrity,humanAcceptance:'not-verified'};
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

export function inspectProjectDeliveryFiles({project, installationRoot=null,changes = [], requirePreview = false} = {}) {
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
  if (preview) for (const message of inspectPreviewConfig(root, {facts}).errors) issues.push({code: 'PREVIEW_INVALID', message});
  const contentIntegrity = inspectContentIntegrity(facts, {requireCoverage: true});
  const evidenceResults={},acceptanceInputs=[];
  let sourceDigest;
  for(const change of facts.changes.items) for(const evidence of change.evidenceIndex || []) {
    const inputs=[];
    for(const asset of facts.components.items.filter(a=>a.id===evidence.subject?.definitionId))for(const edge of asset.assetModel?.implementationInputs || []) {
      try {const file=fileAt(root,edge.to);inputs.push({kind:edge.kind,path:edge.to,sha256:file?sha256(fs.readFileSync(file)):null});}
      catch {inputs.push({kind:edge.kind,path:edge.to,sha256:null});}
    }
    const edges=facts.components.items.flatMap(asset=>asset.assetModel?.implementationInputs || []);
    const impact=inspectEvidenceImpact({evidence,edges,changedInputs:inputs.filter(input=>edges.some(edge=>edge.to===input.path&&edge.sha256!==input.sha256)).map(input=>input.path),current:{taskId:change.id,scopeRevision:change.deliveryScope?.revision}});
    const expectedSourceDigest=['browser-observation','semantic-review'].includes(evidence.kind)?(sourceDigest ??= sha256(canonicalStringify(inspectSyncSources(root)))):undefined;
    let reportIdentity=null;
    try {
      const bytes=fs.readFileSync(resolveEvidencePath(root,evidence.report.path)),report=JSON.parse(bytes);
      reportIdentity={sha256:sha256(bytes),semanticSources:(report.semanticInputs?.sources || []).map(source=>({path:source.path,sha256:(()=>{try{return sha256(fs.readFileSync(resolveEvidencePath(root,source.path)));}catch{return null;}})()})),analysisInput:evidence.kind==='source-analysis'?inspectSourceInputIdentity({project:root,entryRoots:report.analysis?.entryRoots}).inputDigest:null};
    }catch{reportIdentity={state:'unavailable'};}
    acceptanceInputs.push({evidenceId:evidence.evidenceId,inputs,sourceDigest:expectedSourceDigest || null,reportIdentity});
    let checked=inputs.length?inspectEvidenceReport({project:root,installationRoot,evidence,expectedInputs:inputs,expectedScopeDigest:sha256(canonicalStringify(change.deliveryScope)),expectedSubjectDigest:evidenceSubjectFingerprint(facts.components.items.find(a=>a.id===evidence.subject?.definitionId)),...(expectedSourceDigest?{expectedSourceDigest}:{}),...(evidence.kind==='source-analysis'?{expectedEnvironment:{platform:process.platform,architecture:process.arch,node:process.versions.node}}:{})}):{state:'unknown',reason:'缺精确依赖输入'};
    if(impact.state!=='fresh' && checked.state==='verified')checked={state:impact.state,reason:impact.reasons.join('；')};
    if(checked.state==='verified' && evidence.kind==='source-analysis') {
      try{const identity=inspectSourceInputIdentity({project:root,entryRoots:checked.report.analysis.entryRoots});if(identity.inputDigest!==evidence.artifactDigest||evidence.runnerVersion!==analyzerVersion||evidence.verifierVersion!=='foundation-definition/1.1.0')checked={state:'stale',reason:'分析输入或验证器已变化'};}
      catch(error){checked={state:'unknown',reason:error.message};}
    }
    evidenceResults[evidence.evidenceId]=checked;
  }
  const assessment=assessDelivery(facts,{contentIntegrity,evidenceResults});
  const supported = preview?.schemaVersion === '0.1.0' && preview.mode === 'local-static' && Array.isArray(preview.routes) && Array.isArray(preview.assets);
  for (const message of validateFacts(facts, {projectRoot: root, ...(requirePreview && supported ? {previewConfig: preview} : {})})) issues.push({code: 'FACT_REFERENCE_INVALID', message});
  for (const asset of assets.filter(item => item.implementationMapping && (!changes.length || seen.has(item.implementationMapping)))) {
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
  return {schemaVersion: '1.0.0', project: root, state: issues.length ? 'sync-pending' : 'consistent', summary: issues.length ? '代码完成，Foundation同步待完成' : '源码字节、事实引用与所要求的预览映射一致', changes, issues, contentIntegrity, assessment, evidenceResults, acceptanceInputs, deliveryReady: !issues.length && assessment.aggregate==='passed', preview: {required: requirePreview, state: supported ? 'configured-not-browser-verified' : 'unavailable'}, semanticAcceptance: 'not-verified', mutationPerformed: false};
}

export function inspectProjectDelivery({installationRoot, project, changes, requirePreview = false} = {}) {
  const rules = readCurrentFoundationRules({installationRoot, project});
  // A renamed/deleted source can invalidate existing facts. This read-only
  // diagnostic must still expose that pending synchronization for an already
  // adopted, identity-checked project; it does not make the rules executable.
  if (!rules.projectRulesReady && !rules.adoption) return {state: 'not-ready', summary: '项目尚未就绪，不能宣称 Foundation 制作交付完成', nextStep: rules.nextStep, mutationPerformed: false};
  return {...inspectProjectDeliveryFiles({project, installationRoot,changes, requirePreview}), currentIdentityHash: rules.currentIdentityHash, ruleVersion: rules.ruleVersion};
}
