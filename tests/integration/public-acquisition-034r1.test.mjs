import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';

// Opt-in same-path engineering test. Transport, TUF and attestation are test
// doubles, NOT anonymous publication evidence. The production acquire module,
// archive bytes, tar, bound runtime, candidate validation and HTTP plan are real.
// A separate cryptographic regression verifies actual GitHub release proofs.
const repo=fs.realpathSync(path.resolve(import.meta.dirname,'../..'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const input=process.env.FOUNDATION_PUBLIC_ACQUISITION_FIXTURE;
test('034R1 anonymous acquisition path reaches confirmation without installation', {skip:!input||process.platform!=='darwin'||process.arch!=='arm64'},async()=>{
  const config=JSON.parse(fs.readFileSync(input));
  for(const file of [input,config.catalog,config.archive,config.bootstrap])assert(fs.realpathSync(file).includes('/.tmp/'));
  const work=fs.mkdtempSync(path.join(repo,'.tmp/public-acquisition-'));
  const policy=JSON.parse(fs.readFileSync(path.join(repo,'distribution/summon-foundation/lib/public-policy.json')));
  assert.equal(hash(fs.readFileSync(config.bootstrap)),policy.bootstrapRootSha256);
  const catalog=JSON.parse(fs.readFileSync(config.catalog)),r=catalog.releases[0];
  assert.equal(hash(fs.readFileSync(config.archive)),r.sha256);
  r.repositoryId=policy.repositoryId;
  r.url=`https://github.com/${policy.repository}/releases/download/v${r.version}/${path.basename(config.archive)}`;
  const catalogBytes=Buffer.from(JSON.stringify(catalog));
  const catalogFile=path.join(work,'catalog-fixture.json');fs.writeFileSync(catalogFile,catalogBytes);
  const asset=(name,bytes)=>({name,size:bytes.length,digest:'sha256:'+hash(bytes),state:'uploaded',browser_download_url:`https://github.com/${policy.repository}/releases/download/v${r.version}/${name}`});
  const assets=[asset(`foundation-release-${r.version}-macos-arm64.json`,catalogBytes),asset(path.basename(config.archive),fs.readFileSync(config.archive))];
  const context={repository:{full_name:policy.repository,id:policy.repositoryId,private:false},release:{id:1,tag_name:'v'+r.version,immutable:true,draft:false,prerelease:false,assets},sourceCommit:r.sourceCommit,version:r.version};
  const mapping={[policy.bootstrapRootUrl]:config.bootstrap,[assets[0].browser_download_url]:catalogFile,[assets[1].browser_download_url]:config.archive};
  const transport=path.join(work,'transport.mjs');
  fs.writeFileSync(transport,`import fs from 'node:fs';import{spawnSync as real}from'node:child_process';const mapping=${JSON.stringify(mapping)};export function spawnSync(c,a,o){if(c!=='/usr/bin/curl')return real(c,a,o);const u=a.at(-1);fs.appendFileSync(${JSON.stringify(path.join(work,'transport.jsonl'))},JSON.stringify({command:c,args:a,env:o.env})+'\\n');if(mapping[u])return{status:0,stdout:fs.readFileSync(mapping[u])};if(u.startsWith('https://api.github.com/repos/'+${JSON.stringify(policy.repository)}+'/attestations/'))return{status:0,stdout:Buffer.from(JSON.stringify({attestations:[{initiator:'github',repository_id:${policy.repositoryId},bundle:{dsseEnvelope:{payload:Buffer.from(JSON.stringify({predicate:{tag:${JSON.stringify('v'+r.version)}}})).toString('base64')}}}]}))};throw Error('Unexpected fixture request '+u);}`);
  fs.writeFileSync(path.join(work,'trust.mjs'),`import fs from'node:fs';import path from'node:path';export class Updater{constructor(o){this.o=o}async refresh(){}async getTargetInfo(){return {}}async downloadTarget(){const p=path.join(this.o.targetDir,'fixture.json');fs.writeFileSync(p,'{}');return p}}`);
  fs.writeFileSync(path.join(work,'proof.mjs'),`import fs from'node:fs';export function verifyReleaseProof(x){fs.appendFileSync(${JSON.stringify(path.join(work,'proof-calls.jsonl'))},JSON.stringify({asset:x.asset.name,bytes:x.bytes.length,simulation:true})+'\\n');return{status:'TEST_PROOF_ONLY',sourceCommit:x.sourceCommit}}`);
  const moduleUrl=new URL('../../distribution/summon-foundation/lib/acquire.mjs',import.meta.url).href;
  fs.writeFileSync(path.join(work,'loader.mjs'),`export async function resolve(s,c,n){if(c.parentURL===${JSON.stringify(moduleUrl)}){const m={'node:child_process':'transport.mjs','tuf-js':'trust.mjs','./release-proof.mjs':'proof.mjs'};if(m[s])return{url:new URL(m[s],import.meta.url).href,shortCircuit:true}}return n(s,c)}`);
  fs.writeFileSync(path.join(work,'register.mjs'),`import{register}from'node:module';register(new URL('./loader.mjs',import.meta.url));`);
  const stage=path.join(work,'acquisition');fs.mkdirSync(stage,{mode:0o700});
  fs.writeFileSync(path.join(work,'acquire.mjs'),`import{acquireRelease}from${JSON.stringify(moduleUrl)};console.log(JSON.stringify(await acquireRelease(${JSON.stringify(context)},${JSON.stringify(stage)})));`);
  const env={...process.env,NODE_OPTIONS:'',TMPDIR:work};
  const run=spawnSync(process.execPath,['--import',path.join(work,'register.mjs'),path.join(work,'acquire.mjs')],{env,encoding:'utf8',maxBuffer:4e6});
  fs.writeFileSync(path.join(work,'acquire.stdout.log'),run.stdout);fs.writeFileSync(path.join(work,'acquire.stderr.log'),run.stderr);
  assert.equal(run.status,0,run.stderr);assert.equal(fs.statSync(stage).mode&0o777,0o700);
  const receipt=JSON.parse(run.stdout);assert.equal(receipt.installationConfirmed,false);
  assert.equal(fs.readFileSync(path.join(work,'proof-calls.jsonl'),'utf8').trim().split('\n').length,2);
  for(const line of fs.readFileSync(path.join(work,'transport.jsonl'),'utf8').trim().split('\n')){const row=JSON.parse(line);assert.equal(row.args[0],'-q');assert(!Object.keys(row.env).some(k=>/TOKEN|AUTH/.test(k)));}
  const home=path.join(work,'account');fs.mkdirSync(path.join(home,'Library/Application Support'),{recursive:true});fs.mkdirSync(path.join(home,'Library/Caches'));const destination=path.join(home,'Foundation 用户 空格');
  fs.writeFileSync(path.join(work,'account.mjs'),`export function readCurrentPlatformAccount(){return{schemaVersion:'1.0.0',authority:'contained-account-fixture',platform:process.platform,uid:process.getuid(),gid:process.getgid(),username:'fixture',homedir:${JSON.stringify(home)}}}`);
  fs.writeFileSync(path.join(work,'account-loader.mjs'),`export async function resolve(s,c,n){const r=await n(s,c);return r.url.endsWith('/packages/cli/platform-account.mjs')?{url:new URL('./account.mjs',import.meta.url).href,shortCircuit:true}:r}`);
  fs.writeFileSync(path.join(work,'account-register.mjs'),`import{register}from'node:module';register(new URL('./account-loader.mjs',import.meta.url));`);
  const candidate=path.dirname(receipt.launcher);
  const child=spawn(path.join(candidate,'payload/runtime/bin/node'),['--import',path.join(work,'account-register.mjs'),path.join(candidate,'payload/app/packages/cli/index.mjs'),'install','--destination',destination,'--browser','codex'],{cwd:work,env});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const done=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  try{
    const deadline=Date.now()+30000;while(child.exitCode===null&&!stdout.includes('AWAITING_FOUNDATION_UI_CONFIRMATION')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
    assert.match(stdout,/AWAITING_FOUNDATION_UI_CONFIRMATION/,stderr+stdout);
    const ready=JSON.parse(stdout.match(/\{\s*"ok": true,[\s\S]*?\n\}/)[0]);
    const response=await fetch(ready.url);assert.equal(response.status,200);const html=await response.text();fs.writeFileSync(path.join(work,'plan.html'),html);
    assert(html.includes(destination));assert(html.includes(r.version));assert(html.includes(ready.planId));assert(!fs.existsSync(destination));
    fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({status:'PASS_CONTAINED_ACQUISITION_TO_PAGE',version:r.version,sourceCommit:r.sourceCommit,candidateHash:r.candidateHash,archiveSha256:r.sha256,acquireModuleSha256:hash(fs.readFileSync(new URL(moduleUrl))),operation:ready,confirmationSent:false,installed:false,simulated:['transport','TUF','release attestation','OS account'],real:['archive','tar','candidate byte and mode validation','bound runtime','CLI plan','loopback HTTP page']},null,2)+'\n');
  }finally{if(child.exitCode===null)child.kill('SIGTERM');await done;fs.writeFileSync(path.join(work,'page.stdout.log'),stdout);fs.writeFileSync(path.join(work,'page.stderr.log'),stderr);}
  console.log('034R1 acquisition evidence: '+path.relative(repo,work));
});
