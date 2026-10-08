import {inspectStyleVariableUsage} from './style-variable-usage.mjs';
import {resolveObjectLocator,shortObjectName,renderedIconPart} from './object-identity.mjs';
export const PREVIEW_NAMESPACE = 'ai-product-foundation-preview';
const contextKey=Symbol.for('foundation.preview.contexts/2');
const contexts=globalThis[contextKey] ||= new WeakMap();
const bridgeKey=Symbol.for('foundation.preview.bridge/2');
const incarnationElements=new WeakMap();
export function bindPreviewContext(win,context) { contexts.set(win,{...contexts.get(win),...context,...win.__foundationTrustedPreview}); }
function envelope(win) { const q=new URLSearchParams(win.location.search);return {...Object.fromEntries(['projectId','revision','channel'].map(key=>[key,q.get(key)])),...contexts.get(win)?.envelope}; }
function pageId(win) { return contexts.get(win)?.pageId || new URLSearchParams(win.location.search).get('pageId') || 'unmapped-page'; }
const sessions=new WeakMap();
function session(doc) { if(!sessions.has(doc))sessions.set(doc,doc.defaultView.crypto.randomUUID());return sessions.get(doc); }
export const PREVIEW_PROTOCOL_VERSION='foundation-preview/2';

export function applyPreviewTheme(theme, doc) {
  if (theme !== 'light' && theme !== 'dark') return false;
  doc.documentElement.classList.toggle('dark', theme === 'dark');
  doc.documentElement.dataset.theme = theme;
  doc.documentElement.style.colorScheme = theme;
  return true;
}

export function previewThemeFromSearch(search = window.location.search) {
  const theme = new URLSearchParams(search).get('foundationTheme');
  return theme === 'light' || theme === 'dark' ? theme : null;
}

export function announcePreview({win = window} = {}) {
  const target = [...win.document.body.children].find((element) => !element.matches('script,style,[data-foundation-inspector-overlay]')) || win.document.body;
  win.parent.postMessage({namespace: PREVIEW_NAMESPACE, ...envelope(win), protocolVersion:PREVIEW_PROTOCOL_VERSION,capabilities:['page','object-inspection'],kind: 'preview-ready', pageId: pageId(win), route: `${win.location.pathname}${win.location.search}`, object: inspectionObject(target, win)}, win.location.origin);
}

const INSPECTOR_STYLE_ID = 'foundation-inspector-style';
const ephemeralObjects = new WeakMap();
let ephemeralSequence = 0;
const safeText = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const identityAttribute=/^data-foundation-(?:object-id|incarnation|owner-id|definition|instance-key|instance-values|instance-id|render-map|reference|source)$/u;
const runtimeAttributes=element=>({...Object.fromEntries([...element.attributes].filter(attr=>!identityAttribute.test(attr.name)&&!(attr.name==='style'&&!element.style.length)).map(attr=>[attr.name,attr.name==='style'?Array.from(element.style).filter(property=>!property.startsWith('--foundation-cascade-')).map(property=>property+':'+element.style.getPropertyValue(property)+':'+element.style.getPropertyPriority(property)).join(';'):attr.value]).sort(([a],[b])=>a.localeCompare(b))),...(['INPUT','TEXTAREA','SELECT'].includes(element.tagName)?{'$value':String(element.value),'$checked':String(element.checked ?? ''),'$selectedIndex':String(element.selectedIndex ?? '')}:{})});
const contentMarkup=doc=>JSON.stringify([...doc.body.querySelectorAll('*')].filter(element=>!element.closest('[data-foundation-inspector-overlay]')&&element.id!=='foundation-inspector-style').map(element=>({tag:element.localName,attributes:runtimeAttributes(element),text:[...element.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join('')})));


function roleOf(element) {
  return safeText(element.getAttribute('role')) || ({BUTTON: 'button', A: 'link', INPUT: 'input', TEXTAREA: 'textbox', SELECT: 'select', MAIN: 'main', HEADER: 'header', FOOTER: 'footer', NAV: 'navigation', SECTION: 'section', ARTICLE: 'article', FORM: 'form'}[element.tagName] || element.tagName.toLowerCase());
}

function sourceDisplayKey(element) {const part=renderedIconPart(element);return part?part.root.getAttribute('data-foundation-object-id')+'#'+part.mapping.name+':'+part.key:element.getAttribute('data-foundation-object-id');}
function nameInfo(element) {
  const source=renderedIconPart(element)?.root || element,id=source.getAttribute('data-foundation-object-id');
  const peers=id?[...element.ownerDocument.querySelectorAll('[data-foundation-object-id]')].filter(item=>item.getAttribute('data-foundation-object-id')===id):[...(element.parentElement?.children || [])];
  return shortObjectName({label:element.getAttribute('data-foundation-label'),accessible:element.getAttribute('aria-label'),role:roleOf(element),decorative:element.getAttribute('aria-hidden')==='true',instanceKey:instanceOf(element),peerInstanceKeys:peers.map(instanceOf),objectKey:sourceDisplayKey(element),peerObjectKeys:[...(element.parentElement?.children || [])].filter(item=>roleOf(item)===roleOf(element)).map(sourceDisplayKey),text:[...element.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ')});
}
function nameOf(element) {return nameInfo(element).name;}

function structuralSegment(element) {
  const tag = element.tagName.toLowerCase();
  const id = safeText(element.id, 80);
  if (id) return `${tag}#${id}`;
  const siblings = element.parentElement ? [...element.parentElement.children].filter((item) => item.tagName === element.tagName) : [element];
  return siblings.length > 1 ? `${tag}:${siblings.indexOf(element) + 1}` : tag;
}

function instanceOf(element) {
  return element.getAttribute('data-foundation-instance-id') || element.closest('[data-foundation-instance-key]')?.getAttribute('data-foundation-instance-key') || null;
}
function identityOf(element,doc) {
  const part=renderedIconPart(element),sourceElement=part?.root || element;
  const rootId=safeText(sourceElement.getAttribute('data-foundation-object-id'),128);
  const declared=part&&rootId?rootId+'#'+part.mapping.name+':'+part.key:rootId;
  const componentId=safeText(element.getAttribute('data-foundation-component-id'),128);
  const instanceId=safeText(instanceOf(element),128);
  const candidate=declared || (componentId && instanceId ? `component:${componentId}:${instanceId}` : null);
  const duplicates=part ? (part.root.getAttribute('data-foundation-object-id') ? [...doc.querySelectorAll('[data-foundation-object-id]')].filter(e=>e.getAttribute('data-foundation-object-id')===rootId&&(instanceOf(e)||null)===(instanceId||null)).length : 0) : candidate?[...doc.querySelectorAll('[data-foundation-object-id],[data-foundation-component-id]')].filter(e=>(e.getAttribute('data-foundation-object-id') || (e.getAttribute('data-foundation-component-id')&&e.getAttribute('data-foundation-instance-id')?`component:${e.getAttribute('data-foundation-component-id')}:${e.getAttribute('data-foundation-instance-id')}`:null))===candidate&&(instanceOf(e) || null)===(instanceId || null)).length:0;
  if(!ephemeralObjects.has(element))ephemeralObjects.set(element,++ephemeralSequence);
  const persistentId=duplicates===1?candidate:null;
  const history=contexts.get(doc.defaultView)?.identityHistory || [];
  const incarnation=sourceElement.getAttribute('data-foundation-incarnation');
  const registered=history.filter(item=>item.incarnation===incarnation&&Boolean(incarnation)&&item.persistentId===(part?rootId:persistentId) && ((item.instanceKey || null)===(instanceId || null)||!item.instanceKey&&Boolean(element.closest('[data-foundation-instance-key]'))) && item.state==='active');
  let identityGeneration=registered.length===1?registered[0].generation:null;
  if(identityGeneration){if(!incarnationElements.has(doc))incarnationElements.set(doc,new Map());const seen=incarnationElements.get(doc),birthKey=JSON.stringify([identityGeneration,instanceId,persistentId]),old=seen.get(birthKey);if(old&&old!==element){if(!old.isConnected&&contexts.get(doc.defaultView)?.dataBinding==='source-program')seen.set(birthKey,element);else{seen.set(birthKey,false);identityGeneration=null;}}else if(old===false)identityGeneration=null;else seen.set(birthKey,element);}
  const context=contexts.get(doc.defaultView),runtimeObject=context?.runtimeObjects?.find(item=>item.persistentId===persistentId&&item.generation===identityGeneration&&(item.instanceKey || null)===(instanceId || null)),snapshotIssue=context?.dataBinding==='source-program'&&(context.runtimeSnapshotPending||!runtimeObject)?'runtime-snapshot-pending':context?.runtimeDataChanged?'runtime-data-unverified':context?.dataBinding==='unverified'?'data-version-unverified':null;
  return {runtimeSnapshotIssue:context?.runtimeSnapshotIssue || null,instanceGeneration:runtimeObject?.instanceGeneration || null,runtimeVersion:context?.runtimeVersion || null,snapshotIssue,contentVersion:snapshotIssue?null:context?.contentVersion || null,shortReference:snapshotIssue?null:runtimeObject?.reference || element.getAttribute('data-foundation-reference') || null,projectId:envelope(doc.defaultView).projectId,persistentId,identityGeneration,identity:{kind:persistentId?'persistent':'temporary',persistentId,session:session(doc),revision:envelope(doc.defaultView).revision,reason:duplicates>1?'duplicate-identity':persistentId?'explicit-source-identity':'no-persistent-key'},session:session(doc),revision:envelope(doc.defaultView).revision,sourceLocation:element.getAttribute('data-foundation-source')?{file:element.getAttribute('data-foundation-source'),anchor:declared || instanceId,source:'source-annotation'}:null};
}
function inspectorIdOf(element,doc) {
  identityOf(element,doc);
  return `dom:${envelope(doc.defaultView).revision || 'current-document'}:${session(doc)}:${ephemeralObjects.get(element)}`;
}

function descriptor(element, doc) {
  if (!element) return null;
  return {...identityOf(element,doc),nameQuality:nameInfo(element),inspectorId: inspectorIdOf(element, doc), name: nameOf(element), role: roleOf(element), componentId: element.getAttribute('data-foundation-component-id') || null, instanceId: instanceOf(element), registeredComponent: Boolean(element.getAttribute('data-foundation-component-id'))};
}

function inspectorTree(doc) {
  let remaining = 300;
  const visit = (element, depth = 0) => {
    if (remaining <= 0 || depth > 12 || element.matches('script,style,[data-foundation-inspector-overlay]')) return null;
    remaining -= 1;
    const item = descriptor(element, doc);
    return {...item, summary: item.componentId ? `${item.componentId}${item.instanceId ? ` · ${item.instanceId}` : ''}` : structuralSegment(element), children: [...element.children].map((child) => visit(child, depth + 1)).filter(Boolean)};
  };
  return [...doc.body.children].map((element) => visit(element)).filter(Boolean);
}

function inspectableElement(target, doc) {
  if (!(target instanceof doc.defaultView.Element) || target.closest('[data-foundation-inspector-overlay]')) return null;
  return target;
}


function inspectionObject(element, win) {
  const variableUsage=inspectStyleVariableUsage(element,win);
  const computed = win.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const ancestors = [];
  const ancestorIds = [];
  for (let current = element; current && current !== win.document.body; current = current.parentElement) { ancestors.unshift(roleOf(current)); if (current !== element) ancestorIds.unshift(inspectorIdOf(current, win.document)); }
  return {
    version: 1,
    ...identityOf(element,win.document),
    nameQuality:nameInfo(element),
    inspectorId: inspectorIdOf(element, win.document),
    pageId: pageId(win),
    name: nameOf(element),
    role: roleOf(element),
    componentId: element.getAttribute('data-foundation-component-id') || null,
    instanceId: instanceOf(element),
    variant: element.getAttribute('data-foundation-variant') || null,
    eventId: element.getAttribute('data-foundation-event-id') || null,
    eventState: element.getAttribute('data-foundation-event-state') || null,
    registeredComponent: Boolean(element.getAttribute('data-foundation-component-id')),
    path: ancestors.slice(-6),
    ancestorIds: ancestorIds.slice(-12),
    tree: inspectorTree(win.document),
    hierarchy: {parent: descriptor(element.parentElement, win.document), current: descriptor(element, win.document), children: [...element.children].slice(0, 12).map((child) => descriptor(child, win.document))},
    layout: {display: computed.display, position: computed.position, width: `${Math.round(rect.width)}px`, height: `${Math.round(rect.height)}px`, gap: computed.gap, flexDirection: computed.flexDirection, gridTemplateColumns: safeText(computed.gridTemplateColumns)},
    text:element.textContent || '',
    attributes:runtimeAttributes(element),
    usedVariables:variableUsage.used,
    variableCandidates:variableUsage.candidates,
    styleLimitations:variableUsage.limitations,
    style: {color: computed.color, backgroundColor: computed.backgroundColor, fontFamily: safeText(computed.fontFamily), fontSize: computed.fontSize, fontWeight: computed.fontWeight, borderRadius: computed.borderRadius}
  };
}

export function createInspectorBridge({win = window, doc = win.document} = {}) {
  if(win[bridgeKey])return win[bridgeKey];
  let active = false; let hovered = null; let locked = null; let previewed = null; let frameId = null; let refreshObjectOnFrame = false; let destroyed = false;
  const overlay = doc.createElement('div');
  overlay.dataset.foundationInspectorOverlay = '';
  overlay.hidden = true;
  const label = doc.createElement('span'); overlay.append(label); doc.body.append(overlay);
  let style = doc.getElementById(INSPECTOR_STYLE_ID);
  if (!style) {
    style = doc.createElement('style'); style.id = INSPECTOR_STYLE_ID;
    style.textContent = 'html.foundation-inspecting,html.foundation-inspecting *{cursor:crosshair!important}[data-foundation-inspector-overlay]{position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #2563eb;background:rgb(37 99 235/.08)}[data-foundation-inspector-overlay]>span{position:absolute;left:-2px;top:-24px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:4px;background:#2563eb;padding:3px 6px;color:white;font:600 11px/1.4 ui-sans-serif,system-ui}';
    doc.head.append(style);
  }
  const post = (kind, extra = {}) => win.parent.postMessage({namespace: PREVIEW_NAMESPACE, ...envelope(win), kind, ...extra}, win.location.origin);
  const ResizeObserverClass = win.ResizeObserver;
  const targetObserver = ResizeObserverClass ? new ResizeObserverClass(() => scheduleOverlayUpdate(true)) : null;
  const observeTarget = (element) => { targetObserver?.disconnect(); if (element?.isConnected) targetObserver?.observe(element); };
  const clearOverlay = () => { overlay.hidden = true; hovered = null; previewed = null; observeTarget(null); };
  const draw = (element) => {
    if (!element?.isConnected) { clearOverlay(); return; }
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
    label.textContent = `${nameOf(element)} · ${roleOf(element)}`; overlay.hidden = false;
  };
  const sendObject = (kind, element, extra = {}) => {
    if(kind==='inspect-selected'&&contexts.get(win)?.dataBinding==='source-program') {
      syncRuntime().then(()=>{if(!destroyed&&element.isConnected&&locked===element)post(kind,{object:inspectionObject(element,win),...extra});});
    }else post(kind,{object:inspectionObject(element,win),...extra});
  };
  const runtimeRecords=()=>[...doc.body.querySelectorAll('*')].filter(element=>(element.hasAttribute('data-foundation-object-id')||renderedIconPart(element))&&!element.closest('[data-foundation-inspector-overlay]')).map(element=>{
    const identity=identityOf(element,doc),attributes=runtimeAttributes(element);
    const parent=element.parentElement?.closest('[data-foundation-object-id]');
    return {persistentId:identity.persistentId,generation:identity.identityGeneration,instanceKey:instanceOf(element),tag:element.localName,text:element.textContent || '',attributes,parent:parent?{persistentId:sourceDisplayKey(parent),instanceKey:instanceOf(parent)}:null};
  });
  let runtimeFlight=null,lastRuntimeText=null,lastRuntimeVersion=null,runtimeTimer=null,runtimeWriteNonce=null,runtimeSequence=0,runtimeDirty=false;
  async function syncRuntime() {
    if(contexts.get(win)?.dataBinding!=='source-program'||destroyed)return;
    if(runtimeFlight){await runtimeFlight;return;}
    runtimeFlight=(async()=>{
      for(let attempt=0;attempt<3&&!destroyed;attempt++) {
        runtimeDirty=false;
        const records=runtimeRecords(),text=JSON.stringify(records),context=contexts.get(win);
        if(text===lastRuntimeText&&context.runtimeVersion===lastRuntimeVersion&&(!context.runtimeSnapshotIssue||context.runtimeSnapshotIssue==='runtime-synchronizing')){contexts.set(win,{...context,runtimeSnapshotPending:false,runtimeSnapshotIssue:null});return;}
        contexts.set(win,{...context,runtimeSnapshotPending:true,runtimeSnapshotIssue:'runtime-synchronizing'});
        try {
          if(!runtimeWriteNonce){
            const response=await win.fetch('/__foundation/runtime-session',{method:'POST'});
            if(!response.ok)throw new Error('当前运行会话尚未就绪');
            runtimeWriteNonce=(await response.json()).writeNonce;
            if(!runtimeWriteNonce)throw new Error('当前运行会话缺少凭据');
          }
          const response=await win.fetch('/__foundation/runtime-object-snapshot',{method:'POST',headers:{'content-type':'application/json','x-foundation-write-nonce':runtimeWriteNonce},body:JSON.stringify({pageId:pageId(win),contentVersion:context.contentVersion,previousRuntimeVersion:context.runtimeVersion || null,documentId:session(doc),requestSequence:++runtimeSequence,observationScope:'document-local',objects:records})});
          if(response.status===403){runtimeWriteNonce=null;throw new Error('运行服务已重启，重新握手');}
          const result=await response.json();
          if(result.state==='bound') {
            // A response acknowledges this submitted observation even when DOM
            // moved on during transit. Advance its cursor, then bind newer DOM.
            const unchanged=JSON.stringify(runtimeRecords())===text;
            contexts.set(win,{...contexts.get(win),runtimeVersion:result.runtimeVersion,runtimeObjects:unchanged?result.objects:[],runtimeSnapshotPending:!unchanged,runtimeSnapshotIssue:unchanged?null:'runtime-synchronizing'});
            if(unchanged){lastRuntimeText=text;lastRuntimeVersion=result.runtimeVersion;if(locked?.isConnected)post('inspect-updated',{object:inspectionObject(locked,win)});return;}
          }else {
            if(result.reason==='document-cursor-mismatch'&&result.documentRuntimeVersion)contexts.set(win,{...contexts.get(win),runtimeVersion:result.documentRuntimeVersion,runtimeObjects:[]});
            contexts.set(win,{...contexts.get(win),runtimeSnapshotPending:true,runtimeSnapshotIssue:result.state==='stale'?'内容已更新，请刷新后重新选择并复制':result.reason || result.state});
            if(!['sync-required','observation-conflict'].includes(result.state))return;
          }
        }catch(error){contexts.set(win,{...contexts.get(win),runtimeSnapshotPending:true,runtimeSnapshotIssue:error.message});}
        if(attempt<2)await new Promise(resolve=>win.setTimeout(resolve,100*(attempt+1)));
      }
    })();
    try{await runtimeFlight;}finally{runtimeFlight=null;if(runtimeDirty&&!destroyed)scheduleRuntime();}
  }
  function scheduleRuntime(){
    runtimeDirty=true;
    const context=contexts.get(win);
    if(context?.dataBinding==='source-program')contexts.set(win,{...context,runtimeSnapshotPending:true});
    if(runtimeTimer!==null)win.clearTimeout(runtimeTimer);
    runtimeTimer=win.setTimeout(()=>{runtimeTimer=null;syncRuntime();},30);
  }

  const byInspectorId = (value) => {
    const inspectorId = safeText(value, 500);
    const matches=inspectorId ? [doc.body,...doc.body.querySelectorAll('*')].filter(element=>inspectorIdOf(element,doc)===inspectorId) : [];
    return matches.length===1?matches[0]:null;
  };
  function scheduleOverlayUpdate(refreshObject = false) {
    if (destroyed || (!active && !previewed && !locked)) return;
    refreshObjectOnFrame ||= refreshObject;
    if (frameId !== null) return;
    const request = win.requestAnimationFrame?.bind(win) || ((callback) => win.setTimeout(callback, 16));
    frameId = request(() => {
      frameId = null;
      const target = previewed || locked || hovered;
      if (!target?.isConnected) {
        if (previewed === target) previewed = null;
        if (locked) { locked = null; post('inspect-selection-invalidated', {reason: 'node-removed'}); }
        const fallback = locked || (active ? hovered : null);
        if (fallback?.isConnected) { observeTarget(fallback); draw(fallback); }
        else clearOverlay();
        refreshObjectOnFrame = false; return;
      }
      draw(target);
      if (target === locked && refreshObjectOnFrame) sendObject('inspect-updated', locked);
      refreshObjectOnFrame = false;
    });
  }
  const setActive = (next) => {
    active = Boolean(next); if(active){locked = null; clearOverlay();}
    doc.documentElement.classList.toggle('foundation-inspecting', active);
    if (!active && locked) draw(locked);
  };
  const onMessage = (event) => {
    if (event.source !== win.parent || event.origin !== win.location.origin || event.data?.namespace !== PREVIEW_NAMESPACE) return;
    if(event.data.kind==='snapshot-rebound'){const current=envelope(win);if(event.data.projectId===current.projectId&&event.data.channel===current.channel&&event.data.fromRevision===current.revision&&typeof event.data.nextRevision==='string'&&event.data.nextRevision){bindPreviewContext(win,{...contexts.get(win),identityHistory:event.data.identityHistory || [],envelope:{...current,revision:event.data.nextRevision}});announcePreview({win});}return;}
    if(envelope(win).revision && ['projectId','revision','channel'].some(key=>event.data[key]!==envelope(win)[key]))return;
    if(Array.isArray(event.data.identityHistory))bindPreviewContext(win,{...contexts.get(win),identityHistory:event.data.identityHistory});
    if(event.data.kind==='preview-status-request'){announcePreview({win});return;}
    if(event.data.kind==='runtime-binding-request'){syncRuntime().then(()=>{const context=contexts.get(win);post('runtime-binding',{documentId:session(doc),runtimeVersion:context?.runtimeVersion || null,pending:Boolean(context?.runtimeSnapshotPending),issue:context?.runtimeSnapshotIssue || null});});return;}
    if (event.data.kind === 'theme-changed') { applyPreviewTheme(event.data.theme, doc); return; }
    if (event.data.kind === 'inspect-mode-changed' && typeof event.data.active === 'boolean') setActive(event.data.active);
    if (event.data.kind === 'inspect-preview') {
      const next = byInspectorId(event.data.inspectorId);
      if (next) { previewed = next; observeTarget(next); draw(next); }
    }
    if (event.data.kind === 'inspect-preview-ended') {
      previewed = null;
      const next = locked || (active ? hovered : null);
      if (next?.isConnected) { observeTarget(next); draw(next); }
      else clearOverlay();
    }
    if (event.data.kind === 'inspect-navigate') {
      const resolved=event.data.locator?resolveObjectLocator(event.data.locator,[doc.body,...doc.body.querySelectorAll('*')].map(element=>({...identityOf(element,doc),instanceId:instanceOf(element),inspectorId:inspectorIdOf(element,doc),element})),{...envelope(win),session:session(doc)}):null;
      const next = event.data.locator ? resolved?.object?.element : event.data.inspectorId ? byInspectorId(event.data.inspectorId) : event.data.direction === 'parent' ? locked?.parentElement : event.data.direction === 'child' && Number.isInteger(event.data.index) ? locked?.children[event.data.index] : null;
      if (next) { active=false; doc.documentElement.classList.remove('foundation-inspecting'); previewed = null; locked = next; hovered = next; observeTarget(next); draw(next); sendObject('inspect-selected', next,{automaticRestore:event.data.automaticRestore===true}); }
      else post('inspect-selection-invalidated',{reason:'locator-expired-or-ambiguous'});
    }
  };
  const onOver = (event) => {
    if (!active || locked) return;
    const element = inspectableElement(event.composedPath?.().find(node=>node instanceof doc.defaultView.Element) || event.target, doc); if (!element) return;
    previewed = null; hovered = element; observeTarget(element); draw(element); sendObject('inspect-hovered', element);
  };
  const block = (event) => {
    if (!active) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
    if (event.type === 'click') {
      const element = inspectableElement(event.composedPath?.().find(node=>node instanceof doc.defaultView.Element) || event.target, doc);
      if (element) { active=false; doc.documentElement.classList.remove('foundation-inspecting'); previewed = null; locked = element; hovered = element; observeTarget(element); draw(element); sendObject('inspect-selected', element); }
    }
  };
  const onKey = (event) => {
    if (!active && !(locked && event.key==='Escape')) return;
    if (event.key !== 'Escape') return block(event);
    event.preventDefault(); event.stopPropagation();
    if (locked) { locked = null; clearOverlay(); post('inspect-selection-invalidated', {reason: 'escape-lock'}); return; }
    if (hovered) { clearOverlay(); post('inspect-selection-invalidated', {reason: 'escape-hover'}); return; }
    setActive(false); post('inspect-exit-request');
  };
  win.addEventListener('message', onMessage);
  const onViewportChange = () => scheduleOverlayUpdate(false);
  win.addEventListener('scroll', onViewportChange, true);
  win.addEventListener('resize', onViewportChange);
  doc.addEventListener('mouseover', onOver, true);
  for (const type of ['click', 'auxclick', 'submit', 'dragstart']) doc.addEventListener(type, block, true);
  doc.addEventListener('keydown', onKey, true);
  const initialMarkup=contentMarkup(doc);
  const observer = new win.MutationObserver(records => {
    const internal=node=>{const element=node.nodeType===1?node:node.parentElement;return element?.closest('[data-foundation-inspector-overlay],#'+INSPECTOR_STYLE_ID);};
    const context=contexts.get(win);
    if(context?.dataBinding==='source-program'&&records.some(record=>!internal(record.target)))scheduleRuntime();
    if(context?.dataBinding==='static-source'&&contentMarkup(doc)!==initialMarkup)contexts.set(win,{...context,runtimeDataChanged:true});
    if (locked && !locked.isConnected) { locked = null; clearOverlay(); post('inspect-selection-invalidated', {reason: 'node-removed'}); return; } scheduleOverlayUpdate(Boolean(locked));
  });
  observer.observe(doc.body, {childList: true, characterData:true,attributes:true, subtree: true});
  for(const type of ['input','change','toggle'])doc.addEventListener(type,scheduleRuntime,true);
  scheduleRuntime();
  return win[bridgeKey]={destroy() { if (destroyed) return; setActive(false); destroyed = true;delete win[bridgeKey];for(const type of ['input','change','toggle'])doc.removeEventListener(type,scheduleRuntime,true);if(runtimeTimer!==null)win.clearTimeout(runtimeTimer); observer.disconnect(); targetObserver?.disconnect(); if (frameId !== null) { const cancel = win.cancelAnimationFrame?.bind(win) || win.clearTimeout.bind(win); cancel(frameId); frameId = null; } win.removeEventListener('message', onMessage); win.removeEventListener('scroll', onViewportChange, true); win.removeEventListener('resize', onViewportChange); doc.removeEventListener('mouseover', onOver, true); for (const type of ['click', 'auxclick', 'submit', 'dragstart']) doc.removeEventListener(type, block, true); doc.removeEventListener('keydown', onKey, true); overlay.remove(); }};
}

export function installInspectorBridge() {
  return createInspectorBridge();
}
