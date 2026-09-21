import {evaluate, connectDevtools} from '../../../../packages/core/workspace-host.mjs';

// Observe the real workbench iframe and its exact origin/source/envelope. This
// driver never manufactures a ready message or mutates the project's data.
export async function observeWorkbenchCapabilities({devtools,devtoolsPort,sourceSceneDigest,workbenchUrl,projectId,revision,pageId,assetUrl}) {
  const checks=[];
  const wait=async expression=>{let result;for(let n=0;n<80;n++){result=await evaluate(devtools,expression);if(result)return result;await new Promise(resolve=>setTimeout(resolve,50));}return null;};
  const capture=`window.__foundationObserved=[];addEventListener('message',event=>{const frame=document.getElementById('preview-frame');if(!frame||event.source!==frame.contentWindow||event.origin!==location.origin)return;const q=new URL(frame.src).searchParams,d=event.data;if(d?.namespace!=='ai-product-foundation-preview'||['projectId','revision','channel'].some(k=>d[k]!==q.get(k)))return;window.__foundationObserved.push(d);});`;
  await devtools.call('Page.enable');
  await devtools.call('Page.addScriptToEvaluateOnNewDocument',{source:capture});
  const open=async()=>{
    await devtools.call('Page.navigate',{url:workbenchUrl});
    if(!await wait("Boolean(document.getElementById('preview-frame')?.contentWindow)"))return null;
    if(!await evaluate(devtools,'Array.isArray(window.__foundationObserved)'))await evaluate(devtools,capture);
    await evaluate(devtools,`(()=>{const f=document.getElementById('preview-frame'),q=new URL(f.src).searchParams;f.contentWindow.postMessage({namespace:'ai-product-foundation-preview',kind:'preview-status-request',...Object.fromEntries(['projectId','revision','channel'].map(k=>[k,q.get(k)]))},location.origin)})()`);
    return wait(`window.__foundationObserved?.find(d=>d.kind==='preview-ready'&&d.protocolVersion==='foundation-preview/2'&&d.projectId===${JSON.stringify(projectId)}&&d.revision===${JSON.stringify(revision)}&&d.pageId===${JSON.stringify(pageId)}&&d.object?.pageId===d.pageId&&d.object?.inspectorId)`);
  };
  const ready=await open();
  checks.push({id:'workbench-handshake',result:ready?'passed':'failed',actual:ready?{projectId:ready.projectId,revision:ready.revision,pageId:ready.pageId,protocolVersion:ready.protocolVersion,object:ready.object.inspectorId}:await evaluate(devtools,"({frame:document.getElementById('preview-frame')?.src,observed:window.__foundationObserved?.map(d=>({kind:d.kind,projectId:d.projectId,revision:d.revision,pageId:d.pageId,protocol:d.protocolVersion})),project:window.__FOUNDATION_MODEL__?.project?.projectId,revision:window.__FOUNDATION_MODEL__?.revision,body:document.body.innerText.slice(0,300)})")});
  let selection=null;
  if(ready) {
    await evaluate(devtools,`(()=>{const f=document.getElementById('preview-frame'),q=new URL(f.src).searchParams;f.contentWindow.postMessage({namespace:'ai-product-foundation-preview',kind:'inspect-navigate',inspectorId:${JSON.stringify(ready.object.inspectorId)},...Object.fromEntries(['projectId','revision','channel'].map(k=>[k,q.get(k)]))},location.origin)})()`);
    selection=await wait(`window.__foundationObserved?.find(d=>d.kind==='inspect-selected'&&d.object?.inspectorId===${JSON.stringify(ready.object.inspectorId)})`);
  }
  checks.push({id:'object-location',result:selection?'passed':'failed',actual:selection?.object || null});
  const reopened=await open();
  checks.push({id:'project-reopen',result:reopened&&reopened.projectId===ready?.projectId&&reopened.pageId===ready?.pageId&&reopened.revision===ready?.revision?'passed':'failed',actual:reopened?{projectId:reopened.projectId,pageId:reopened.pageId,revision:reopened.revision,session:reopened.object.session}:null});
  if(assetUrl) {
    const actual=await evaluate(devtools,`new Promise(resolve=>{const f=document.createElement('iframe'),url=new URL(${JSON.stringify(assetUrl)}),q=url.searchParams;f.sandbox='allow-scripts';f.dataset.foundationVerifierAsset='';let timer;const finish=value=>{clearTimeout(timer);removeEventListener('message',receive);resolve(value)};const receive=event=>{const d=event.data;if(event.source!==f.contentWindow||event.origin!=='null'||d?.namespace!=='ai-product-foundation-asset-preview'||d.kind!=='status'||['projectId','revision','channel','assetId'].some(k=>d[k]!==q.get(k)))return;if(['ready','error','unsupported'].includes(d.status))finish({status:d.status,projectId:d.projectId,revision:d.revision,assetId:d.assetId,channel:d.channel,sandbox:f.getAttribute('sandbox')});};addEventListener('message',receive);f.addEventListener('load',()=>f.contentWindow.postMessage({namespace:'ai-product-foundation-asset-preview',kind:'status-request',...Object.fromEntries(['projectId','revision','channel','assetId'].map(k=>[k,q.get(k)]))},'*'));timer=setTimeout(()=>finish(null),4000);f.src=url.href;document.body.append(f);})`);
    let rendered=null;
    const tree=await devtools.call('Page.getFrameTree');
    const frames=[];const visit=node=>{frames.push(node.frame);for(const child of node.childFrames || [])visit(child);};visit(tree.frameTree);
    const frame=frames.find(frame=>frame.url===assetUrl);
    const q=new URL(assetUrl).searchParams;
    const expression=`(()=>{const assetId=${JSON.stringify(q.get('assetId'))},scenarioId=${JSON.stringify(q.get('scenarioId'))},instance=${JSON.stringify(q.get('instanceId'))};const targets=[...document.querySelectorAll('[data-foundation-component-id][data-foundation-scene]')].filter(e=>e.getAttribute('data-foundation-component-id')===assetId&&e.getAttribute('data-foundation-scene')===scenarioId&&(!instance||e.getAttribute('data-foundation-instance-id')===instance));const e=targets[0],r=e?.getBoundingClientRect();return {count:targets.length,width:r?.width||0,height:r?.height||0,assetId,scenarioId,instance,sourceSceneDigest:e?.getAttribute('data-foundation-source-scene'),otherSceneRoots:document.querySelectorAll('[data-foundation-scene]').length-targets.length};})()`;
    if(frame) {
      const world=await devtools.call('Page.createIsolatedWorld',{frameId:frame.id,worldName:'foundation-verification'});
      rendered=(await devtools.call('Runtime.evaluate',{contextId:world.executionContextId,returnByValue:true,expression})).result?.value;
    }else if(devtoolsPort){
      const targets=(await devtools.call('Target.getTargets')).targetInfos.filter(target=>target.type==='iframe'&&target.url===assetUrl);
      if(targets.length===1){const frameTools=await connectDevtools(`ws://127.0.0.1:${devtoolsPort}/devtools/page/${targets[0].targetId}`);try{rendered=await evaluate(frameTools,expression);}finally{await frameTools.close();}}
    }
    await evaluate(devtools,"document.querySelector('[data-foundation-verifier-asset]')?.remove()");
    checks.push({id:'asset-ready',result:actual?.status==='ready'&&sourceSceneDigest&&rendered?.sourceSceneDigest===sourceSceneDigest&&rendered?.count===1&&rendered.width>0&&rendered.height>0&&rendered.otherSceneRoots===0?'passed':'failed',actual:{handshake:actual,rendered}});
  }
  return checks;
}
