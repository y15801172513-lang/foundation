import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {prepareSourceScene} from '../../packages/core/source-scene.mjs';
import {analyzeSourcesInWorker} from '../../packages/core/source-analysis.mjs';
import {browserLaunchContract,waitForBrowserDevtoolsPort} from '../helpers/browser-launch-contract.mjs';
import {connectDevtools,evaluate,cleanupBrowser} from '../helpers/browser-lifecycle.mjs';
import {sha256} from '../../packages/core/install-contract.mjs';

test('047R2 candidate runtime renders source-bound export and fixed instances; forged configuration, identity and missing bridge fail',{timeout:60000},async t=>{
 const root=fs.realpathSync('.');fs.mkdirSync(path.join(root,'.tmp/047r2'),{recursive:true});const base=fs.mkdtempSync(path.join(root,'.tmp/047r2/source-scene-'));
 const candidate=fs.realpathSync(process.env.FOUNDATION_047_CANDIDATE),module=path.join(candidate,'payload/app/artifacts/preview/asset-preview-bridge.mjs');
 const manifest=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json')));
 assert.equal(sha256(fs.readFileSync(module)),manifest.files.find(file=>file.path==='app/artifacts/preview/asset-preview-bridge.mjs').sha256);
 const project=path.join(base,'project');fs.mkdirSync(project);
 fs.writeFileSync(path.join(project,'Counter.jsx'),`import {useState} from 'react';export function Counter({instanceId='计数器定义'}){const [count,setCount]=useState(0);return <section data-instance={instanceId}><h2>{instanceId}</h2><button onClick={()=>setCount(count+1)}>增加</button><output>{count}</output></section>}`);
 const d=analyzeSourcesInWorker({project,entryRoots:['Counter.jsx']}).definitions.find(d=>d.name==='Counter');
 const asset={id:'counter',implementationMapping:'Counter.jsx',assetModel:{binding:{file:d.file,export:'Counter',declarationKind:d.declarationKind,anchor:d.anchor},configuration:[{key:'instanceId',kind:'string'}]},usageLocations:['item-a','item-b'].map(instanceId=>({instanceId,bindingId:instanceId,configuration:{instanceId}}))},facts={components:{items:[asset]}};
 const sceneFor=instance=>prepareSourceScene({project,facts,asset,scenario:{id:'default',kind:instance?'instance':'definition',definitionId:'counter',...(instance?{instanceId:instance}:{}),adapter:'forged-callback.html'}});
 const scenes=new Map(['','item-a','item-b'].map(instance=>[instance,sceneFor(instance)]));
 const runtimes=Object.fromEntries(['react-runtime.mjs','react.mjs','jsx-runtime.mjs','react-dom-client.mjs'].map(name=>[name,fs.readFileSync(path.join(candidate,'payload/app/artifacts/preview',name))])),bridge=fs.readFileSync(module);let active,mode;
 const server=http.createServer((req,res)=>{res.setHeader('access-control-allow-origin','*');const url=new URL(req.url,'http://local');if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><script>window.messages=[];addEventListener("message",e=>{if(e.source===document.querySelector("iframe")?.contentWindow&&e.origin==="null")messages.push(e.data)})</script>');return;}const resource=active?.resources[url.pathname];res.setHeader('content-type',resource?.mime || 'text/javascript');if(resource){res.end(resource.bytes);return;}const runtimeName=Object.keys(runtimes).find(name=>url.pathname===active?.prefix+name);if(runtimeName){res.end(runtimes[runtimeName]);return;}if(url.pathname===active?.prefix+'bridge.mjs'&&mode!=='broken'){res.end(bridge);return;}res.statusCode=404;res.end('缺少受控资源');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const temporary=path.join(base,'browser'),profile=path.join(temporary,'profile');fs.mkdirSync(profile,{recursive:true});
 const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',browserLaunchContract({}, {userDataDirectory:profile}).args,{env:{...process.env,TMPDIR:temporary,XDG_CACHE_HOME:temporary},stdio:'ignore'});let devtools;
 t.after(async()=>cleanupBrowser({child:browser,devtools,server,temporary,profile,root:path.join(root,'.tmp'),remove:()=>fs.rmSync(temporary,{recursive:true}),diagnostic:value=>t.diagnostic(JSON.stringify(value))}));
 const port=await waitForBrowserDevtoolsPort(profile,browser),target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();devtools=await connectDevtools(target.webSocketDebuggerUrl);
 await devtools.call('Page.enable');await devtools.call('Runtime.enable');
 await devtools.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 for(let n=0;n<100;n++){if(await evaluate(devtools,'Array.isArray(window.messages)'))break;await new Promise(resolve=>setTimeout(resolve,20));}
 const observations=[];
 for(const [testMode,instance]of [['normal',''],['normal','item-a'],['normal','item-b'],['wrong','item-a'],['broken','item-a'],['fake','item-a']]) {
  mode=testMode;active=scenes.get(instance);const query=new URLSearchParams({mode,instanceId:instance,projectId:'p',revision:'r',channel:'c',assetId:mode==='wrong'?'other':'counter',scenarioId:'default',variantValues:mode==='fake'?'{"forged":true}':'{}'});
  await evaluate(devtools,`(()=>{document.querySelector('iframe')?.remove();messages=[];const f=document.createElement('iframe');f.sandbox='allow-scripts';f.src=${JSON.stringify(active.route+'?'+query.toString())};document.body.append(f)})()`);
  let messages=[];for(let n=0;n<60;n++){messages=await evaluate(devtools,'messages');if(messages.length)break;await new Promise(resolve=>setTimeout(resolve,25));}
  if(mode==='normal') {
   fs.writeFileSync(path.join(base,`events-${mode}-${instance || 'definition'}.json`),JSON.stringify(devtools.events,null,2));
   assert(messages.some(m=>m.status==='ready'&&m.projectId==='p'&&m.revision==='r'&&m.channel==='c'&&m.assetId==='counter'),JSON.stringify(messages));
   const targets=(await devtools.call('Target.getTargets')).targetInfos;
   fs.writeFileSync(path.join(base,'targets.json'),JSON.stringify(targets,null,2));
   const frameTarget=targets.find(target=>target.type==='iframe'&&target.url.includes(active.route));
   assert(frameTarget,'隔离 frame 必须有独立浏览器 target');
   const frameTools=await connectDevtools(`ws://127.0.0.1:${port}/devtools/page/${frameTarget.targetId}`);
   const world={executionContextId:undefined};
   const observation=await evaluate(frameTools,`(()=>{const root=document.querySelector('[data-foundation-scene]');document.querySelector('button').click();return {instance:root.dataset.foundationInstanceId || '',sourceSceneDigest:root.getAttribute('data-foundation-source-scene'),label:document.querySelector('h2').textContent,roots:document.body.querySelectorAll('[data-foundation-scene]').length,width:root.getBoundingClientRect().width,height:root.getBoundingClientRect().height,sections:document.querySelectorAll('section').length,storageBlocked:(()=>{try{localStorage.setItem('probe','bad');return false}catch{return true}})()}})()`,world.executionContextId);
   await new Promise(resolve=>setTimeout(resolve,30));observation.count=await evaluate(frameTools,"document.querySelector('output').textContent",world.executionContextId);
   await frameTools.close();
   assert.equal(observation.instance,instance);assert.equal(observation.label,instance || '计数器定义');assert.equal(observation.sourceSceneDigest,active.renderDigest);assert.equal(observation.roots,1);assert.equal(observation.sections,1);assert(observation.width>0&&observation.height>0);assert.equal(observation.count,'1');assert.equal(observation.storageBlocked,true);observations.push({mode,instance,...observation});
  } else {assert(!messages.some(message=>message.status==='ready'));observations.push({mode,instance,status:messages[0]?.status || 'timeout-no-ready'});}
 }
 fs.writeFileSync(path.join(base,'observations.json'),JSON.stringify({candidateHash:manifest.candidateHash,moduleSha256:sha256(fs.readFileSync(module)),runtimeHashes:Object.fromEntries(Object.entries(runtimes).map(([name,bytes])=>[name,sha256(bytes)])),sceneDigests:[...scenes.values()].map(scene=>scene.digest),observations},null,2));
 t.diagnostic('工程场景证据='+base+'；实际候选 runtime 与标准桥接，源码导出编译；不证明宿主自然制作');
});
