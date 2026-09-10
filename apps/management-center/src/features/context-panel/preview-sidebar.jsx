import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ChevronDown, ChevronRightIcon, Copy} from 'lucide-react';
import {CodeText, ContentDescription, MetadataText, PanelTitle, SectionTitle} from '@/components/foundation/content-roles';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {previewSidebarModel} from '@/workspace/workspace-projections.mjs';
import {buildInspectorCopyPayload, INSPECTOR_COPY_CATEGORIES, inspectorScopeRecommendation} from '@/workspace/inspector-context.mjs';

function RelationGroup({title, relations, direction}) {
  return <section className="preview-sidebar-section"><SectionTitle>{title}</SectionTitle>{relations.length ? <ul className="preview-relation-list">{relations.map((relation) => <li key={relation.id}><strong>{direction === 'incoming' ? relation.fromName : relation.toName}</strong><span>触发：{relation.trigger || '尚未登记'}</span><span>条件：{relation.condition || '无条件'}</span></li>)}</ul> : <ContentDescription>尚未登记</ContentDescription>}</section>;
}

function Summary({record}) {
  const values = Object.entries(record || {}).filter(([, value]) => value);
  return values.length ? <dl className="inspector-summary">{values.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <ContentDescription>尚未登记</ContentDescription>;
}

function keepTreeItemVisible(item) {
  const tree = item?.closest('.inspector-tree');
  if (!tree) return;
  const itemRect = item.getBoundingClientRect();
  const treeRect = tree.getBoundingClientRect();
  if (itemRect.top < treeRect.top) tree.scrollTop += itemRect.top - treeRect.top;
  else if (itemRect.bottom > treeRect.bottom) tree.scrollTop += itemRect.bottom - treeRect.bottom;
}

function visibleTreeItems(nodes, expanded, parentId = null, depth = 0) {
  const result = [];
  const setSize = nodes.length;
  nodes.forEach((node, index) => {
    const hasChildren = Boolean(node.children?.length);
    const open = hasChildren && expanded.has(node.inspectorId);
    result.push({node, parentId, depth, position: index + 1, setSize, hasChildren, open});
    if (open) result.push(...visibleTreeItems(node.children, expanded, node.inspectorId, depth + 1));
  });
  return result;
}

function InspectorFileTreeNode({node, selectedId, expanded, setNodeOpen, onNavigate, onPreview, focusId, moveFocus, onKeyDown, registerItem, depth = 0, position = 1, setSize = 1}) {
  const hasChildren = Boolean(node.children?.length);
  const open = expanded.has(node.inspectorId);
  const selected = node.inspectorId === selectedId;
  const siblingSummary = !node.registeredComponent && node.summary && ![node.name, node.role].includes(node.summary) ? ` · ${node.summary}` : '';
  const label = <><span className="inspector-file-tree-label">{node.name}</span><small>{node.role}{node.registeredComponent ? ' · 组件' : siblingSummary}</small></>;
  const item = <Button ref={(element) => registerItem(node.inspectorId, element)} variant={selected ? 'secondary' : 'ghost'} size="sm" className="inspector-file-tree-button min-w-0 flex-1 justify-start px-1" data-inspector-tree-item data-inspector-tree-id={node.inspectorId} data-active={selected} role="treeitem" tabIndex={focusId === node.inspectorId ? 0 : -1} aria-level={depth + 1} aria-posinset={position} aria-setsize={setSize} aria-expanded={hasChildren ? open : undefined} aria-selected={selected} onFocus={() => moveFocus(node.inspectorId, {focus: false})} onKeyDown={(event) => onKeyDown(event, node.inspectorId)} onClick={() => onNavigate?.({inspectorId: node.inspectorId})}>{label}</Button>;
  const preview = () => onPreview?.({inspectorId: node.inspectorId});
  const endPreview = () => onPreview?.(null);
  if (!hasChildren) return <div className="inspector-file-tree-row flex items-center gap-0.5" onMouseEnter={preview} onMouseLeave={endPreview}><span className="size-6 shrink-0" data-inspector-tree-spacer aria-hidden="true" />{item}</div>;
  return <Collapsible open={open} onOpenChange={(next) => setNodeOpen(node.inspectorId, next)}><div className="inspector-file-tree-row flex items-center gap-0.5" onMouseEnter={preview} onMouseLeave={endPreview}><CollapsibleTrigger render={<Button variant="link" size="icon-xs" className="inspector-file-tree-toggle group shrink-0" data-inspector-tree-toggle tabIndex={-1} aria-hidden="true" aria-label={`${open ? '收起' : '展开'} ${node.name}`} onMouseDown={(event) => event.preventDefault()} />}><ChevronRightIcon className="transition-transform group-data-panel-open:rotate-90" /></CollapsibleTrigger>{item}</div><CollapsibleContent className="inspector-file-tree-children mt-1 ml-5" role="group"><div className="flex flex-col gap-1">{node.children.map((child, index) => <InspectorFileTreeNode key={child.inspectorId} node={child} selectedId={selectedId} expanded={expanded} setNodeOpen={setNodeOpen} onNavigate={onNavigate} onPreview={onPreview} focusId={focusId} moveFocus={moveFocus} onKeyDown={onKeyDown} registerItem={registerItem} depth={depth + 1} position={index + 1} setSize={node.children.length} />)}</div></CollapsibleContent></Collapsible>;
}

function InspectorFileTree({object, onNavigate, onPreview, expandedInspectorNodes, onExpandedInspectorNodesChange, inspectorTreeFocusId, onInspectorTreeFocusIdChange, active = false}) {
  const controlled = expandedInspectorNodes instanceof Set && typeof onExpandedInspectorNodesChange === 'function';
  const [localExpanded, setLocalExpanded] = useState(() => new Set(object.ancestorIds || []));
  const focusControlled = typeof onInspectorTreeFocusIdChange === 'function';
  const [localFocusId, setLocalFocusId] = useState(object.inspectorId);
  const treeRef = useRef(null);
  const itemRefs = useRef(new Map());
  const previousObject = useRef(`${object.pageId}:${object.inspectorId}`);
  const expanded = controlled ? expandedInspectorNodes : localExpanded;
  const setExpanded = controlled ? onExpandedInspectorNodesChange : setLocalExpanded;
  const requestedFocusId = focusControlled ? inspectorTreeFocusId : localFocusId;
  const visible = visibleTreeItems(object.tree || [], expanded);
  const visibleById = new Map(visible.map((entry, index) => [entry.node.inspectorId, {...entry, index}]));
  const selectedFocusId = visibleById.has(object.inspectorId) ? object.inspectorId : null;
  const focusId = visibleById.has(requestedFocusId) ? requestedFocusId : selectedFocusId || visible[0]?.node.inspectorId || null;
  const visibleSignature = visible.map((entry) => entry.node.inspectorId).join('|');
  const setFocusId = focusControlled ? onInspectorTreeFocusIdChange : setLocalFocusId;
  if (treeRef.current?.contains(document.activeElement)) treeRef.current.dataset.hadTreeFocus = 'true';
  useEffect(() => { if (!controlled) setLocalExpanded(new Set(object.ancestorIds || [])); }, [controlled, object.inspectorId, object.ancestorIds?.join('|')]);
  useLayoutEffect(() => {
    const objectIdentity = `${object.pageId}:${object.inspectorId}`;
    const objectChanged = previousObject.current !== objectIdentity;
    previousObject.current = objectIdentity;
    const nextFocusId = objectChanged && selectedFocusId ? selectedFocusId : focusId;
    if (nextFocusId && nextFocusId !== requestedFocusId) setFocusId(nextFocusId);
    const shouldRestore = active && (objectChanged || treeRef.current?.dataset.hadTreeFocus === 'true' || (focusControlled && Boolean(inspectorTreeFocusId)));
    if (shouldRestore && nextFocusId) {
      itemRefs.current.get(nextFocusId)?.focus();
      if (treeRef.current) delete treeRef.current.dataset.hadTreeFocus;
    }
    keepTreeItemVisible(itemRefs.current.get(selectedFocusId));
  }, [active, focusControlled, focusId, inspectorTreeFocusId, object.inspectorId, object.pageId, requestedFocusId, selectedFocusId, visibleSignature]);
  const registerItem = (id, element) => { if (element) itemRefs.current.set(id, element); else itemRefs.current.delete(id); };
  const setNodeOpen = (id, open) => setExpanded((current) => { const result = new Set(current); if (open) result.add(id); else result.delete(id); return result; });
  const moveFocus = (id, {focus = true} = {}) => {
    if (!visibleById.has(id)) return;
    setFocusId(id);
    if (focus) itemRefs.current.get(id)?.focus();
  };
  const onKeyDown = (event, id) => {
    const entry = visibleById.get(id);
    if (!entry) return;
    let handled = true;
    if (event.key === 'ArrowDown') moveFocus(visible[Math.min(entry.index + 1, visible.length - 1)]?.node.inspectorId);
    else if (event.key === 'ArrowUp') moveFocus(visible[Math.max(entry.index - 1, 0)]?.node.inspectorId);
    else if (event.key === 'Home') moveFocus(visible[0]?.node.inspectorId);
    else if (event.key === 'End') moveFocus(visible.at(-1)?.node.inspectorId);
    else if (event.key === 'ArrowRight' && entry.hasChildren) {
      if (!entry.open) setNodeOpen(id, true);
      else moveFocus(entry.node.children[0]?.inspectorId);
    } else if (event.key === 'ArrowLeft') {
      if (entry.hasChildren && entry.open) setNodeOpen(id, false);
      else if (entry.parentId) moveFocus(entry.parentId);
    } else if (event.key === 'Enter' || event.key === ' ') onNavigate?.({inspectorId: id});
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  };
  return <div ref={treeRef} className="inspector-tree" data-file-tree="collapsible" role="tree" aria-label="页面对象层级">{(object.tree || []).map((node, index) => <InspectorFileTreeNode key={node.inspectorId} node={node} selectedId={object.inspectorId} expanded={expanded} setNodeOpen={setNodeOpen} onNavigate={onNavigate} onPreview={onPreview} focusId={focusId} moveFocus={moveFocus} onKeyDown={onKeyDown} registerItem={registerItem} position={index + 1} setSize={object.tree.length} />)}</div>;
}

function CopyObjectMenu({model, page, object, onCopyTask}) {
  const copy = (category) => onCopyTask?.(buildInspectorCopyPayload({project: model.project, page, object, category}));
  return <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" variant="outline" />}><Copy data-icon="inline-start" />复制<ChevronDown data-icon="inline-end" /></DropdownMenuTrigger><DropdownMenuContent aria-label="复制对象上下文">{INSPECTOR_COPY_CATEGORIES.map((item) => <DropdownMenuItem key={item.id} onClick={() => copy(item.id)}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
}

function InspectorSection({title, children}) {
  return <section className="preview-sidebar-section"><SectionTitle>{title}</SectionTitle>{children}</section>;
}

function InspectorObjectView({model, object, onNavigate, onPreview, onCopyTask, expandedInspectorNodes, onExpandedInspectorNodesChange, inspectorTreeFocusId, onInspectorTreeFocusIdChange, treeActive}) {
  const page = object.page || model.pages?.find((item) => item.id === object.pageId);
  const recommendation = object.recommendation || inspectorScopeRecommendation(object);
  const pageName = (id) => model.pages?.find((item) => item.id === id)?.name || '尚未命名页面';
  const objectName = object.name || object.role || '未命名对象';
  const objectIdentity = object.componentId ? `${object.componentId}${object.instanceId ? ` · ${object.instanceId}` : ''}` : `${object.role} · 普通页面结构`;
  return <section className="preview-sidebar-content" data-sidebar-view="object"><header className="preview-sidebar-heading inspector-heading"><div><MetadataText as="p" className="sidebar-kicker">已锁定对象</MetadataText><Tooltip><TooltipTrigger render={<PanelTitle className="truncate" tabIndex={0}>{objectName}</PanelTitle>} /><TooltipContent side="bottom" align="start">{objectName}</TooltipContent></Tooltip><Tooltip><TooltipTrigger render={<ContentDescription className="truncate" data-object-identity tabIndex={0}>{object.componentId ? <CodeText>{objectIdentity}</CodeText> : objectIdentity}</ContentDescription>} /><TooltipContent side="bottom" align="start">{objectIdentity}</TooltipContent></Tooltip></div><CopyObjectMenu model={model} page={page} object={object} onCopyTask={onCopyTask} /></header><InspectorSection title="页面与完整层级"><ContentDescription>{page?.name || object.pageId || '尚未登记页面'} · {object.path?.join(' > ') || '层级尚未登记'}</ContentDescription>{object.tree?.length ? <InspectorFileTree object={object} onNavigate={onNavigate} onPreview={onPreview} expandedInspectorNodes={expandedInspectorNodes} onExpandedInspectorNodesChange={onExpandedInspectorNodesChange} inspectorTreeFocusId={inspectorTreeFocusId} onInspectorTreeFocusIdChange={onInspectorTreeFocusIdChange} active={treeActive} /> : <ContentDescription className="inspector-local-note">完整层级尚未从预览返回。</ContentDescription>}</InspectorSection><InspectorSection title="默认修改范围"><strong className="inspector-recommendation">{recommendation.label}</strong><ContentDescription>{recommendation.rationale}</ContentDescription><ContentDescription>{recommendation.impact} · 置信度：{recommendation.confidence}</ContentDescription>{object.localStructureNote ? <ContentDescription className="inspector-local-note">{object.localStructureNote}</ContentDescription> : null}</InspectorSection><InspectorSection title="相关逻辑">{object.relatedLogic?.length ? <ul>{object.relatedLogic.map((item) => <li key={item.id}><strong>{item.trigger || '触发方式尚未登记'}</strong><span>从“{pageName(item.from)}”前往“{pageName(item.to)}”；条件：{item.condition || '无条件'}{item.targetState ? `；目标状态：${item.targetState}` : ''}{item.preservedState ? `；保留状态：${item.preservedState}` : ''}</span></li>)}</ul> : <ContentDescription>当前事实中没有直接帮助此对象任务的逻辑。</ContentDescription>}</InspectorSection><InspectorSection title="布局摘要"><Summary record={object.layout} /></InspectorSection><InspectorSection title="样式摘要"><Summary record={object.style} /></InspectorSection>{object.usageLocations?.length || object.gaps?.length ? <InspectorSection title="使用、影响与已知缺口">{object.usageLocations?.length ? <ul>{object.usageLocations.map((usage, index) => <li key={`${usage.pageId}-${usage.instanceId || index}`}>{usage.pageName || pageName(usage.pageId)}{usage.instanceId ? ` · ${usage.instanceId}` : ''}</li>)}</ul> : null}{object.gaps?.length ? <ul>{object.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : null}</InspectorSection> : null}</section>;
}

const EVENT_STATE = {current: {label: '当前', actions: ['归档', '删除']}, archived: {label: '已归档', actions: ['恢复']}, deleted: {label: '已删除', actions: []}};

function RuntimeEventState({selectedEvent}) {
  if (!selectedEvent?.id) return null;
  const presentation = EVENT_STATE[selectedEvent.state] || {label: selectedEvent.state || '未知', actions: []};
  return <section className="preview-sidebar-section" data-runtime-event-state><SectionTitle>所选事件的运行状态</SectionTitle><ContentDescription><CodeText>{selectedEvent.id}</CodeText> · {presentation.label}</ContentDescription><ContentDescription>可执行状态操作：{presentation.actions.length ? presentation.actions.join('、') : '暂无'}</ContentDescription></section>;
}

export function PreviewSidebar({view = 'page', model, pageId, selectedEvent = null, inspectedObject = null, onNavigate, onPreview, onCopyTask, expandedInspectorNodes, onExpandedInspectorNodesChange, inspectorTreeFocusId, onInspectorTreeFocusIdChange, treeActive = false}) {
  if (view === 'object') return inspectedObject ? <InspectorObjectView model={model} object={inspectedObject} onNavigate={onNavigate} onPreview={onPreview} onCopyTask={onCopyTask} expandedInspectorNodes={expandedInspectorNodes} onExpandedInspectorNodesChange={onExpandedInspectorNodesChange} inspectorTreeFocusId={inspectorTreeFocusId} onInspectorTreeFocusIdChange={onInspectorTreeFocusIdChange} treeActive={treeActive} /> : <section className="preview-sidebar-content" data-sidebar-view="object-empty"><header className="preview-sidebar-heading"><MetadataText as="p" className="sidebar-kicker">检查对象</MetadataText><PanelTitle>当前预览尚未就绪</PanelTitle><ContentDescription>预览连接后，这里会自动选择最外围内容。</ContentDescription></header></section>;
  const sidebar = previewSidebarModel({...model, pageId});
  if (!sidebar.page) return <section className="preview-sidebar-content"><p>尚未登记当前页面。</p></section>;
  return <section className="preview-sidebar-content" data-sidebar-view="page"><header className="preview-sidebar-heading"><MetadataText as="p" className="sidebar-kicker">当前页面</MetadataText><PanelTitle>{sidebar.page.name || '尚未登记'}</PanelTitle><ContentDescription><CodeText>{sidebar.page.id}</CodeText> · {sidebar.page.preview || sidebar.page.route || 'route 尚未登记'}</ContentDescription></header><RelationGroup title="从哪里进入" relations={sidebar.incoming} direction="incoming" /><RelationGroup title="可以去哪里" relations={sidebar.outgoing} direction="outgoing" /><section className="preview-sidebar-section"><SectionTitle>页面内状态变化</SectionTitle>{sidebar.stateChanges.length ? <ul>{sidebar.stateChanges.map((item) => <li key={item.id}><strong>{item.name || item.id}</strong><span>{item.description || '状态变化说明尚未登记'}</span></li>)}</ul> : <ContentDescription>尚未登记页面内状态变化。</ContentDescription>}</section><RuntimeEventState selectedEvent={selectedEvent} />{sidebar.gaps.length ? <section className="preview-sidebar-section"><SectionTitle>需要处理</SectionTitle><ul>{sidebar.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></section> : null}</section>;
}
