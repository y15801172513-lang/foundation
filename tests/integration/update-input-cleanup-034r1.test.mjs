import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildCandidate,createLifecyclePlan,inspectInstallation,hashDirectory,sha256} from '@foundation/core';
import {snapshotUpdateInputs} from '../../packages/core/update-input-inventory.mjs';
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
  const html=renderLifecyclePage(session.session);assert(html.includes(stage));assert(html.includes(asset));assert(html.includes('此页面本身不执行清理'));
  assert.equal(inspectInstallation(installed).current.version,'0.2.5');assert(fs.existsSync(path.join(stage,asset)));
  const before=hashDirectory(installed);
  // Unconfirmed/cancelled/unknown host states leave inputs and installation alone.
  for(const state of ['pending','cancelled','failed','unknown']){assert.notEqual(state,'completed');assert(fs.existsSync(path.join(stage,asset)));assert.equal(hashDirectory(installed),before);}
  const unknown=path.join(built.root,'user-note');fs.writeFileSync(unknown,'keep');assert.throws(()=>snapshotUpdateInputs(candidate,installed),/未知文件/);fs.unlinkSync(unknown);
  const manifestFile=path.join(built.root,'manifest.json'),manifestBytes=fs.readFileSync(manifestFile);
  const ordinary=path.join(built.root,'payload',built.manifest.files[0].path),ordinaryBytes=fs.readFileSync(ordinary);fs.appendFileSync(ordinary,'changed');assert.throws(()=>snapshotUpdateInputs(candidate,installed),/已修改/);fs.writeFileSync(ordinary,ordinaryBytes);
  const link=path.join(stage,'linked-candidate');fs.symlinkSync(built.root,link);assert.throws(()=>snapshotUpdateInputs({...candidate,path:link},installed),/链接|漂移/);
  applyLifecycleForTest(plan);
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
