import {bindPreviewContext,announcePreview as announce,createInspectorBridge as create,PREVIEW_NAMESPACE} from '../../../packages/core/preview-bridge.mjs';
export {PREVIEW_NAMESPACE,applyPreviewTheme,previewThemeFromSearch} from '../../../packages/core/preview-bridge.mjs';
export function pageIdFromPath(pathname) { return pathname.startsWith('/events/manage')?'page_events_manage':pathname.startsWith('/events/detail')?'page_event_detail':'page_events_home'; }
function context(win) {bindPreviewContext(win,{pageId:pageIdFromPath(win.location.pathname)});}
export function announcePreview({win=window}={}) { context(win);return announce({win}); }
export function createInspectorBridge({win=window,doc=win.document}={}) {context(win);return create({win,doc});}
let installed;
export function installInspectorBridge() {return installed ||= createInspectorBridge();}
export function isAssetPreviewLocation(location=window.location) {return location.pathname==='/events'&&new URLSearchParams(location.search).get('foundationAssetPreview')==='1';}
export function componentSelectionMessage({componentId,instanceId,variant,eventId=null,eventState=null,pageId}) {const q=typeof window==='undefined'?new URLSearchParams():new URLSearchParams(window.location.search);return {namespace:PREVIEW_NAMESPACE,...Object.fromEntries(['projectId','revision','channel'].map(k=>[k,q.get(k)])),kind:'component-selected',componentId,instanceId,variant,eventId,eventState,pageId};}
export function announceComponent(input) {if(!isAssetPreviewLocation())window.parent.postMessage(componentSelectionMessage({pageId:pageIdFromPath(window.location.pathname),...input}),window.location.origin);}
