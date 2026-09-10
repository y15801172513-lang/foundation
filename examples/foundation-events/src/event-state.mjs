export const STORAGE_KEY = 'foundation-events-demo-v1';
export const MANAGE_TABS = ['current', 'archived', 'deleted'];
export const ALLOWED_RETURN_TARGETS = new Set(['/events', ...MANAGE_TABS.map((tab) => `/events/manage?tab=${tab}`)]);

export const INITIAL_EVENTS = [
  {id: 'event_010_complete', title: 'Prompt 010 工程结构稳定化完成', summary: '公开 workspace、preview 配置、事实校验和确定性构建已完成。', entries: ['三包公开边界', '本地静态 preview 白名单', '19 项回归测试'], nextAction: '在 Foundation 01 中核对 R1 事件映射。', status: 'current', important: true, updatedAt: '2026-08-27T16:00:00.000Z'},
  {id: 'event_component_context', title: '组件变体与复制上下文待闭环', summary: '需要让实例、变体、页面与可复制上下文使用同一选择结果。', entries: ['primary 与 secondary', 'bridge 保留 variant'], status: 'current', important: false, updatedAt: '2026-08-28T08:00:00.000Z'},
  {id: 'event_events_app', title: '事件模拟 App 开始验证', summary: '以最小可操作项目验证页面、关系、状态和组件事实。', entries: ['首页', '管理页', '详情快速选择'], status: 'current', important: false, updatedAt: '2026-08-28T09:00:00.000Z'},
  {id: 'event_install_pending', title: '安装版本仍未开始', summary: '安装版本属于后续阶段，本轮不进入。', entries: ['等待明确授权'], status: 'archived', important: false, updatedAt: '2026-08-27T12:00:00.000Z'},
  {id: 'event_assets_figma_later', title: '资产判断库与 Figma 留待后续', summary: '不在当前 Foundation 验证项目中提前实现。', entries: ['完整资产库', 'Figma 写入'], status: 'deleted', important: false, updatedAt: '2026-08-27T12:00:00.000Z'}
];

export function cloneInitialEvents() { return structuredClone(INITIAL_EVENTS); }

export function normalizeEvents(events) {
  const current = events.filter((event) => event.status === 'current');
  let importantSeen = false;
  return events.map((event) => {
    if (event.status !== 'current') return {...event, important: false};
    if (event.important && !importantSeen) { importantSeen = true; return event; }
    return {...event, important: false};
  }).map((event, index, all) => !importantSeen && all[index]?.status === 'current' ? (importantSeen = true, {...event, important: true}) : event);
}

export function changeEventStatus(events, id, status) {
  if (!['archived', 'deleted', 'current'].includes(status)) return events;
  const changed = events.map((event) => event.id === id ? {...event, status, important: status === 'current' ? event.important : false, updatedAt: new Date().toISOString()} : event);
  return normalizeEvents(changed);
}

export function addEvent(events, {title, summary}) {
  const id = `event_local_${String(title).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new'}`;
  const uniqueId = events.some((event) => event.id === id) ? `${id}-${events.length + 1}` : id;
  const currentCount = events.filter((event) => event.status === 'current').length;
  return normalizeEvents([{id: uniqueId, title: String(title).trim(), summary: String(summary).trim(), entries: ['本地新增事件'], status: 'current', important: currentCount === 0, updatedAt: new Date().toISOString()}, ...events]);
}

export function sanitizeReturnTarget(value) { return ALLOWED_RETURN_TARGETS.has(value) ? value : '/events'; }

export function eventReturnTarget({returnTo, from, tab}) {
  if (returnTo) return sanitizeReturnTarget(returnTo);
  return from === 'manage' ? sanitizeReturnTarget(`/events/manage?tab=${MANAGE_TABS.includes(tab) ? tab : 'current'}`) : '/events';
}

export function currentReturnTarget({pathname, returnTo, from, tab}) {
  if (pathname?.startsWith('/events/detail')) return eventReturnTarget({returnTo, from, tab});
  if (pathname?.startsWith('/events/manage')) return sanitizeReturnTarget(`/events/manage?tab=${MANAGE_TABS.includes(tab) ? tab : 'current'}`);
  return '/events';
}

export function detailTarget(id, returnTo) {
  return `/events/detail?id=${encodeURIComponent(id)}&returnTo=${encodeURIComponent(sanitizeReturnTarget(returnTo))}`;
}
