import {useEffect, useRef, useState} from 'react';
import {GripHorizontal, Maximize2, Minimize2, PanelRight} from 'lucide-react';
import {Card, CardHeader} from '@/components/ui/card';
import {FoundationIconButton} from '@/components/foundation/icon-button';

const RESIZE_EDGES = ['n', 'e', 's', 'w', 'nw', 'ne', 'sw', 'se'];
const RESIZE_EDGE_LABELS = {n: '上侧', e: '右侧', s: '下侧', w: '左侧', nw: '左上角', ne: '右上角', sw: '左下角', se: '右下角'};

export function FloatingContextPanel({state, dispatch, children, header, headerActions}) {
  const panelRef = useRef(null);
  const gestureRef = useRef(null);
  const [bounds, setBounds] = useState({width: 900, height: 700});
  const boundsRef = useRef(bounds);
  const size = state.floatingSize || {width: 360, height: 540};
  const sizeRef = useRef(size);
  const position = state.floatingPosition || {x: 24, y: 24};
  const collapseAt = (event) => {
    const workspace = panelRef.current?.closest('.workspace');
    const workspaceRect = workspace?.getBoundingClientRect();
    const controlRect = event.currentTarget.getBoundingClientRect();
    if (!workspaceRect) return dispatch({type: 'collapse'});
    dispatch({type: 'collapse', collapsedPosition: {x: controlRect.left - workspaceRect.left, y: controlRect.top - workspaceRect.top}, workspace: {width: workspaceRect.width, height: workspaceRect.height}, panel: {width: 28, height: 28}});
  };

  useEffect(() => {
    const node = panelRef.current?.closest('.workspace');
    if (!node) return undefined;
    const update = () => setBounds({width: node.clientWidth, height: node.clientHeight});
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { boundsRef.current = bounds; }, [bounds]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => {
    const move = (event) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const workspace = boundsRef.current;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (gesture.kind === 'drag') {
        const actualSize = {width: panelRef.current?.offsetWidth || sizeRef.current.width, height: panelRef.current?.offsetHeight || sizeRef.current.height};
        dispatch({type: 'set-position', position: {x: gesture.start.x + dx, y: gesture.start.y + dy}, workspace, panel: actualSize});
      } else {
        const west = gesture.edge.includes('w');
        const north = gesture.edge.includes('n');
        const horizontal = west || gesture.edge.includes('e');
        const vertical = north || gesture.edge.includes('s');
        const maxWidth = west ? gesture.position.x + gesture.start.width - 12 : workspace.width - gesture.position.x - 12;
        const maxHeight = north ? gesture.position.y + gesture.start.height - 12 : workspace.height - gesture.position.y - 12;
        const width = horizontal ? Math.max(300, Math.min(maxWidth, gesture.start.width + (west ? -dx : dx))) : gesture.start.width;
        const height = vertical ? Math.max(260, Math.min(maxHeight, gesture.start.height + (north ? -dy : dy))) : gesture.start.height;
        const nextPosition = {x: west ? gesture.position.x + gesture.start.width - width : gesture.position.x, y: north ? gesture.position.y + gesture.start.height - height : gesture.position.y};
        dispatch({type: 'set-position', position: nextPosition, workspace, panel: {width, height}});
        dispatch({type: 'set-floating-size', size: {width, height}});
      }
    };
    const end = (event) => { if (gestureRef.current?.pointerId === event.pointerId) gestureRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  }, [dispatch]);

  const startGesture = (event, gesture) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gestureRef.current = {...gesture, pointerId: event.pointerId, x: event.clientX, y: event.clientY};
  };

  return <Card ref={panelRef} data-panel-placement="floating" className="floating-panel" style={{left: position.x, top: position.y, width: size.width, height: size.height}}><div className="floating-drag-strip panel-drag-handle" onPointerDown={(event) => startGesture(event, {kind: 'drag', start: position})}><GripHorizontal className="floating-drag-indicator" aria-hidden="true" /></div><CardHeader className="panel-header">{header}<div className="panel-actions"><FoundationIconButton label="停靠到右侧" onClick={() => dispatch({type: 'toggle-placement'})}><PanelRight data-icon="inline-start" /></FoundationIconButton><FoundationIconButton label="最小化信息面板" onClick={collapseAt}><Minimize2 data-icon="inline-start" /></FoundationIconButton>{headerActions}</div></CardHeader>{children}{RESIZE_EDGES.map((edge) => <div key={edge} data-resize-edge={edge} className={`resize-handle resize-handle-${edge}`} aria-label={`从${RESIZE_EDGE_LABELS[edge]}调整信息面板尺寸`} onPointerDown={(event) => { event.stopPropagation(); startGesture(event, {kind: 'resize', edge, start: size, position}); }} />)}</Card>;
}

export function PanelRestoreButton({state, dispatch}) {
  const buttonRef = useRef(null);
  const gestureRef = useRef(null);
  const movedRef = useRef(false);
  const [bounds, setBounds] = useState({width: 0, height: 0});
  const boundsRef = useRef(bounds);
  const size = {width: 28, height: 28};
  const floatingSize = state.floatingSize || {width: 360, height: 540};
  const floatingSizeRef = useRef(floatingSize);
  const position = state.collapsedPosition || {x: Math.max(12, bounds.width - size.width - 12), y: 12};
  useEffect(() => {
    const node = buttonRef.current?.parentElement;
    if (!node) return undefined;
    const update = () => setBounds({width: node.clientWidth, height: node.clientHeight});
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { boundsRef.current = bounds; }, [bounds]);
  useEffect(() => { floatingSizeRef.current = floatingSize; }, [floatingSize]);
  useEffect(() => {
    const move = (event) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
      dispatch({type: 'set-collapsed-position', position: {x: gesture.start.x + dx, y: gesture.start.y + dy}, workspace: boundsRef.current, panel: size});
    };
    const finish = (event) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gestureRef.current = null;
      if (movedRef.current) window.setTimeout(() => { movedRef.current = false; }, 0);
    };
    const cancel = (event) => { if (gestureRef.current?.pointerId === event.pointerId) { gestureRef.current = null; movedRef.current = false; } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); };
  }, [dispatch]);
  const startGesture = (event) => {
    movedRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gestureRef.current = {pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: position};
  };
  const restoreFromAnchor = () => dispatch({type: 'restore', workspace: boundsRef.current, panel: floatingSizeRef.current});
  const restoreWithKeyboard = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    restoreFromAnchor();
  };
  return <div ref={buttonRef} className="restore-panel" style={{left: position.x, top: position.y}}><FoundationIconButton label="展开信息面板" variant="outline" onPointerDown={startGesture} onPointerUp={() => { if (!movedRef.current) restoreFromAnchor(); }} onKeyDown={restoreWithKeyboard} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) restoreFromAnchor(); }}><Maximize2 data-icon="inline-start" /></FoundationIconButton></div>;
}
