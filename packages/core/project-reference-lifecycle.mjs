import {runtimeObservationObjects} from './object-identity.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {realProject,resolveProjectFile} from './path-boundary.mjs';
import {readFacts} from './facts.mjs';
import {inspectProjectAuthority} from './project-authority.mjs';
import {prepareInspectorUpgradePlan} from './inspector-upgrade-plan.mjs';
import {synchronizeProject} from './project-sync.mjs';
import {captureProjectRoundInputs} from './project-context-round.mjs';
import {prepareObjectReferences} from './project-revisions.mjs';
import {inspectProjectStructure} from './project-coverage.mjs';
import {verifyWebPreviewBuild} from './web-preview-build.mjs';
import {executeProjectTransaction,withSerializedProjectTransactions} from './project-transaction.mjs';
import {sha256,canonicalStringify} from './install-contract.mjs';
import {signTrustedPayload,verifyTrustedPayload} from './trusted-authority.mjs';

const digest=value=>sha256(canonicalStringify(value));
function authority(project,installationRoot) {
  const root=realProject(project),state=inspectProjectAuthority(root,{installationRoot});
  if(state.state!=='enabled'||!state.agreement||state.continuousSync?.state!=='active')throw new Error('对象生命周期需要当前项目绑定与有效持续同步授权');
  return {root,projectId:state.projectId};
}
function target(root,relative) {
  if(!relative||path.isAbsolute(relative)||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('生命周期文件路径无效');
  let cursor=root;
  for(const part of relative.split('/')) {
    cursor=path.join(cursor,part);
    const stat=fs.lstatSync(cursor,{throwIfNoEntry:false});
    if(stat?.isSymbolicLink())throw new Error('生命周期拒绝符号链接路径');
  }
  return cursor;
}
function write(root,relative,bytes,mode=0o600) {
  const file=target(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,bytes,{mode});fs.chmodSync(file,mode);
}
function requireSuccess(result) {
  if(['failed','conflict','stopped','in-progress'].includes(result.state))throw new Error('身份同步未完成：'+JSON.stringify(result.error || result.recovery || result));
  return result;
}

// Exact identity-only adaptation changes source offsets, never copied runtime
// data or document cursors. A missing/ambiguous successor aborts the transaction.
export function preserveAdaptedRuntimeObservations(before,after) {
  if(!Object.keys(before?.runtimeSnapshots || {}).length)return after;
  if(before.contentVersion!==after.contentVersion)throw new Error('身份适配未保留有效内容版本，不能继承运行观察');
  const snapshots=structuredClone(before.runtimeSnapshots);
  const adapt=object=>{
    const matches=after.objects.filter(source=>source.pageId===object.pageId&&source.persistentId===object.persistentId&&source.generation===object.generation&&source.tag===object.tag&&(source.instanceKey===object.instanceKey||source.dynamicInstances&&source.instanceKey===null));
    if(matches.length!==1)throw new Error('身份适配后的运行对象缺少唯一源码继承');
    const source=matches[0];
    return {...object,...Object.fromEntries(['file','line','offset','sha256','mode','sourceIdentityPhysical','sourcePhysical'].map(key=>[key,source[key]]))};
  };
  for(const snapshot of Object.values(snapshots)){
    snapshot.objects=(snapshot.objects || []).map(adapt);
    for(const observation of Object.values(snapshot.observations || {}))observation.objects=(observation.objects || []).map(adapt);
  }
  return {...after,runtimeSnapshots:snapshots};
}

// This is an explicit source-edit operation, never invoked by a GET or merely
// by granting continuous facts permission. The task must have source authority.
export function applyInspectorUpgrade(options) {
  if(options.sourceWriteAuthorized!==true)throw new Error('源码身份适配需要本任务已有的明确源码修改授权');
  const {root}=authority(options.project,options.installationRoot);
  return withSerializedProjectTransactions({stateRoot:target(root,'.foundation/backups/reference-transactions')},()=>applyInspectorUpgradeUnlocked(options));
}
function applyInspectorUpgradeUnlocked({project,installationRoot,sourceWriteAuthorized=false,expectedPlan,reviewedBridgeFiles=[]}) {
  const {root}=authority(project,installationRoot);
  if(sourceWriteAuthorized!==true)throw new Error('源码身份适配需要本任务已有的明确源码修改授权');
  const plan=prepareInspectorUpgradePlan({project:root,installationRoot});
  if(!expectedPlan||digest(plan)!==digest(expectedPlan))throw new Error('身份适配计划已变化；重新读取精确计划');
  if(!Array.isArray(reviewedBridgeFiles)||reviewedBridgeFiles.some(file=>!plan.bridge.files.some(item=>item.path===file)))throw new Error('桥接审阅文件不属于当前精确计划');
  const bridges=plan.bridge.files.filter(file=>reviewedBridgeFiles.includes(file.path)&&file.state!=='current');
  if(!plan.files.length&&!bridges.length)return {state:'unchanged',pending:plan.pending,mutationPerformed:false};
  const files=[...plan.files.map(file=>({path:file.path,sha256:sha256(fs.readFileSync(target(root,file.path)))})),...bridges.map(file=>({path:file.path,sha256:file.beforeSha256}))];
  const taskId='identity-adapt-'+crypto.randomUUID(),planHash=digest(plan);
  const beforeInputs=captureProjectRoundInputs(root),beforeFacts=readFacts(root),priorEquivalences=beforeFacts.project.contextLifecycle?.sourceEquivalences || [];
  return executeProjectTransaction({operationId:taskId,operation:'inspector-source-adaptation',planHash,
    expectedBeforeState:{files},recoveryPolicy:{objectReferences:true},stateRoot:path.join(root,'.foundation/backups/reference-transactions'),
    scopes:[{root,paths:[...files.map(file=>file.path),'.foundation/facts']}],
    consume:()=>{
      authority(root,installationRoot);
      if(files.some(file=>(fs.existsSync(target(root,file.path))?sha256(fs.readFileSync(target(root,file.path))):null)!==file.sha256))throw new Error('适配前源码发生漂移');
      return {sourceWriteAuthorized:true,planHash};
    },
    apply:()=>{
      requireSuccess(synchronizeProject({project:root,installationRoot,roundAction:'begin',taskId,identityActions:plan.identityActions}));
      const identities=readFacts(root).project.contextLifecycle.identities;
      for(const file of plan.files) {
        let text=fs.readFileSync(target(root,file.path),'utf8');
        if(sha256(text)!==file.beforeSha256)throw new Error('适配写入前源码发生漂移');
        for(const edit of [...file.edits].sort((a,b)=>b.offset-a.offset)) {
          const insertion=edit.text ?? Object.entries(edit.attributes).map(([name,value])=>{
            const birth=typeof value==='object'?identities.find(item=>item.objectId===value.objectId&&item.state==='reserved')?.incarnation:value;
            if(!birth)throw new Error('身份适配缺少已登记出生世代');
            return ' '+name+'='+JSON.stringify(birth);
          }).join('');
          text=text.slice(0,edit.offset)+insertion+text.slice(edit.offset);
        }
        write(root,file.path,text,fs.statSync(target(root,file.path)).mode&0o777);
      }
      for(const file of bridges)write(root,file.path,file.content,fs.existsSync(target(root,file.path))?fs.statSync(target(root,file.path)).mode&0o777:0o644);
      const sync=requireSuccess(synchronizeProject({project:root,installationRoot,roundAction:'finish',taskId}));
      if(plan.files.length) {
        // This exact, program-produced edit only inserts identity attributes and
        // forwarding parameters. Preserve the prior effective source version;
        // any later byte edit no longer matches this equivalence witness.
        const facts=readFacts(root),observation=captureProjectRoundInputs(root);
        const equivalents=plan.files.map(file=>{
          const before=beforeInputs.files.find(input=>input.path===file.path),after=observation.files.find(input=>input.path===file.path);
          return {path:file.path,beforeSha256:before.sha256,afterSha256:after.sha256,semanticSha256:priorEquivalences.findLast(item=>item.path===file.path&&item.afterSha256===before.sha256)?.semanticSha256 || before.semanticSha256,source:'exact-identity-adaptation',planHash};
        });
        const lifecycle={...facts.project.contextLifecycle,sourceEquivalences:[...(facts.project.contextLifecycle.sourceEquivalences || []),...equivalents]};
        const content={...facts.project,contextLifecycle:lifecycle};
        lifecycle.objectReferences=preserveAdaptedRuntimeObservations(beforeFacts.project.contextLifecycle?.objectReferences,prepareObjectReferences({...facts,project:content},inspectProjectStructure(root,{installationRoot}),observation.files));
        const transition={purpose:'foundation-project-round/1',project:root,action:'observe',taskId,factsDigest:digest(facts),expectedSha256:sha256(fs.readFileSync(target(root,'.foundation/facts/project.json'))),observation,content};
        requireSuccess(synchronizeProject({project:root,installationRoot,handlerPayload:{documents:[],sources:[],scope:'精确身份注入不改变产品有效内容；保留升级前当前引用',generatedAt:new Date().toISOString(),roundTransition:{...transition,integrity:signTrustedPayload(transition)}}}));
      }
      return {state:'adapted',mutationPerformed:true,pending:plan.pending,sync};
    },verify:()=>{
      const facts=readFacts(root);
      if(plan.identityActions.some(action=>!facts.project.contextLifecycle.identities.some(item=>item.objectId===action.objectId&&item.state==='active')))throw new Error('身份适配后置核验失败');
      return {births:plan.identityActions.length,files:files.length};
    }});
}

export function createObjectReferenceBackup(options) {
  const {root}=authority(options.project,options.installationRoot);
  return withSerializedProjectTransactions({stateRoot:target(root,'.foundation/backups/reference-transactions')},()=>createObjectReferenceBackupUnlocked(options));
}
function createObjectReferenceBackupUnlocked({project,installationRoot}) {
  const {root,projectId}=authority(project,installationRoot),observation=captureProjectRoundInputs(root);
  const facts=readFacts(root),buildFiles=[];
  for(const page of facts.pages.items.filter(page=>page.previewBinding?.producer==='foundation-web-build/1')) {
    const receipt=verifyWebPreviewBuild({project:root,facts,page});
    buildFiles.push(page.previewBinding.receipt.path,...receipt.outputs.map(file=>file.path));
  }
  const files=[...observation.files.map(file=>file.path),...(observation.previewResources || []),...buildFiles,...fs.readdirSync(target(root,'.foundation/facts')).map(name=>'.foundation/facts/'+name)];
  const records=[...new Set(files)].sort().map(relative=>{
    const file=target(root,relative),bytes=fs.readFileSync(file);
    return {path:relative,sha256:sha256(bytes),mode:fs.statSync(file).mode&0o777,bytes:bytes.toString('base64')};
  });
  if(records.reduce((n,file)=>n+file.bytes.length,0)>64*1024*1024)throw new Error('引用备份超过64MiB，未写入');
  const payload={purpose:'foundation-object-reference-backup/1',projectId,sourceDigest:observation.byteDigest,records};
  if(captureProjectRoundInputs(root).byteDigest!==observation.byteDigest||digest(readFacts(root))!==digest(facts)||records.some(record=>sha256(fs.readFileSync(target(root,record.path)))!==record.sha256))throw new Error('备份读取期间输入发生漂移，未签发备份');
  const backup={...payload,integrity:signTrustedPayload(payload)},relative='.foundation/backups/object-references-'+digest(payload)+'.json';
  const file=target(root,relative);
  if(!fs.existsSync(file))write(root,relative,JSON.stringify(backup)+'\n');
  else {
    const {integrity,...existing}=JSON.parse(fs.readFileSync(file));
    if(digest(existing)!==digest(payload)||!verifyTrustedPayload(existing,integrity))throw new Error('同名引用备份内容冲突');
  }
  return {state:'saved',path:relative,sha256:sha256(fs.readFileSync(file)),projectId,files:records.length};
}

export function prepareObjectReferenceRestore({project,installationRoot,backupPath}) {
  const {root,projectId}=authority(project,installationRoot);
  const bytes=fs.readFileSync(target(root,backupPath)),{integrity,...backup}=JSON.parse(bytes);
  if(backup.purpose!=='foundation-object-reference-backup/1'||backup.projectId!==projectId||!verifyTrustedPayload(backup,integrity))throw new Error('引用备份损坏或不属于当前项目');
  if(!Array.isArray(backup.records)||new Set(backup.records.map(file=>file.path)).size!==backup.records.length)throw new Error('引用备份文件集合无效');
  for(const file of backup.records){target(root,file.path);if(sha256(Buffer.from(file.bytes,'base64'))!==file.sha256)throw new Error('引用备份文件摘要不匹配');}
  const current=captureProjectRoundInputs(root),facts=readFacts(root);
  const additions=current.files.filter(file=>!backup.records.some(saved=>saved.path===file.path));
  if(additions.length)throw new Error('恢复与新增文件冲突；保留当前文件并先处理精确冲突');
  const beforeTargets=backup.records.map(record=>{const file=target(root,record.path);return {path:record.path,sha256:fs.existsSync(file)?sha256(fs.readFileSync(file)):null};});
  return {purpose:'foundation-object-reference-restore/1',projectId,project:root,backupPath,backupSha256:sha256(bytes),beforeDigest:current.byteDigest,beforeTargets,factsDigest:digest(facts),files:backup.records.map(({bytes,...record})=>record)};
}

export function restoreObjectReferences(options) {
  if(options.sourceWriteAuthorized!==true)throw new Error('恢复包含源码写入，需要本任务明确恢复授权');
  const {root}=authority(options.project,options.installationRoot);
  return withSerializedProjectTransactions({stateRoot:target(root,'.foundation/backups/reference-transactions')},()=>restoreObjectReferencesUnlocked(options));
}
function restoreObjectReferencesUnlocked({project,installationRoot,plan,sourceWriteAuthorized=false}) {
  if(sourceWriteAuthorized!==true)throw new Error('恢复包含源码写入，需要本任务明确恢复授权');
  const {root}=authority(project,installationRoot),fresh=prepareObjectReferenceRestore({project:root,installationRoot,backupPath:plan.backupPath});
  if(digest(fresh)!==digest(plan))throw new Error('引用恢复计划已漂移，未写入');
  const backup=JSON.parse(fs.readFileSync(target(root,plan.backupPath))),operationId='reference-restore-'+crypto.randomUUID();
  return executeProjectTransaction({operationId,operation:'object-reference-restore',planHash:digest(plan),expectedBeforeState:plan,recoveryPolicy:{objectReferences:true},stateRoot:path.join(root,'.foundation/backups/reference-transactions'),scopes:[{root,paths:plan.files.map(file=>file.path)}],
    consume:()=>{if(digest(prepareObjectReferenceRestore({project:root,installationRoot,backupPath:plan.backupPath}))!==digest(plan))throw new Error('恢复提交前输入漂移');return {planHash:digest(plan)};},
    apply:()=>{
      for(const file of backup.records)write(root,file.path,Buffer.from(file.bytes,'base64'),file.mode);
      const facts=readFacts(root),observation=captureProjectRoundInputs(root),lifecycle=facts.project.contextLifecycle;
      if(lifecycle){
        for(const item of [...(lifecycle.identities || []).filter(item=>item.state==='active'),...(lifecycle.objectReferences?.objects || []),...runtimeObservationObjects(lifecycle.objectReferences)]) {
          const file=observation.files.find(file=>file.path===(item.sourceFile || item.file));
          if(!file||file.sha256!==(item.sourceSha256 || item.sha256))throw new Error('恢复身份与备份源码不一致');
          item.sourcePhysical=file.physical;item.sourceIdentityPhysical=file.identityPhysical || null;
        }
        lifecycle.restorations=[...(lifecycle.restorations || []),{operationId,backupSha256:plan.backupSha256,sourceDigest:observation.byteDigest}];
        lifecycle.lastObservation=observation;
        write(root,'.foundation/facts/project.json',JSON.stringify(facts.project,null,2)+'\n');
      }
      return {state:'restored',mutationPerformed:true,operationId};
    },verify:()=>{
      if(captureProjectRoundInputs(root).byteDigest!==backup.sourceDigest)throw new Error('恢复后的源码集合或摘要不一致');
      for(const record of backup.records.filter(file=>file.path!=='.foundation/facts/project.json'))if(sha256(fs.readFileSync(target(root,record.path)))!==record.sha256)throw new Error('恢复后的材料字节不一致：'+record.path);
      return {sourceDigest:backup.sourceDigest,projectId:plan.projectId};
    }});
}
