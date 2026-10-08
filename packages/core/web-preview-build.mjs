import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {realProject,resolveProjectFile} from './path-boundary.mjs';
import {readFacts} from './facts.mjs';
import {inspectProjectAuthority} from './project-authority.mjs';
import {captureProjectRoundInputs} from './project-context-round.mjs';
import {synchronizeProject} from './project-sync.mjs';
import {sha256,canonicalStringify} from './install-contract.mjs';
import {signTrustedPayload,verifyTrustedPayload} from './trusted-authority.mjs';

const inputs=project=>captureProjectRoundInputs(project).files.filter(file=>!file.path.startsWith('.foundation/')&&!['document','configuration-empty'].includes(file.kind)).map(({path,sha256})=>({path,sha256}));
function safeDirectory(root,relative) {
  let cursor=root;
  for(const part of relative.split('/')) {
    if(!part||part==='..'||part==='.')throw new Error('构建输出路径无效');
    cursor=path.join(cursor,part);const stat=fs.lstatSync(cursor,{throwIfNoEntry:false});
    if(stat?.isSymbolicLink())throw new Error('构建输出拒绝符号链接');
    if(!stat)fs.mkdirSync(cursor);
  }
  return cursor;
}

// Runs the project's existing Vite pipeline in an explicit build task. No
// project configuration is evaluated by a read-only workbench request.
export function buildProjectWebPreview({project,installationRoot,pageId,buildAuthorized=false}) {
  const root=realProject(project),authority=inspectProjectAuthority(root,{installationRoot});
  if(!buildAuthorized||authority.state!=='enabled'||authority.continuousSync?.state!=='active')throw new Error('可信预览构建需要当前项目及明确构建授权');
  const facts=readFacts(root),page=facts.pages.items.find(item=>item.id===pageId);
  if(!page?.preview||!page.implementationMapping)throw new Error('构建需要已登记页面、源码入口与预览路由');
  const vite=resolveProjectFile(root,'node_modules/vite/bin/vite.js','项目 Vite 构建器');
  const directory='.foundation/generated-cache/web-preview/'+crypto.randomUUID(),out=safeDirectory(root,directory),before=inputs(root);
  const run=spawnSync(process.execPath,[vite,'build','--outDir',out,'--base','./','--sourcemap'],{cwd:root,env:{...process.env,TMPDIR:out,npm_config_cache:out+'/npm-cache'},encoding:'utf8',maxBuffer:16*1024*1024,timeout:180000});
  fs.writeFileSync(path.join(out,'build.log'),(run.stdout || '')+(run.stderr || ''));
  if(run.status!==0)throw new Error('项目预览构建失败，日志已保留；退出码 '+run.status);
  if(canonicalStringify(before)!==canonicalStringify(inputs(root)))throw new Error('构建期间项目输入发生变化；拒绝绑定旧结果');
  const outputs=[],dependencies=new Map(),maps=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const absolute=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('构建产物拒绝符号链接');if(entry.isDirectory())walk(absolute);else if(entry.isFile()&&entry.name!=='build.log'){const bytes=fs.readFileSync(absolute),relative=path.relative(out,absolute).split(path.sep).join('/');outputs.push({path:directory+'/'+relative,relative,sha256:sha256(bytes)});if(relative.endsWith('.map'))maps.push({absolute,map:JSON.parse(bytes)});}}};walk(out);
  if(!outputs.some(file=>file.relative==='index.html')||!maps.length)throw new Error('当前生产者要求 index.html 与可核对源码的 source map');
  for(const {absolute,map} of maps)for(const [index,source] of (map.sources || []).entries()) {
    if(!map.sourcesContent?.[index])continue;
    const absoluteSource=path.resolve(path.dirname(absolute),map.sourceRoot || '',source),relative=path.relative(root,absoluteSource).split(path.sep).join('/');
    if(relative.startsWith('../')||!fs.existsSync(absoluteSource))continue;
    const current=resolveProjectFile(root,relative,'source map 输入'),bytes=fs.readFileSync(current);
    if(bytes.toString('utf8')!==map.sourcesContent[index])throw new Error('source map 与实际输入不一致：'+relative);
    dependencies.set(relative,{path:relative,sha256:sha256(bytes)});
  }
  if(!dependencies.has(page.implementationMapping))throw new Error('构建 source map 没有绑定页面源码入口');
  const payload={purpose:'foundation-web-build/1',projectId:facts.foundation.projectId,pageId,producer:'vite-source-map',sources:before,dependencies:[...dependencies.values()],outputs};
  const receipt={...payload,integrity:signTrustedPayload(payload)},receiptPath=directory+'/receipt.json';
  fs.writeFileSync(path.join(root,receiptPath),JSON.stringify(receipt)+'\n');
  const route=page.preview,base=route.endsWith('/')?route:route.slice(0,route.lastIndexOf('/')+1);
  const published=outputs.filter(file=>!file.relative.endsWith('.map'));
  const previewPath='.foundation/preview.json',preview=JSON.parse(fs.readFileSync(resolveProjectFile(root,previewPath)));
  const sourceInputs=[...new Map([...before,...payload.dependencies].map(input=>[input.path,input])).values()];
  const record={...page,previewBinding:{producer:'foundation-web-build/1',inputDigest:sha256(canonicalStringify(sourceInputs)),receipt:{path:receiptPath,sha256:sha256(fs.readFileSync(path.join(root,receiptPath)))},inputs:sourceInputs}};
  return synchronizeProject({project:root,installationRoot,handlerPayload:{scope:'绑定本次真实构建的源码、资源与对象映射',generatedAt:new Date().toISOString(),sources:[...sourceInputs,...outputs.map(({path,sha256})=>({path,sha256})),{path:receiptPath,sha256:record.previewBinding.receipt.sha256}],documents:[{kind:'pages',expectedSha256:sha256(fs.readFileSync(resolveProjectFile(root,'.foundation/facts/pages.json'))),upserts:[record]}],preview:{expectedSha256:sha256(fs.readFileSync(resolveProjectFile(root,previewPath))),routes:[{path:route,file:directory+'/index.html'}],assets:published.filter(file=>file.relative!=='index.html').map(file=>({path:base+file.relative,file:file.path}))}}});
}

export function verifyWebPreviewBuild({project,facts,page}) {
  const reference=page.previewBinding?.receipt;
  if(page.previewBinding?.producer!=='foundation-web-build/1'||!reference)throw new Error('页面缺少可信构建，需 project build-preview');
  const bytes=fs.readFileSync(resolveProjectFile(project,reference.path,'构建回执'));
  if(sha256(bytes)!==reference.sha256)throw new Error('构建回执已改变');
  const {integrity,...receipt}=JSON.parse(bytes);
  if(receipt.purpose!=='foundation-web-build/1'||receipt.projectId!==facts.foundation.projectId||receipt.pageId!==page.id||!verifyTrustedPayload(receipt,integrity))throw new Error('构建回执不属于当前项目/页面');
  if(canonicalStringify(receipt.sources)!==canonicalStringify(inputs(project)))throw new Error('构建源码已变化，需重新构建当前页面');
  for(const input of [...receipt.dependencies,...receipt.outputs])if(sha256(fs.readFileSync(resolveProjectFile(project,input.path,'构建依赖或产物')))!==input.sha256)throw new Error('构建依赖或实际运行字节已变化');
  return receipt;
}
