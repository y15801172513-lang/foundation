// The project mounts an isolated definition/instance, then supplies its real root.
// This adapter never hides sibling page regions or renders a substitute screenshot.
export function createAssetSceneBridge({win=window,root,definitionId,scenarioId}) {
  const query=new URLSearchParams(win.location.search),keys=['projectId','revision','channel','assetId'];
  const identity=Object.fromEntries(keys.map(key=>[key,query.get(key)]));
  let parentOrigin;try{parentOrigin=new URL(win.document.referrer).origin;}catch{return {state:'unsupported',destroy(){}};}
  const configured=keys.every(key=>identity[key])&&identity.assetId===definitionId&&query.get('scenarioId')===scenarioId;
  const emit=()=>{
    const rect=root?.isConnected?root.getBoundingClientRect():null;
    const outside=[...win.document.body.children].filter(element=>element!==root&&!element.contains(root)&&!['SCRIPT','STYLE','LINK'].includes(element.tagName));
    const ready=!outside.length&&configured&&root?.getAttribute('data-foundation-component-id')===definitionId&&root.getAttribute('data-foundation-scene')===scenarioId&&rect?.width>0&&rect?.height>0;
    win.parent.postMessage({namespace:'ai-product-foundation-asset-preview',kind:'status',...identity,status:ready?'ready':'unsupported',message:ready?'独立场景已挂载；完整验收由工作台核验':'缺少匹配的独立定义场景根'},parentOrigin);
  };
  const onMessage=event=>{const data=event.data;if(event.source!==win.parent||event.origin!==parentOrigin||data?.namespace!=='ai-product-foundation-asset-preview')return;if(data.kind==='snapshot-rebound'){if(data.projectId===identity.projectId&&data.assetId===identity.assetId&&data.channel===identity.channel&&data.fromRevision===identity.revision&&typeof data.nextRevision==='string'&&data.nextRevision){identity.revision=data.nextRevision;emit();}return;}if(data.kind!=='status-request'||keys.some(key=>data[key]!==identity[key]))return;emit();};
  win.addEventListener('message',onMessage);emit();return {state:configured?'configured':'unsupported',destroy(){win.removeEventListener('message',onMessage);}};
}

// Framework-neutral mount contract. React callers render the requested exported
// definition into this fresh container with createRoot; static callers append DOM.
// Only the dedicated scene is mounted. Existing page content is never hidden.
export async function mountAssetScene({win=window,definitionId,scenarioId,instanceId=null,render}) {
  const doc=win.document;
  if([...doc.body.children].some(element=>!['SCRIPT','STYLE','LINK'].includes(element.tagName)))throw new Error('独立场景需要空白文档，不能用整页或隐藏区域代替');
  const root=doc.createElement('div');
  root.setAttribute('data-foundation-component-id',definitionId);
  root.setAttribute('data-foundation-scene',scenarioId);
  if(instanceId)root.setAttribute('data-foundation-instance-id',instanceId);
  doc.body.append(root);
  let cleanup;
  try {
    cleanup=await render(root);
    // Offscreen sandboxed frames can suspend requestAnimationFrame. Wait for
    // committed content and actual geometry using bounded timers instead.
    await new Promise((resolve,reject)=>{
      let poll;
      const finish=error=>{win.clearTimeout(poll);win.clearTimeout(timeout);error?reject(error):resolve();};
      const timeout=win.setTimeout(()=>finish(new Error('独立场景未在限定时间内渲染真实定义')),8000);
      const inspect=()=>{const rect=root.getBoundingClientRect();if(root.isConnected&&root.children.length&&rect.width>0&&rect.height>0)finish();else poll=win.setTimeout(inspect,50);};
      inspect();
    });
    if(!root.children.length)throw new Error('独立场景尚未渲染真实定义');
    const bridge=createAssetSceneBridge({win,root,definitionId,scenarioId});
    return {...bridge,root,destroy(){bridge.destroy();if(typeof cleanup==='function')cleanup();root.remove();}};
  }catch(error){if(typeof cleanup==='function')cleanup();root.remove();throw error;}
}
