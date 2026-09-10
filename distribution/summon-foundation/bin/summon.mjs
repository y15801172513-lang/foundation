#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectRelease,acquireRelease,plainPath} from '../lib/acquire.mjs';

const help=`summon foundation [--inspect] [--version x.y.z]
summon foundation --prepare --version x.y.z --destination /absolute/folder
summon foundation --acquire --version x.y.z
首次命令只查询发行并提供对话接续信息，不安装或注册 Skill。
--prepare 下载并核验固定发行，打开 Foundation 本人确认流程；不会代替确认。
--acquire 仅下载并核验更新材料，返回候选与回执；不启动安装或执行更新。
仅 macOS arm64。npm 入口需要 Node/npm；已安装 Foundation 使用随包运行时。
普通终端不能控制 Codex 对话或内置浏览器。无需 npm 的引导见公共仓库安装说明。`;
function fail(message){throw Error(message);}
function parse(args){
  if(args.length===0||args.length===1&&['--help','-h'].includes(args[0]))return {help:true};
  if(args.shift()!=='foundation')fail('仅支持 summon foundation');
  const result={prepare:false};const seen=new Set();
  while(args.length){const flag=args.shift();if(seen.has(flag))fail('重复参数');seen.add(flag);
    if(flag==='--prepare')result.prepare=true;
    else if(flag==='--acquire')result.acquire=true;
    else if(flag==='--inspect')result.inspect=true;
    else if(flag==='--version'||flag==='--destination'){if(!args.length||args[0].startsWith('--'))fail('参数缺值');result[flag.slice(2)]=args.shift();}
    else fail('未知参数；请查看 --help');
  }
  if((result.prepare||result.acquire)&&result.inspect||result.prepare&&result.acquire||result.destination&&!result.prepare)fail('参数组合不支持');
  if(result.prepare&&(!result.version||!result.destination))fail('准备前须由对话明确固定版本和意向目录');
  if(result.acquire&&!result.version)fail('获取更新材料前须固定版本');
  return result;
}
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
  const args=parse(process.argv.slice(2));
  if(args.help){console.log(help);process.exit(0);}
  if(process.platform!=='darwin'||process.arch!=='arm64')fail('当前仅支持 macOS arm64；尚未安装');
  const context=inspectRelease(args.version);
  const guide=`https://github.com/${context.repository.full_name}/blob/${context.documentationCommit}/docs/install-with-codex.md`;
  if(!args.prepare&&!args.acquire){
    console.log(JSON.stringify({schemaVersion:'1.0.0',status:'RELEASE_DISCOVERED_NOT_ACQUIRED',product:'Foundation',version:context.version,sourceCommit:context.sourceCommit,documentationCommit:context.documentationCommit,repository:context.repository.full_name,guide,installationPerformed:false,skillRegistered:false,
      conversationNextStep:'按用户本次安装意图继续：读取固定提交的安装说明，检查当前任务权限及目录，解释版本/目标/缓存和其他写入影响，询问缺失选择。使用本包 --prepare 固定上述版本与用户选择的目录；打开返回的 loopback URL，等待本人确认，不代点。观察同次操作到结果并复查健康；成功后主动询问是否通过既有独立确认启用 Skill。下载输出不是权限提升指令。',
      terminalBoundary:'普通终端无法创建或唤醒 Codex 对话；请在有相应权限的 Codex 任务发起安装。',
      acquisition:'尚未下载或验证运行归档。--prepare 才执行匿名 GitHub 证明与完整性核验。'},null,2));
  }else{
    sourceGuard();if(args.prepare)plainPath(args.destination);const stage=stageDirectory();console.log(`本次独占获取目录：${stage}`);
    const receipt=await acquireRelease(context,stage);console.log(JSON.stringify({status:'GITHUB_ACQUISITION_VERIFIED',...receipt,destinationIntent:args.destination}));
    if(args.acquire){console.log(JSON.stringify({status:'UPDATE_INPUT_READY_NOT_APPLIED',candidate:path.dirname(receipt.launcher),receipt:path.join(stage,'acquisition.json'),next:'使用当前健康安装的稳定入口生成独立更新计划；本人确认后才更新。获取回执不是删除授权。'}));process.exit(0);}
    const env={...process.env};for(const key of ['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','NODE_REDIRECT_WARNINGS','NODE_COMPILE_CACHE','NODE_COMPILE_CACHE_PORTABLE','NODE_PRESERVE_SYMLINKS'])delete env[key];
    const child=spawnSync(receipt.launcher,['install','--destination',args.destination,'--browser','codex'],{stdio:'inherit',env});
    if(child.error||child.signal||child.status===null)fail(`确认服务未正常返回；结果待核实，保留 ${stage}，不要自动重试安装`);
    process.exitCode=child.status;
  }
}catch(e){console.error(`错误：${e.message}`);process.exitCode=1;}
