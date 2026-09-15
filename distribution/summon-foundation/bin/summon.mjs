#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {inspectRelease,plainPath} from '../lib/acquire.mjs';

import {acquireInWorker} from '../lib/acquisition-task.mjs';
import {startProgressPage} from '../lib/progress-page.mjs';
import {followSelectedSkill} from '../lib/skill-handoff.mjs';
import {followMaintenance} from '../lib/maintenance-handoff.mjs';
import {resumeSkillHandoff} from '../lib/resume-handoff.mjs';
import {parseSummonArgs} from '../lib/cli-options.mjs';
import {createOperation,saveOperation,readOperation,runtimeObservation} from '../lib/operation-result.mjs';

const help=`summon foundation [--version x.y.z] [--destination /absolute/folder]
summon foundation --inspect [--version x.y.z]
summon foundation --prepare --version x.y.z --destination /absolute/folder
summon foundation --acquire --version x.y.z
summon foundation --status /absolute/acquisition/operation-result.json
summon foundation --update --root /absolute/installed-folder --version x.y.z
summon foundation --uninstall --root /absolute/installed-folder
summon foundation --resume /absolute/acquisition/operation-result.json
默认命令下载并验证正式发行，进入安装准备；未给目录时在安装页选择。不会静默安装或注册 Skill。
--inspect 才只读查询发行，不下载运行归档。
--prepare 下载并核验固定发行，打开 Foundation 本人确认流程；不会代替确认。
--acquire 仅下载并核验更新材料，返回候选与回执；不启动安装或执行更新。
--status 只读本次结果记录；中间记录不证明进程仍在运行，不重试或重放确认。
--update / --uninstall 从已安装稳定入口组织必要步骤；每一步仍需页面独立确认，不自动注册原本没有的 Skill。
--resume 明确恢复程序已完成后的所选 Skill；核验当前安装与旧记录后仅准备未完成项的新确认，不重复安装。
仅 macOS arm64。npm 入口需要 Node/npm；已安装 Foundation 使用随包运行时。
普通终端不能控制 Codex 对话或内置浏览器。无需 npm 的引导见公共仓库安装说明。`;
function fail(message){throw Error(message);}
function sourceGuard(){
  for(const start of [fs.realpathSync(process.cwd()),fs.realpathSync(import.meta.dirname)]){
    for(let p=start;p!==path.dirname(p);p=path.dirname(p)){
      if(fs.existsSync(path.join(p,'AGENTS.md'))&&fs.existsSync(path.join(p,'packages/core/trusted-authority.mjs')))fail('SOURCE_ONLY：源码建设目录不得操作真实安装缓存；请在有安装权限的独立任务使用正式 npm 入口');
    }
  }
}
function stageDirectory(){
  const account=spawnSync('/usr/bin/id',['-un'],{encoding:'utf8'});if(account.status!==0)fail('无法读取 OS 账户');
  const r=spawnSync('/usr/bin/dscl',['.','-read',`/Users/${account.stdout.trim()}`,'NFSHomeDirectory'],{encoding:'utf8'});
  const match=/^NFSHomeDirectory: (\/[^\n]+)\n?$/.exec(r.stdout);if(r.status!==0||!match)fail('无法核验 OS 主目录；不使用 HOME 替代');
  const home=plainPath(match[1]);const cache=path.join(home,'Library/Caches/ai-product-foundation-kit-acquisition');
  console.log(`确认前将写入获取缓存：${cache}。下载材料暂时保留；安装目录仍需本人在页面确认。npm 自己的下载缓存由 npm 管理。`);
  for(const p of [path.join(home,'Library'),path.join(home,'Library/Caches'),cache]){plainPath(p);if(!fs.existsSync(p))fs.mkdirSync(p,{mode:0o700});if(!fs.lstatSync(p).isDirectory())fail('缓存祖先不是目录');}
  const stat=fs.lstatSync(cache);if(stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700)fail('获取缓存必须由当前用户独占 0700；不会自动 chmod 已有目录');
  return fs.mkdtempSync(path.join(cache,'acquisition.'));
}
let operation=null,stage=null,progressPage=null;
function updateOperation(patch){if(!operation)return;Object.assign(operation,patch,{updatedAt:new Date().toISOString()});const file=saveOperation(operation,stage);if(file)operation.resultFile=file;progressPage?.publish();console.log(JSON.stringify({status:'FOUNDATION_INSTALL_OPERATION',...operation,resultFile:file,recordSaved:!!file}));}
async function openInstalledWorkbench(root,env){
  let child;
  try{
    plainPath(root);const launcher=path.join(root,'bin/foundation-kit');plainPath(launcher);
    const stdout=path.join(stage,'workbench.stdout.log'),stderr=path.join(stage,'workbench.stderr.log');
    const out=fs.openSync(stdout,'wx',0o600);let err;
    try{err=fs.openSync(stderr,'wx',0o600);child=spawn(launcher,['workbench','open','--root',root],{detached:true,stdio:['ignore',out,err],env});}finally{fs.closeSync(out);if(err!==undefined)fs.closeSync(err);}
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    for(let n=0;n<100;n++){
      if(child.exitCode!==null)throw Error('工作台进程提前退出');
      let ready;try{ready=JSON.parse(fs.readFileSync(stdout,'utf8'));}catch{}
      if(ready?.url){const url=new URL(ready.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)throw Error('工作台网址无效');const response=await fetch(url,{signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)throw Error('工作台未就绪');return{state:'ready',url:url.href,pid:child.pid,requiredHostAction:'open-returned-loopback-url-in-codex-browser'};}
      await new Promise(r=>setTimeout(r,100));
    }
    throw Error('工作台启动超时');
  }catch{if(child&&child.exitCode===null)child.kill('SIGTERM');return{state:'not-ready',reason:'安装结果保留；工作台未能就绪，可从已安装入口重新打开'};}
}
try{
  const args=parseSummonArgs(process.argv.slice(2));
  if(args.help){console.log(help);process.exit(0);}
  if(args.status){console.log(JSON.stringify(readOperation(args.status),null,2));process.exit(0);}
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<9))fail('获取入口需要 Node.js 22.9 或以上；尚未安装，不自动安装依赖');
  if(process.platform!=='darwin'||process.arch!=='arm64')fail('当前仅支持 macOS arm64；尚未安装');
  const maintenance=args.update||args.uninstall;
  if(args.prepare||args.acquire||maintenance||args.resume)sourceGuard();
  if(args.prepare||args.acquire||maintenance){operation=createOperation();stage=stageDirectory();updateOperation({});if(!saveOperation(operation,stage))fail('无法在已披露的获取目录保存操作记录；尚未联网或安装');}
  if(args.prepare)console.log('正在准备 Foundation 安装：将查询并固定本次正式版本，说明缓存位置后下载核验。未选目录会在安装页选择；之后仍需本人确认精确计划。请保持当前 Codex 任务等待并打开返回的内置浏览器网址；不会自动改用系统浏览器。');
  if(args.resume){
    const env={...process.env};for(const key of ['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','NODE_REDIRECT_WARNINGS','NODE_COMPILE_CACHE','NODE_COMPILE_CACHE_PORTABLE','NODE_PRESERVE_SYMLINKS'])delete env[key];
    const result=await resumeSkillHandoff({file:args.resume,env,onChange:patch=>{if(!operation){operation=patch;stage=path.dirname(plainPath(args.resume));}updateOperation(patch);}});
    updateOperation(result);process.exitCode=result.state==='completed'?0:1;
  }else if(maintenance){
    plainPath(args.root);
    const env={...process.env};for(const key of ['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','NODE_REDIRECT_WARNINGS','NODE_COMPILE_CACHE','NODE_COMPILE_CACHE_PORTABLE','NODE_PRESERVE_SYMLINKS'])delete env[key];
    updateOperation({kind:args.update?'update':'uninstall',installationRoot:args.root});
    progressPage=await startProgressPage(()=>operation);updateOperation({progressUrl:progressPage.url});
    let candidate;
    if(args.update){
      const {context,receipt}=await acquireInWorker({version:args.version,stage,operationId:operation.operationId,onContext:context=>updateOperation({version:context.version,sourceCommit:context.sourceCommit}),onProgress:download=>updateOperation({download}),onPhase:phase=>updateOperation({phase})});
      const directory=plainPath(path.dirname(receipt.launcher)),manifest=JSON.parse(fs.readFileSync(plainPath(path.join(directory,'manifest.json'))));
      if(manifest.productVersion!==context.version)fail('获取版本与候选不一致');
      candidate={path:directory,manifestHash:manifest.candidateHash,version:manifest.productVersion,bytes:manifest.totalBytes,runtimeHash:manifest.files.find(f=>f.path===manifest.runtime.path)?.sha256};
    }
    updateOperation(await followMaintenance({operation,kind:operation.kind,candidate,env,onChange:updateOperation}));
    process.exitCode=operation.state==='completed'?0:1;
    await progressPage.close();progressPage=null;
  }else if(!args.prepare&&!args.acquire){
    const context=inspectRelease(args.version);
    const guide=`https://github.com/${context.repository.full_name}/blob/${context.documentationCommit}/docs/install-with-codex.md`;
    console.log(JSON.stringify({schemaVersion:'1.0.0',status:'RELEASE_DISCOVERED_NOT_ACQUIRED',product:'Foundation',version:context.version,sourceCommit:context.sourceCommit,documentationCommit:context.documentationCommit,repository:context.repository.full_name,guide,installationPerformed:false,skillRegistered:false,
      conversationNextStep:'本次 --inspect 仅查询；未下载、未安装，不自动接续写入。需要安装时由用户发起默认安装入口，并核对当前任务权限。',
      terminalBoundary:'普通终端无法创建或唤醒 Codex 对话；请在有相应权限的 Codex 任务发起安装。',
      acquisition:'尚未下载或验证运行归档。默认入口或 --prepare 执行匿名 GitHub 证明与完整性核验。'},null,2));
  }else{
    if(args.destination)plainPath(args.destination);console.log(`本次独占获取目录：${stage}`);
    progressPage=await startProgressPage(()=>operation);
    updateOperation({progressUrl:progressPage.url});
    console.log(JSON.stringify({status:'FOUNDATION_ACQUISITION_PROGRESS_PAGE',url:progressPage.url,operationId:operation.operationId,next:'在 Codex 内置浏览器打开同次只读进度页，保持任务等待；不会自动打开系统浏览器。'}));
    const {context,receipt}=await acquireInWorker({version:args.version,stage,operationId:operation.operationId,onContext:context=>updateOperation({version:context.version,sourceCommit:context.sourceCommit}),onProgress:download=>updateOperation({download}),onPhase:phase=>updateOperation({phase})});console.log(JSON.stringify({status:'GITHUB_ACQUISITION_VERIFIED',...receipt,destinationIntent:args.destination}));
    updateOperation({phase:'acquired',version:context.version,sourceCommit:context.sourceCommit});
    if(args.acquire){updateOperation({state:'update-input-ready',terminal:true});console.log(JSON.stringify({status:'UPDATE_INPUT_READY_NOT_APPLIED',candidate:path.dirname(receipt.launcher),receipt:path.join(stage,'acquisition.json'),next:'使用当前健康安装的稳定入口生成独立更新计划；本人确认后才更新。获取回执不是删除授权。'}));await progressPage.close();progressPage=null;process.exit(0);}
    const env={...process.env};for(const key of ['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','NODE_REDIRECT_WARNINGS','NODE_COMPILE_CACHE','NODE_COMPILE_CACHE_PORTABLE','NODE_PRESERVE_SYMLINKS'])delete env[key];
    const supported=spawnSync(receipt.launcher,['--help'],{encoding:'utf8',env,timeout:15000});
    if(!args.destination){
      if(supported.status!==0||!supported.stdout.includes('--choose-destination'))fail('本次发行尚不支持页面选择目录；未启动安装。请由当前对话取得目录后使用明确的 --destination，或等待新版发行，不静默采用默认位置');
    }
    updateOperation({phase:'starting-confirmation-service',installationWrites:'unknown'});
    const child=spawn(receipt.launcher,['install',...(!args.destination&&supported.stdout?.includes('--journey-id')?['--journey-id',operation.operationId]:[]),...(args.destination?['--destination',args.destination]:['--choose-destination']),'--browser','codex'],{stdio:['inherit','pipe','inherit'],env});
    child.stdout.setEncoding('utf8');
    let pending='',json='';
    child.stdout.on('data',bytes=>{process.stdout.write(bytes);pending+=bytes.toString();if(pending.length>1_000_000){pending='';json='';return;}let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(!json&&!line.trim().startsWith('{'))continue;json+=line+'\n';if(json.length>1_000_000){json='';continue;}let e;try{e=JSON.parse(json)}catch{continue}json='';
      const observed=runtimeObservation(e);if(observed)updateOperation(observed);
    }});
    const interrupt=signal=>{child.kill(signal);};
    const int=()=>interrupt('SIGINT'),term=()=>interrupt('SIGTERM');
    process.once('SIGINT',int);process.once('SIGTERM',term);
    const ended=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));}).finally(()=>{process.off('SIGINT',int);process.off('SIGTERM',term);});
    if(ended.signal||ended.code===null)fail(`确认服务未正常返回；结果待核实，保留 ${stage}，不要自动重试安装`);
    if(operation.state==='awaiting-skill'){
      try{updateOperation(await followSelectedSkill({operation,env,onChange:updateOperation}));}
      catch(error){updateOperation({state:'partial',phase:'finished',terminal:true,skillRegistered:false,handoffFailure:{code:error.code||'SKILL_HANDOFF_REQUIRES_VERIFICATION',command:error.command||null,exitCode:error.exitCode??null},next:'程序已安装，Skill 接续未完成；保留当前计划与结果，仅核实未完成步骤，不重装程序或重放确认。'});}
    }
    if(!operation.terminal)updateOperation({state:'verification-required',terminal:true,childExitCode:ended.code,next:'服务退出不等于成功或取消；只读核验原 session 与 installed 状态，不自动重试'});
    if(operation.state==='completed'&&operation.installationRoot){
      const workbench=await openInstalledWorkbench(operation.installationRoot,env);
      updateOperation({phase:'finished',workbench,next:workbench.state==='ready'?(operation.skillRegistered?'打开已安装工作台；Skill 文件已注册，新对话识别与项目接入另验':'打开已安装工作台；本次未注册 Skill，项目接入另行确认'):'安装已完成，但工作台未就绪；保留安装结果并只读检查'});
    }
    process.exitCode=operation.state==='partial'?1:ended.code;
  }
}catch(e){const message=String(e.message).replace(/https?:\/\/\S+/g,'[已脱敏网址]').replace(/(?:github_pat_|ghp_|npm_)[A-Za-z0-9_]+/g,'[已脱敏凭据]');updateOperation({state:operation?.programState==='completed'?'partial':operation&&operation.installationWrites!=='none'?'verification-required':'failed',terminal:true,...(operation?.programState==='completed'?{failedPhase:operation.phase,phase:'finished'}:{}),errorCode:['ACQUISITION_TRANSPORT_FAILED','ACQUISITION_VALIDATION_FAILED'].includes(e.code)?e.code:'INSTALL_ENTRY_FAILED',diagnostic:e.diagnostic||null,next:message+'。先核验旧工具进程已结束及同次结果；保留材料，不自动重试或重放安装确认'});console.error(`错误：${message}`);process.exitCode=1;}finally{if(progressPage)await progressPage.close();}
