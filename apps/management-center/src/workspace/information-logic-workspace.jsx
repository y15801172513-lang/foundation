import {useEffect, useMemo, useRef, useState} from 'react';
import {Background, ControlButton, Controls, Handle, Position, ReactFlow, useEdgesState, useNodesState, useReactFlow, useStore, useStoreApi} from '@xyflow/react';
import {ExternalLink, GitBranch, Link2, Lock, LockOpen, Maximize2, ZoomIn, ZoomOut} from 'lucide-react';
import {ContentDescription, ImportantText, MetadataText, PageTitle, PanelTitle} from '@/components/foundation/content-roles';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Field, FieldError, FieldGroup, FieldLabel} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Spinner} from '@/components/ui/spinner';
import {isValidPageConnection, logicFlowModel, relationPresentation} from './workspace-projections.mjs';
import {recoverPageRelationConflict, RelationRequestError, saveRelationWithRollback} from './relation-client.mjs';

function handleTop(index, total) { return `${Math.round(((index + 1) / (total + 1)) * 100)}%`; }

function themedPreviewRoute(route, theme) {
  const url = new URL(route, window.location.origin);
  url.searchParams.set('foundationTheme', theme);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function PageFlowNode({data}) {
  const {page, incoming, outgoing, current, gaps, theme, onOpenPage, onEditPage} = data;
  const route = page.preview || page.route;
  const previewSrc = route && current ? themedPreviewRoute(route, theme) : null;
  const [loadedPreview, setLoadedPreview] = useState(null);
  const previewLoading = Boolean(previewSrc && loadedPreview !== previewSrc);
  const incomingSlots = incoming.length + 1; const outgoingSlots = outgoing.length + 1;
  return <article className={`page-flow-node${current ? ' is-current' : ''}`} data-page-id={page.id}>{incoming.map((handle, index) => <Handle key={handle.id} id={handle.id} type="target" position={Position.Left} style={{top: handleTop(index, incomingSlots)}} />)}<Handle id="new-target" type="target" position={Position.Left} style={{top: handleTop(incoming.length, incomingSlots)}} /><header><div><span className="page-node-kicker">页面</span><h2>{page.name || page.id}</h2></div><span className={gaps.length ? 'node-status has-gap' : 'node-status'}>{gaps.length ? `${gaps.length} 项缺口` : '事实完整'}</span></header><div className="page-thumbnail nodrag nopan" data-preview-mode={previewSrc ? 'live' : 'summary'} aria-busy={previewLoading}>{previewSrc ? <iframe key={previewSrc} title={`${page.name} 页面缩略预览`} src={previewSrc} loading="eager" sandbox="allow-scripts" tabIndex={-1} onLoad={() => setLoadedPreview(previewSrc)} /> : route ? <div className="page-thumbnail-summary"><strong>{page.name || page.id}</strong><span>静态页面摘要</span><code>{route}</code></div> : <p>预览尚未登记</p>}{previewLoading ? <div className="page-thumbnail-loading" data-foundation-loading="thumbnail"><Spinner className="size-5" aria-label={`${page.name || page.id} 页面缩略预览正在载入`} /></div> : null}<span aria-hidden="true" /></div><p className="page-node-route"><code>{page.id}</code><br />{route || 'route 尚未登记'}</p><p className="page-node-relations">进入 {incoming.length} · 去向 {outgoing.length}</p><div className="page-node-actions nodrag nopan"><Button size="sm" variant="outline" onClick={() => onOpenPage(page.id)}><ExternalLink data-icon="inline-start" />在预览中打开</Button><Button size="sm" variant="ghost" onClick={() => onEditPage(page.id)}><GitBranch data-icon="inline-start" />查看 / 编辑页面逻辑</Button></div>{outgoing.map((handle, index) => <Handle key={handle.id} id={handle.id} type="source" position={Position.Right} style={{top: handleTop(index, outgoingSlots)}} />)}<Handle id="new-source" type="source" position={Position.Right} style={{top: handleTop(outgoing.length, outgoingSlots)}} /></article>;
}

export const nodeTypes = {pageFlow: PageFlowNode};

export function LogicFlowControls() {
  const store = useStoreApi();
  const {zoomIn, zoomOut, fitView} = useReactFlow();
  const isInteractive = useStore((state) => state.nodesDraggable || state.nodesConnectable || state.elementsSelectable);
  const minZoomReached = useStore((state) => state.transform[2] <= state.minZoom);
  const maxZoomReached = useStore((state) => state.transform[2] >= state.maxZoom);
  const setInteractive = () => store.setState({nodesDraggable: !isInteractive, nodesConnectable: !isInteractive, elementsSelectable: !isInteractive});
  return <Controls showZoom={false} showFitView={false} showInteractive={false} aria-label="画布控制">
    <ControlButton className="react-flow__controls-zoomin" aria-label="放大画布" title="放大画布" disabled={maxZoomReached} onClick={() => zoomIn()}><ZoomIn aria-hidden="true" strokeWidth={2} /></ControlButton>
    <ControlButton className="react-flow__controls-zoomout" aria-label="缩小画布" title="缩小画布" disabled={minZoomReached} onClick={() => zoomOut()}><ZoomOut aria-hidden="true" strokeWidth={2} /></ControlButton>
    <ControlButton className="react-flow__controls-fitview" aria-label="适应视图" title="适应视图" onClick={() => fitView()}><Maximize2 aria-hidden="true" strokeWidth={2} /></ControlButton>
    <ControlButton className="react-flow__controls-interactive" aria-label={isInteractive ? '锁定画布' : '解锁画布'} title={isInteractive ? '锁定画布' : '解锁画布'} aria-pressed={!isInteractive} onClick={setInteractive}>{isInteractive ? <Lock aria-hidden="true" strokeWidth={2} /> : <LockOpen aria-hidden="true" strokeWidth={2} />}</ControlButton>
  </Controls>;
}

const ACTION_TYPES = [{value: 'navigation', label: '页面导航'}, {value: 'state', label: '状态变化'}, {value: 'entity', label: '同页实体切换'}];

export function RelationEditor({connection, pages, relations, saving = false, error = '', conflict = null, onCancel, onSave, onRetry, onRefresh}) {
  const self = connection?.source === connection?.target;
  const [actionType, setActionType] = useState(self ? 'state' : 'navigation');
  const [trigger, setTrigger] = useState(''); const [condition, setCondition] = useState(''); const [targetState, setTargetState] = useState(''); const [targetEntity, setTargetEntity] = useState('');
  const triggerRef = useRef(null); const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    return () => returnFocusRef.current?.focus();
  }, []);
  const source = pages.find((page) => page.id === connection?.source); const target = pages.find((page) => page.id === connection?.target);
  const draft = {from: connection?.source, to: connection?.target, trigger: trigger.trim() || null, condition: condition.trim() || null, ...(actionType === 'state' && targetState.trim() ? {targetState: targetState.trim()} : {}), ...(actionType === 'entity' && targetEntity.trim() ? {targetEntity: targetEntity.trim()} : {})};
  const valid = isValidPageConnection({connection, pages, relations, draft});
  const refreshing = conflict?.status === 'refreshing';
  const busy = saving || refreshing;
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}><DialogContent className="relation-editor sm:max-w-lg" showCloseButton={!busy} initialFocus={triggerRef} finalFocus={returnFocusRef} aria-busy={busy}><DialogHeader><DialogTitle>登记页面关系</DialogTitle><DialogDescription>{source?.name || connection?.source} → {target?.name || connection?.target}。保存关系不等于运行跳转已实现。</DialogDescription></DialogHeader><FieldGroup className="relation-editor-fields"><Field><FieldLabel>动作类型</FieldLabel><Select items={ACTION_TYPES} value={actionType} onValueChange={setActionType}><SelectTrigger aria-label="动作类型"><SelectValue>{ACTION_TYPES.find((item) => item.value === actionType)?.label}</SelectValue></SelectTrigger><SelectContent align="start" alignItemWithTrigger={false}><SelectGroup>{ACTION_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="relation-trigger">触发器</FieldLabel><Input ref={triggerRef} id="relation-trigger" value={trigger} onChange={(event) => setTrigger(event.target.value)} placeholder="例如：点击管理事件" /></Field>{actionType === 'state' && <Field><FieldLabel htmlFor="relation-target-state">目标状态</FieldLabel><Input id="relation-target-state" value={targetState} onChange={(event) => setTargetState(event.target.value)} placeholder="例如：archived" /></Field>}{actionType === 'entity' && <Field><FieldLabel htmlFor="relation-target-entity">目标实体</FieldLabel><Input id="relation-target-entity" value={targetEntity} onChange={(event) => setTargetEntity(event.target.value)} placeholder="例如：next-event" /></Field>}<Field><FieldLabel htmlFor="relation-condition">条件（可空）</FieldLabel><Input id="relation-condition" value={condition} onChange={(event) => setCondition(event.target.value)} placeholder="无条件" /></Field><p>保存后：关系已登记 · {trigger.trim() ? '触发器待绑定' : '触发器未绑定'}</p><FieldError className="relation-editor-error">{error}</FieldError></FieldGroup><DialogFooter className="relation-editor-actions">{conflict?.status === 'ready' ? <><Button variant="outline" disabled={saving} onClick={onCancel}>取消本次保存</Button><Button disabled={saving || !valid} onClick={() => onRetry?.(draft)}>{saving ? <><Spinner data-icon="inline-start" aria-label="正在保存关系" />保存中…</> : '使用最新版本重试'}</Button></> : conflict?.status === 'refresh-failed' ? <><Button variant="outline" disabled={saving} onClick={onCancel}>取消本次保存</Button><Button disabled={saving} onClick={() => onRefresh?.(draft)}>{saving ? <><Spinner data-icon="inline-start" aria-label="正在刷新关系" />刷新中…</> : '重新刷新关系'}</Button></> : <><Button variant="outline" disabled={busy} onClick={onCancel}>取消</Button><Button disabled={busy || !valid} onClick={() => onSave(draft)}>{busy ? <><Spinner data-icon="inline-start" aria-label={refreshing ? '正在刷新关系' : '正在保存关系'} />{refreshing ? '刷新中…' : '保存中…'}</> : '保存关系'}</Button></>}</DialogFooter></DialogContent></Dialog>;
}

export function InformationLogicWorkspace({model, pageId, theme = 'light', onSelectPage, onOpenPage, onRelationSaved, onRelationsRefreshed = () => {}}) {
  const projection = useMemo(() => logicFlowModel({pages: model.pages, relations: model.relations, currentPageId: pageId}), [model.pages, model.relations, pageId]);
  const decorate = (items) => items.map((node) => ({...node, data: {...node.data, theme, onOpenPage, onEditPage: onSelectPage}}));
  const [nodes, setNodes, onNodesChange] = useNodesState(decorate(projection.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState(projection.edges);
  const [editor, setEditor] = useState(null); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [conflict, setConflict] = useState(null); const [selectedRelation, setSelectedRelation] = useState(null); const [notice, setNotice] = useState('');
  useEffect(() => {
    setNodes((current) => { const positions = new Map(current.map((node) => [node.id, node.position])); return decorate(projection.nodes).map((node) => ({...node, position: positions.get(node.id) || node.position})); });
    setEdges(projection.edges);
  }, [projection, theme]);
  const removeDraft = () => setEdges((current) => current.filter((edge) => edge.id !== 'relation-draft'));
  const openEditor = (connection) => {
    if (!isValidPageConnection({connection, pages: model.pages, relations: model.relations})) { setNotice('连接端点无效。'); return; }
    setError(''); setConflict(null); setNotice(''); setEditor(connection);
    setEdges((current) => [...current.filter((edge) => edge.id !== 'relation-draft'), {id: 'relation-draft', source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle, animated: true, className: 'relation-draft', label: '关系草稿'}]);
  };
  const cancelEditor = () => { removeDraft(); setEditor(null); setError(''); setConflict(null); };
  const refreshConflict = async (caught, draft) => {
    setConflict({status: 'refreshing', sourceError: caught});
    try {
      const recovery = await recoverPageRelationConflict({error: caught, draft}, {onRefresh: (latest) => onRelationsRefreshed(latest.relations, latest.version)});
      setConflict({status: 'ready', retryVersion: recovery.retryVersion, sourceError: caught});
      setError('关系事实已由其他写者更新。画布已刷新；你的草稿仍保留，请确认后使用最新版本重试。');
    } catch (refreshError) {
      setConflict({status: 'refresh-failed', sourceError: caught});
      setError(`关系事实已更新，但刷新失败：${refreshError.message}`);
    }
  };
  const save = async (draft, version = model.relationsVersion) => {
    if (!isValidPageConnection({connection: editor, pages: model.pages, relations: model.relations, draft})) { setError('关系语义无效、退化自连或与现有关系完全重复。'); removeDraft(); return; }
    setSaving(true); setError('');
    try {
      const payload = await saveRelationWithRollback({draft, version, nonce: window.__FOUNDATION_WRITE_NONCE__ || ''}, {onRollback: removeDraft});
      if (payload.state === 'pending-manager-confirmation') {
        removeDraft(); setEditor(null); setConflict(null); setNotice('已打开 Foundation 本地管理器；确认后刷新此页面读取最新关系事实。');
        return;
      }
      removeDraft(); setEditor(null); setConflict(null); setNotice('关系已登记；运行触发仍需绑定和验证。'); onRelationSaved(payload.relation, payload.version);
    } catch (caught) {
      if (caught instanceof RelationRequestError && caught.status === 409 && caught.code === 'version_conflict') await refreshConflict(caught, draft);
      else setError(caught.message);
    }
    finally { setSaving(false); }
  };
  const selectedPresentation = selectedRelation ? relationPresentation(selectedRelation) : null;
  return <main className="work-mode-shell logic-flow-workspace"><header className="logic-flow-toolbar"><div><PageTitle>逻辑搭建</PageTitle><ContentDescription>拖动页面、连接 Handle，并在保存前登记真实语义。</ContentDescription></div>{notice && <MetadataText as="p" role="status">{notice}</MetadataText>}</header><section className="logic-flow-main"><div className="logic-flow-canvas"><ReactFlow colorMode={theme} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={openEditor} isValidConnection={(connection) => isValidPageConnection({connection, pages: model.pages, relations: model.relations})} onNodeClick={(_, node) => onSelectPage(node.id)} onEdgeClick={(_, edge) => setSelectedRelation(edge.data?.relation || null)} fitView minZoom={0.35} maxZoom={1.5} deleteKeyCode={null}><Background gap={20} size={1} /><LogicFlowControls /></ReactFlow></div><aside className="logic-relation-inspector"><PanelTitle>关系详情</PanelTitle>{selectedRelation ? <><ImportantText as="strong">{selectedRelation.trigger || '触发尚未登记'}</ImportantText><ContentDescription>{selectedRelation.from} → {selectedRelation.to}</ContentDescription><ContentDescription>条件：{selectedRelation.condition || '无条件'}</ContentDescription><ContentDescription>{selectedPresentation.lifecycleLabel}</ContentDescription><ContentDescription>{selectedPresentation.runtimeLabel}</ContentDescription><Button disabled variant="outline"><Link2 data-icon="inline-start" />删除关系尚未支持</Button></> : <ContentDescription>选择一条关系查看生命周期和运行绑定状态。</ContentDescription>}</aside></section>{editor && <RelationEditor key={`${editor.source}-${editor.target}-${editor.sourceHandle}-${editor.targetHandle}`} connection={editor} pages={model.pages} relations={model.relations} saving={saving} error={error} conflict={conflict} onCancel={cancelEditor} onSave={save} onRetry={(draft) => save(draft, conflict?.retryVersion)} onRefresh={(draft) => refreshConflict(conflict?.sourceError, draft)} />}</main>;
}
