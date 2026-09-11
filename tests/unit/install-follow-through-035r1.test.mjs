import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';
import {spawnSync} from 'node:child_process';
import{downloadFailure}from'../../distribution/summon-foundation/lib/acquire.mjs';
import{createOperation,saveOperation,readOperation,runtimeObservation}from'../../distribution/summon-foundation/lib/operation-result.mjs';
import{parseSummonArgs}from'../../distribution/summon-foundation/lib/cli-options.mjs';
const root=path.resolve(import.meta.dirname,'../..');
test('035R1 runtime observations distinguish confirmation, execution and terminal uncertainty',()=>{
 assert.equal(runtimeObservation({status:'AWAITING_FOUNDATION_UI_CONFIRMATION'}).installationWrites,'none');
 assert.equal(runtimeObservation({status:'FOUNDATION_OPERATION_STATE',state:'executing'}).installationWrites,'possible');
 for(const state of ['completed','failed','cancelled','expired']){const r=runtimeObservation({status:'BOOTSTRAP_OPERATION_ENDED',state});assert.equal(r.state,state);assert.equal(r.terminal,true);assert.equal(r.runtimeHealth,'unknown');assert.equal(r.installationWrites,state==='completed'?'runtime-reported-installed':'unknown');}
 assert.equal(runtimeObservation({status:'BOOTSTRAP_OPERATION_ENDED',state:'unexpected'}).terminal,false);
 assert.equal(runtimeObservation({state:'cancelled-no-install'}).installationWrites,'none');
 assert.equal(runtimeObservation({state:'expired-no-install'}).terminal,true);
 assert.equal(runtimeObservation({state:'shutdown-no-install'}).installationWrites,'none');
 assert.equal(runtimeObservation({status:'BOOTSTRAP_OPERATION_ENDED',state:'failed',result:{executableHealth:'failed'}}).runtimeHealth,'failed');
 assert.equal(runtimeObservation({status:'arbitrary',state:'completed'}),null);
});
test('035R1 curl diagnostic retains real code but never signed URL or credentials',()=>{
 for(const[status,category]of[[5,'proxy-dns'],[6,'dns'],[7,'connection'],[22,'http'],[28,'timeout-or-low-speed'],[35,'tls'],[60,'tls-certificate'],[56,'transport']]){const e=downloadFailure({status,stderr:'https://example.invalid/file?sig=secret password=fixture-only'},'github.com');assert.equal(e.diagnostic.curlExitCode,status);assert.equal(e.diagnostic.category,category);assert(!JSON.stringify(e).includes('secret'));assert(!e.message.includes('password'));}
 assert.equal(downloadFailure({status:null,signal:'SIGTERM'},'github.com').diagnostic.category,'terminated');
});
test('035R1 persisted failure is private, identity-bound and readonly; stale running is unknown',()=>{
 const stage=fs.mkdtempSync(root+'/.tmp/follow-through-');fs.chmodSync(stage,0o700);const r=createOperation();const file=saveOperation(r,stage);assert(file);assert.equal(fs.statSync(file).mode&511,384);assert.equal(readOperation(file).state,'verification-required');const before=fs.readFileSync(file);readOperation(file);assert.deepEqual(fs.readFileSync(file),before);
 Object.assign(r,{terminal:true,state:'failed',phase:'fetching-and-verifying-runtime',diagnostic:{category:'dns',curlExitCode:6}});assert.equal(saveOperation(r,stage),file);const got=readOperation(file);assert.equal(got.state,'failed');assert.equal(got.operationId,r.operationId);assert.equal(got.installationWrites,'none');assert.equal(saveOperation(createOperation(),stage),null);assert.equal(readOperation(file).operationId,r.operationId);
 const link=stage+'/link.json';fs.symlinkSync(file,link);assert.throws(()=>readOperation(link));assert.equal(saveOperation(r,stage+'/missing'),null);assert.equal(r.diagnostic.curlExitCode,6);
});
test('035R1 status cannot trigger prepare or combine with mutation',()=>{
 assert.deepEqual(parseSummonArgs(['foundation','--status','/record.json']),{prepare:false,status:'/record.json'});
 for(const flags of [['--status'],['--status',''],['--status','/r','--prepare'],['--status','/r','--version','0.2.7'],['--status','/r','--status','/b']])assert.throws(()=>parseSummonArgs(['foundation',...flags]));
});
test('035R1 real acquisition transport failure records actual curl code without executing runtime',()=>{
 const work=fs.mkdtempSync(root+'/.tmp/transport-failure-'),url=new URL('../../distribution/summon-foundation/lib/acquire.mjs',import.meta.url).href,recordUrl=new URL('../../distribution/summon-foundation/lib/operation-result.mjs',import.meta.url).href;
 fs.writeFileSync(work+'/transport.mjs',`export function spawnSync(c,a){if(c!=='/usr/bin/curl')throw Error('unexpected execution');return{status:Number(process.env.FIXTURE_CURL_CODE),stderr:Buffer.from('https://example.invalid/?sig=PRIVATE')};}`);
 fs.writeFileSync(work+'/loader.mjs',`export async function resolve(s,c,n){if(c.parentURL===${JSON.stringify(url)}&&s==='node:child_process')return{url:new URL('./transport.mjs',import.meta.url).href,shortCircuit:true};return n(s,c)}`);
 fs.writeFileSync(work+'/register.mjs',`import{register}from'node:module';register(new URL('./loader.mjs',import.meta.url));`);
 fs.writeFileSync(work+'/probe.mjs',`import{acquireRelease}from${JSON.stringify(url)};import{createOperation,saveOperation}from${JSON.stringify(recordUrl)};const r=createOperation();try{await acquireRelease({},process.env.FIXTURE_STAGE,{onPhase:phase=>{r.phase=phase;saveOperation(r,process.env.FIXTURE_STAGE)}})}catch(e){Object.assign(r,{state:'failed',terminal:true,diagnostic:e.diagnostic});saveOperation(r,process.env.FIXTURE_STAGE);console.log(JSON.stringify(r));process.exitCode=1;}`);
 const results=[];for(const code of [6,7,28]){const stage=work+'/case-'+code;fs.mkdirSync(stage,{mode:0o700});const r=spawnSync(process.execPath,['--import',work+'/register.mjs',work+'/probe.mjs'],{env:{...process.env,NODE_OPTIONS:'',FIXTURE_STAGE:stage,FIXTURE_CURL_CODE:String(code)},encoding:'utf8'});results.push({code,status:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,1,r.stderr);const end=JSON.parse(r.stdout);assert.equal(end.diagnostic.curlExitCode,code);assert.equal(end.phase,'verifying-trust');assert.equal(end.installationWrites,'none');assert(!r.stdout.includes('PRIVATE'));assert.equal(readOperation(stage+'/operation-result.json').state,'failed');assert(!fs.existsSync(stage+'/candidate'));}
 fs.writeFileSync(work+'/results.json',JSON.stringify({simulation:'curl transport only; actual acquire, journal and process exit',results},null,2));
});
