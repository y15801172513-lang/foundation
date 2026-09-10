import {Component, useEffect, useState} from 'react';
import {EventAction} from './components/event-action';
import {EventCard} from './components/event-card';
import {EventFormDialog} from './components/event-form-dialog';
import {EventQuickSelect} from './components/event-quick-select';
import {EventStatus} from './components/event-status';
import {ASSET_PREVIEW_NAMESPACE, assetPreviewParentOrigin, isAssetPreviewStatusRequest} from './asset-preview-protocol.mjs';
import './asset-preview.css';

export {ASSET_PREVIEW_NAMESPACE} from './asset-preview-protocol.mjs';

const SAMPLE_EVENTS = [
  {id: 'preview_event_current', title: '资产预览事件', summary: '使用真实注册组件与当前设计变量渲染，不写入项目事实。', entries: ['隔离副作用'], nextAction: '核对默认变体和关键状态。', status: 'current', important: true, updatedAt: '2026-08-29T10:00:00.000Z'},
  {id: 'preview_event_archived', title: '已归档示例', summary: '用于验证归档状态的真实视觉。', entries: [], status: 'archived', important: false, updatedAt: '2026-08-29T10:00:00.000Z'}
];

function QuickSelectPreview() {
  const [value, setValue] = useState(SAMPLE_EVENTS[0].id);
  return <EventQuickSelect events={SAMPLE_EVENTS} value={value} onValueChange={setValue} />;
}

const card = (defaultVariant) => ({variants: ['featured', 'current', 'archived', 'deleted'], defaultVariant, render: (variant) => {
  const status = ['archived', 'deleted'].includes(variant) ? variant : 'current';
  const event = {...SAMPLE_EVENTS[0], status, important: variant === 'featured'};
  return <EventCard event={event} pageId="asset_preview" variant={variant} onOpen={() => {}} />;
}});

export const ASSET_PREVIEW_REGISTRY = Object.freeze({
  component_event_card: card('current'),
  component_event_card_featured: card('featured'),
  component_event_card_archived: card('archived'),
  component_event_card_deleted: card('deleted'),
  component_event_action: {variants: ['new', 'manage', 'archive', 'delete', 'restore', 'back'], defaultVariant: 'new', render: (variant) => <EventAction variant={variant} instanceId="asset_preview_action" onClick={() => {}}>真实 EventAction · {variant}</EventAction>},
  component_event_form_dialog: {variants: ['create'], defaultVariant: 'create', render: () => <EventFormDialog onCreate={() => {}} />},
  component_event_quick_select: {variants: ['detail'], defaultVariant: 'detail', render: () => <QuickSelectPreview />},
  component_event_status_badge: {variants: ['current', 'archived', 'deleted'], defaultVariant: 'current', render: (variant) => <EventStatus status={variant} eventId="preview_event_current" pageId="asset_preview" />}
});

function previewInput(search = window.location.search) {
  const params = new URLSearchParams(search);
  return {assetId: params.get('assetId') || '', requestedVariant: params.get('variant') || '', channel: params.get('channel') || ''};
}

function postPreviewStatus({assetId, channel}, status, message = '') {
  if (!assetId || !channel) return;
  window.parent.postMessage({namespace: ASSET_PREVIEW_NAMESPACE, kind: 'status', assetId, channel, status, message: String(message).slice(0, 300)}, window.location.origin);
}

export class AssetPreviewBoundary extends Component {
  constructor(props) { super(props); this.state = {error: null}; }
  static getDerivedStateFromError(error) { return {error}; }
  componentDidCatch(error) { postPreviewStatus(this.props.input, 'error', error?.message || '组件预览渲染失败'); }
  render() { return this.state.error ? <section className="asset-preview-message"><strong>预览渲染失败</strong><span>{this.state.error.message}</span></section> : this.props.children; }
}

export function AssetPreviewApp({search}) {
  const input = previewInput(search);
  const registration = Object.hasOwn(ASSET_PREVIEW_REGISTRY, input.assetId) ? ASSET_PREVIEW_REGISTRY[input.assetId] : null;
  const variant = registration?.variants.includes(input.requestedVariant) ? input.requestedVariant : registration?.defaultVariant;
  useEffect(() => {
    const announce = () => postPreviewStatus(input, registration ? 'ready' : 'unsupported', registration ? '' : '当前实现未登记安全预览适配器');
    const onMessage = (event) => {
      if (isAssetPreviewStatusRequest(event, {parentWindow: window.parent, parentOrigin: assetPreviewParentOrigin(document.referrer), assetId: input.assetId, channel: input.channel})) announce();
    };
    window.addEventListener('message', onMessage);
    announce();
    return () => window.removeEventListener('message', onMessage);
  }, [input.assetId, input.channel, registration]);
  if (!registration) return <section className="asset-preview-message"><strong>暂不支持此资产预览</strong><span>当前实现未登记安全预览适配器。</span></section>;
  return <AssetPreviewBoundary input={input}><main className="asset-preview-stage" data-preview-asset-id={input.assetId} data-preview-variant={variant}><div className="asset-preview-component">{registration.render(variant)}</div></main></AssetPreviewBoundary>;
}
