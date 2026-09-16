import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {LifecycleError, canonicalStringify} from './install-contract.mjs';
import {verifyTrustedPayload} from './trusted-authority.mjs';

const fail=(code,message)=>{throw new LifecycleError(code,message,{stage:'installation-scope'});};
const within=(root,file)=>file===root||file.startsWith(root+path.sep);
function realDirectory(directory){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||path.normalize(directory)!==directory)fail('INSTALL_SCOPE_PATH_INVALID','项目位置必须是完整真实路径');
  for(let p=directory;p!==path.dirname(p);p=path.dirname(p)){const s=fs.lstatSync(p);if(s.isSymbolicLink()||!s.isDirectory())fail('INSTALL_SCOPE_PATH_INVALID','项目路径不能包含链接或非目录');}
  if(fs.realpathSync(directory)!==directory)fail('INSTALL_SCOPE_PATH_INVALID','项目真实路径已变化');
  const s=fs.statSync(directory);return{path:directory,device:String(s.dev),inode:String(s.ino)};
}

// This is a plan input, not write authority. The enclosing immutable lifecycle
// plan and its manager confirmation authorize the exact chosen scope.
export function prepareInstallationScope({kind='user',projectRoot=null,installationRoot}={}){
  if(kind==='user'){
    if(projectRoot!==null)fail('INSTALL_SCOPE_INVALID','当前用户模式不能携带项目绑定');
    return{schemaVersion:'1.0.0',kind:'user',project:null};
  }
  if(kind!=='project')fail('INSTALL_SCOPE_INVALID','未知使用范围');
  const project=realDirectory(projectRoot);
  // Official discovery is bounded by the repository. Do not guess a non-Git
  // project's ancestor boundary or silently initialize a repository.
  const git=spawnSync('/usr/bin/git',['-C',projectRoot,'rev-parse','--show-toplevel'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',GIT_OPTIONAL_LOCKS:'0'},timeout:10000});
  if(git.status!==0||git.stdout.trim()!==projectRoot)fail('PROJECT_SKILL_SCOPE_UNVERIFIED','仅当前项目模式需要明确的 Git 仓库根；不会代建仓库或猜测发现范围');
  if(typeof installationRoot!=='string'||!path.isAbsolute(installationRoot)||path.normalize(installationRoot)!==installationRoot||within(projectRoot,installationRoot)||within(installationRoot,projectRoot))fail('INSTALL_SCOPE_DESTINATION_INVALID','程序使用独立目录并绑定此项目；不能与业务项目互相包含，以保留现有项目和卸载保护');
  return{schemaVersion:'1.0.0',kind:'project',project};
}

export function verifyInstallationScope(scope,installationRoot,{cwd=null,project=null}={}){
  if(!scope||scope.schemaVersion!=='1.0.0'||!['user','project'].includes(scope.kind))fail('INSTALL_SCOPE_INVALID','安装使用范围记录无效');
  if(scope.kind==='user'){if(scope.project!==null)fail('INSTALL_SCOPE_INVALID','用户范围含未知项目绑定');return scope;}
  const current=prepareInstallationScope({kind:'project',projectRoot:scope.project?.path,installationRoot});
  if(canonicalStringify(current)!==canonicalStringify(scope))fail('INSTALL_SCOPE_DRIFT','项目目录已移动、替换或身份变化；保留安装，不自动重新绑定');
  if(cwd!==null&&!within(scope.project.path,fs.realpathSync(cwd)))fail('INSTALL_SCOPE_OUTSIDE_PROJECT','此 Foundation 仅供绑定项目使用，请在该项目中重新打开任务');
  if(project!==null&&!within(scope.project.path,fs.realpathSync(project)))fail('INSTALL_SCOPE_OTHER_PROJECT','本安装不能接入或修改另一个项目');
  return scope;
}

export function readInstallationScope(installationRoot,options={}){
  const file=path.join(installationRoot,'state','current.json');
  if(!fs.existsSync(file))return null;
  for(let p=file;p!==path.dirname(p);p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())fail('INSTALL_SCOPE_RECORD_INVALID','使用范围记录路径含链接');
  if(!fs.lstatSync(file).isFile()||fs.statSync(file).size>1024*1024)fail('INSTALL_SCOPE_RECORD_INVALID','使用范围记录类型或大小无效');
  const{integrity,...record}=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!verifyTrustedPayload(record,integrity))fail('INSTALL_SCOPE_RECORD_INVALID','使用范围记录签名无效');
  return verifyInstallationScope(record.usageScope||{schemaVersion:'1.0.0',kind:'user',project:null},installationRoot,options);
}
