import {resolveObjectLocator} from './object-identity.mjs';
export const PREVIEW_NAMESPACE = 'ai-product-foundation-preview';
const contexts=new WeakMap();
const incarnationElements=new WeakMap();
export function bindPreviewContext(win,context) { contexts.set(win,{...context}); }
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

function roleOf(element) {
  return safeText(element.getAttribute('role')) || ({BUTTON: 'button', A: 'link', INPUT: 'input', TEXTAREA: 'textbox', SELECT: 'select', MAIN: 'main', HEADER: 'header', FOOTER: 'footer', NAV: 'navigation', SECTION: 'section', ARTICLE: 'article', FORM: 'form'}[element.tagName] || element.tagName.toLowerCase());
}

function nameInfo(element) {
  const registered=safeText(element.getAttribute('data-foundation-label'));
  const accessible=safeText(element.getAttribute('aria-label'));
  const ownText=safeText([...element.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' '),72);
  const usable=text=>/[\p{L}\p{N}]/u.test(text);
  let name=registered||accessible||(usable(ownText)?ownText:'');
  let state=name?'declared':'inferred';
  if(!name)name=element.getAttribute('aria-hidden')==='true'?'装饰对象（用途待命名）':`${roleOf(element)}（待命名）`;
  return {name,state,source:registered?'source-annotation':accessible?'accessible-name':usable(ownText)?'own-text':'role-inference'};
}
function nameOf(element) {return nameInfo(element).name;}

function structuralSegment(element) {
  const tag = element.tagName.toLowerCase();
  const id = safeText(element.id, 80);
  if (id) return `${tag}#${id}`;
  const siblings = element.parentElement ? [...element.parentElement.children].filter((item) => item.tagName === element.tagName) : [element];
  return siblings.length > 1 ? `${tag}:${siblings.indexOf(element) + 1}` : tag;
}

function identityOf(element,doc) {
  const declared=safeText(element.getAttribute('data-foundation-object-id'),128);
  const componentId=safeText(element.getAttribute('data-foundation-component-id'),128);
  const instanceId=safeText(element.getAttribute('data-foundation-instance-id'),128);
  const candidate=declared || (componentId && instanceId ? `component:${componentId}:${instanceId}` : null);
  const duplicates=candidate?[...doc.querySelectorAll('[data-foundation-object-id],[data-foundation-component-id]')].filter(e=>(e.getAttribute('data-foundation-object-id') || (e.getAttribute('data-foundation-component-id')&&e.getAttribute('data-foundation-instance-id')?`component:${e.getAttribute('data-foundation-component-id')}:${e.getAttribute('data-foundation-instance-id')}`:null))===candidate).length:0;
  if(!ephemeralObjects.has(element))ephemeralObjects.set(element,++ephemeralSequence);
  const persistentId=duplicates===1?candidate:null;
  const history=contexts.get(doc.defaultView)?.identityHistory || [];
  const incarnation=element.getAttribute('data-foundation-incarnation');
  const registered=history.filter(item=>item.incarnation===incarnation&&Boolean(incarnation)&&item.persistentId===persistentId && (item.instanceKey || null)===(instanceId || null) && item.state==='active');
  let identityGeneration=registered.length===1?registered[0].generation:null;
  if(identityGeneration){if(!incarnationElements.has(doc))incarnationElements.set(doc,new Map());const seen=incarnationElements.get(doc),old=seen.get(identityGeneration);if(old&&old!==element){seen.set(identityGeneration,false);identityGeneration=null;}else if(old===false)identityGeneration=null;else seen.set(identityGeneration,element);}
  return {projectId:envelope(doc.defaultView).projectId,persistentId,identityGeneration,identity:{kind:persistentId?'persistent':'temporary',persistentId,session:session(doc),revision:envelope(doc.defaultView).revision,reason:duplicates>1?'duplicate-identity':persistentId?'explicit-source-identity':'no-persistent-key'},session:session(doc),revision:envelope(doc.defaultView).revision,sourceLocation:element.getAttribute('data-foundation-source')?{file:element.getAttribute('data-foundation-source'),anchor:declared || instanceId,source:'source-annotation'}:null};
}
function inspectorIdOf(element,doc) {
  identityOf(element,doc);
  return `dom:${envelope(doc.defaultView).revision || 'current-document'}:${session(doc)}:${ephemeralObjects.get(element)}`;
}

function descriptor(element, doc) {
  if (!element) return null;
  return {...identityOf(element,doc),nameQuality:nameInfo(element),inspectorId: inspectorIdOf(element, doc), name: nameOf(element), role: roleOf(element), componentId: element.getAttribute('data-foundation-component-id') || null, instanceId: element.getAttribute('data-foundation-instance-id') || null, registeredComponent: Boolean(element.getAttribute('data-foundation-component-id'))};
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
  return target.closest('[data-foundation-component-id]') || target;
}

function inspectionObject(element, win) {
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
    instanceId: element.getAttribute('data-foundation-instance-id') || null,
    variant: element.getAttribute('data-foundation-variant') || null,
    eventId: element.getAttribute('data-foundation-event-id') || null,
    eventState: element.getAttribute('data-foundation-event-state') || null,
    registeredComponent: Boolean(element.getAttribute('data-foundation-component-id')),
    path: ancestors.slice(-6),
    ancestorIds: ancestorIds.slice(-12),
    tree: inspectorTree(win.document),
    hierarchy: {parent: descriptor(element.parentElement, win.document), current: descriptor(element, win.document), children: [...element.children].slice(0, 12).map((child) => descriptor(child, win.document))},
    layout: {display: computed.display, position: computed.position, width: `${Math.round(rect.width)}px`, height: `${Math.round(rect.height)}px`, gap: computed.gap, flexDirection: computed.flexDirection, gridTemplateColumns: safeText(computed.gridTemplateColumns)},
    style: {color: computed.color, backgroundColor: computed.backgroundColor, fontFamily: safeText(computed.fontFamily), fontSize: computed.fontSize, fontWeight: computed.fontWeight, borderRadius: computed.borderRadius}
  };
}

export function createInspectorBridge({win = window, doc = win.document} = {}) {
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
  const sendObject = (kind, element) => post(kind, {object: inspectionObject(element, win)});
  const byInspectorId = (value) => {
    const inspectorId = safeText(value, 500);
    const matches=inspectorId ? [doc.body,...doc.body.querySelectorAll('*')].filter(element=>inspectorIdOf(element,doc)===inspectorId) : [];
    return matches.length===1?matches[0]:null;
  };
  function scheduleOverlayUpdate(refreshObject = false) {
    if (destroyed || (!active && !previewed)) return;
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
      if (target === locked && refreshObjectOnFrame) sendObject('inspect-selected', locked);
      refreshObjectOnFrame = false;
    });
  }
  const setActive = (next) => {
    active = Boolean(next); locked = null; clearOverlay();
    doc.documentElement.classList.toggle('foundation-inspecting', active);
    if (!active) post('inspect-selection-invalidated', {reason: 'mode-exited'});
  };
  const onMessage = (event) => {
    if (event.source !== win.parent || event.origin !== win.location.origin || event.data?.namespace !== PREVIEW_NAMESPACE) return;
    if(event.data.kind==='snapshot-rebound'){const current=envelope(win);if(event.data.projectId===current.projectId&&event.data.channel===current.channel&&event.data.fromRevision===current.revision&&typeof event.data.nextRevision==='string'&&event.data.nextRevision){bindPreviewContext(win,{...contexts.get(win),identityHistory:event.data.identityHistory || [],envelope:{...current,revision:event.data.nextRevision}});announcePreview({win});}return;}
    if(envelope(win).revision && ['projectId','revision','channel'].some(key=>event.data[key]!==envelope(win)[key]))return;
    if(Array.isArray(event.data.identityHistory))bindPreviewContext(win,{...contexts.get(win),identityHistory:event.data.identityHistory});
    if(event.data.kind==='preview-status-request'){announcePreview({win});return;}
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
      const resolved=event.data.locator?resolveObjectLocator(event.data.locator,[doc.body,...doc.body.querySelectorAll('*')].map(element=>({...identityOf(element,doc),instanceId:element.getAttribute('data-foundation-instance-id'),inspectorId:inspectorIdOf(element,doc),element})),{...envelope(win),session:session(doc)}):null;
      const next = event.data.locator ? resolved?.object?.element : event.data.inspectorId ? byInspectorId(event.data.inspectorId) : event.data.direction === 'parent' ? locked?.parentElement : event.data.direction === 'child' && Number.isInteger(event.data.index) ? locked?.children[event.data.index] : null;
      if (next) { previewed = null; locked = next; hovered = next; observeTarget(next); draw(next); sendObject('inspect-selected', next); }
      else post('inspect-selection-invalidated',{reason:'locator-expired-or-ambiguous'});
    }
  };
  const onOver = (event) => {
    if (!active || locked) return;
    const element = inspectableElement(event.target, doc); if (!element) return;
    previewed = null; hovered = element; observeTarget(element); draw(element); sendObject('inspect-hovered', element);
  };
  const block = (event) => {
    if (!active) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
    if (event.type === 'click') {
      const element = inspectableElement(event.target, doc);
      if (element) { previewed = null; locked = element; hovered = element; observeTarget(element); draw(element); sendObject('inspect-selected', element); }
    }
  };
  const onKey = (event) => {
    if (!active) return;
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
  const observer = new win.MutationObserver(() => { if (locked && !locked.isConnected) { locked = null; clearOverlay(); post('inspect-selection-invalidated', {reason: 'node-removed'}); return; } scheduleOverlayUpdate(Boolean(locked)); });
  observer.observe(doc.body, {childList: true, subtree: true});
  return {destroy() { if (destroyed) return; setActive(false); destroyed = true; observer.disconnect(); targetObserver?.disconnect(); if (frameId !== null) { const cancel = win.cancelAnimationFrame?.bind(win) || win.clearTimeout.bind(win); cancel(frameId); frameId = null; } win.removeEventListener('message', onMessage); win.removeEventListener('scroll', onViewportChange, true); win.removeEventListener('resize', onViewportChange); doc.removeEventListener('mouseover', onOver, true); for (const type of ['click', 'auxclick', 'submit', 'dragstart']) doc.removeEventListener(type, block, true); doc.removeEventListener('keydown', onKey, true); overlay.remove(); }};
}

let installedInspector = null;
export function installInspectorBridge() {
  if (!installedInspector) installedInspector = createInspectorBridge();
  return installedInspector;
}
