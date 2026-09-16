import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildCandidate,createLifecyclePlan,inspectInstallation} from '../helpers/internal-core.mjs';
import {applyLifecycleForTest} from '../helpers/test-authorization.mjs';
import {prepareInstallationScope,readInstallationScope} from '../../packages/core/installation-scope.mjs';
import {canonicalStringify,sha256} from '../../packages/core/install-contract.mjs';

test('C6 signed scope survives install/update/reopen/uninstall while other installations and project files remain intact',()=>{
  const root=fs.mkdtempSync(path.resolve('.tmp/C6-lifecycle-'));
  const projects=['A','B'].map(name=>{const p=path.join(root,name);fs.mkdirSync(p);assert.equal(spawnSync('/usr/bin/git',['init','-q',p]).status,0);fs.writeFileSync(p+'/user.txt',name);return p;});
  const runtime=root+'/node';fs.copyFileSync(process.execPath,runtime);fs.chmodSync(runtime,0o755);
  const candidate=version=>{const source=root+'/source-'+version;fs.mkdirSync(source+'/app',{recursive:true});fs.writeFileSync(source+'/app/health.mjs',`console.log(JSON.stringify({ok:true,version:${JSON.stringify(version)}}))`);return buildCandidate({sourceRoot:source,outputRoot:root+'/candidate-'+version,productVersion:version,platform:process.platform,arch:process.arch,runtimeSource:runtime,entrypoint:'app/health.mjs',sourceKind:'local-test'});};
  const old=candidate('0.2.12'),next=candidate('0.2.13');
  const plan=(target,operation,built,usageScope=null,mode=null)=>createLifecyclePlan({operation,profile:'core',mode,targetRoot:target,sandboxRoot:root,usageScope,currentVersion:inspectInstallation(target).current?.version||null,targetVersion:built?.manifest.productVersion||null,candidate:built?{path:built.root,manifestHash:built.manifest.candidateHash,runtimeHash:built.manifest.files.find(f=>f.path===built.manifest.runtime.path).sha256,bytes:built.manifest.totalBytes,version:built.manifest.productVersion,acquisition:'local-ingestion'}:null});
  const targets=['user','project-A','project-B'].map(name=>root+'/install-'+name);
  const scopes=targets.map((target,i)=>prepareInstallationScope({kind:i?'project':'user',projectRoot:i?projects[i-1]:null,installationRoot:target}));
  for(let i=0;i<targets.length;i++){
    if(i)assert.throws(()=>plan(targets[i],'install',old,scopes[i]),{code:'NEW_INSTALL_USER_SCOPE_REQUIRED'});
    // Historical project-scope input, only in the existing isolated authorization
    // fixture. Production creation now rejects it; maintenance must still read it.
    const {planId:_id,integrity:_hash,...seed}=plan(targets[i],'install',old,scopes[0]);
    seed.usageScope=scopes[i];
    const unsigned={...seed,planId:`plan-${sha256(canonicalStringify(seed)).slice(0,24)}`};
    const historical={...unsigned,integrity:{algorithm:'sha256',hash:sha256(canonicalStringify(unsigned))}};
    applyLifecycleForTest(historical);assert.deepEqual(readInstallationScope(targets[i]),scopes[i]);
  }
  const otherRecords=[targets[0],targets[2]].map(target=>fs.readFileSync(target+'/state/current.json'));
  assert.throws(()=>plan(targets[1],'update',next,scopes[0]),{code:'INSTALL_SCOPE_MIGRATION_UNSUPPORTED'});
  assert.throws(()=>readInstallationScope(targets[1],{cwd:projects[1]}),{code:'INSTALL_SCOPE_OUTSIDE_PROJECT'});
  applyLifecycleForTest(plan(targets[1],'update',next));
  assert.equal(inspectInstallation(targets[1]).current.version,'0.2.13');
  assert.deepEqual(readInstallationScope(targets[1],{cwd:projects[0]}),scopes[1]);
  applyLifecycleForTest(plan(targets[1],'uninstall',null,null,'app-and-runtime'));
  assert.equal(inspectInstallation(targets[1]).installed,false);
  assert(fs.existsSync(targets[1]+'/uninstall-result.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(targets[1]+'/uninstall-result.json')).usageScope,scopes[1]);
  for(let i=0;i<projects.length;i++)assert.equal(fs.readFileSync(projects[i]+'/user.txt','utf8'),['A','B'][i]);
  for(const [i,target] of [targets[0],targets[2]].entries())assert.deepEqual(fs.readFileSync(target+'/state/current.json'),otherRecords[i]);
  fs.writeFileSync(root+'/evidence.json',JSON.stringify({kind:'engineering authorization fixture; small health candidate, not final product payload',targets,scopes,nonTargetRecordsUnchanged:true,projectsPreserved:true},null,2));
});
