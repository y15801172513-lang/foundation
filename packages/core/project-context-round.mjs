import {readFacts} from './facts.mjs';
import {inspectProjectDeliveryFiles} from './project-delivery.mjs';
import {beginObjectLifetimes,finishObjectLifetimes} from './object-identity.mjs';
import {inspectProjectStructure} from './project-coverage.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';
import {sourceSemanticDigest} from './source-syntax.mjs';
export {sourceSemanticDigest} from './source-syntax.mjs';
import {realProject,resolveProjectFile} from './path-boundary.mjs';
import {sha256,canonicalStringify} from './install-contract.mjs';
import {signTrustedPayload,verifyTrustedPayload} from './trusted-authority.mjs';
const digest=value=>sha256(canonicalStringify(value));
const runtime=/\.(?:[cm]?[jt]sx?|html|css|vue|svelte|swift|kt|dart|json|svg|png|jpe?g|webp|woff2?)$/iu;
const ignored=new Set(['.git','.foundation','.tmp','node_modules']);
export function captureProjectRoundInputs(project) {
  const root=realProject(project),files=[],unknown=[],evidencePaths=new Set();let previewResources=[];try{const config=JSON.parse(fs.readFileSync(resolveProjectFile(root,'.foundation/preview.json')));previewResources=[...(config.routes || []),...(config.assets || [])].map(entry=>entry.file);}catch{}
  try{const changes=JSON.parse(fs.readFileSync(resolveProjectFile(root,'.foundation/facts/changes.json')));for(const record of changes.items || [])for(const evidence of record.evidenceIndex || []){
    try{const file=resolveProjectFile(root,evidence.report.path),bytes=fs.readFileSync(file);if(sha256(bytes)!==evidence.report.sha256)continue;const {foundationReceipt,...report}=JSON.parse(bytes),{integrity,...receipt}=foundationReceipt || {};if(receipt.project===root&&receipt.reportDigest===digest(report)&&verifyTrustedPayload(receipt,integrity))evidencePaths.add(evidence.report.path);}catch{}
  }}catch{}

  const walk=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(ignored.has(entry.name))continue;const file=path.join(directory,entry.name),relative=path.relative(root,file).split(path.sep).join('/');if(entry.isSymbolicLink()){unknown.push({path:relative,reason:'symbolic-link'});continue;}if(entry.isDirectory()){walk(file);continue;}if(evidencePaths.has(relative))continue;if(!entry.isFile()){unknown.push({path:relative,reason:'non-file'});continue;}const before=fs.statSync(file),bytes=fs.readFileSync(file),after=fs.statSync(file);if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('枚举期间文件变化，保留旧完整代');files.push({path:relative,sha256:sha256(bytes),semanticSha256:sourceSemanticDigest(relative,bytes),kind:/^(?:package(?:-lock)?|[jt]sconfig)\.json$/u.test(relative)?'runtime-config':runtime.test(relative)?'runtime-candidate':/\.(?:md|txt|rst)$/iu.test(relative)||/^(?:LICENSE|NOTICE|\.gitignore|\.npmrc)$/u.test(relative)?'document':'unknown',physical:digest({dev:after.dev,ino:after.ino,birth:after.birthtimeMs,ctime:after.ctimeMs})});}};walk(root);
  const managed=path.join(root,'.foundation/preview.json');if(fs.existsSync(managed)){const file=resolveProjectFile(root,'.foundation/preview.json'),bytes=fs.readFileSync(file);files.push({path:'.foundation/preview.json',sha256:sha256(bytes),semanticSha256:sha256(bytes),kind:previewResources.length?'runtime-config':'configuration-empty',physical:sha256(bytes)});}
  // A textual extension is not an exclusion when runtime ownership or a source
  // reference proves that the bytes are consumed by the product.
  const runtimeDependencies=new Set(previewResources);
  for(const name of ['pages','components','interactions','motions','design-tokens'])try{const document=JSON.parse(fs.readFileSync(resolveProjectFile(root,`.foundation/facts/${name}.json`)));for(const item of document.items || [])for(const dependency of [item.implementationMapping,...(item.assetModel?.implementationInputs || []).map(edge=>edge.to),...(item.previewBinding?.inputs || []).map(input=>input.path)])if(dependency)runtimeDependencies.add(dependency);}catch{}
  for(const input of files.filter(file=>file.kind==='runtime-candidate'&&/\.(?:[cm]?[jt]sx?|html|css|vue|svelte)$/u.test(file.path))){
    const text=fs.readFileSync(resolveProjectFile(root,input.path),'utf8');
    for(const match of text.matchAll(/["'`]([^"'`\n]+\.(?:md|txt|rst))(?:[?#][^"'`\n]*)?["'`]/gu)){
      const reference=match[1];if(/^(?:[a-z]+:|\/\/)/iu.test(reference))continue;
      runtimeDependencies.add(path.posix.normalize(reference.startsWith('/')?reference.slice(1):path.posix.join(path.posix.dirname(input.path),reference)));
    }
  }
  for(const file of files)if(file.kind==='document'&&runtimeDependencies.has(file.path))file.kind='runtime-candidate';
  files.sort((a,b)=>a.path.localeCompare(b.path));
  return {schemaVersion:'1.0.0',files,unknown,previewResources,byteDigest:digest(files.map(({path,sha256})=>({path,sha256}))),semanticDigest:digest(files.map(({path,semanticSha256,kind})=>({path,semanticSha256,kind}))),physicalDigest:digest(files.map(({path,physical})=>({path,physical})))};
}
export function diffRoundInputs(before,after) {
  const old=new Map((before?.files || []).map(file=>[file.path,file])),next=new Map(after.files.map(file=>[file.path,file]));
  return [...new Set([...old.keys(),...next.keys()])].sort((a,b)=>a.localeCompare(b)).flatMap(path=>{const a=old.get(path),b=next.get(path);if(a?.sha256===b?.sha256&&a?.physical===b?.physical)return [];return [{path,kind:!a?'added':!b?'deleted':a.sha256===b.sha256?'physical-only':a.semanticSha256===b.semanticSha256?'bytes-only':'semantic',inputKind:b?.kind || a.kind,before:a || null,after:b || null}];});
}
const nonRuntime=file=>['document','configuration-empty'].includes(file?.kind);
export function advanceProjectObservation(previous,observation,{origin='read'}={}) {
  const lifecycle=structuredClone(previous || {schemaVersion:'1.0.0',rounds:[],currentRoundId:null});
  const prior=lifecycle.lastObservation || lifecycle.rounds?.find(round=>round.id===lifecycle.currentRoundId)?.end;
  const pending=new Map((lifecycle.pendingChanges || []).map(change=>[change.path,change]));
  const differences=diffRoundInputs(prior || {files:[]},observation);
  for(const change of differences){
    if(change.kind==='physical-only'||nonRuntime(change.after || change.before))continue;
    const old=pending.get(change.path),event={origin,before:change.before?.sha256 || null,after:change.after?.sha256 || null,observation:observation.byteDigest};
    pending.set(change.path,{...change,before:old?old.before:change.before,origin:old?.origin || (prior?origin:'import-pending'),history:[...(old?.history || []),event]});
  }
  lifecycle.pendingChanges=[...pending.values()].sort((a,b)=>a.path.localeCompare(b.path));
  lifecycle.exclusions=observation.files.filter(nonRuntime).map(file=>({path:file.path,sha256:file.sha256,rule:file.kind==='document'?'non-runtime-document/1':'empty-preview-registry/1'}));
  lifecycle.lastObservation=observation;
  return lifecycle;
}
export function projectRuntimeDigest(observation){return digest(observation.files.filter(file=>!nonRuntime(file)).map(({path,sha256})=>({path,sha256})));}
export function inspectProjectRound(facts,observation,{taskId=null}={}) {
  const lifecycle=advanceProjectObservation(facts.project?.contextLifecycle,observation),current=lifecycle.rounds?.find(round=>round.id===lifecycle.currentRoundId);
  const records=['pages','components','interactions','motions','design-tokens','relations'].flatMap(kind=>facts[kind]?.items || []),known=new Set(records.flatMap(record=>[record.implementationMapping,...(record.sourceStructure?.inputs || []).map(input=>input.path),...(record.assetModel?.implementationInputs || []).map(edge=>edge.to)]).filter(Boolean));
  for(const file of observation.previewResources || [])known.add(file);
  const unaccounted=observation.files.filter(file=>!nonRuntime(file)&&file.kind!=='runtime-config'&&!known.has(file.path));
  const changes=current?diffRoundInputs(current.baseline,observation):[];
  const unknown=[...(lifecycle.identities || []).filter(identity=>['reserved','unverified'].includes(identity.state)||identity.reason==='retired-birth-still-in-source'||identity.state==='active'&&!observation.files.some(file=>file.path===identity.sourceFile&&file.physical===identity.sourcePhysical)).map(identity=>({path:identity.sourceFile,reason:'object-continuity-unverified',incarnation:identity.incarnation})),...observation.unknown,...unaccounted.map(file=>({path:file.path,reason:'unregistered-runtime-input'}))];
  const last=facts.project?.contextLifecycle?.lastObservation || current?.end;
  const fresh=last?.byteDigest===observation.byteDigest&&last?.physicalDigest===observation.physicalDigest;
  const state=unknown.length?'pending':!last?(observation.files.every(nonRuntime)?'not-applicable':'untracked'):!fresh||current?.state==='active'?'pending':'observed';
  return {state,roundId:current?.id || null,taskId:current?.taskId || null,changes,pendingChanges:lifecycle.pendingChanges,exclusions:lifecycle.exclusions,unknown,byteDigest:observation.byteDigest,semanticDigest:observation.semanticDigest,physicalDigest:observation.physicalDigest,baseline:current?.baseline || null,current:current || null,mutationPerformed:false};
}
export function prepareRoundTransition({project,facts,taskId,action,identityActions=[],installationRoot=null,now=Date.now()}) {
  if(!['begin','finish','observe'].includes(action)||!taskId)throw new Error('round 需 begin/finish 与明确 taskId');
  const observation=captureProjectRoundInputs(project),previous=facts.project.contextLifecycle || {schemaVersion:'1.0.0',rounds:[],currentRoundId:null};
  const lifecycle=advanceProjectObservation(previous,observation,{origin:action==='begin'?'preflight':action}),current=lifecycle.rounds.find(round=>round.id===lifecycle.currentRoundId);
  if(action==='begin') {
    if(current?.state==='active'){if(current.taskId!==taskId)throw new Error('另一轮任务尚未结束，不能覆盖其基线');if(identityActions.length)throw new Error('已有 round 起点；身份意图不能事后追加');}
    else {const round={id:crypto.randomUUID(),taskId,state:'active',baseline:observation,startedAt:new Date(now).toISOString()};lifecycle.rounds.push(round);lifecycle.currentRoundId=round.id;lifecycle.identities=beginObjectLifetimes(finishObjectLifetimes(lifecycle.identities || [],inspectProjectStructure(project).objects,observation.files),identityActions);}
  } else if(action==='finish') {
    if(identityActions.length)throw new Error('身份连续性意图必须在 round 开始时声明，不能事后补造');
    if(!current||current.taskId!==taskId)throw new Error('结束前缺匹配的 round 起点');
    if(current.end?.physicalDigest!==observation.physicalDigest||current.state!=='observed'){current.end=observation;current.changes=diffRoundInputs(current.baseline,observation);current.state='observed';current.observedAt=new Date(now).toISOString();lifecycle.identities=finishObjectLifetimes(lifecycle.identities || [],inspectProjectStructure(project).objects,observation.files);}
  }
  if(action==='observe'){
    const evaluated=inspectProjectDeliveryFiles({project,installationRoot});
    // Runtime evidence needs the installation context and is settled by sync's
    // dedicated acceptance transition below, never by claimed status strings.
    const valid=evaluated.acceptanceCandidates || [];
    lifecycle.acceptances=[...new Map([...(lifecycle.acceptances || []),...valid].map(record=>[record.taskId,record])).values()];
    const accepted=new Map(valid.flatMap(record=>record.files.map(file=>[file.path,file.sha256])));
    lifecycle.pendingChanges=lifecycle.pendingChanges.filter(change=>!accepted.has(change.path)||accepted.get(change.path)!==(change.after?.sha256 || null));
  }
  const content={...facts.project,contextLifecycle:lifecycle};
  const value={purpose:'foundation-project-round/1',project:realProject(project),action,taskId,factsDigest:digest(facts),expectedSha256:sha256(fs.readFileSync(resolveProjectFile(project,'.foundation/facts/project.json'))),observation,content};
  return {...value,integrity:signTrustedPayload(value)};
}
export function verifyRoundTransition(project,transition) {
  const {integrity,...value}=transition || {};
  if(value.purpose!=='foundation-project-round/1'||value.project!==realProject(project)||!verifyTrustedPayload(value,integrity))throw new Error('round 观察不是程序签发的当前项目输入');
  if(value.factsDigest!==digest(readFacts(project)))throw new Error('round 评估后的事实发生漂移');
  const actual=captureProjectRoundInputs(project);
  if(actual.byteDigest!==value.observation.byteDigest||actual.physicalDigest!==value.observation.physicalDigest)throw new Error('round 输入在提交前漂移');
  if(sha256(fs.readFileSync(resolveProjectFile(project,'.foundation/facts/project.json')))!==value.expectedSha256)throw new Error('round 项目事实已被并发修改');
  return value;
}
