import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Updater} from 'tuf-js';
import snappy from 'snappyjs';
import {verifyReleaseProof} from './release-proof.mjs';
import policy from './public-policy.json' with {type:'json'};

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`错误：${message}`); };
const semver = /^\d+\.\d+\.\d+$/;
const json = bytes => JSON.parse(bytes.toString('utf8'));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value==='object' ? `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
// Public transport never reads gh credentials or curl configuration. Proxy
// environment remains optional; neither Mono nor an author path is packaged.
function download(url, limit=10_000_000, largeAsset=false) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password) fail('只接受无凭证 HTTPS 地址');
  const env = {PATH:'/usr/bin:/bin'};
  for (const key of ['HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy','TMPDIR']) if (process.env[key]) env[key]=process.env[key];
  // Large immutable assets may take minutes on a constrained proxy. Keep a
  // bounded transfer, fail stalled connections, and never execute partial data.
  const r=spawnSync('/usr/bin/curl',['-q',...(largeAsset?['--http1.1','--speed-limit','1024','--speed-time','60']:[]),'--fail','--silent','--show-error','--location','--max-redirs','4','--proto','=https','--proto-redir','=https','--connect-timeout','15','--max-time',largeAsset?'1200':'120',url],{env,maxBuffer:limit});
  if(r.status!==0 || r.error) fail(`匿名获取失败（${u.hostname}）；保留本次材料，不自动重试安装`);
  return r.stdout;
}
function api(endpoint) { return json(download(`https://api.github.com/repos/${policy.repository}/${endpoint}`)); }
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
async function verifiedAsset(context,asset,stage,trust) {
  if(!asset||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>250_000_000||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.name)||!/^sha256:[a-f0-9]{64}$/.test(asset.digest)||asset.browser_download_url!==`https://github.com/${policy.repository}/releases/download/${context.release.tag_name}/${asset.name}`)fail('资产元数据无效');
  const bytes=download(asset.browser_download_url,asset.size+1,asset.size>10_000_000);
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
export async function acquireRelease(context,stage) {
  plainPath(stage);const s=fs.lstatSync(stage);if(!s.isDirectory()||(s.mode&0o777)!==0o700||s.uid!==process.getuid()||fs.readdirSync(stage).length)fail('获取目录必须是当前用户的新建独占空目录');
  const beforeTmp=process.env.TMPDIR;process.env.TMPDIR=stage;
  try{
    const trust=await trustRoot(stage);
    const name=`foundation-release-${context.version}-macos-arm64.json`;
    const catalogs=context.release.assets.filter(x=>x.name===name);if(catalogs.length!==1)fail('发行清单缺失或重复');
    const catalog=json((await verifiedAsset(context,catalogs[0],stage,trust)).bytes);
    const releases=catalog.releases?.filter(x=>x.version===context.version&&x.platform==='darwin'&&x.arch==='arm64');
    if(catalog.schemaVersion!=='1.0.0'||catalog.product!=='ai-product-foundation-kit'||catalog.keyId!==null||!Number.isSafeInteger(catalog.issuedAt)||catalog.issuedAt>Date.now()||!Number.isSafeInteger(catalog.expiresAt)||catalog.expiresAt<=Date.now()||catalog.expiresAt<=catalog.issuedAt||releases?.length!==1)fail('发行清单身份、有效期或架构不匹配');
    const release=releases[0];const assetName=`foundation-${release.sha256}.tar.gz`;
    if(release.repositoryId!==policy.repositoryId||release.sourceCommit!==context.sourceCommit||!/^[a-f0-9]{64}$/.test(release.candidateHash)||release.url!==`https://github.com/${policy.repository}/releases/download/${context.release.tag_name}/${assetName}`||!/^\d+\.\d+\.\d+$/.test(release.runtime?.version)||release.runtime.url!==`https://nodejs.org/dist/v${release.runtime.version}/node-v${release.runtime.version}-darwin-arm64.tar.gz`)fail('清单不能更换仓库、提交或官方运行时来源');
    const assets=context.release.assets.filter(x=>x.name===assetName&&x.size===release.bytes&&x.digest===`sha256:${release.sha256}`);if(assets.length!==1)fail('归档身份不匹配');
    const archive=await verifiedAsset(context,assets[0],stage,trust);
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
