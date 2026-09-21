import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {build} from 'vite';
import {browserLaunchContract,waitForBrowserDevtoolsPort} from '../helpers/browser-launch-contract.mjs';
import {connectDevtools,evaluate,cleanupBrowser} from '../helpers/browser-lifecycle.mjs';
import {sha256} from '../../packages/core/install-contract.mjs';

test('047R1 candidate React scene mounts actual definition and instance; broken/wrong/whole-page scenes never become ready',{timeout:60000},async t=>{
 const root=fs.realpathSync('.');fs.mkdirSync(path.join(root,'.tmp/047r1'),{recursive:true});const base=fs.mkdtempSync(path.join(root,'.tmp/047r1/react-scene-'));
 const candidate=fs.realpathSync(process.env.FOUNDATION_047_CANDIDATE),module=path.join(candidate,'payload/app/artifacts/preview/asset-preview-bridge.mjs');
 const manifest=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json')));
 assert.equal(sha256(fs.readFileSync(module)),manifest.files.find(file=>file.path==='app/artifacts/preview/asset-preview-bridge.mjs').sha256);
 const entry=path.join(base,'entry.jsx');
 fs.writeFileSync(entry,`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {mountAssetScene} from ${JSON.stringify(module)};
const q=new URLSearchParams(location.search),mode=q.get('mode'),instance=q.get('instanceId');
function Counter({instanceId}){const [count,setCount]=useState(0);return <section data-instance={instanceId || 'definition'}><h2>{instanceId || '计数器定义'}</h2><button onClick={()=>setCount(count+1)}>增加</button><output>{count}</output></section>}
if(mode==='fake'){const page=document.createElement('main');page.innerHTML='<aside hidden>另一个业务区域</aside><section>完整页面</section>';document.body.append(page)}
if(mode!=='broken')mountAssetScene({definitionId:'counter',scenarioId:mode==='wrong'?'other':'default',instanceId:instance,render(root){const react=createRoot(root);react.render(<Counter instanceId={instance}/>);return()=>react.unmount()}}).catch(error=>{document.body.dataset.failure=error.message});`);
 await build({configFile:false,define:{'process.env.NODE_ENV':'"production"'},root:base,cacheDir:path.join(base,'cache'),logLevel:'warn',build:{outDir:path.join(base,'dist'),lib:{entry,formats:['es'],fileName:()=> 'scene.js'},minify:false}});
 const bundle=fs.readFileSync(path.join(base,'dist/scene.js'));
 const server=http.createServer((req,res)=>{res.setHeader('access-control-allow-origin','*');res.setHeader('content-type',req.url.startsWith('/scene.js')?'text/javascript':'text/html');res.end(req.url.startsWith('/scene.js')?bundle:req.url.startsWith('/scene?')?'<!doctype html><meta charset="utf-8"><script type="module" src="/scene.js"></script>':'<!doctype html><script>window.messages=[];addEventListener("message",e=>{if(e.source===document.querySelector("iframe")?.contentWindow&&e.origin==="null")messages.push(e.data)})</script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const temporary=path.join(base,'browser'),profile=path.join(temporary,'profile');fs.mkdirSync(profile,{recursive:true});
 const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',browserLaunchContract({}, {userDataDirectory:profile}).args,{env:{...process.env,TMPDIR:temporary,XDG_CACHE_HOME:temporary},stdio:'ignore'});let devtools;
 t.after(async()=>cleanupBrowser({child:browser,devtools,server,temporary,profile,root:path.join(root,'.tmp'),remove:()=>fs.rmSync(temporary,{recursive:true}),diagnostic:value=>t.diagnostic(JSON.stringify(value))}));
 const port=await waitForBrowserDevtoolsPort(profile,browser),target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();devtools=await connectDevtools(target.webSocketDebuggerUrl);
 await devtools.call('Page.enable');await devtools.call('Runtime.enable');
 await devtools.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 for(let n=0;n<100;n++){if(await evaluate(devtools,'Array.isArray(window.messages)'))break;await new Promise(resolve=>setTimeout(resolve,20));}
 const observations=[];
 for(const [mode,instance]of [['normal',''],['normal','item-a'],['normal','item-b'],['wrong','item-a'],['broken','item-a'],['fake','item-a']]) {
  const query=new URLSearchParams({mode,instanceId:instance,projectId:'p',revision:'r',channel:'c',assetId:'counter',scenarioId:'default'});
  await evaluate(devtools,`(()=>{document.querySelector('iframe')?.remove();messages=[];const f=document.createElement('iframe');f.sandbox='allow-scripts';f.src='/scene?'+${JSON.stringify(query.toString())};document.body.append(f)})()`);
  let messages=[];for(let n=0;n<60;n++){messages=await evaluate(devtools,'messages');if(messages.length)break;await new Promise(resolve=>setTimeout(resolve,25));}
  if(mode==='normal') {
   fs.writeFileSync(path.join(base,`events-${mode}-${instance || 'definition'}.json`),JSON.stringify(devtools.events,null,2));
   assert(messages.some(m=>m.status==='ready'&&m.projectId==='p'&&m.revision==='r'&&m.channel==='c'&&m.assetId==='counter'),JSON.stringify(messages));
   const targets=(await devtools.call('Target.getTargets')).targetInfos;
   fs.writeFileSync(path.join(base,'targets.json'),JSON.stringify(targets,null,2));
   const frameTarget=targets.find(target=>target.type==='iframe'&&target.url.includes('/scene?'));
   assert(frameTarget,'隔离 frame 必须有独立浏览器 target');
   const frameTools=await connectDevtools(`ws://127.0.0.1:${port}/devtools/page/${frameTarget.targetId}`);
   const world={executionContextId:undefined};
   const observation=await evaluate(frameTools,`(()=>{const root=document.querySelector('[data-foundation-scene]');document.querySelector('button').click();return {instance:root.dataset.foundationInstanceId || '',roots:document.body.querySelectorAll('[data-foundation-scene]').length,width:root.getBoundingClientRect().width,height:root.getBoundingClientRect().height,sections:document.querySelectorAll('section').length,storageBlocked:(()=>{try{localStorage.setItem('probe','bad');return false}catch{return true}})()}})()`,world.executionContextId);
   await new Promise(resolve=>setTimeout(resolve,30));observation.count=await evaluate(frameTools,"document.querySelector('output').textContent",world.executionContextId);
   await frameTools.close();
   assert.equal(observation.instance,instance);assert.equal(observation.roots,1);assert.equal(observation.sections,1);assert(observation.width>0&&observation.height>0);assert.equal(observation.count,'1');assert.equal(observation.storageBlocked,true);observations.push({mode,instance,...observation});
  } else {assert(!messages.some(message=>message.status==='ready'));observations.push({mode,instance,status:messages[0]?.status || 'timeout-no-ready'});}
 }
 fs.writeFileSync(path.join(base,'observations.json'),JSON.stringify({candidateHash:manifest.candidateHash,moduleSha256:sha256(fs.readFileSync(module)),bundleSha256:sha256(bundle),observations},null,2));
 t.diagnostic('工程场景证据='+base+'；此测试不证明项目自动接入或自然制作');
});
