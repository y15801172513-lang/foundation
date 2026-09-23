import {prepareMotionScene} from '@foundation/core';
import {projectDeliveryIdentity} from '@foundation/core';
import {prepareSourceScene} from '@foundation/core';
import {projectSemanticRevision} from '@foundation/core';
import {captureProjectRoundInputs} from '@foundation/core';
import fs from 'node:fs';
import {canonicalStringify} from '@foundation/core';
import path from 'node:path';
import crypto from 'node:crypto';
import {readFacts} from '@foundation/core';
import {inspectProjectDeliveryFiles} from '@foundation/core';
import {readPreviewConfig} from '@foundation/core';
import {readProjectPolicyForDisplay} from '@foundation/core';
import {projectWithEffectivePolicy} from '@foundation/core';
import {inspectLocalLifecycle} from '@foundation/core';
import {readWorkbenchAuthorityKey} from '../../../../packages/core/workspace-host.mjs';
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
  let model={project:{name:'Foundation'},pages:[],relations:[],components:[],assets:[],changes:[],interactions:[],preview:{mode:'local-static',allowedOrigins:['self']},projectSelected:false},factsDigest=null,previewManifestDigest=null,assessment=null,acceptanceInputs=[],routeMap={},sourceScenes={},semanticRevision=null,roundObservation=null,deliveryIdentity=null;
  if(project) {
    const facts=readFacts(project);roundObservation=captureProjectRoundInputs(project);semanticRevision=projectSemanticRevision(facts,roundObservation.files);factsDigest=hash(JSON.stringify(facts));
    deliveryIdentity=projectDeliveryIdentity({project,current:state.installation.current,facts});
    const preview=fs.existsSync(path.join(project,'.foundation/preview.json'))?readPreviewConfig(project):{schemaVersion:'0.1.0',mode:'unconfigured',routes:[],assets:[]};
    previewManifestDigest=hash(JSON.stringify(preview));
    facts.foundation=projectWithEffectivePolicy(facts.foundation,readProjectPolicyForDisplay({installationRoot,project}));
    facts.delivery=inspectProjectDeliveryFiles({project,installationRoot});assessment=facts.delivery.assessment;acceptanceInputs=facts.delivery.acceptanceInputs || [];
    for(const entry of [...preview.routes,...preview.assets]) {add(entry.path,entry.absoluteFile,project);routeMap[entry.path]=entry.file;}
    const bridgeRoot=path.join(installationRoot,state.installation.current.appPath,'artifacts/preview');
    for(const page of facts.pages.items.filter(page=>page.previewBinding?.producer==='foundation-static-preview/1')){
      const entry=resourceBytes[page.preview];if(!entry)continue;
      for(const name of ['preview-bridge.mjs','object-identity.mjs'])if(!resourceBytes['/__foundation/standard-preview/'+name])add('/__foundation/standard-preview/'+name,path.join(bridgeRoot,name),bridgeRoot);
      const script=`<script type="module">import {bindPreviewContext,createInspectorBridge,announcePreview} from '/__foundation/standard-preview/preview-bridge.mjs';bindPreviewContext(window,{pageId:${JSON.stringify(page.id)}});createInspectorBridge();announcePreview();</script>`;
      const bytes=Buffer.from(entry.bytes.toString('utf8')+script);resourceBytes[page.preview]={...entry,bytes,sha256:hash(bytes)};
    }
    const fontRoot=path.join(project,'dist/assets');
    if(fs.existsSync(fontRoot))for(const name of fs.readdirSync(fontRoot).sort())if(name.endsWith('.woff2')&&!resourceBytes['/assets/'+name]){add('/assets/'+name,path.join(fontRoot,name),project);routeMap['/assets/'+name]='dist/assets/'+name;}
    facts.semanticRevision=semanticRevision;
    model=buildViewModel(facts,preview);
    const artifactRoot=path.join(installationRoot,state.installation.current.appPath,'artifacts/preview');
    for(const asset of facts.components.items)if(asset.assetModel) {
      const target=model.assets.find(item=>item.assetId===asset.id);if(target){target.scenarioRoutes={};target.sceneLimitations={};}
      for(const scenario of asset.assetModel.previewScenarios || [])try {
        const scene=prepareSourceScene({project,facts,asset,scenario});
        for(const [url,resource]of Object.entries(scene.resources)){totalBytes+=resource.bytes.length;if(totalBytes>128*1024*1024)throw new Error('场景快照超过 128 MiB');resourceBytes[url]={...resource,sha256:hash(resource.bytes)};}
        for(const name of ['react-runtime.mjs','react.mjs','jsx-runtime.mjs','react-dom-client.mjs','lucide-react.mjs'])add(scene.prefix+name,path.join(artifactRoot,name),artifactRoot);
        add(scene.prefix+'bridge.mjs',path.join(artifactRoot,'asset-preview-bridge.mjs'),artifactRoot);
        for(const input of scene.plan.inputs)fileInputs.push({file:path.join(project,input.path),sha256:input.sha256});
        sourceScenes[asset.id+':'+scenario.id]={route:scene.route,digest:scene.digest,renderDigest:scene.renderDigest,plan:scene.plan};if(target)target.scenarioRoutes[scenario.id]=scene.route;
      }catch(error){if(target)target.sceneLimitations[scenario.id]=error.message;}
    }
    for(const asset of facts.motions.items) {
      const target=model.assets.find(item=>item.assetId===asset.id);
      try {
        const scene=prepareMotionScene({project,asset});
        for(const [url,resource]of Object.entries(scene.resources))resourceBytes[url]={...resource,sha256:hash(resource.bytes)};
        add(scene.prefix+'bridge.mjs',path.join(artifactRoot,'asset-preview-bridge.mjs'),artifactRoot);
        for(const input of scene.plan.inputs)fileInputs.push({file:path.join(project,input.path),sha256:input.sha256});
        sourceScenes[asset.id+':motion']={route:scene.route,digest:scene.digest,renderDigest:scene.renderDigest,plan:scene.plan};
        if(target){target.previewRoute=scene.route;target.motionScenario='motion';}
      }catch(error){if(target){target.previewRoute=null;target.sceneLimitation=error.message;}}
    }
    if(hash(JSON.stringify(readFacts(project)))!==factsDigest)throw new Error('准备快照时事实发生并发变化');
  }
  const after=readWorkbenchAuthorityKey({installationRoot,project});if(before!==after)throw new Error('准备快照时授权代际发生变化');
  const installationGeneration=hash(JSON.stringify(state.installation.current));
  const buildDigest=hash(JSON.stringify(Object.entries(resourceBytes).map(([url,r])=>[url,r.sha256])));
  const acceptanceDigest=hash(canonicalStringify({assessment,round:roundObservation,inputs:acceptanceInputs.sort((a,b)=>a.evidenceId.localeCompare(b.evidenceId))}));
  const revision=hash(canonicalStringify({installationGeneration,factsDigest,previewManifestDigest,buildDigest,acceptanceDigest}));
  model={...model,deliveryIdentity,revision,semanticRevision,resourceRevision:buildDigest,observationRevision:acceptanceDigest,installationGeneration,assets:model.assets.map(asset=>({...asset,revision,resourceRevision:buildDigest,projectId:model.project.projectId}))};
  const html=workspaceModelDocument(model,{writeNonce});
  const finalState=inspectLocalLifecycle({installationRoot,project,operationRequirement:'lifecycle-inspect'});
  if(finalState.bridge?.installationHealth?.code!=='FOUNDATION_HEALTHY'||readWorkbenchAuthorityKey({installationRoot,project})!==after || fileInputs.some(input=>hash(fs.readFileSync(input.file))!==input.sha256))throw new Error('资源读取与完整校验之间出现字节漂移');
  return {revision,semanticRevision,resourceRevision:buildDigest,observationRevision:acceptanceDigest,authorityKey:after,installationGeneration,factsDigest,previewManifestDigest,buildDigest,acceptanceDigest,model,routeMap,sourceScenes,resourceBytes,assessment,html};
}
