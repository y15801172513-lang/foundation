import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';
const repo=fs.realpathSync(path.resolve(import.meta.dirname,'../..'));
const input=process.env.FOUNDATION_INSTALL_ENTRY_CANDIDATE;
for (const scenario of ['skipped','selected','reject-registration','unknown-skill-files']) test(`039 npm ${scenario}: real payload and product-owned Skill continuation`,{skip:!input,timeout:90000},async()=>{
  const skillChoice=scenario==='skipped'?'skipped':'selected';
  const candidate=fs.realpathSync(input);assert(candidate.startsWith(repo+'/.tmp/'));const manifest=JSON.parse(fs.readFileSync(candidate+'/manifest.json'));
  const work=fs.mkdtempSync(repo+'/.tmp/npm-final-036-'),home=work+'/account';fs.mkdirSync(home+'/Library/Application Support',{recursive:true});fs.mkdirSync(home+'/Library/Caches');
  if(scenario==='unknown-skill-files'){fs.mkdirSync(home+'/.agents/skills/ai-product-foundation-kit',{recursive:true});fs.writeFileSync(home+'/.agents/skills/ai-product-foundation-kit/SKILL.md','user-owned unknown skill\n');}
  const entry=new URL('../../distribution/summon-foundation/bin/summon.mjs',import.meta.url).href;
  // Only initial account discovery/acquisition are substituted. Production npm
  // orchestration, actual payload engine, stable launcher and workbench are real.
  fs.writeFileSync(work+'/account.mjs',`export function readCurrentPlatformAccount(){return{authority:'036-contained-account',platform:process.platform,uid:process.getuid(),gid:process.getgid(),username:'fixture',homedir:${JSON.stringify(home)}}}`);
  fs.writeFileSync(work+'/account-loader.mjs',`export async function resolve(s,c,n){const r=await n(s,c);return r.url.endsWith('/packages/cli/platform-account.mjs')?{url:new URL('./account.mjs',import.meta.url).href,shortCircuit:true}:r}`);
  fs.writeFileSync(work+'/account-register.mjs',`import{register}from'node:module';register(new URL('./account-loader.mjs',import.meta.url));`);
  fs.writeFileSync(work+'/acquire.mjs',`import fs from'node:fs';export{plainPath}from${JSON.stringify(new URL('../../distribution/summon-foundation/lib/acquire.mjs',import.meta.url).href)};export function inspectRelease(){return{version:${JSON.stringify(manifest.productVersion)},sourceCommit:'a'.repeat(40),documentationCommit:'b'.repeat(40),repository:{full_name:'y15801172513-lang/foundation'}}}export async function acquireRelease(c,s,o){o.onPhase('fetching-and-verifying-runtime');o.onProgress({downloadedBytes:7,totalBytes:null});const deadline=Date.now()+15000;while(!fs.existsSync(${JSON.stringify(work+'/release-download')})&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));if(!fs.existsSync(${JSON.stringify(work+'/release-download')}))throw Error('工程获取屏障超时');return{launcher:${JSON.stringify(candidate+'/foundation-kit')},installationConfirmed:false}}`);
  fs.writeFileSync(work+'/fs.mjs',`import fs from'node:fs';export default{...fs,existsSync(p){return String(p).endsWith('/AGENTS.md')?false:fs.existsSync(p)}};`);
  fs.writeFileSync(work+'/child.mjs',`import{spawn as real,spawnSync as sync}from'node:child_process';export function spawnSync(c,a,o){if(c==='/usr/bin/id')return{status:0,stdout:'fixture\\n'};if(c==='/usr/bin/dscl')return{status:0,stdout:${JSON.stringify('NFSHomeDirectory: '+home+'\n')}};return sync(c,a,o)}export function spawn(c,a,o){if(c===${JSON.stringify(candidate+'/foundation-kit')}&&a[0]==='install')return real(${JSON.stringify(candidate+'/payload/runtime/bin/node')},['--import',${JSON.stringify(work+'/account-register.mjs')},${JSON.stringify(candidate+'/payload/app/packages/cli/index.mjs')},...a],o);return real(c,a,o)}`);
  fs.writeFileSync(work+'/skill-child.mjs',`import fs from'node:fs';import{spawn as real,spawnSync as sync}from'node:child_process';function bound(c,a){if(!c.startsWith(${JSON.stringify(home+'/')})||!c.endsWith('/bin/foundation-kit'))throw Error('fixture rejects non-installed launcher');const root=c.slice(0,-'/bin/foundation-kit'.length),current=JSON.parse(fs.readFileSync(root+'/state/current.json'));return[root+'/'+current.runtimePath,['--import',${JSON.stringify(work+'/account-register.mjs')},root+'/'+current.entrypoint,...a]]}export function spawnSync(c,a,o){return sync(...bound(c,a),o)}export function spawn(c,a,o){return real(...bound(c,a),o)}`);
  fs.writeFileSync(work+'/loader.mjs',`export async function resolve(s,c,n){if(c.parentURL?.endsWith('/lib/manager-step.mjs')&&s==='node:child_process')return{url:new URL('./skill-child.mjs',import.meta.url).href,shortCircuit:true};if(c.parentURL===${JSON.stringify(entry)}||c.parentURL?.endsWith('/lib/acquisition-worker.mjs')){const m={'../lib/acquire.mjs':'acquire.mjs','./acquire.mjs':'acquire.mjs','node:child_process':'child.mjs','node:fs':'fs.mjs'};if(m[s])return{url:new URL(m[s],import.meta.url).href,shortCircuit:true}}return n(s,c)}`);
  fs.writeFileSync(work+'/register.mjs',`import{register}from'node:module';register(new URL('./loader.mjs',import.meta.url));`);
  const child=spawn(process.execPath,['--import',work+'/register.mjs',new URL(entry).pathname,'foundation'],{cwd:work,env:{...process.env,PATH:'',NODE_OPTIONS:'',TMPDIR:work}});let out='',err='',workbench;
  child.stdout.on('data',b=>{out+=b;fs.writeFileSync(work+'/stdout.log',out)});child.stderr.on('data',b=>{err+=b;fs.writeFileSync(work+'/stderr.log',err)});const done=new Promise(r=>child.once('close',(code,signal)=>r({code,signal})));
  try{
    const events=text=>text.split('\n').filter(l=>l.startsWith('{')).map(l=>{try{return JSON.parse(l)}catch{return{}}});
    const waitPage=async(getText,proc,status)=>{const deadline=Date.now()+15000;while(proc.exitCode===null&&Date.now()<deadline){const e=events(getText()).find(e=>e.status===status);if(e?.url)return e;await new Promise(r=>setTimeout(r,25));}assert.fail(getText()+err);};
    const progress=await waitPage(()=>out,child,'FOUNDATION_ACQUISITION_PROGRESS_PAGE'),url=progress.url,destination=home+'/Foundation 用户';
    const post=async(page,body)=>{const response=await fetch(page+'/action',{method:'POST',headers:{origin:new URL(page).origin,'content-type':'application/json'},body:JSON.stringify({csrf:page.split('/').at(-1),...body})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
    const initial=await(await fetch(url+'/state')).json();assert.equal(initial.record.phase,'choosing-intent');assert(!fs.existsSync(destination));assert(!out.includes('fetching-and-verifying-runtime'));
    fs.writeFileSync(work+'/initial.html',await(await fetch(url)).text());
    await post(url,{operationId:initial.record.operationId,action:'choose',destination,skillChoice});
    const deadline=Date.now()+15000;while(!out.includes('fetching-and-verifying-runtime')&&child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
    assert.match(out,/fetching-and-verifying-runtime/);assert(!fs.existsSync(destination));
    fs.writeFileSync(work+'/acquiring.html',await(await fetch(url)).text());fs.writeFileSync(work+'/release-download','engineering transport barrier released');
    const drive=async(page,{rejectRegister=false,requireNoInstall=false}={})=>{
      const sessions=[],until=Date.now()+30000;let state;
      while(Date.now()<until){
        state=await(await fetch(page+'/state')).json();
        if(state.record.terminal)break;
        const v=state.view;
        if(v?.session?.state==='pending'&&!sessions.some(s=>s.sessionId===v.session.sessionId)){
          if(requireNoInstall&&sessions.length===0){assert(!fs.existsSync(destination));assert.equal(v.session.operation,'install');}
          const register=v.session.operation==='register';
          const action=rejectRegister&&register?'cancel-no-change':v.action;
          sessions.push({sessionId:v.session.sessionId,planHash:v.session.planHash,operation:v.session.operation,capabilityId:v.session.capabilityId||null,action});
          const currentPage=await fetch(page,{redirect:'manual'});assert.equal(currentPage.status,200);fs.writeFileSync(work+'/page-'+v.session.sessionId+'.html',await currentPage.text());
          await post(page,{operationId:state.record.operationId,sessionId:v.session.sessionId,planHash:v.session.planHash,managerNonce:v.managerNonce,action});
        }
        await new Promise(r=>setTimeout(r,50));
      }
      assert.equal(state?.record.terminal,true,JSON.stringify(state));return{record:state.record,sessions,url:page};
    };
    const installed=await drive(url,{rejectRegister:scenario==='reject-registration',requireNoInstall:true}),exit=await done,last=installed.record;
    assert.equal(installed.sessions.filter(s=>!s.capabilityId).length,1);assert.equal(last.installationRoot,destination);
    assert.equal(last.programState,'completed');assert.equal(last.journeyContext.id,progress.operationId);
    assert.equal(last.journeyContext.skillChoice,skillChoice);
    if(['reject-registration','unknown-skill-files'].includes(scenario)){
      assert.equal(exit.code,1);assert.equal(last.state,'partial');assert.equal(last.skillRegistered,false);assert(!fs.existsSync(destination+'/state/codex-skill-registration.json'));
      if(scenario==='unknown-skill-files')assert.equal(fs.readFileSync(home+'/.agents/skills/ai-product-foundation-kit/SKILL.md','utf8'),'user-owned unknown skill\n');
      if(scenario==='reject-registration'){
        assert(installed.sessions.some(s=>s.operation==='register'&&s.action==='cancel-no-change'));
        const before=fs.readFileSync(destination+'/state/current.json');
        const resumed=spawn(process.execPath,['--import',work+'/register.mjs',new URL(entry).pathname,'foundation','--resume',last.resultFile],{cwd:work,env:{...process.env,PATH:'',NODE_OPTIONS:'',TMPDIR:work}});
        let text='',errors='';resumed.stdout.on('data',b=>{text+=b;fs.writeFileSync(work+'/resume.stdout.log',text)});resumed.stderr.on('data',b=>{errors+=b;fs.writeFileSync(work+'/resume.stderr.log',errors)});
        const ended=new Promise(r=>resumed.once('close',code=>r(code)));
        try{const page=await waitPage(()=>text,resumed,'FOUNDATION_SINGLE_PAGE'),recovered=await drive(page.url);assert.equal(await ended,0,text+errors);assert.equal(recovered.record.state,'completed');assert.equal(recovered.sessions.length,1);assert.equal(recovered.sessions[0].operation,'register');assert(!installed.sessions.some(s=>s.sessionId===recovered.sessions[0].sessionId));assert.deepEqual(fs.readFileSync(destination+'/state/current.json'),before);assert(fs.existsSync(home+'/.agents/skills/ai-product-foundation-kit/SKILL.md'));}finally{if(resumed.exitCode===null)resumed.kill('SIGTERM');await ended;}
      }
      fs.writeFileSync(work+'/result.json',JSON.stringify({scenario,status:'ENGINEERING_PASS',candidateHash:manifest.candidateHash,installed,exit,simulated:['account provider','preverified acquisition','engineering exact confirmation'],real:['single-page product continuation','partial terminal','program retained','unknown files preserved','resume without program replay'],freshConversation:false},null,2));return;
    }
    assert.equal(exit.code,0,err);assert.equal(last.state,'completed');assert.equal(last.phase,skillChoice==='selected'?'finished':'runtime-ended');assert.equal(last.terminal,true);assert.equal(last.skillRegistered,skillChoice==='selected');assert.equal(installed.sessions.length,skillChoice==='selected'?3:1);
    assert.equal(fs.existsSync(home+'/.agents/skills/ai-product-foundation-kit/SKILL.md'),skillChoice==='selected');
    // 040 never opens the workbench automatically. Reopen explicitly through the stable launcher.
    const launcher=destination+'/bin/foundation-kit',health=spawnSync(launcher,['--foundation-health'],{cwd:work,env:{...process.env,PATH:'',NODE_OPTIONS:'',TMPDIR:work},encoding:'utf8'});assert.equal(health.status,0,health.stderr);assert.equal(JSON.parse(health.stdout).version,manifest.productVersion);
    const opened=spawn(launcher,['workbench','open','--root',destination],{cwd:work,env:{...process.env,PATH:'',NODE_OPTIONS:'',TMPDIR:work}});let openedText='',openedErr='';opened.stdout.on('data',b=>openedText+=b);opened.stderr.on('data',b=>openedErr+=b);const openedDone=new Promise(r=>opened.once('close',r));
    try{const deadline=Date.now()+15000;while(!openedText.includes('"url"')&&opened.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));const ready=JSON.parse(openedText.trim());assert.equal((await fetch(ready.url)).status,200);}finally{if(opened.exitCode===null)opened.kill('SIGTERM');await openedDone;}
    fs.writeFileSync(destination+'/user-keep.txt','keep user data');
    const maintenance=spawn(process.execPath,['--import',work+'/register.mjs',new URL(entry).pathname,'foundation','--uninstall','--root',destination],{cwd:work,env:{...process.env,PATH:'',NODE_OPTIONS:'',TMPDIR:work}});
    let maintenanceOut='',maintenanceErr='';maintenance.stdout.on('data',b=>{maintenanceOut+=b;fs.writeFileSync(work+'/uninstall.stdout.log',maintenanceOut)});maintenance.stderr.on('data',b=>maintenanceErr+=b);
    const maintenanceDone=new Promise(r=>maintenance.once('close',(code,signal)=>r({code,signal})));
    try{
      const page=await waitPage(()=>maintenanceOut,maintenance,'FOUNDATION_SINGLE_PAGE'),removed=await drive(page.url),ended=await maintenanceDone,final=removed.record;
      assert.equal(ended.code,0,maintenanceOut+maintenanceErr);assert.equal(final.state,'completed');assert.equal(final.kind,'uninstall');assert.equal(removed.sessions.length,skillChoice==='selected'?2:1);
      assert(!fs.existsSync(destination+'/bin/foundation-kit'));assert.equal(JSON.parse(fs.readFileSync(final.uninstallReceipt)).state,'uninstalled');assert.equal(fs.readFileSync(destination+'/user-keep.txt','utf8'),'keep user data');assert(!fs.existsSync(home+'/.agents/skills/ai-product-foundation-kit/SKILL.md'));
      fs.writeFileSync(work+'/uninstall-result.json',JSON.stringify({ended,removed,confirmation:'engineering same-page fixture; product requested every plan'},null,2));
    }finally{if(maintenance.exitCode===null)maintenance.kill('SIGTERM');await maintenanceDone;}
    fs.writeFileSync(work+'/result.json',JSON.stringify({status:'ENGINEERING_PASS',candidateHash:manifest.candidateHash,installed,exit,simulated:['OS account','preverified acquisition','engineering exact page confirmation'],real:['single-page npm orchestration','payload install','stable health','explicit stable workbench reopen','finite exit'],freshConversation:false},null,2));console.log('040 npm final evidence '+path.relative(repo,work));
  }finally{if(child.exitCode===null)child.kill('SIGTERM');await done;}
});
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
    for(const mode of ['cancel','expire','terminate']){
      const clock=work+'/clock.mjs';
      if(mode==='expire')fs.writeFileSync(clock,`const real=Date.now;let offset=0;Date.now=()=>real()+offset;const later=globalThis.setTimeout;globalThis.setTimeout=(f,n,...a)=>n>590000?later(()=>{offset=n+1;f(...a)},30):later(f,n,...a);`);
      const c=spawn(candidate+'/payload/runtime/bin/node',['--import',work+'/register.mjs',...(mode==='expire'?['--import',clock]:[]),candidate+'/payload/app/packages/cli/index.mjs','install','--choose-destination','--browser','codex'],{cwd:work,env});
      const ended=new Promise(r=>c.once('close',(code,signal)=>r({code,signal})));let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);
      try{
        const deadline=Date.now()+15000;while(!out.includes('AWAITING_FOUNDATION_DIRECTORY_SELECTION')&&c.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
        assert.match(out,/AWAITING_FOUNDATION_DIRECTORY_SELECTION/,err);
        if(mode==='cancel'){const first=JSON.parse(out.trim().split('\n')[0]);const html=await(await fetch(first.url)).text();const nonce=html.match(/nonce:"([a-f0-9]{64})"/)[1];const response=await fetch(first.url+'__foundation/install/selection',{method:'POST',headers:{origin:new URL(first.url).origin,'content-type':'application/json'},body:JSON.stringify({nonce,action:'cancel'})});assert.equal(response.status,200);}
        if(mode==='terminate')c.kill('SIGTERM');
        const exit=await ended;assert.equal(exit.code,0,err);assert.match(out,mode==='cancel'?/cancelled-no-install/:mode==='expire'?/expired-no-install/:/shutdown-no-install/);assert(!out.includes('FOUNDATION_SELECTION_BOUND'));noInstallCases.push({mode,exit,stdout:out,stderr:err,clockSimulated:mode==='expire'});
      }finally{if(c.exitCode===null)c.kill('SIGTERM');await ended;}
    }
    invoke(launcher,['--foundation-health']);
    fs.writeFileSync(work+'/result.json',JSON.stringify({status:'ENGINEERING_PASS',candidateHash:manifest.candidateHash,build:manifest.build,version:manifest.productVersion,health,operation:status,noInstallCases,confirmationFixture:true,realUserConfirmation:false,freshConversation:false,simulated:['OS account','directory choices','confirmation fixture','expiry clock'],real:['candidate validation','selection HTTP','exact plan','transaction','stable launcher health','reopen']},null,2)+'\n');
    console.log('035 evidence '+path.relative(repo,work));
  }catch(error){fs.writeFileSync(work+'/failure.json',JSON.stringify({message:error.message,stack:error.stack},null,2));throw error;}
  finally{if(child.exitCode===null)child.kill('SIGTERM');await done;}
});
