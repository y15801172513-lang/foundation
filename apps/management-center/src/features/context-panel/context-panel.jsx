import {ExternalLink, Minimize2} from 'lucide-react';
import {ScanSearch} from 'lucide-react';
import {ResizableHandle, ResizablePanel} from '@/components/ui/resizable';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {FoundationIconButton} from '@/components/foundation/icon-button';
import {FloatingContextPanel} from './floating-context-panel';
import {PreviewSidebar} from './preview-sidebar';

function collapseFromControl(event, dispatch) {
  const workspace = event.currentTarget.closest('.workspace');
  const workspaceRect = workspace?.getBoundingClientRect();
  const controlRect = event.currentTarget.getBoundingClientRect();
  if (!workspaceRect) return dispatch({type: 'collapse'});
  dispatch({type: 'collapse', collapsedPosition: {x: controlRect.left - workspaceRect.left, y: controlRect.top - workspaceRect.top}, workspace: {width: workspaceRect.width, height: workspaceRect.height}, panel: {width: 28, height: 28}});
}

export function ContextPanel({model, state, dispatch, page, selectedEvent = null, inspectedObject = null, expandedInspectorNodes, onExpandedInspectorNodesChange, inspectorTreeFocusId, onInspectorTreeFocusIdChange, inspectorActive = false, onToggleInspector, onNavigateInspector, onPreviewInspector, onCopyInspector}) {
  if (state.panelCollapsed) return null;
  const contextTabs = <TabsList variant="default" className="context-panel-tab-list" aria-label="侧栏工作上下文"><TabsTrigger value="page">页面逻辑</TabsTrigger><TabsTrigger value="object">检查对象</TabsTrigger></TabsList>;
  const inspectorAction = <FoundationIconButton label="检查预览对象" variant={inspectorActive ? 'secondary' : 'ghost'} aria-pressed={inspectorActive} onClick={onToggleInspector}><ScanSearch /></FoundationIconButton>;
  const contextHeader = <div className="context-panel-leading">{inspectorAction}{contextTabs}</div>;
  const actions = <div className="context-panel-actions"><FoundationIconButton label="切换为悬浮" onClick={() => dispatch({type: 'toggle-placement'})}><ExternalLink /></FoundationIconButton><FoundationIconButton label="最小化信息面板" onClick={(event) => collapseFromControl(event, dispatch)}><Minimize2 /></FoundationIconButton></div>;
  const content = <div className="panel-body"><TabsContent value="page" keepMounted><ScrollArea className="panel-scroll"><PreviewSidebar view="page" model={model} pageId={state.pageId} selectedEvent={selectedEvent} /></ScrollArea></TabsContent><TabsContent value="object" keepMounted><ScrollArea className="panel-scroll"><PreviewSidebar view="object" model={model} pageId={state.pageId} inspectedObject={inspectedObject} onNavigate={onNavigateInspector} onPreview={onPreviewInspector} onCopyTask={onCopyInspector} expandedInspectorNodes={expandedInspectorNodes} onExpandedInspectorNodesChange={onExpandedInspectorNodesChange} inspectorTreeFocusId={inspectorTreeFocusId} onInspectorTreeFocusIdChange={onInspectorTreeFocusIdChange} treeActive={state.panelContext === 'object'} /></ScrollArea></TabsContent></div>;
  return <Tabs value={state.panelContext || 'page'} onValueChange={(context) => dispatch({type: 'set-panel-context', context})} className="preview-sidebar-root">{state.panelPlacement === 'floating' ? <FloatingContextPanel state={state} dispatch={dispatch} header={contextHeader}>{content}</FloatingContextPanel> : <><div className="context-panel-toolbar">{contextHeader}{actions}</div>{content}</>}</Tabs>;
}

export function DockedContextPanel(props) {
  return <><ResizableHandle /><ResizablePanel defaultSize="26%" minSize={360} maxSize="40%"><aside className="panel-slot"><ContextPanel {...props} /></aside></ResizablePanel></>;
}
