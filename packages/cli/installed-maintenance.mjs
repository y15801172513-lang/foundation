import fs from 'node:fs';
import path from 'node:path';
import {plainPath} from '../../distribution/summon-foundation/lib/local-path.mjs';
import {createOperation,saveOperation,readOperation,operationExitCode,discoverOperations,selectResumableOperation} from '../../distribution/summon-foundation/lib/operation-result.mjs';
import {installedClient,discoverRegisteredInstallation} from '../../distribution/summon-foundation/lib/manager-step.mjs';
import {followMaintenance} from '../../distribution/summon-foundation/lib/maintenance-handoff.mjs';
import {resumeSkillHandoff} from '../../distribution/summon-foundation/lib/resume-handoff.mjs';
import {createJourneyControl} from '../../distribution/summon-foundation/lib/journey-control.mjs';
import {startProgressPage} from '../../distribution/summon-foundation/lib/progress-page.mjs';

function privateDirectory(directory){
 plainPath(directory);
 if(!fs.existsSync(directory))fs.mkdirSync(directory,{mode:0o700});
 const s=fs.lstatSync(directory);if(!s.isDirectory()||s.uid!==process.getuid()||(s.mode&511)!==448)throw Error('维护记录目录必须由当前账户独占 0700');
 return directory;
}
export async function runInstalledMaintenance({authority,args,output}) {
 if(authority.mode!=='platform-installed-runtime')throw Error('维护入口只接受已核验的当前安装；源码或候选不能冒充安装');
 const option=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
 const root=plainPath(authority.installRoot),env={...process.env};
 for(const key of ['NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','NODE_REDIRECT_WARNINGS','NODE_COMPILE_CACHE','NODE_COMPILE_CACHE_PORTABLE','NODE_PRESERVE_SYMLINKS'])delete env[key];
 const registered=option('--binding')?discoverRegisteredInstallation(option('--binding'),env):null;
 if(registered&&registered.installationRoot!==root)throw Error('注册记录不属于此稳定入口');
 const current=installedClient(root,env).call(['manager','inspect','--root',root]).installation?.current;
 if(!current?.identity?.installId||(registered?.installId||option('--install-id'))!==current.identity.installId)throw Error('安装定位身份不符或缺失；保留文件，按明确安装位置核对 current，不能扫描磁盘猜测');
 const home=plainPath(authority.homeRealPath);
 const records=path.join(home,'Library','Application Support','Foundation Maintenance',current.identity.installId);
 if(args[1]==='status'){
  const discovery=discoverOperations({home,installationRoot:root,installId:current.identity.installId});
  output.log(JSON.stringify({installationRoot:root,installId:current.identity.installId,currentVersion:current.version,records,...discovery},null,2));return;
 }
 let previous=null;
 if(args[1]==='resume'){
  previous=option('--record')?readOperation(plainPath(option('--record'))):selectResumableOperation(discoverOperations({home,installationRoot:root,installId:current.identity.installId}),option('--operation-id'));
  previous.kind ||= previous.programState==='completed'?'install':null;
  if(previous.installationRoot!==root||previous.installId!==current.identity.installId||(previous.installedCandidateHash||previous.previousCandidateHash)&&current.candidateHash!==(previous.installedCandidateHash||previous.previousCandidateHash))throw Error('旧记录与当前安装身份不一致');
  if(previous.pid&&previous.pid!==process.pid){try{process.kill(previous.pid,0);throw Error('旧进程仍存在；先查询原操作，不并发恢复')}catch(e){if(e.code!=='ESRCH')throw e}}
  if(previous.currentPlanRef){const old=installedClient(root,env).call(['manager','status','--plan-ref',previous.currentPlanRef]);if(['executing','consumed','pending'].includes(old.state))throw Error('原计划尚未明确结束；先核对、取消或等待到期，不创建并发批准');}
  if(previous.kind!=='uninstall'&&!(previous.programState==='completed'&&previous.journeyContext?.skillChoice==='selected'))throw Error('本记录不能自动续接；只读核对后为明确的剩余动作创建新计划');
  if(previous.kind==='uninstall'&&previous.programState==='completed')throw Error('程序卸载已完成，请读独立卸载回执，不重复执行');
 }
 const kind=previous?.kind||args[1];
 if(!['uninstall','update','install'].includes(kind))throw Error('维护动作无效');
 let candidate;
 if(kind==='update'&&!previous&&!option('--candidate')){
  output.log(JSON.stringify({state:'acquisition-required',installationRoot:root,installId:current.identity.installId,currentVersion:current.version,mutationPerformed:false,executionAuthority:false,
   route:{product:'summon foundation',arguments:['foundation','--update','--root',root],source:'https://github.com/y15801172513-lang/foundation/blob/main/docs/install-with-codex.md'},
   next:'使用正式说明核验的获取入口查询并固定目标发行，再从 --update 同页流程下载、核验和独立确认。需要独立获取环境与该缓存的写入权限；不要运行未核验的 npx。离线时保留当前安装，卸载不依赖此环境。'},null,2));return;
 }
 if(kind==='update'&&!previous){
  const directory=plainPath(option('--candidate'));
  const m=JSON.parse(fs.readFileSync(plainPath(path.join(directory,'manifest.json'))));
  candidate={path:directory,manifestHash:m.candidateHash,version:m.productVersion,bytes:m.totalBytes,runtimeHash:m.files.find(f=>f.path===m.runtime.path)?.sha256};
 }
 for(const old of discoverOperations({home,installationRoot:root,installId:current.identity.installId}).operations){
  if((!old.terminal||old.resumable)&&old.pid&&old.pid!==process.pid){try{process.kill(old.pid,0);throw Error('该安装已有未结束的获取或维护进程；只读查询原记录，不并行创建计划')}catch(e){if(e.code!=='ESRCH')throw e}}
  if(!old.terminal&&old.currentPlanRef){const status=installedClient(root,env).call(['manager','status','--plan-ref',old.currentPlanRef]);if(['pending','executing','consumed'].includes(status.state))throw Error('已有未结束的精确计划；先核对原操作，不创建并发批准');}
 }
 privateDirectory(path.dirname(records));privateDirectory(records);
 let operation={...createOperation(),kind,installationRoot:root,currentVersion:current.version,installId:current.identity.installId,previousCandidateHash:current.candidateHash,...(previous?{resumes:previous.operationId}: {})};
 const stage=privateDirectory(path.join(records,'operation-'+operation.operationId));let page;
 const update=patch=>{Object.assign(operation,patch,{updatedAt:new Date().toISOString()});operation.resultFile=path.join(stage,'operation-result.json');if(!saveOperation(operation,stage))throw Error('维护记录保存失败，停止接续');page?.publish();output.log(JSON.stringify({status:'FOUNDATION_INSTALL_OPERATION',...operation}));};
 const control=createJourneyControl(()=>operation,patch=>patch?update(patch):page?.publish());
 update({});
 try{
  page=await startProgressPage(()=>operation,{control});update({progressUrl:page.url});output.log(JSON.stringify({status:'FOUNDATION_SINGLE_PAGE',url:page.url,operationId:operation.operationId}));
  const result=previous&&kind!=='uninstall'?await resumeSkillHandoff({file:previous.resultFile||option('--record'),env,journeyControl:control,newOperation:operation,onChange:update}):await followMaintenance({operation,kind,candidate,env,onChange:update,journeyControl:control});
  update(result);process.exitCode=operationExitCode(operation);
 }catch(error){update({state:'verification-required',terminal:true,phase:'finished',next:error.message+'；保留本次记录，只读核对后再明确继续，不重放批准'});process.exitCode=1;throw error;}
 finally{if(page)await page.close();}
}
