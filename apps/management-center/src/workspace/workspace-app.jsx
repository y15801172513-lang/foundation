import {Component, lazy, Suspense, useEffect, useReducer, useRef, useState} from 'react';
import {buildContextRecord, contextPlainText, resolveComponentSelection} from '@foundation/core/context';
import {Moon, Sun} from 'lucide-react';
import {MetadataText} from '@/components/foundation/content-roles';
import {FoundationIconButton} from '@/components/foundation/icon-button';
import {NavigationMenu, NavigationMenuItem, NavigationMenuLink, NavigationMenuList} from '@/components/ui/navigation-menu';
import {Spinner} from '@/components/ui/spinner';
import {TooltipProvider} from '@/components/ui/tooltip';
import {isAllowedPreviewMessage} from '@/features/preview/bridge-policy.mjs';
import {createWorkspaceState, transitionWorkspace} from '@/state/workspace-state.mjs';
import {applyWorkspaceTheme, readWorkspaceTheme} from '@/theme/workspace-theme.mjs';
import {copyContextPlainText} from './copy-context.mjs';
import {enrichInspectorObject} from './inspector-context.mjs';

const model = window.__FOUNDATION_MODEL__ || {project: {name: 'Foundation'}, pages: [], relations: [], components: [], assets: [], changes: [], interactions: [], preview: {mode: 'local-static', allowedOrigins: ['self']}};
const InformationLogicWorkspace = lazy(() => import('./information-logic-workspace').then((module) => ({default: module.InformationLogicWorkspace})));
const AssetManagementWorkspace = lazy(() => import('./asset-management-workspace').then((module) => ({default: module.AssetManagementWorkspace})));
const PageBuildingWorkspace = lazy(() => import('./page-building-workspace').then((module) => ({default: module.PageBuildingWorkspace})));

function WorkspaceLoading({name, label}) {
  return <main className="work-mode-shell workspace-loading-shell" aria-label={name} aria-busy="true" data-foundation-loading="workspace"><div className="workspace-loading" aria-live="polite"><Spinner className="size-6" aria-label={label} /><MetadataText as="span">{label}…</MetadataText></div></main>;
}

function PreviewWorkspaceLoading() {
  return <WorkspaceLoading name="预览搭建" label="正在载入预览工作区" />;
}

function LogicWorkspaceLoading() {
  return <WorkspaceLoading name="逻辑搭建" label="正在载入逻辑画布" />;
}

function AssetWorkspaceLoading() {
  return <WorkspaceLoading name="资产管理" label="正在载入资产工作区" />;
}

class WorkspaceChunkBoundary extends Component {
  constructor(props) { super(props); this.state = {failed: false}; }
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    if (this.state.failed) return <main className="work-mode-shell"><h1>{this.props.title}加载失败</h1><p role="alert">工作区资源未能载入，请刷新页面后重试。</p></main>;
    return this.props.children;
  }
}

export function WorkspaceApp() {
  const [theme, setTheme] = useState(() => {
    const initial = readWorkspaceTheme();
    applyWorkspaceTheme(initial);
    return initial;
  });
  const [state, dispatch] = useReducer((current, action) => transitionWorkspace(current, action), createWorkspaceState({pageId: model.entryPage}));
  const [relationState, setRelationState] = useState({items: model.relations || [], version: model.relationsVersion || null});
  const workspaceModel = {...model, relations: relationState.items, relationsVersion: relationState.version};
  const [bridge, setBridge] = useState({label: '等待预览就绪…', route: null, connected: false});
  const [inspector, setInspector] = useState({active: false, phase: 'inactive', object: null});
  const [defaultInspectedObject, setDefaultInspectedObject] = useState(null);
  const iframeRef = useRef(null);
  const themeRef = useRef(theme);
  const inspectorRef = useRef(inspector);
  const workspaceModelRef = useRef(workspaceModel);
  const page = workspaceModel.pages.find((item) => item.id === state.pageId) || workspaceModel.pages[0];
  const selection = resolveComponentSelection(workspaceModel.components, {componentId: state.componentId, instanceId: state.instanceId, eventId: state.eventId, variant: state.variant, pageId: state.componentPageId || state.pageId});
  const component = selection?.component || null;
  const selectedAsset = (workspaceModel.assets || []).find((asset) => asset.assetId === (state.assetId || selection?.componentId)) || null;
  const recordInput = {project: workspaceModel.project, pages: workspaceModel.pages, relations: workspaceModel.relations, assets: workspaceModel.assets || [], mode: state.workspaceArea === 'assets' ? 'assets' : state.buildingMode, pageId: state.pageId};
  const pageContextRecord = buildContextRecord({...recordInput, selection, scope: 'page'});
  const componentContextRecord = buildContextRecord({...recordInput, selection, scope: 'component'});
  const assetContextRecord = buildContextRecord({...recordInput, selection: selectedAsset ? {asset: selectedAsset, instanceId: state.instanceId, eventId: state.eventId, variant: selectedAsset.variant} : null, scope: 'asset'});
  const pageContext = contextPlainText(pageContextRecord);
  const componentContext = contextPlainText(componentContextRecord);
  const assetContext = contextPlainText(assetContextRecord);
  const postToPreview = (message) => iframeRef.current?.contentWindow?.postMessage({namespace: 'ai-product-foundation-preview', ...message}, window.location.origin);

  useEffect(() => { inspectorRef.current = inspector; workspaceModelRef.current = workspaceModel; }, [inspector, workspaceModel]);

  useEffect(() => {
    themeRef.current = theme;
    applyWorkspaceTheme(theme);
    postToPreview({kind: 'theme-changed', theme});
  }, [theme]);

  useEffect(() => {
    const onMessage = (event) => {
      if (!isAllowedPreviewMessage(event, {iframeWindow: iframeRef.current?.contentWindow, currentOrigin: window.location.origin, preview: model.preview})) return;
      if (event.data.kind === 'preview-ready') {
        setBridge({label: `已连接 · ${event.data.route}`, route: event.data.route, connected: true});
        setDefaultInspectedObject(event.data.object ? enrichInspectorObject(event.data.object, workspaceModelRef.current) : null);
        if (event.data.pageId) dispatch({type: 'set-page', pageId: event.data.pageId, route: event.data.route});
        postToPreview({kind: 'theme-changed', theme: themeRef.current});
      }
      if (event.data.kind === 'component-selected' && !inspectorRef.current.active) dispatch({type: 'set-component', componentId: event.data.componentId, instanceId: event.data.instanceId, eventId: event.data.eventId, eventState: event.data.eventState, variant: event.data.variant, pageId: event.data.pageId});
      if (event.data.kind === 'inspect-hovered' && inspectorRef.current.active) setInspector((current) => ({...current, phase: 'hover'}));
      if (event.data.kind === 'inspect-selected' && inspectorRef.current.active) {
        setInspector({active: true, phase: 'locked', object: enrichInspectorObject(event.data.object, workspaceModelRef.current)});
        dispatch({type: 'set-panel-context', context: 'object'});
      }
      if (event.data.kind === 'inspect-selection-invalidated') setInspector((current) => ({active: current.active, phase: current.active ? 'hover' : 'inactive', object: null}));
      if (event.data.kind === 'inspect-exit-request') setInspector({active: false, phase: 'inactive', object: null});
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const copyContext = async (content) => {
    const result = await copyContextPlainText(navigator.clipboard, content);
    setBridge((current) => ({...current, label: result.message}));
  };
  const toggleInspector = () => {
    const active = !inspector.active;
    const next = {active, phase: active ? 'hover' : 'inactive', object: null};
    inspectorRef.current = next;
    setInspector(next);
    postToPreview({kind: 'inspect-mode-changed', active});
  };
  const navigateInspector = (navigation) => {
    if (!inspectorRef.current.active) {
      const next = {active: true, phase: 'hover', object: null};
      inspectorRef.current = next;
      setInspector(next);
      postToPreview({kind: 'inspect-mode-changed', active: true});
    }
    postToPreview({kind: 'inspect-navigate', ...navigation});
  };
  const onPreviewLoad = (route) => {
    setBridge({label: `已加载 · ${route}`, route, connected: false});
    setDefaultInspectedObject(null);
    setInspector((current) => ({...current, phase: current.active ? 'hover' : 'inactive', object: null}));
    postToPreview({kind: 'inspect-mode-changed', active: inspectorRef.current.active});
  };
  const openPageBuilding = (pageId) => {
    const target = workspaceModel.pages.find((item) => item.id === pageId);
    dispatch({type: 'navigate-page', pageId, route: target?.preview || null});
    dispatch({type: 'set-building-mode', mode: 'preview'});
  };
  const relationSaved = (relation, version) => setRelationState((current) => ({items: [...current.items, relation], version}));
  const relationsRefreshed = (items, version) => setRelationState({items, version});
  const panelProps = {model: workspaceModel, state, dispatch, page, component, selectedEvent: state.eventId ? {id: state.eventId, state: state.eventState} : null, inspectedObject: inspector.phase === 'locked' ? inspector.object : defaultInspectedObject, onNavigateInspector: navigateInspector, onPreviewInspector: (navigation) => postToPreview(navigation ? {kind: 'inspect-preview', ...navigation} : {kind: 'inspect-preview-ended'}), onCopyInspector: copyContext, pageContextRecord, componentContextRecord, pageContext, componentContext, onCopyPage: () => copyContext(pageContext), onCopyComponent: () => copyContext(componentContext)};
  const content = state.workspaceArea === 'building' && state.buildingMode === 'logic'
    ? <WorkspaceChunkBoundary title="逻辑搭建"><Suspense fallback={<LogicWorkspaceLoading />}><InformationLogicWorkspace model={workspaceModel} pageId={state.pageId} theme={theme} onSelectPage={(pageId) => dispatch({type: 'set-page', pageId})} onOpenPage={openPageBuilding} onRelationSaved={relationSaved} onRelationsRefreshed={relationsRefreshed} /></Suspense></WorkspaceChunkBoundary>
    : state.workspaceArea === 'assets'
      ? <WorkspaceChunkBoundary title="资产管理"><Suspense fallback={<AssetWorkspaceLoading />}><AssetManagementWorkspace model={workspaceModel} selectedAsset={selectedAsset} assetRecord={assetContextRecord} assetRawText={assetContext} onSelectAsset={(assetId) => dispatch({type: 'set-asset', assetId})} onCopyAsset={() => copyContext(assetContext)} /></Suspense></WorkspaceChunkBoundary>
      : <WorkspaceChunkBoundary title="预览搭建"><Suspense fallback={<PreviewWorkspaceLoading />}><PageBuildingWorkspace model={workspaceModel} state={state} dispatch={dispatch} iframeRef={iframeRef} panelProps={panelProps} inspectorActive={inspector.active} onToggleInspector={toggleInspector} onPreviewLoad={onPreviewLoad} /></Suspense></WorkspaceChunkBoundary>;
  const setBuildingMode = (mode) => { if (mode !== 'preview' && inspector.active) toggleInspector(); dispatch({type: 'set-building-mode', mode}); };
  const openAssets = () => { if (inspector.active) toggleInspector(); dispatch({type: 'open-assets'}); };
  const dark = theme === 'dark';
  const toggleTheme = () => {
    const next = themeRef.current === 'dark' ? 'light' : 'dark';
    themeRef.current = next;
    setTheme(next);
  };
  return <TooltipProvider><div className="app-shell"><header className="topbar"><span className="topbar-project truncate text-base font-medium" aria-label={workspaceModel.project?.name || 'Foundation'} title={workspaceModel.project?.name || 'Foundation'}>{workspaceModel.project?.name || 'Foundation'}</span><NavigationMenu className="topbar-navigation" aria-label="工作区"><NavigationMenuList><NavigationMenuItem><NavigationMenuLink href="#preview" active={state.workspaceArea === 'building' && state.buildingMode === 'preview'} onClick={(event) => { event.preventDefault(); setBuildingMode('preview'); }}>预览搭建</NavigationMenuLink></NavigationMenuItem><NavigationMenuItem><NavigationMenuLink href="#logic" active={state.workspaceArea === 'building' && state.buildingMode === 'logic'} onClick={(event) => { event.preventDefault(); setBuildingMode('logic'); }}>逻辑搭建</NavigationMenuLink></NavigationMenuItem><NavigationMenuItem><NavigationMenuLink href="#assets" active={state.workspaceArea === 'assets'} onClick={(event) => { event.preventDefault(); openAssets(); }}>资产管理</NavigationMenuLink></NavigationMenuItem></NavigationMenuList></NavigationMenu><FoundationIconButton data-theme-toggle className="ml-1" label={dark ? '切换到亮模式' : '切换到暗模式'} aria-pressed={dark} onClick={toggleTheme}>{dark ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}</FoundationIconButton></header>{content}<footer className="statusbar"><span>{model.projectSelected === false ? '未选择项目 · 不自动扫描或启用' : bridge.label}</span><span>Foundation 项目资料 · {workspaceModel.pages.length} 个页面 · {workspaceModel.components.length} 个组件</span></footer></div></TooltipProvider>;
}
