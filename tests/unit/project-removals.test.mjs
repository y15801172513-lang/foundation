import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {makeTempDirectory} from '../helpers/project-fixture.mjs';
import {inspectScopedRemovals} from '../../packages/core/project-delivery.mjs';
import {assertProjectFileAbsent} from '../../packages/core/path-boundary.mjs';
import {requiredFactCapabilities} from '../../packages/core/asset-model.mjs';

const hash='a'.repeat(64);
test('删除审阅必须绑定观察到的旧字节、当前需求、无剩余引用和安全缺失路径',()=>{
 const project=makeTempDirectory('review-removal-'),claim={path:'old.js',beforeSha256:hash,sourceRefIds:['user']};
 const facts={project:{},pages:{items:[]}},requirement={sourceRefIds:['user'],removedInputs:[claim]};
 const round={pendingChanges:[{path:'old.js',before:null,after:null,history:[{before:hash,after:null}]}]},observation={files:[]};
 const input={project,facts,requirement,round,observation};
 assert.deepEqual(inspectScopedRemovals(input),[claim]);
 assert.throws(()=>inspectScopedRemovals({...input,round:{pendingChanges:[]}}),/历史字节/);
 assert.throws(()=>inspectScopedRemovals({...input,requirement:{...requirement,removedInputs:[{...claim,beforeSha256:'b'.repeat(64)}]}}),/摘要/);
 assert.throws(()=>inspectScopedRemovals({...input,requirement:{...requirement,sourceRefIds:['other']}}),/需求来源/);
 assert.throws(()=>inspectScopedRemovals({...input,facts:{...facts,pages:{items:[{id:'live',implementationMapping:'old.js'}]}}}),/仍被/);
 assert.throws(()=>inspectScopedRemovals({...input,requirement:{...requirement,removedInputs:[claim,claim]}}),/重复/);
 fs.writeFileSync(path.join(project,'old.js'),'recreated');assert.throws(()=>inspectScopedRemovals(input),/仍然存在/);
 fs.symlinkSync(project,path.join(project,'link'));assert.throws(()=>assertProjectFileAbsent(project,'link/missing.js'),/符号链接/);
 fs.symlinkSync(path.join(project,'missing'),path.join(project,'dangling'));assert.throws(()=>assertProjectFileAbsent(project,'dangling'),/符号链接/);
 for(const file of ['../missing.js','a/../missing.js','a//missing.js','/missing.js'])assert.throws(()=>assertProjectFileAbsent(project,file),/精确/);
});

test('删除合同和持久接受记录均要求专用能力，不能降级到只认识旧语义合同的运行时',()=>{
 assert(!requiredFactCapabilities({}).includes('deletion-review/1'));
 assert(requiredFactCapabilities({changes:{items:[{deliveryScope:{items:[{removedInputs:[{path:'old.js'}]}]}}]}}).includes('deletion-review/1'));
 assert(requiredFactCapabilities({project:{contextLifecycle:{acceptances:[{removals:[{path:'old.js'}]}]}}}).includes('deletion-review/1'));
});
