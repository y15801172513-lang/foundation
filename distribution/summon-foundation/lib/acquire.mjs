import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Updater} from 'tuf-js';
import snappy from 'snappyjs';
import {verifyReleaseProof} from './release-proof.mjs';
import policy from './public-policy.json' with {type:'json'};
import {readOperation} from './operation-result.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Object.assign(new Error(`错误：${message}`),{code:'ACQUISITION_VALIDATION_FAILED'}); };
const semver = /^\d+\.\d+\.\d+$/;
const json = bytes => JSON.parse(bytes.toString('utf8'));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value==='object' ? `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
export function downloadFailure(result,hostname) {
  const code=Number.isInteger(result.status)?result.status:null;
  const category=({5:'proxy-dns',6:'dns',7:'connection',22:'http',28:'timeout-or-low-speed',35:'tls',60:'tls-certificate'})[code] || (result.signal?'terminated':'transport');
  // Do not retain stderr: redirects, proxy credentials and signed query URLs may occur there.
  const error=Error(`匿名获取失败（${hostname}）；类别 ${category}，curl 退出码 ${code ?? '未知'}；未执行安装`);
  error.code='ACQUISITION_TRANSPORT_FAILED';error.diagnostic={category,curlExitCode:code,signal:['SIGINT','SIGTERM','SIGKILL'].includes(result.signal)?result.signal:null,host:hostname};return error;
}
// Public transport never reads gh credentials or curl configuration. Proxy
// environment remains optional; neither Mono nor an author path is packaged.
function download(url, limit=10_000_000) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password) fail('只接受无凭证 HTTPS 地址');
  const env = {PATH:'/usr/bin:/bin'};
  for (const key of ['HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy','TMPDIR']) if (process.env[key]) env[key]=process.env[key];
  const r=spawnSync('/usr/bin/curl',['-q','--fail','--silent','--show-error','--location','--max-redirs','4','--proto','=https','--proto-redir','=https','--connect-timeout','15','--max-time','120',url],{env,maxBuffer:limit});
  if(r.status!==0 || r.error) throw downloadFailure(r,u.hostname);
  return r.stdout;
}
function api(endpoint) { return json(download(`https://api.github.com/repos/${policy.repository}/${endpoint}`)); }
async function downloadLarge(url,total,onProgress) {
  const {spawn}=await import('node:child_process');
  const env={PATH:'/usr/bin:/bin'};for(const k of ['HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy','TMPDIR'])if(process.env[k])env[k]=process.env[k];
  // Retry acquisition only, never an installation. Each attempt has independent
  // byte accounting and a hard bound; incomplete bytes are never executed.
  for(let attempt=1;attempt<=2;attempt++){
    let bytes=0,chunks=[],last=0,overflow=false;
    onProgress({attempt,downloadedBytes:0,totalBytes:total,lastProgressAt:null});
    const child=spawn('/usr/bin/curl',['-q','--http1.1','--speed-limit','1024','--speed-time','60','--fail','--silent','--show-error','--location','--max-redirs','4','--proto','=https','--proto-redir','=https','--connect-timeout','15','--max-time','600',url],{env,stdio:['ignore','pipe','pipe']});
    const stop=signal=>child.kill(signal),int=()=>stop('SIGINT'),term=()=>stop('SIGTERM');process.once('SIGINT',int);process.once('SIGTERM',term);
    let interrupted=null;const markInt=()=>interrupted='SIGINT',markTerm=()=>interrupted='SIGTERM';process.once('SIGINT',markInt);process.once('SIGTERM',markTerm);
    child.stderr.resume();
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>total){overflow=true;child.kill('SIGTERM');return;}chunks.push(b);const now=Date.now();if(now-last>=1000){last=now;onProgress({attempt,downloadedBytes:bytes,totalBytes:total,lastProgressAt:new Date(now).toISOString()});}});
    const ended=await new Promise(resolve=>{child.once('error',error=>resolve({status:null,error}));child.once('close',(status,signal)=>resolve({status,signal}));});
    process.off('SIGINT',int);process.off('SIGTERM',term);process.off('SIGINT',markInt);process.off('SIGTERM',markTerm);
    onProgress({attempt,downloadedBytes:bytes,totalBytes:total,lastProgressAt:last?new Date(last).toISOString():null});
    if(overflow)fail('下载超出已绑定资产长度；拒绝执行');
    if(ended.status===0&&!interrupted)return Buffer.concat(chunks);
    const error=downloadFailure({...ended,signal:interrupted||ended.signal},new URL(url).hostname);
    if(attempt===2||interrupted||![5,6,7,28,52,56].includes(ended.status))throw error;
  }
}
function regular(file) { const s=fs.lstatSync(file); if(!s.isFile()||s.isSymbolicLink())fail('不是普通文件');return s; }
export function plainPath(file) {
  if(!path.isAbsolute(file)||path.normalize(file)!==file)fail('路径必须是规范化绝对路径');
  for(let cursor=file;cursor!==path.dirname(cursor);cursor=path.dirname(cursor)){
    if(fs.existsSync(cursor)||fs.lstatSync(cursor,{throwIfNoEntry:false})){
      const s=fs.lstatSync(cursor);if(s.isSymbolicLink())fail('路径包含符号链接');
      if(fs.realpathSync(cursor)!==cursor)fail('路径真实位置不一致');
    }
  }
  return file;
}
export function inspectRelease(version) {
  if(!Number.isSafeInteger(policy.repositoryId)||policy.repositoryId<=0)fail('公共仓库身份尚未绑定；此源码不是可用发行入口');
  if(version!==undefined&&!semver.test(version))fail('版本必须是明确的 x.y.z');
  const repository=json(download(`https://api.github.com/repos/${policy.repository}`));
  if(repository.id!==policy.repositoryId||repository.full_name!==policy.repository||repository.private!==false)fail('公共仓库身份漂移');
  const release=api(version?`releases/tags/v${version}`:'releases/latest');
  if(!/^v\d+\.\d+\.\d+$/.test(release.tag_name)||!release.immutable||release.draft||release.prerelease)fail('没有可用的正式不可变发行');
  const commit=api(`commits/${release.tag_name}`);
  if(!/^[a-f0-9]{40}$/.test(commit.sha))fail('无法解析发行提交');
  // Instructions follow the maintained public docs, frozen for this invocation;
  // runtime identity still comes exclusively from the immutable release tag.
  const documentation=api('commits/main');
  if(!/^[a-f0-9]{40}$/.test(documentation.sha))fail('无法固定当前安装说明提交');
  return {repository,release,sourceCommit:commit.sha,documentationCommit:documentation.sha,version:release.tag_name.slice(1)};
}
async function trustRoot(stage) {
  const metadata=path.join(stage,'tuf-metadata'),targets=path.join(stage,'tuf-targets');
  fs.mkdirSync(metadata,{mode:0o700});fs.mkdirSync(targets,{mode:0o700});
  const bootstrap=download(policy.bootstrapRootUrl);
  if(hash(bootstrap)!==policy.bootstrapRootSha256)fail('GitHub 初始信任数据摘要漂移');
  fs.writeFileSync(path.join(metadata,'root.json'),bootstrap,{flag:'wx',mode:0o600});
  // TUF validates root rotation, metadata signatures, expiry and target hashes.
  const updater=new Updater({metadataDir:metadata,targetDir:targets,metadataBaseUrl:'https://tuf-repo.github.com',targetBaseUrl:'https://tuf-repo.github.com/targets',config:{fetchTimeout:30000,fetchRetries:0}});
  await updater.refresh();const info=await updater.getTargetInfo('trusted_root.json');if(!info)fail('GitHub 信任目标缺失');
  return json(fs.readFileSync(await updater.downloadTarget(info)));
}
async function verifiedAsset(context,asset,stage,trust,onProgress) {
  if(!asset||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>250_000_000||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.name)||!/^sha256:[a-f0-9]{64}$/.test(asset.digest)||asset.browser_download_url!==`https://github.com/${policy.repository}/releases/download/${context.release.tag_name}/${asset.name}`)fail('资产元数据无效');
  const bytes=asset.size>10_000_000?await downloadLarge(asset.browser_download_url,asset.size,onProgress):download(asset.browser_download_url,asset.size+1);
  if(bytes.length!==asset.size||`sha256:${hash(bytes)}`!==asset.digest)fail('下载长度或摘要不匹配');
  const proofs=api(`attestations/${asset.digest}?predicate_type=release&per_page=100`).attestations;
  if(!Array.isArray(proofs)||proofs.length>=100)fail('证明列表不完整或分页待核实');
  const matches=[];
  for(const item of proofs){
    if(item.initiator!=='github'||item.repository_id!==policy.repositoryId)continue;
    let bundle=item.bundle;
    if(!bundle){
      const url=new URL(item.bundle_url);
      if(url.protocol!=='https:'||url.hostname!=='tmaproduction.blob.core.windows.net'||!url.pathname.startsWith('/attestations/'))fail('证明存储来源不符合 GitHub 公共来源');
      bundle=json(Buffer.from(snappy.uncompress(download(url.href),10_000_000)));
    }
    const statement=json(Buffer.from(bundle.dsseEnvelope.payload,'base64'));
    if(statement.predicate?.tag===context.release.tag_name)matches.push(bundle);
  }
  if(matches.length!==1)fail('无法唯一确定对应发行证明');
  const evidence=verifyReleaseProof({...context,bundle:matches[0],trustedRoot:trust,asset,bytes});
  fs.writeFileSync(path.join(stage,asset.name),bytes,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(stage,asset.name+'.verification.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
  return {bytes,file:path.join(stage,asset.name),evidence};
}
function validateCandidate(root,release,sourceCommit) {
  const manifestFile=path.join(root,'manifest.json');regular(plainPath(manifestFile));const manifest=json(fs.readFileSync(manifestFile));
  const {candidateHash,...manifestBody}=manifest;
  if(candidateHash!==hash(canonical(manifestBody)))fail('候选清单摘要不匹配');
  if(manifest.candidateHash!==release.candidateHash||manifest.productVersion!==release.version||manifest.platform!=='darwin'||manifest.arch!=='arm64'||manifest.build?.identity!==sourceCommit||manifest.source?.kind!=='repository-local-build'||manifest.runtime?.officialSourceVerified!==true||manifest.signature?.status!=='unsigned'||manifest.signature?.productionDistribution!==false)fail('候选身份、运行时或构建提交不匹配');
  const expected=new Map([['manifest.json',null],['foundation-kit',manifest.launcher]]);
  if(!Array.isArray(manifest.files)||manifest.launcher?.path!=='foundation-kit')fail('候选清单无效');
  for(const record of manifest.files){
    if(typeof record.path!=='string'||record.path.split('/').some(s=>!s||s==='.'||s==='..')||record.path.includes('\\'))fail('候选清单路径越界');
    const rel='payload/'+record.path;if(expected.has(rel))fail('候选清单路径重复');expected.set(rel,record);
  }
  const actual=new Set();
  const walk=(dir)=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),s=fs.lstatSync(file);if(s.isSymbolicLink())fail('候选含链接');if(s.uid!==process.getuid()||(s.mode&0o7000)!==0)fail('候选所有者或特殊权限无效');if(s.isDirectory())walk(file);else {if(!s.isFile())fail('候选含特殊文件');const rel=path.relative(root,file);actual.add(rel);if(!expected.has(rel))fail('候选包含未知文件');const r=expected.get(rel);if(r&&(r.size!==s.size||r.mode!==(s.mode&0o777)||r.sha256!==hash(fs.readFileSync(file))))fail('候选字节或模式不匹配');}}};walk(root);
  if(actual.size!==expected.size||[...expected.keys()].some(k=>!actual.has(k)))fail('候选缺失文件');
  const node=path.join(root,'payload/runtime/bin/node');if(hash(fs.readFileSync(node))!==release.runtime.binarySha256)fail('官方运行时摘要不匹配');
  return {manifest,launcher:path.join(root,'foundation-kit')};
}
// stage is always created by the CLI from the OS account in production.
// Keeping this module callable allows contained engineering validation without
// adding an install/cache override to the user-facing executable.
export async function acquireRelease(context,stage,{onPhase=()=>{},onProgress=()=>{},operationId=null}={}) {
  plainPath(stage);const s=fs.lstatSync(stage),entries=fs.readdirSync(stage);if(!s.isDirectory()||(s.mode&0o777)!==0o700||s.uid!==process.getuid())fail('获取目录必须是当前用户的新建独占空目录');
  if(entries.length){if(entries.length!==1||entries[0]!=='operation-result.json'||!operationId)fail('获取目录包含未知内容');const r=readOperation(path.join(stage,entries[0]));if(r.operationId!==operationId||r.terminal||r.phase!=='discovering')fail('获取目录不是本次早期记录');}
  const beforeTmp=process.env.TMPDIR;process.env.TMPDIR=stage;
  try{
    onPhase('verifying-trust');
    const trust=await trustRoot(stage);
    const name=`foundation-release-${context.version}-macos-arm64.json`;
    const catalogs=context.release.assets.filter(x=>x.name===name);if(catalogs.length!==1)fail('发行清单缺失或重复');
    onPhase('fetching-and-verifying-catalog');
    const catalog=json((await verifiedAsset(context,catalogs[0],stage,trust)).bytes);
    const releases=catalog.releases?.filter(x=>x.version===context.version&&x.platform==='darwin'&&x.arch==='arm64');
    if(catalog.schemaVersion!=='1.0.0'||catalog.product!=='ai-product-foundation-kit'||catalog.keyId!==null||!Number.isSafeInteger(catalog.issuedAt)||catalog.issuedAt>Date.now()||!Number.isSafeInteger(catalog.expiresAt)||catalog.expiresAt<=Date.now()||catalog.expiresAt<=catalog.issuedAt||releases?.length!==1)fail('发行清单身份、有效期或架构不匹配');
    const release=releases[0];const assetName=`foundation-${release.sha256}.tar.gz`;
    if(release.repositoryId!==policy.repositoryId||release.sourceCommit!==context.sourceCommit||!/^[a-f0-9]{64}$/.test(release.candidateHash)||release.url!==`https://github.com/${policy.repository}/releases/download/${context.release.tag_name}/${assetName}`||!/^\d+\.\d+\.\d+$/.test(release.runtime?.version)||release.runtime.url!==`https://nodejs.org/dist/v${release.runtime.version}/node-v${release.runtime.version}-darwin-arm64.tar.gz`)fail('清单不能更换仓库、提交或官方运行时来源');
    const assets=context.release.assets.filter(x=>x.name===assetName&&x.size===release.bytes&&x.digest===`sha256:${release.sha256}`);if(assets.length!==1)fail('归档身份不匹配');
    onPhase('fetching-and-verifying-runtime');
    const archive=await verifiedAsset(context,assets[0],stage,trust,onProgress);
    onPhase('extracting-and-validating');
    const listing=spawnSync('/usr/bin/tar',['-tzf',archive.file],{encoding:'utf8',maxBuffer:10_000_000});
    const types=spawnSync('/usr/bin/tar',['-tvzf',archive.file],{encoding:'utf8',maxBuffer:10_000_000});
    if(listing.status!==0||types.status!==0||listing.stdout.trim().split('\n').some(p=>p.startsWith('/')||p.includes('\\')||p.split('/').includes('..'))||types.stdout.trim().split('\n').some(p=>!['d','-'].includes(p[0])||/[sStT]/.test(p.slice(1,10))))fail('归档包含不安全路径、链接或特殊权限');
    const candidate=path.join(stage,'candidate');fs.mkdirSync(candidate,{mode:0o700});
    const extracted=spawnSync('/usr/bin/tar',['-xzf',archive.file,'-p','--no-same-owner','--no-acls','--no-fflags','--no-mac-metadata','--no-xattrs','-C',candidate],{stdio:'pipe'});if(extracted.status!==0)fail('归档展开失败；未执行');
    const checked=validateCandidate(candidate,release,context.sourceCommit);
    const receipt={...archive.evidence,candidateHash:release.candidateHash,launcher:checked.launcher,purpose:'acquisition-cache',retained:true,deletionAuthority:false,installationConfirmed:false};
    fs.writeFileSync(path.join(stage,'acquisition.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
    return receipt;
  }finally{if(beforeTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=beforeTmp;}
}
