import {useEffect, useState} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Archive, ArrowLeft, FolderKanban, RotateCcw, Trash2} from 'lucide-react';
import {announcePreview, applyPreviewTheme, installInspectorBridge, isAssetPreviewLocation, previewThemeFromSearch} from './bridge.mjs';
import {addEvent, changeEventStatus, cloneInitialEvents, currentReturnTarget, detailTarget, eventReturnTarget, MANAGE_TABS, STORAGE_KEY} from './event-state.mjs';
import {EventAction} from './components/event-action';
import {EventCard} from './components/event-card';
import {EventFormDialog} from './components/event-form-dialog';
import {EventQuickSelect} from './components/event-quick-select';
import {EventStatus} from './components/event-status';
import {AssetPreviewApp} from './asset-preview';
import {applyFoundationFontPlatform} from '../../../apps/management-center/src/foundation-font-platform.mjs';
import './styles.css';
import './structure-correction.css';

function readStoredEvents() { try { const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (!Array.isArray(stored)) return cloneInitialEvents(); const initialById = new Map(cloneInitialEvents().map((event) => [event.id, event])); return stored.map((event) => ({...initialById.get(event.id), ...event, nextAction: event.nextAction ?? initialById.get(event.id)?.nextAction})); } catch { return cloneInitialEvents(); } }
function routeInfo() { const url = new URL(window.location.href); const pathname = url.pathname; return {pathname, id: url.searchParams.get('id'), from: url.searchParams.get('from'), tab: url.searchParams.get('tab'), returnTo: url.searchParams.get('returnTo')}; }
function statusLabel(status) { return ({current: '当前', archived: '已归档', deleted: '已删除'})[status] || '未知'; }

function App() {
  const [events, setEvents] = useState(readStoredEvents);
  const [route, setRoute] = useState(routeInfo);
  const [pageTransitionKey, setPageTransitionKey] = useState(0);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(events)); }, [events]);
  useEffect(() => { installInspectorBridge(); }, []);
  const transitionTo = (applyRoute) => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const commit = () => { applyRoute(); setPageTransitionKey((current) => current + 1); };
    if (!reducedMotion && document.startViewTransition) return document.startViewTransition(() => flushSync(commit));
    return commit();
  };
  useEffect(() => { const listener = () => transitionTo(() => setRoute(routeInfo())); window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener); }, []);
  useEffect(() => { announcePreview(); }, [route.pathname, route.id, route.from, route.tab, route.returnTo]);
  const navigate = (target) => {
    if (`${window.location.pathname}${window.location.search}` === target) return;
    transitionTo(() => { window.history.pushState({}, '', target); setRoute(routeInfo()); });
  };
  const openDetail = (event) => navigate(detailTarget(event.id, currentReturnTarget(route)));
  const updateStatus = (id, status) => setEvents((current) => changeEventStatus(current, id, status));
  const currentEvents = events.filter((event) => event.status === 'current');
  const featured = currentEvents.find((event) => event.important) || null;
  const renderHome = () => <main className="events-shell"><header className="events-header"><div><p className="eyebrow">Foundation 验证项目</p><h1>当前事件</h1><p>只展示仍在进行中的事件；归档与删除操作集中在管理页。</p></div><div className="events-header__actions"><EventFormDialog onCreate={({title, summary}) => setEvents((current) => addEvent(current, {title, summary}))} /><EventAction variant="manage" instanceId="event_action_manage" onClick={() => navigate('/events/manage?tab=current')}><FolderKanban data-icon="inline-start" />管理事件</EventAction></div></header>{featured ? <section aria-label="重要事件"><EventCard event={featured} pageId="page_events_home" variant="featured" onOpen={() => openDetail(featured)} /></section> : <section className="event-empty"><h2>暂无当前事件</h2><p>新增一条事件后会显示在这里。</p></section>}<section className="event-grid" aria-label="当前事件列表">{currentEvents.filter((event) => event.id !== featured?.id).map((event) => <EventCard key={event.id} event={event} pageId="page_events_home" variant="current" onOpen={() => openDetail(event)} />)}</section></main>;
  const renderManage = () => { const tab = MANAGE_TABS.includes(route.tab) ? route.tab : 'current'; const items = events.filter((event) => event.status === tab); return <main className="events-shell"><header className="events-header"><div><p className="eyebrow">事件管理</p><h1>管理事件</h1><p>状态变化是数据操作，不会伪装成页面跳转。</p></div><EventAction variant="back" instanceId="event_action_back_events" onClick={() => navigate('/events')}><ArrowLeft data-icon="inline-start" />返回首页</EventAction></header><Tabs value={tab} onValueChange={(nextTab) => navigate(`/events/manage?tab=${nextTab}`)}><TabsList variant="line" className="event-tabs" aria-label="事件状态">{MANAGE_TABS.map((item) => <TabsTrigger key={item} value={item}>{statusLabel(item)}</TabsTrigger>)}</TabsList></Tabs><section className="event-grid">{items.map((event) => <EventCard key={event.id} event={event} pageId="page_events_manage" variant={event.status} onOpen={() => openDetail(event)}>{event.status === 'current' && <><EventAction variant="archive" instanceId={`event_action_archive_${event.id}`} eventId={event.id} eventState={event.status} targetEventState="archived" onClick={() => updateStatus(event.id, 'archived')}><Archive data-icon="inline-start" />归档</EventAction><EventAction variant="delete" instanceId={`event_action_delete_${event.id}`} eventId={event.id} eventState={event.status} targetEventState="deleted" onClick={() => updateStatus(event.id, 'deleted')}><Trash2 data-icon="inline-start" />删除</EventAction></>}{event.status === 'archived' && <EventAction variant="restore" instanceId={`event_action_restore_${event.id}`} eventId={event.id} eventState={event.status} targetEventState="current" onClick={() => updateStatus(event.id, 'current')}><RotateCcw data-icon="inline-start" />恢复</EventAction>}</EventCard>)}</section>{!items.length && <section className="event-empty"><h2>此状态没有事件</h2><p>状态变化后会真实反映在这里。</p></section>}<footer className="events-manage-footer"><EventAction variant="restore" instanceId="event_action_reset_demo" onClick={() => setEvents(cloneInitialEvents())}><RotateCcw data-icon="inline-start" />恢复演示数据</EventAction></footer></main>; };
  const renderDetail = () => { const event = events.find((item) => item.id === route.id) || currentEvents[0] || events[0]; if (!event) return <main className="events-shell"><section className="event-empty"><h1>暂无事件</h1><EventAction variant="back" instanceId="event_action_back_empty" onClick={() => navigate('/events')}>返回首页</EventAction></section></main>; const returnTarget = eventReturnTarget(route); return <main className="events-shell"><header className="events-header"><div><p className="eyebrow">事件详情 · {statusLabel(event.status)}</p><h1>{event.title}</h1><p>{event.summary}</p></div><EventAction variant="back" instanceId={`event_action_back_${event.id}`} onClick={() => navigate(returnTarget)}><ArrowLeft data-icon="inline-start" />返回来源页</EventAction></header><section className="event-detail"><div className="event-detail__meta"><span>是否重要：{event.important ? '是' : '否'}</span><EventStatus status={event.status} eventId={event.id} /><time>更新时间：{new Date(event.updatedAt).toLocaleString('zh-CN')}</time></div><h2>条目</h2><ul>{event.entries.map((entry) => <li key={entry}>{entry}</li>)}</ul><div className="event-detail__select"><label htmlFor="event-quick-select">快速选择其他事件</label><EventQuickSelect events={events} value={event.id} onValueChange={(id) => navigate(detailTarget(id, currentReturnTarget(route)))} /></div></section></main>; };
  const content = route.pathname.startsWith('/events/manage') ? renderManage() : route.pathname.startsWith('/events/detail') ? renderDetail() : renderHome();
  return <div key={pageTransitionKey} className="event-page-transition">{content}</div>;
}

applyFoundationFontPlatform();
applyPreviewTheme(previewThemeFromSearch(), document);
createRoot(document.getElementById('root')).render(isAssetPreviewLocation() ? <AssetPreviewApp /> : <App />);
