export const PREVIEW_NAMESPACE = 'ai-product-foundation-preview';

const text = (value, max = 500) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const nullableText = (value, max = 500) => value === null || value === undefined || text(value, max);
const summary = (value) => value && typeof value === 'object' && text(value.inspectorId, 500) && text(value.name) && text(value.role, 80) && nullableText(value.componentId, 128) && nullableText(value.instanceId, 128) && typeof value.registeredComponent === 'boolean';
const eventState = (value) => value === null || value === undefined || ['current', 'archived', 'deleted'].includes(value);

function inspectorTreeNode(value, state, depth = 0) {
  if (!summary(value) || !text(value.summary, 500) || !Array.isArray(value.children) || depth > 12 || state.count >= 300) return false;
  state.count += 1;
  return value.children.every((child) => inspectorTreeNode(child, state, depth + 1));
}

export function isInspectorObject(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !text(value.pageId, 128) || !text(value.name) || !text(value.role, 80)) return false;
  if (!text(value.inspectorId, 500) || !nullableText(value.componentId, 128) || !nullableText(value.instanceId, 128) || !nullableText(value.variant, 128) || !nullableText(value.eventId, 128) || !eventState(value.eventState) || typeof value.registeredComponent !== 'boolean') return false;
  if (!Array.isArray(value.path) || value.path.length > 6 || !value.path.every((item) => text(item, 80))) return false;
  if (!Array.isArray(value.ancestorIds) || value.ancestorIds.length > 12 || !value.ancestorIds.every((item) => text(item, 500))) return false;
  const treeState = {count: 0};
  if (!Array.isArray(value.tree) || !value.tree.length || !value.tree.every((node) => inspectorTreeNode(node, treeState))) return false;
  if (!value.hierarchy || !summary(value.hierarchy.current) || (value.hierarchy.parent !== null && !summary(value.hierarchy.parent)) || !Array.isArray(value.hierarchy.children) || value.hierarchy.children.length > 12 || !value.hierarchy.children.every(summary)) return false;
  const stringRecord = (record, allowed) => record && typeof record === 'object' && Object.keys(record).every((key) => allowed.has(key) && typeof record[key] === 'string' && record[key].length <= 500);
  return stringRecord(value.layout, new Set(['display', 'position', 'width', 'height', 'gap', 'flexDirection', 'gridTemplateColumns'])) && stringRecord(value.style, new Set(['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'borderRadius']));
}

export function isPreviewMessagePayload(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.kind === 'preview-ready') return text(data.pageId, 128) && text(data.route, 500) && (data.object === undefined || isInspectorObject(data.object));
  if (data.kind === 'component-selected') return text(data.componentId, 128) && text(data.instanceId, 128) && text(data.pageId, 128) && nullableText(data.variant, 128) && nullableText(data.eventId, 128) && eventState(data.eventState);
  if (data.kind === 'inspect-hovered' || data.kind === 'inspect-selected') return isInspectorObject(data.object);
  if (data.kind === 'inspect-selection-invalidated') return text(data.reason, 128);
  if (data.kind === 'inspect-exit-request') return true;
  return false;
}

export function isAllowedPreviewMessage(event, {iframeWindow, currentOrigin, preview}) {
  if (!event || event.data?.namespace !== PREVIEW_NAMESPACE) return false;
  if (!iframeWindow || event.source !== iframeWindow) return false;
  const allowedOrigins = new Set((preview?.allowedOrigins || []).map((origin) => origin === 'self' ? currentOrigin : origin));
  return allowedOrigins.has(event.origin) && isPreviewMessagePayload(event.data);
}
