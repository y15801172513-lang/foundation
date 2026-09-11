#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {inspectRelease,acquireRelease,plainPath} from '../lib/acquire.mjs';

import {parseSummonArgs} from '../lib/cli-options.mjs';

const help=`summon foundation [--version x.y.z] [--destination /absolute/folder]
summon foundation --inspect [--version x.y.z]
summon foundation --prepare --version x.y.z --destination /absolute/folder
summon foundation --acquire --version x.y.z
默认命令下载并验证正式发行，进入安装准备；未给目录时在安装页选择。不会静默安装或注册 Skill。
--inspect 才只读查询发行，不下载运行归档。
--prepare 下载并核验固定发行，打开 Foundation 本人确认流程；不会代替确认。
--acquire 仅下载并核验更新材料，返回候选与回执；不启动安装或执行更新。
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
try{
  const args=parseSummonArgs(process.argv.slice(2));
  if(args.help){console.log(help);process.exit(0);}
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||(major===22&&minor<9))fail('获取入口需要 Node.js 22.9 或以上；尚未安装，不自动安装依赖');
  if(process.platform!=='darwin'||process.arch!=='arm64')fail('当前仅支持 macOS arm64；尚未安装');
  if(args.prepare||args.acquire)sourceGuard();
  if(args.prepare)console.log('正在准备 Foundation 安装：将查询并固定本次正式版本，说明缓存位置后下载核验。未选目录会在安装页选择；之后仍需本人确认精确计划。请保持当前 Codex 任务等待并打开返回的内置浏览器网址；不会自动改用系统浏览器。');
  const context=inspectRelease(args.version);
  const guide=`https://github.com/${context.repository.full_name}/blob/${context.documentationCommit}/docs/install-with-codex.md`;
  if(!args.prepare&&!args.acquire){
    console.log(JSON.stringify({schemaVersion:'1.0.0',status:'RELEASE_DISCOVERED_NOT_ACQUIRED',product:'Foundation',version:context.version,sourceCommit:context.sourceCommit,documentationCommit:context.documentationCommit,repository:context.repository.full_name,guide,installationPerformed:false,skillRegistered:false,
      conversationNextStep:'本次 --inspect 仅查询；未下载、未安装，不自动接续写入。需要安装时由用户发起默认安装入口，并核对当前任务权限。',
      terminalBoundary:'普通终端无法创建或唤醒 Codex 对话；请在有相应权限的 Codex 任务发起安装。',
      acquisition:'尚未下载或验证运行归档。默认入口或 --prepare 执行匿名 GitHub 证明与完整性核验。'},null,2));
  }else{
    if(args.destination)plainPath(args.destination);const stage=stageDirectory();console.log(`本次独占获取目录：${stage}`);
    const receipt=await acquireRelease(context,stage);console.log(JSON.stringify({status:'GITHUB_ACQUISITION_VERIFIED',...receipt,destinationIntent:args.destination}));
    if(args.acquire){console.log(JSON.stringify({status:'UPDATE_INPUT_READY_NOT_APPLIED',candidate:path.dirname(receipt.launcher),receipt:path.join(stage,'acquisition.json'),next:'使用当前健康安装的稳定入口生成独立更新计划；本人确认后才更新。获取回执不是删除授权。'}));process.exit(0);}
    const env={...process.env};for(const key of ['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','NODE_REDIRECT_WARNINGS','NODE_COMPILE_CACHE','NODE_COMPILE_CACHE_PORTABLE','NODE_PRESERVE_SYMLINKS'])delete env[key];
    if(!args.destination){
      const supported=spawnSync(receipt.launcher,['onboarding','--help'],{encoding:'utf8',env,timeout:15000});
      if(supported.status!==0||!supported.stdout.includes('--choose-destination'))fail('本次发行尚不支持页面选择目录；未启动安装。请由当前对话取得目录后使用明确的 --destination，或等待新版发行，不静默采用默认位置');
    }
    const child=spawn(receipt.launcher,['install',...(args.destination?['--destination',args.destination]:['--choose-destination']),'--browser','codex'],{stdio:'inherit',env});
    const interrupt=signal=>{child.kill(signal);};
    const int=()=>interrupt('SIGINT'),term=()=>interrupt('SIGTERM');
    process.once('SIGINT',int);process.once('SIGTERM',term);
    const ended=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));}).finally(()=>{process.off('SIGINT',int);process.off('SIGTERM',term);});
    if(ended.signal||ended.code===null)fail(`确认服务未正常返回；结果待核实，保留 ${stage}，不要自动重试安装`);
    process.exitCode=ended.code;
  }
}catch(e){console.error(`错误：${e.message}`);process.exitCode=1;}
