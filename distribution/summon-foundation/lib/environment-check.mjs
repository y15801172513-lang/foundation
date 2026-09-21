import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {plainPath} from './local-path.mjs';

export function classifyEntryEnvironment({platform,arch,nodeVersion,tools}){
  const [major,minor]=String(nodeVersion||'').split('.').map(Number);
  const supported=platform==='darwin'&&arch==='arm64';
  const compatible=Number.isInteger(major)&&Number.isInteger(minor)&&(major>22||major===22&&minor>=9);
  const missing=tools.filter(x=>!x.available).map(x=>x.path);
  return{platform,arch,nodeVersion,supported,compatible,tools,state:!supported?'unsupported':!compatible?'environment-required':missing.length?'blocked':'ready',missing,sharedSettingsChanged:false};
}
export function inspectEntryEnvironment({purpose='acquire'}={}){
  // Hash/proof verification uses Node crypto. System shasum belongs only to the
  // no-Node preparation script, not an npm action or installed confirmation.
  const requirements={discover:['/usr/bin/curl'],acquire:['/usr/bin/curl','/usr/bin/tar'],confirm:[],uninstall:[],resume:[]};
  if(!Object.hasOwn(requirements,purpose))throw Error('未知环境检查动作');
  const tools=requirements[purpose].map(file=>{let available=false;try{fs.accessSync(file,fs.constants.X_OK);available=fs.statSync(file).isFile();}catch{}return{path:file,available};});
  const result={...classifyEntryEnvironment({platform:process.platform,arch:process.arch,nodeVersion:process.versions.node,tools}),purpose,entryRuntime:process.execPath,checkedAt:new Date().toISOString(),programRuntime:'随程序携带，不替换现有 Node'};
  const receipt=path.resolve(path.dirname(process.execPath),'../..','environment-result.txt');
  try{if(fs.existsSync(receipt)){
    plainPath(receipt);const stat=fs.lstatSync(receipt);if(!stat.isFile()||stat.size>65536)throw Error('基础环境回执异常，保留并核实');
    const fields=Object.fromEntries(fs.readFileSync(receipt,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
    const hash=crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex');
    if(fields.state!=='prepared-and-rechecked'||fields.node!==process.execPath||fields.node_sha256!==hash||fields.node_version!==process.versions.node)throw Error('基础环境回执与当前运行文件不一致，不继续');
    result.preparation={receipt,plan:fields.plan,state:fields.state,humanApproval:'由启动任务核验，本记录不是人类批准证明',retention:'获取器专用环境保留为缓存，不自动清理；不属于程序安装根'};
  }}catch{result.state='blocked';result.preparation={receipt,state:'verification-required',reason:'基础环境回执与当前运行文件无法核实；保留材料，不继续'};}
  return result;
}
export function inspectEntryDestination(input){
  let destination=String(input||'').trim();
  if((destination.startsWith('"')&&destination.endsWith('"'))||(destination.startsWith("'")&&destination.endsWith("'")))destination=destination.slice(1,-1);
  plainPath(destination);
  if(fs.existsSync(destination)&&(!fs.lstatSync(destination).isDirectory()||fs.readdirSync(destination).length))throw Error('安装目录已有内容或不是目录；请选择独立空目录，不覆盖已有文件');
  const parent=path.dirname(destination);plainPath(parent);if(!fs.existsSync(parent)||!fs.lstatSync(parent).isDirectory())throw Error('安装目录的父目录必须存在');
  fs.accessSync(parent,fs.constants.W_OK|fs.constants.X_OK);
  const disk=fs.statfsSync(parent),availableBytes=Number(disk.bavail)*Number(disk.bsize);
  if(!Number.isFinite(availableBytes)||availableBytes<=0)throw Error('无法确认可用空间；尚未下载或安装');
  return{destination,parent,availableBytes,checkedAt:new Date().toISOString(),authority:'intent-only; runtime rechecks exact bytes and plan'};
}

// Intent preflight only. The installed engine repeats identity checks and seals
// the actual scope in the independently confirmed lifecycle plan.
export function inspectScopeIntent(kind, input, destination){
  if(kind==='user'&&input==null)return {kind,projectRoot:null};
  throw Error('新安装供当前用户的不同项目共用，不接受项目范围；已有项目安装不会自动迁移');
}
