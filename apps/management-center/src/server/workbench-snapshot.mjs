import fs from 'node:fs';
import {canonicalStringify} from '../../../../packages/core/install-contract.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readFacts} from '../../../../packages/core/facts.mjs';
import {inspectProjectDeliveryFiles} from '../../../../packages/core/project-delivery.mjs';
import {readPreviewConfig} from '../../../../packages/core/preview-config.mjs';
import {readProjectPolicyForDisplay} from '../../../../packages/core/rules-delivery.mjs';
import {projectWithEffectivePolicy} from '../../../../packages/core/ui-policy.mjs';
import {inspectLocalLifecycle} from '../../../../packages/core/lifecycle-manager.mjs';
import {readWorkbenchAuthorityKey} from '../../../../packages/core/workbench-runtime.mjs';
import {buildViewModel} from './view-model.mjs';
import {WORKSPACE_ASSETS} from './workspace-assets.mjs';
import {workspaceModelDocument} from './workspace-document.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const mime=file=>({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html;charset=utf-8','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'}[path.extname(file)] || 'application/octet-stream');
export function prepareWorkbenchSnapshot({installationRoot,project=null,writeNonce='',distRoot=path.resolve(import.meta.dirname,'../../dist')}) {
  const before=readWorkbenchAuthorityKey({installationRoot,project});
  const state=inspectLocalLifecycle({installationRoot,project,operationRequirement:'lifecycle-inspect'});
  if(state.bridge?.installationHealth?.code!=='FOUNDATION_HEALTHY'||project&&(state.project?.state!=='enabled'||!state.project?.agreement))throw new Error('安装完整性或项目绑定未通过');
  distRoot=path.join(installationRoot,state.installation.current.appPath,'node_modules/@foundation/management-center/dist');
  const resourceBytes={},fileInputs=[];let totalBytes=0;
  const add=(url,file,boundary)=>{
    const real=fs.realpathSync(file);
    if(real!==path.resolve(file)||!real.startsWith(fs.realpathSync(boundary)+path.sep)||!fs.statSync(file).isFile())throw new Error('快照资源路径不安全');
    const bytes=fs.readFileSync(file);totalBytes+=bytes.length;
    if(totalBytes>128*1024*1024)throw new Error('完整快照资源超过 128 MiB');
    resourceBytes[url]={bytes,mime:mime(file),sha256:hash(bytes)};
    fileInputs.push({file,sha256:hash(bytes)});
  };
  const assets=path.join(distRoot,'assets');
  add(WORKSPACE_ASSETS.script,path.join(assets,'workspace.js'),distRoot);add(WORKSPACE_ASSETS.stylesheet,path.join(assets,'workspace.css'),distRoot);
  for(const [folder,prefix]of [['chunks',WORKSPACE_ASSETS.chunkPrefix],['binary',WORKSPACE_ASSETS.binaryPrefix]])if(fs.existsSync(path.join(assets,folder)))for(const name of fs.readdirSync(path.join(assets,folder)).sort()) {
    add(prefix+name,path.join(assets,folder,name),distRoot);
    if(folder==='chunks')resourceBytes[WORKSPACE_ASSETS.preloadChunkPrefix+name]=resourceBytes[prefix+name];
  }
  let model={project:{name:'Foundation'},pages:[],relations:[],components:[],assets:[],changes:[],interactions:[],preview:{mode:'local-static',allowedOrigins:['self']},projectSelected:false},factsDigest=null,previewManifestDigest=null,assessment=null,acceptanceInputs=[],routeMap={};
  if(project) {
    const facts=readFacts(project);factsDigest=hash(JSON.stringify(facts));
    const preview=fs.existsSync(path.join(project,'.foundation/preview.json'))?readPreviewConfig(project):{schemaVersion:'0.1.0',mode:'unconfigured',routes:[],assets:[]};
    previewManifestDigest=hash(JSON.stringify(preview));
    facts.foundation=projectWithEffectivePolicy(facts.foundation,readProjectPolicyForDisplay({installationRoot,project}));
    facts.delivery=inspectProjectDeliveryFiles({project,installationRoot});assessment=facts.delivery.assessment;acceptanceInputs=facts.delivery.acceptanceInputs || [];
    for(const entry of [...preview.routes,...preview.assets]) {add(entry.path,entry.absoluteFile,project);routeMap[entry.path]=entry.file;}
    const fontRoot=path.join(project,'dist/assets');
    if(fs.existsSync(fontRoot))for(const name of fs.readdirSync(fontRoot).sort())if(name.endsWith('.woff2')&&!resourceBytes['/assets/'+name]){add('/assets/'+name,path.join(fontRoot,name),project);routeMap['/assets/'+name]='dist/assets/'+name;}
    model=buildViewModel(facts,preview);
    if(hash(JSON.stringify(readFacts(project)))!==factsDigest)throw new Error('准备快照时事实发生并发变化');
  }
  const after=readWorkbenchAuthorityKey({installationRoot,project});if(before!==after)throw new Error('准备快照时授权代际发生变化');
  const installationGeneration=hash(JSON.stringify(state.installation.current));
  const buildDigest=hash(JSON.stringify(Object.entries(resourceBytes).map(([url,r])=>[url,r.sha256])));
  const acceptanceDigest=hash(canonicalStringify({assessment,inputs:acceptanceInputs.sort((a,b)=>a.evidenceId.localeCompare(b.evidenceId))}));
  const revision=hash(canonicalStringify({installationGeneration,factsDigest,previewManifestDigest,buildDigest,acceptanceDigest}));
  model={...model,revision,installationGeneration,assets:model.assets.map(asset=>({...asset,revision,projectId:model.project.projectId}))};
  const html=workspaceModelDocument(model,{writeNonce});
  const finalState=inspectLocalLifecycle({installationRoot,project,operationRequirement:'lifecycle-inspect'});
  if(finalState.bridge?.installationHealth?.code!=='FOUNDATION_HEALTHY'||readWorkbenchAuthorityKey({installationRoot,project})!==after || fileInputs.some(input=>hash(fs.readFileSync(input.file))!==input.sha256))throw new Error('资源读取与完整校验之间出现字节漂移');
  return {revision,authorityKey:after,installationGeneration,factsDigest,previewManifestDigest,buildDigest,acceptanceDigest,model,routeMap,resourceBytes,assessment,html};
}
