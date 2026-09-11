import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';
const repo=fs.realpathSync(path.resolve(import.meta.dirname,'../..'));
const input=process.env.FOUNDATION_INSTALL_ENTRY_CANDIDATE;
test('035 real payload: selection, rejection, exact confirmation, install and stable reopen',{skip:!input,timeout:90000},async()=>{
  const candidate=fs.realpathSync(input);assert(candidate.startsWith(repo+'/.tmp/'));
  const manifest=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json')));
  const work=fs.mkdtempSync(path.join(repo,'.tmp/entry-035-')),home=path.join(work,'account');
  fs.mkdirSync(path.join(home,'Library/Application Support'),{recursive:true});fs.mkdirSync(path.join(home,'Library/Caches'));
  fs.writeFileSync(path.join(work,'account.mjs'),`export function readCurrentPlatformAccount(){return{authority:'035-contained-account',platform:process.platform,uid:process.getuid(),gid:process.getgid(),username:'fixture',homedir:${JSON.stringify(home)}}}`);
  fs.writeFileSync(path.join(work,'loader.mjs'),`export async function resolve(s,c,n){const r=await n(s,c);return r.url.endsWith('/packages/cli/platform-account.mjs')?{url:new URL('./account.mjs',import.meta.url).href,shortCircuit:true}:r}`);
  fs.writeFileSync(path.join(work,'register.mjs'),`import{register}from'node:module';register(new URL('./loader.mjs',import.meta.url));`);
  const env={...process.env,PATH:'',NODE_OPTIONS:'',TMPDIR:work};
  let stdout='',stderr='';const child=spawn(candidate+'/payload/runtime/bin/node',['--import',work+'/register.mjs',candidate+'/payload/app/packages/cli/index.mjs','install','--choose-destination','--browser','codex'],{cwd:work,env});
  const done=new Promise(r=>child.once('close',(code,signal)=>r({code,signal})));
  child.stdout.on('data',b=>{stdout+=b;fs.writeFileSync(work+'/stdout.log',stdout)});child.stderr.on('data',b=>{stderr+=b;fs.writeFileSync(work+'/stderr.log',stderr)});
  const commands=[];
  const invoke=(command,args)=>{const r=spawnSync(command,args,{cwd:work,env,encoding:'utf8',timeout:15000});commands.push({command,args,status:r.status,stdout:r.stdout,stderr:r.stderr});fs.writeFileSync(work+'/commands.json',JSON.stringify(commands,null,2));assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
  try{
    const until=Date.now()+30000;while(!stdout.includes('AWAITING_FOUNDATION_DIRECTORY_SELECTION')&&child.exitCode===null&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
    assert.match(stdout,/AWAITING_FOUNDATION_DIRECTORY_SELECTION/,stderr);
    const ready=JSON.parse(stdout.trim().split('\n')[0]);assert.equal(ready.browser.opened,false);
    const page=await(await fetch(ready.url)).text();fs.writeFileSync(work+'/selection.html',page);
    const nonce=page.match(/nonce:"([a-f0-9]{64})"/)[1],origin=new URL(ready.url).origin;
    const post=(destination,extra={})=>fetch(ready.url+'__foundation/install/selection',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({nonce,action:'select',destination,...extra})});
    const destination=path.join(home,'Foundation 中文 空格');
    assert.equal((await post(destination,{nonce:'wrong'})).status,403);
    const occupied=path.join(home,'occupied');fs.mkdirSync(occupied);fs.writeFileSync(occupied+'/keep.txt','user-data');
    assert.equal((await post(occupied)).status,409);assert.equal(fs.readFileSync(occupied+'/keep.txt','utf8'),'user-data');
    fs.symlinkSync(occupied,path.join(home,'linked'));assert.equal((await post(path.join(home,'linked'))).status,400);
    assert.equal((await post(path.join(home,'missing-parent','Foundation'))).status,400);
    assert.equal(fs.existsSync(destination),false);
    const competing=await Promise.all([post(destination),post(destination)]);assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
    const selected=competing.find(r=>r.status===200);const bound=await selected.json();
    assert.equal((await post(destination)).status,409);
    const refresh=await fetch(ready.url,{redirect:'manual'});assert.equal(refresh.status,303);assert.equal(refresh.headers.get('location'),bound.url);
    const confirmation=await(await fetch(bound.url)).text();fs.writeFileSync(work+'/confirmation.html',confirmation);
    assert(confirmation.includes(destination));assert(confirmation.includes(manifest.productVersion));assert.equal(fs.existsSync(destination),false);
    const managerNonce=confirmation.match(/name="managerNonce" value="([^"]+)"/)[1];
    // Explicit engineering confirmation fixture in this project's isolated account.
    // It does not prove a human click, fresh Codex discovery or active notification.
    const applied=await fetch(bound.url+'__foundation/manager/confirm',{method:'POST',headers:{origin:new URL(bound.url).origin,'content-type':'application/json'},body:JSON.stringify({managerNonce,action:'confirm-exact-operation'})});
    const result=await applied.json();assert.equal(applied.status,200,JSON.stringify(result));assert.equal(result.state,'completed');
    assert.equal((await done).code,0);assert.match(stdout,/BOOTSTRAP_OPERATION_ENDED/);
    const launcher=destination+'/bin/foundation-kit';const health=invoke(launcher,['--foundation-health']);
    const status=invoke(candidate+'/payload/runtime/bin/node',['--import',work+'/register.mjs',candidate+'/payload/app/packages/cli/index.mjs','onboarding','status','--session-id',result.sessionId]);
    assert.equal(status.state,'completed');assert.equal(status.result.current.version,manifest.productVersion);
    const reopened=spawn(launcher,['workbench','open','--root',destination],{cwd:work,env});let opened='';reopened.stdout.on('data',b=>opened+=b);let error='';reopened.stderr.on('data',b=>error+=b);
    try{const deadline=Date.now()+15000;while(!opened.includes('"url"')&&reopened.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));assert.match(opened,/"url"/,error);const response=await fetch(JSON.parse(opened.trim()).url);assert.equal(response.status,200);fs.writeFileSync(work+'/reopened.html',await response.text());}finally{reopened.kill('SIGTERM');}
    const noInstallCases=[];
    for(const mode of ['cancel','expire']){
      const clock=work+'/clock.mjs';
      if(mode==='expire')fs.writeFileSync(clock,`const real=Date.now;let offset=0;Date.now=()=>real()+offset;const later=globalThis.setTimeout;globalThis.setTimeout=(f,n,...a)=>n>590000?later(()=>{offset=n+1;f(...a)},30):later(f,n,...a);`);
      const c=spawn(candidate+'/payload/runtime/bin/node',['--import',work+'/register.mjs',...(mode==='expire'?['--import',clock]:[]),candidate+'/payload/app/packages/cli/index.mjs','install','--choose-destination','--browser','codex'],{cwd:work,env});
      const ended=new Promise(r=>c.once('close',(code,signal)=>r({code,signal})));let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);
      try{
        const deadline=Date.now()+15000;while(!out.includes('AWAITING_FOUNDATION_DIRECTORY_SELECTION')&&c.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
        assert.match(out,/AWAITING_FOUNDATION_DIRECTORY_SELECTION/,err);
        if(mode==='cancel'){const first=JSON.parse(out.trim().split('\n')[0]);const html=await(await fetch(first.url)).text();const nonce=html.match(/nonce:"([a-f0-9]{64})"/)[1];const response=await fetch(first.url+'__foundation/install/selection',{method:'POST',headers:{origin:new URL(first.url).origin,'content-type':'application/json'},body:JSON.stringify({nonce,action:'cancel'})});assert.equal(response.status,200);}
        const exit=await ended;assert.equal(exit.code,0,err);assert.match(out,mode==='cancel'?/cancelled-no-install/:/expired-no-install/);assert(!out.includes('FOUNDATION_SELECTION_BOUND'));noInstallCases.push({mode,exit,stdout:out,stderr:err,clockSimulated:mode==='expire'});
      }finally{if(c.exitCode===null)c.kill('SIGTERM');await ended;}
    }
    invoke(launcher,['--foundation-health']);
    fs.writeFileSync(work+'/result.json',JSON.stringify({status:'ENGINEERING_PASS',candidateHash:manifest.candidateHash,build:manifest.build,version:manifest.productVersion,health,operation:status,noInstallCases,confirmationFixture:true,realUserConfirmation:false,freshConversation:false,simulated:['OS account','directory choices','confirmation fixture','expiry clock'],real:['candidate validation','selection HTTP','exact plan','transaction','stable launcher health','reopen']},null,2)+'\n');
    console.log('035 evidence '+path.relative(repo,work));
  }catch(error){fs.writeFileSync(work+'/failure.json',JSON.stringify({message:error.message,stack:error.stack},null,2));throw error;}
  finally{if(child.exitCode===null)child.kill('SIGTERM');await done;}
});
