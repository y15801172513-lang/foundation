import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function reject(message){throw new Error(`升级暂存盘点失败：${message}`);}
function plain(file){
  if(!path.isAbsolute(file)||path.normalize(file)!==file)reject('路径不是规范化绝对路径');
  for(let p=file;p!==path.dirname(p);p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink()||fs.realpathSync(p)!==p)reject('路径含链接或已漂移');
  return file;
}
function identity(file){const s=fs.lstatSync(plain(file));if(s.uid!==process.getuid()||(s.mode&0o7000))reject('所有者或特殊权限不明确');return{device:s.dev,inode:s.ino,uid:s.uid,mode:s.mode&0o777};}
function fileRecord(file){const s=fs.lstatSync(plain(file));if(!s.isFile()||s.nlink!==1)reject('不是独占普通文件');return{path:file,...identity(file),bytes:s.size,sha256:hash(fs.readFileSync(file))};}
const overlaps=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);

// Read-only admission, not installation authority. The signed exact plan binds
// these identities; apply repeats this snapshot before using any candidate.
export function snapshotAcquisitionCandidate(candidatePath,{homeRealPath,installRoot}) {
  const cache=path.join(homeRealPath,'Library/Caches/ai-product-foundation-kit-acquisition');
  const stage=path.dirname(candidatePath);
  for(const p of [homeRealPath,path.join(homeRealPath,'Library'),path.join(homeRealPath,'Library/Caches')]){const s=identity(p);if((s.mode&0o022)!==0||!fs.lstatSync(p).isDirectory())reject('账户缓存祖先可被其他用户写入');}
  if(path.dirname(stage)!==cache||!/^acquisition\.[A-Za-z0-9]+$/.test(path.basename(stage))||path.basename(candidatePath)!=='candidate')reject('不属于 OS 账户标准获取目录');
  for(const p of [cache,stage]){const s=identity(p);if(s.mode!==0o700)reject('获取目录不是当前账户独占 0700');}
  const operationFile=path.join(stage,'operation-result.json');if(fileRecord(operationFile).mode!==0o600)reject('操作记录权限无效');
  const operation=JSON.parse(fs.readFileSync(operationFile));
  if(operation.terminal!==false||!['acquired','awaiting-confirmation','executing'].includes(operation.phase)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(operation.operationId||''))reject('获取操作不是本次未结束记录');
  if(operation.installationRoot&&operation.installationRoot!==installRoot)reject('操作绑定其他安装目录');
  const receipt=JSON.parse(fs.readFileSync(plain(path.join(stage,'acquisition.json'))));
  const manifest=JSON.parse(fs.readFileSync(plain(path.join(candidatePath,'manifest.json'))));
  const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
  const {candidateHash,...body}=manifest;
  if(manifest.source?.kind!=='repository-local-build'||manifest.platform!==process.platform||manifest.arch!==process.arch||manifest.runtime?.officialSourceVerified!==true||!Number.isSafeInteger(receipt.releaseId)||receipt.releaseId<=0)reject('不是当前平台的正式来源候选');
  if(hash(canonical(body))!==candidateHash||receipt.verification!=='github-release-signature-timestamp-and-byte-binding'||receipt.repository!=='y15801172513-lang/foundation'||receipt.repositoryId!==1363748227||receipt.sourceCommit!==manifest.build?.identity||!/^[a-f0-9]{40}$/.test(receipt.sourceCommit||'')||receipt.tag!=='v'+manifest.productVersion||operation.version!==manifest.productVersion||operation.sourceCommit!==receipt.sourceCommit)reject('获取来源、操作或清单身份不一致');
  const snapshot=snapshotUpdateInputs({path:candidatePath,manifestHash:candidateHash},installRoot);
  const catalogName=`foundation-release-${manifest.productVersion}-macos-arm64.json`;
  const allowed=new Set(['candidate','acquisition.json','operation-result.json','tuf-targets','tuf-metadata',receipt.asset,receipt.asset+'.verification.json',catalogName,catalogName+'.verification.json']);
  for(const name of fs.readdirSync(stage))if(!allowed.has(name))reject('获取目录包含未知内容');
  const proofFile=path.join(stage,receipt.asset+'.verification.json');fileRecord(proofFile);
  const proof=JSON.parse(fs.readFileSync(proofFile));
  for(const key of ['repository','repositoryId','releaseId','tag','sourceCommit','asset','bytes','sha256','verification'])if(proof[key]!==receipt[key])reject('获取回执与来源核验记录不一致');
  const sourceEvidence=[];
  for(const name of [receipt.asset+'.verification.json',catalogName,catalogName+'.verification.json'])sourceEvidence.push(fileRecord(path.join(stage,name)));
  const catalog=JSON.parse(fs.readFileSync(path.join(stage,catalogName)));
  const releases=catalog.releases?.filter(x=>x.version===manifest.productVersion&&x.sourceCommit===receipt.sourceCommit&&x.candidateHash===candidateHash&&x.sha256===receipt.sha256&&x.bytes===receipt.bytes&&x.repositoryId===receipt.repositoryId);
  if(releases?.length!==1||releases[0].platform!==manifest.platform||releases[0].arch!==manifest.arch||releases[0].runtime?.binarySha256!==manifest.files.find(f=>f.path===manifest.runtime.path)?.sha256||releases[0].url!==`https://github.com/y15801172513-lang/foundation/releases/download/${receipt.tag}/${receipt.asset}`)reject('发行目录未绑定本次候选');
  const catalogProof=JSON.parse(fs.readFileSync(path.join(stage,catalogName+'.verification.json')));
  for(const key of ['repository','repositoryId','releaseId','tag','sourceCommit','verification'])if(catalogProof[key]!==receipt[key])reject('发行目录来源证明不一致');
  const catalogBytes=fs.readFileSync(path.join(stage,catalogName));if(catalogProof.asset!==catalogName||catalogProof.bytes!==catalogBytes.length||catalogProof.sha256!==hash(catalogBytes))reject('发行目录证明未绑定字节');
  const evidenceDirectories=[];
  function evidence(dir){evidenceDirectories.push({path:dir,...identity(dir)});for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name);plain(p);if(fs.lstatSync(p).isDirectory())evidence(p);else sourceEvidence.push(fileRecord(p));}}
  for(const name of ['tuf-targets','tuf-metadata'])evidence(path.join(stage,name));
  return {...snapshot,operationId:operation.operationId,sourceCommit:receipt.sourceCommit,cacheIdentity:identity(cache),sourceEvidence:sourceEvidence.sort((a,b)=>a.path.localeCompare(b.path)),evidenceDirectories};
}

// Read-only plan material. Execution is called only by the already-authorized
// transaction after a successful update, never by an exposed cleanup command.
export function snapshotUpdateInputs(candidate,installationRoot){
  const root=path.dirname(plain(path.resolve(candidate.path)));
  if(path.basename(candidate.path)!=='candidate'||overlaps(root,path.resolve(installationRoot)))reject('暂存与安装范围重叠或不是独占获取候选');
  const rootStat=fs.lstatSync(root);if(!rootStat.isDirectory()||(rootStat.mode&0o777)!==0o700)reject('获取目录不是私密目录');
  const receiptPath=path.join(root,'acquisition.json');const receiptRecord=fileRecord(receiptPath);
  const receipt=JSON.parse(fs.readFileSync(receiptPath));
  if(receipt.candidateHash!==candidate.manifestHash||receipt.launcher!==path.join(candidate.path,'foundation-kit')||!/^[a-f0-9]{64}$/.test(receipt.sha256||'')||receipt.asset!==`foundation-${receipt.sha256}.tar.gz`)reject('获取回执与候选不一致');
  const archive=fileRecord(path.join(root,receipt.asset));if(archive.sha256!==receipt.sha256||archive.bytes!==receipt.bytes)reject('归档已变化');
  const manifest=JSON.parse(fs.readFileSync(path.join(candidate.path,'manifest.json')));
  if(manifest.candidateHash!==candidate.manifestHash)reject('候选身份不一致');
  const expected=new Map([['manifest.json',null],['foundation-kit',manifest.launcher],...manifest.files.map(r=>['payload/'+r.path,r])]);
  const files=[archive];const directories=[];
  function walk(dir){const prefix=path.relative(candidate.path,dir);if(prefix&&![...expected.keys()].some(p=>p.startsWith(prefix+'/')))reject('候选含未知目录');directories.push({path:dir,...identity(dir)});for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.lstatSync(file);if(s.isDirectory()&&!s.isSymbolicLink())walk(file);else {const relative=path.relative(candidate.path,file);if(!expected.has(relative))reject('候选含未知文件');const record=fileRecord(file),bound=expected.get(relative);if(bound&&(record.bytes!==bound.size||record.mode!==bound.mode||record.sha256!==bound.sha256))reject('候选文件已修改');files.push(record);}}}
  walk(candidate.path);
  if(files.length!==expected.size+1)reject('候选缺失文件');
  return {schemaVersion:'1.0.0',executor:'confirmed-update-engine',root,rootIdentity:identity(root),candidateHash:candidate.manifestHash,receipt:receiptRecord,files:files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),directories:directories.sort((a,b)=>b.path.length-a.path.length),bytes:files.reduce((n,r)=>n+r.bytes,0),trigger:'same-confirmed-update-completed-current-health-and-consumers-ended',preserves:['acquisition.json','verification receipts','TUF metadata','installed current and rollback','projects','shared or unknown or changed files'],activity:'must-recheck-after-update',deletionAuthority:'same-human-confirmed-plan-and-host-permissions-required'};
}

export function finishConfirmedUpdateInputs(plan) {
  const scope=plan.hostCleanup,result={state:'retained',deleted:[],preserved:[],operationId:plan.planId,reason:'not-requested'};
  if(plan.operation!=='update'||scope?.executor!=='confirmed-update-engine')return result;
  const same=(p,r)=>{const s=fs.lstatSync(plain(p));return s.dev===r.device&&s.ino===r.inode&&s.uid===r.uid&&(s.mode&511)===r.mode;};
  const ancestors=()=>{if(!same(scope.root,scope.rootIdentity))throw Error('获取根已替换');for(const d of scope.directories)if(fs.existsSync(d.path)&&!same(d.path,d))throw Error('候选目录已替换');};
  try{
    ancestors();if(!same(scope.receipt.path,scope.receipt)||hash(fs.readFileSync(scope.receipt.path))!==scope.receipt.sha256)throw Error('获取回执已变化');
    // An open executable, cwd or file under these inputs means a consumer may
    // still depend on them. Unavailable inspection also preserves all inputs.
    const used=spawnSync('/usr/sbin/lsof',['-t','+D',scope.root],{encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin'}});
    if(used.error||used.signal||used.stdout?.trim()||used.stderr?.trim()||![0,1].includes(used.status))throw Error('暂存仍在使用或无法核验消费者');
    result.reason=null;
    for(const r of scope.files){try{ancestors();const s=fs.lstatSync(plain(r.path));if(!s.isFile()||s.nlink!==1||!same(r.path,r)||s.size!==r.bytes||hash(fs.readFileSync(r.path))!==r.sha256)throw Error('文件已变化');fs.unlinkSync(r.path);result.deleted.push(r.path);}catch{result.preserved.push({path:r.path,reason:'changed-missing-or-unavailable'});}}
    for(const d of scope.directories){try{if(same(d.path,d)&&fs.readdirSync(d.path).length===0)fs.rmdirSync(d.path);}catch{result.preserved.push({path:d.path,reason:'not-empty-changed-or-unavailable'});}}
    result.state=result.preserved.length?'partial':'completed';
  }catch(error){result.reason=error.message;result.preserved=scope.files.map(r=>({path:r.path,reason:'not-safe-to-clean'}));}
  // This secondary receipt failure must never turn a completed update into a rollback.
  try{ancestors();const file=path.join(scope.root,'cleanup-result.json');fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});result.recordLocation=file;}catch{result.recordSaved=false;}
  return result;
}
