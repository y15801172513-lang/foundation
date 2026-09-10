import {useEffect, useState} from 'react';
import {ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable';
import {ContextPanel, DockedContextPanel} from '@/features/context-panel/context-panel';
import {PanelRestoreButton} from '@/features/context-panel/floating-context-panel';
import {PreviewCanvas} from '@/features/preview/preview-canvas';

export function PageBuildingWorkspace({model, state, dispatch, iframeRef, panelProps, inspectorActive, onToggleInspector, onPreviewLoad}) {
  const showDockedPanel = !state.panelCollapsed && state.panelPlacement === 'docked';
  const showFloatingPanel = !state.panelCollapsed && state.panelPlacement === 'floating';
  const inspectedObject = panelProps.inspectedObject;
  const [expandedInspectorNodes, setExpandedInspectorNodes] = useState(() => new Set(inspectedObject?.ancestorIds || []));
  const [inspectorTreeFocusId, setInspectorTreeFocusId] = useState(inspectedObject?.inspectorId || null);
  useEffect(() => {
    const ancestorIds = inspectedObject?.ancestorIds || [];
    setExpandedInspectorNodes((current) => {
      const next = new Set(current);
      ancestorIds.forEach((id) => next.add(id));
      return next.size === current.size ? current : next;
    });
  }, [inspectedObject?.pageId, inspectedObject?.inspectorId, inspectedObject?.ancestorIds?.join('|')]);
  useEffect(() => { if (inspectedObject?.inspectorId) setInspectorTreeFocusId(inspectedObject.inspectorId); }, [inspectedObject?.pageId, inspectedObject?.inspectorId]);
  const contextProps = {...panelProps, expandedInspectorNodes, onExpandedInspectorNodesChange: setExpandedInspectorNodes, inspectorTreeFocusId, onInspectorTreeFocusIdChange: setInspectorTreeFocusId, inspectorActive, onToggleInspector};
  return <main className="workspace"><ResizablePanelGroup orientation="horizontal" className="workspace-panels"><ResizablePanel defaultSize={showDockedPanel ? '74%' : '100%'} minSize="48%"><PreviewCanvas model={model} state={state} dispatch={dispatch} iframeRef={iframeRef} onPreviewLoad={onPreviewLoad} /></ResizablePanel>{showDockedPanel && <DockedContextPanel {...contextProps} />}</ResizablePanelGroup>{showFloatingPanel && <ContextPanel {...contextProps} />}{state.panelCollapsed && <PanelRestoreButton state={state} dispatch={dispatch} />}</main>;
}
