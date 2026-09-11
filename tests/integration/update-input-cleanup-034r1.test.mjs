import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildCandidate,createLifecyclePlan,inspectInstallation,hashDirectory,sha256} from '@foundation/core';
import {snapshotUpdateInputs,finishConfirmedUpdateInputs} from '../../packages/core/update-input-inventory.mjs';
import {renderLifecyclePage} from '../../packages/core/lifecycle-feedback.mjs';
import {createPendingLocalManagerSession} from '../../packages/core/lifecycle-manager.mjs';
import {installFoundationFixture} from '../helpers/authorized-project-fixture.mjs';
import {applyLifecycleForTest} from '../helpers/test-authorization.mjs';
import {makeScopedTempDirectory} from '../helpers/project-fixture.mjs';

test('034R1 confirmed isolated update binds host cleanup; preserves installed versions and changed inputs',()=>{
  // Engineering confirmation fixture, not human approval. The deletion below
  // represents ordinary host file tools and is deliberately NOT product code.
  const root=makeScopedTempDirectory('034R1','update-inputs-');
  const installed=installFoundationFixture(root,'0.2.5');
  const source=path.join(root,'new-source');fs.mkdirSync(path.join(source,'app'),{recursive:true});fs.writeFileSync(path.join(source,'app/main.mjs'),'console.log(JSON.stringify({ok:true,version:"0.2.6"}));\n');
  const stage=path.join(root,'acquisition');fs.mkdirSync(stage,{mode:0o700});
  const built=buildCandidate({sourceRoot:source,outputRoot:path.join(stage,'candidate'),productVersion:'0.2.6',platform:process.platform,arch:process.arch,runtimeSource:path.join(root,'private-node'),entrypoint:'app/main.mjs',sourceKind:'local-test'});
  const archiveBytes=Buffer.from('isolated archive placeholder; update reads verified candidate');const digest=sha256(archiveBytes),asset=`foundation-${digest}.tar.gz`;fs.writeFileSync(path.join(stage,asset),archiveBytes);
  const receipt={candidateHash:built.manifest.candidateHash,launcher:path.join(built.root,'foundation-kit'),asset,sha256:digest,bytes:archiveBytes.length};fs.writeFileSync(path.join(stage,'acquisition.json'),JSON.stringify(receipt));
  const candidate={path:built.root,manifestHash:built.manifest.candidateHash,version:'0.2.6',bytes:built.manifest.totalBytes};
  const plan=createLifecyclePlan({operation:'update',targetRoot:installed,currentVersion:'0.2.5',targetVersion:'0.2.6',candidate,cleanupAcquisition:true});
  const session=createPendingLocalManagerSession({plan,stateRoot:path.join(root,'manager-state')});
  const html=renderLifecyclePage(session.session);assert(html.includes(stage));assert(html.includes(asset));assert(html.includes('页面确认绑定清理范围'));
  assert.equal(inspectInstallation(installed).current.version,'0.2.5');assert(fs.existsSync(path.join(stage,asset)));
  const before=hashDirectory(installed);
  // Unconfirmed/cancelled/unknown host states leave inputs and installation alone.
  for(const state of ['pending','cancelled','failed','unknown']){assert.notEqual(state,'completed');assert(fs.existsSync(path.join(stage,asset)));assert.equal(hashDirectory(installed),before);}
  const unknown=path.join(built.root,'user-note');fs.writeFileSync(unknown,'keep');assert.throws(()=>snapshotUpdateInputs(candidate,installed),/未知文件/);fs.unlinkSync(unknown);
  const manifestFile=path.join(built.root,'manifest.json'),manifestBytes=fs.readFileSync(manifestFile);
  const ordinary=path.join(built.root,'payload',built.manifest.files[0].path),ordinaryBytes=fs.readFileSync(ordinary);fs.appendFileSync(ordinary,'changed');assert.throws(()=>snapshotUpdateInputs(candidate,installed),/已修改/);fs.writeFileSync(ordinary,ordinaryBytes);
  const link=path.join(stage,'linked-candidate');fs.symlinkSync(built.root,link);assert.throws(()=>snapshotUpdateInputs({...candidate,path:link},installed),/链接|漂移/);
  // A real open input must suppress automatic post-processing; the historical
  // host-deletion assertions below still exercise identity-bound preservation.
  const heldInput=fs.openSync(path.join(stage,asset),'r');
  const applied=applyLifecycleForTest(plan);fs.closeSync(heldInput);
  assert.equal(applied.cleanup.state,'retained');
  const current=inspectInstallation(installed);assert.equal(current.current.version,'0.2.6');assert.equal(current.recovery.status,'clean');
  const installedHash=hashDirectory(installed),deleted=[],preserved=[];
  // Simulated failed host deletion is distinct from the real completed update.
  let cleanupState='pending';try{throw Object.assign(new Error('simulated host permission failure'),{code:'EACCES'});}catch{cleanupState='failed';}
  assert.equal(cleanupState,'failed');assert.equal(inspectInstallation(installed).current.version,'0.2.6');assert(fs.existsSync(path.join(stage,asset)));
  // Changed inputs are retained by comparison, not by a fresh authorization.
  fs.appendFileSync(manifestFile,'\n');const boundManifest=plan.hostCleanup.files.find(x=>x.path===manifestFile);assert.notEqual(sha256(fs.readFileSync(manifestFile)),boundManifest.sha256);assert(fs.existsSync(manifestFile));
  // Restore only this synthetic test mutation, then exercise complete cleanup.
  fs.writeFileSync(manifestFile,manifestBytes);
  const user=path.join(stage,'user-note');fs.writeFileSync(user,'keep');
  for(const record of plan.hostCleanup.files){
    const stat=fs.lstatSync(record.path);
    if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||stat.dev!==record.device||stat.ino!==record.inode||stat.uid!==record.uid||(stat.mode&0o777)!==record.mode||stat.size!==record.bytes||sha256(fs.readFileSync(record.path))!==record.sha256){preserved.push(record.path);continue;}
    fs.unlinkSync(record.path);deleted.push(record.path);
  }
  for(const record of plan.hostCleanup.directories){const stat=fs.lstatSync(record.path);if(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.dev===record.device&&stat.ino===record.inode&&fs.readdirSync(record.path).length===0)fs.rmdirSync(record.path);}
  assert(deleted.includes(path.join(stage,asset)));assert(!fs.existsSync(built.root));assert.deepEqual(preserved,[]);assert(fs.existsSync(user));assert(fs.existsSync(path.join(stage,'acquisition.json')));assert.equal(hashDirectory(installed),installedHash);
  fs.writeFileSync(path.join(stage,'cleanup-result.json'),JSON.stringify({operationId:plan.planId,planHash:plan.integrity.hash,update:'completed',version:current.current.version,cleanup:'completed',deleted,preserved:[user,path.join(stage,'acquisition.json')],simulatedFailure:{update:'completed',cleanup:cleanupState},simulation:'engineering confirmation and host tools; no human acceptance'}));
  // Re-reading absent files does not repeat update or claim a second deletion.
  assert(deleted.every(file=>!fs.existsSync(file)));assert.equal(hashDirectory(installed),installedHash);
  console.log('034R1 cleanup evidence: '+root);
});

test('036 confirmed update finishes its own exact cleanup and preserves unrelated files',()=>{
  const root=makeScopedTempDirectory('036','automatic-cleanup-'),installed=installFoundationFixture(root,'0.2.5');
  const source=path.join(root,'source');fs.mkdirSync(source+'/app',{recursive:true});fs.writeFileSync(source+'/app/main.mjs','console.log(JSON.stringify({ok:true,version:"0.2.6"}));\n');
  const stage=root+'/acquisition';fs.mkdirSync(stage,{mode:0o700});
  const built=buildCandidate({sourceRoot:source,outputRoot:stage+'/candidate',productVersion:'0.2.6',platform:process.platform,arch:process.arch,runtimeSource:root+'/private-node',entrypoint:'app/main.mjs',sourceKind:'local-test'});
  const bytes=Buffer.from('contained archive fixture'),digest=sha256(bytes),asset=`foundation-${digest}.tar.gz`;fs.writeFileSync(stage+'/'+asset,bytes);
  fs.writeFileSync(stage+'/acquisition.json',JSON.stringify({candidateHash:built.manifest.candidateHash,launcher:built.root+'/foundation-kit',asset,sha256:digest,bytes:bytes.length}));fs.writeFileSync(stage+'/user-note','keep');
  const plan=createLifecyclePlan({operation:'update',targetRoot:installed,currentVersion:'0.2.5',targetVersion:'0.2.6',candidate:{path:built.root,manifestHash:built.manifest.candidateHash,version:'0.2.6',bytes:built.manifest.totalBytes},cleanupAcquisition:true});
  const result=applyLifecycleForTest(plan);assert.equal(result.stableLauncherHealth,'passed');assert.equal(result.cleanup.state,'completed',JSON.stringify(result.cleanup));assert(!fs.existsSync(built.root));assert(!fs.existsSync(stage+'/'+asset));assert.equal(fs.readFileSync(stage+'/user-note','utf8'),'keep');assert(fs.existsSync(stage+'/acquisition.json'));assert.equal(JSON.parse(fs.readFileSync(stage+'/cleanup-result.json')).operationId,plan.planId);assert.equal(inspectInstallation(installed).current.version,'0.2.6');
  assert.throws(()=>createLifecyclePlan({operation:'update',targetRoot:installed,currentVersion:'0.2.6',targetVersion:'0.2.6',candidate:{path:built.root}}),e=>e.code==='UPDATE_VERSION_ALREADY_CURRENT');
});

test('036 cleanup refuses changed bytes, replaced directory and symlink without changing installed result',()=>{
  // Focused post-commit cleanup unit: synthetic inventory only, no confirmation
  // bypass and no claim that this fixture executes an installation.
  const root=makeScopedTempDirectory('036','cleanup-drift-');
  const digest=b=>sha256(Buffer.from(b));
  const identity=p=>{const s=fs.lstatSync(p);return{device:s.dev,inode:s.ino,uid:s.uid,mode:s.mode&511};};
  for(const kind of ['bytes','symlink','directory','receipt-collision']){
    const stage=path.join(root,kind);fs.mkdirSync(stage,{mode:0o700});const dir=stage+'/candidate';fs.mkdirSync(dir);
    const file=dir+'/data';fs.writeFileSync(file,'original');const receipt=stage+'/acquisition.json';fs.writeFileSync(receipt,'{}');
    const plan={operation:'update',planId:'fixture-'+kind,hostCleanup:{executor:'confirmed-update-engine',root:stage,rootIdentity:identity(stage),receipt:{path:receipt,...identity(receipt),sha256:digest('{}')},files:[{path:file,...identity(file),bytes:8,sha256:digest('original')}],directories:[{path:dir,...identity(dir)}]}};
    const sentinel=stage+'/user-data';fs.writeFileSync(sentinel,'must stay');
    if(kind==='bytes')fs.writeFileSync(file,'modified');
    if(kind==='symlink'){fs.unlinkSync(file);fs.symlinkSync(sentinel,file);}
    if(kind==='directory'){fs.renameSync(dir,stage+'/old-candidate');fs.mkdirSync(dir);fs.writeFileSync(file,'original');}
    if(kind==='receipt-collision')fs.writeFileSync(stage+'/cleanup-result.json','user owned');
    const result=finishConfirmedUpdateInputs(plan);
    assert.equal(fs.readFileSync(sentinel,'utf8'),'must stay');assert.equal(fs.readFileSync(receipt,'utf8'),'{}');
    if(kind==='receipt-collision'){assert.equal(result.state,'completed');assert.equal(result.recordSaved,false);assert.equal(fs.readFileSync(stage+'/cleanup-result.json','utf8'),'user owned');}
    else{assert.notEqual(result.state,'completed');assert(fs.lstatSync(file));assert.equal(result.deleted.length,0);}
  }
});
