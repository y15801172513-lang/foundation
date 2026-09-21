import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {makeTempDirectory} from '../helpers/project-fixture.mjs';
import {applyLifecycleForTest} from '../helpers/test-authorization.mjs';
import {createLifecyclePlan} from '../../packages/core/install-contract.mjs';
import {openOrReuseWorkbench} from '../../packages/core/workbench-runtime.mjs';

test('关闭工作台服务释放精确实例；同进程可以重开，替换后的登记不能被旧服务清除',async()=>{
 const base=makeTempDirectory('workbench-close-'),candidate=fs.realpathSync(process.env.FOUNDATION_047_CANDIDATE),manifest=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json'))),installationRoot=path.join(base,'installation');
 applyLifecycleForTest(createLifecyclePlan({operation:'install',targetRoot:installationRoot,sandboxRoot:base,targetVersion:manifest.productVersion,candidate:{path:candidate,manifestHash:manifest.candidateHash,runtimeHash:manifest.files.find(f=>f.path===manifest.runtime.path).sha256,bytes:manifest.totalBytes,version:manifest.productVersion}}));
 let server;
 const open=()=>openOrReuseWorkbench({installationRoot,createServer:()=>{server=http.createServer((req,res)=>res.end('fixture'));return server;}});
 const first=await open(),file=path.join(installationRoot,'state/workbench-instances',first.key+'.json');
 assert(fs.existsSync(file));
 await new Promise(resolve=>server.close(resolve));assert(!fs.existsSync(file));
 const second=await open();assert.equal(second.reused,false);assert.equal(second.key,first.key);assert.notEqual(second.nonce,first.nonce);
 const replaced=JSON.stringify({...second,nonce:'different-owner'});fs.writeFileSync(file,replaced);
 await new Promise(resolve=>server.close(resolve));assert.equal(fs.readFileSync(file,'utf8'),replaced);
});
