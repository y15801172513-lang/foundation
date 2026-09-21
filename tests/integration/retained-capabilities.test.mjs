import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildCandidate, createLifecyclePlan, hashDirectory} from '@foundation/core';
import {applyLifecycleForTest} from '../helpers/test-authorization.mjs';
import {installFoundationFixture, enableProjectFixture} from '../helpers/authorized-project-fixture.mjs';
import {makeTempDirectory, projectFixturePath} from '../helpers/project-fixture.mjs';

test('受管切换读取 project/pages 的能力要求，拒绝遗漏删除历史或自动结构能力的候选且保留项目字节',()=>{
  const base=makeTempDirectory('retained-capabilities-');
  const installationRoot=installFoundationFixture(base);
  const project=projectFixturePath(base,'retained');fs.mkdirSync(project,{recursive:true});
  enableProjectFixture(project,installationRoot);
  const source=path.join(base,'legacy-source');fs.mkdirSync(path.join(source,'app'),{recursive:true});
  fs.writeFileSync(path.join(source,'app/health.mjs'),'console.log(JSON.stringify({ok:true,version:"0.2.0"}))');
  fs.writeFileSync(path.join(source,'app/foundation-runtime-descriptor.json'),JSON.stringify({factCapabilities:['component-delivery/1','semantic-review/1','project-round/1']}));
  const candidate=buildCandidate({sourceRoot:source,outputRoot:path.join(base,'legacy-candidate'),productVersion:'0.2.0',platform:process.platform,arch:process.arch,runtimeSource:path.join(base,'private-node'),entrypoint:'app/health.mjs',sourceKind:'local-test'});
  const plan=()=>createLifecyclePlan({operation:'repair',targetRoot:installationRoot,sandboxRoot:base,currentVersion:'0.2.0',targetVersion:'0.2.0',candidate:{path:candidate.root,manifestHash:candidate.manifest.candidateHash,runtimeHash:candidate.manifest.files.find(f=>f.path===candidate.manifest.runtime.path).sha256,bytes:candidate.manifest.totalBytes,version:'0.2.0'}});
  // Deliberate retained input at the compatibility boundary, not a claimed
  // product acceptance. No changes/components record carries either capability.
  const write=(kind,value)=>fs.writeFileSync(path.join(project,'.foundation/facts',kind+'.json'),JSON.stringify(value));
  const pointer=fs.readFileSync(path.join(installationRoot,'state/current.json'));
  for(const [kind,value,capability] of [
    ['project',{contextLifecycle:{acceptances:[{removals:[{path:'removed.js'}]}]}},'deletion-review/1'],
    ['pages',{items:[{id:'page',sourceStructure:{}}]},'automatic-project-context/1'],
  ]) {
    write('project',{});write('pages',{items:[]});write('changes',{items:[]});write('components',{items:[]});write(kind,value);
    const before=hashDirectory(project);
    assert.throws(()=>applyLifecycleForTest(plan()),error=>error.code==='PROJECT_DOWNGRADE_INCOMPATIBLE'&&error.message.includes(capability));
    assert.equal(hashDirectory(project),before);
    assert.deepEqual(fs.readFileSync(path.join(installationRoot,'state/current.json')),pointer);
  }
});
