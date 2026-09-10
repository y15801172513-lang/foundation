export const PREVIEW_NAMESPACE = 'ai-product-foundation-preview';

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

export function isAssetPreviewLocation(location = window.location) {
  return location.pathname === '/events' && new URLSearchParams(location.search).get('foundationAssetPreview') === '1';
}

export function pageIdFromPath(pathname) {
  if (pathname.startsWith('/events/manage')) return 'page_events_manage';
  if (pathname.startsWith('/events/detail')) return 'page_event_detail';
  return 'page_events_home';
}

export function announcePreview({win = window} = {}) {
  const target = [...win.document.body.children].find((element) => !element.matches('script,style,[data-foundation-inspector-overlay]')) || win.document.body;
  win.parent.postMessage({namespace: PREVIEW_NAMESPACE, kind: 'preview-ready', pageId: pageIdFromPath(win.location.pathname), route: `${win.location.pathname}${win.location.search}`, object: inspectionObject(target, win)}, win.location.origin);
}

export function componentSelectionMessage({componentId, instanceId, variant, eventId = null, eventState = null, pageId}) {
  return {namespace: PREVIEW_NAMESPACE, kind: 'component-selected', componentId, instanceId, variant, eventId, eventState, pageId};
}

export function announceComponent({componentId, instanceId, variant, eventId = null, eventState = null, pageId = pageIdFromPath(window.location.pathname)}) {
  if (isAssetPreviewLocation()) return;
  window.parent.postMessage(componentSelectionMessage({componentId, instanceId, variant, eventId, eventState, pageId}), window.location.origin);
}

const INSPECTOR_STYLE_ID = 'foundation-inspector-style';
const safeText = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function roleOf(element) {
  return safeText(element.getAttribute('role')) || ({BUTTON: 'button', A: 'link', INPUT: 'input', TEXTAREA: 'textbox', SELECT: 'select', MAIN: 'main', HEADER: 'header', FOOTER: 'footer', NAV: 'navigation', SECTION: 'section', ARTICLE: 'article', FORM: 'form'}[element.tagName] || element.tagName.toLowerCase());
}

function nameOf(element) {
  return safeText(element.getAttribute('aria-label')) || safeText(element.getAttribute('data-foundation-label')) || safeText(element.textContent, 72) || roleOf(element);
}

function structuralSegment(element) {
  const tag = element.tagName.toLowerCase();
  const id = safeText(element.id, 80);
  if (id) return `${tag}#${id}`;
  const siblings = element.parentElement ? [...element.parentElement.children].filter((item) => item.tagName === element.tagName) : [element];
  return siblings.length > 1 ? `${tag}:${siblings.indexOf(element) + 1}` : tag;
}

function inspectorIdOf(element, doc) {
  const componentId = safeText(element.getAttribute('data-foundation-component-id'), 128);
  const instanceId = safeText(element.getAttribute('data-foundation-instance-id'), 128);
  if (componentId) return `component:${componentId}:${instanceId || pageIdFromPath(doc.location.pathname)}`;
  const segments = [];
  for (let current = element; current && current !== doc.body; current = current.parentElement) segments.unshift(structuralSegment(current));
  return `dom:${segments.join('/') || structuralSegment(element)}`;
}

function descriptor(element, doc) {
  if (!element) return null;
  return {inspectorId: inspectorIdOf(element, doc), name: nameOf(element), role: roleOf(element), componentId: element.getAttribute('data-foundation-component-id') || null, instanceId: element.getAttribute('data-foundation-instance-id') || null, registeredComponent: Boolean(element.getAttribute('data-foundation-component-id'))};
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
    inspectorId: inspectorIdOf(element, win.document),
    pageId: pageIdFromPath(win.location.pathname),
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

export function createInspectorBridge({win = window, doc = document} = {}) {
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
  const post = (kind, extra = {}) => win.parent.postMessage({namespace: PREVIEW_NAMESPACE, kind, ...extra}, win.location.origin);
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
    return inspectorId ? [doc.body, ...doc.body.querySelectorAll('*')].find((element) => inspectorIdOf(element, doc) === inspectorId) : null;
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
      const next = event.data.inspectorId ? byInspectorId(event.data.inspectorId) : event.data.direction === 'parent' ? locked?.parentElement : event.data.direction === 'child' && Number.isInteger(event.data.index) ? locked?.children[event.data.index] : null;
      if (next) { previewed = null; locked = next; hovered = next; observeTarget(next); draw(next); sendObject('inspect-selected', next); }
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
