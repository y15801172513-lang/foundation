export const ASSET_PREVIEW_NAMESPACE = 'ai-product-foundation-asset-preview';
export const ASSET_PREVIEW_SANDBOX = 'allow-scripts';
export const ASSET_PREVIEW_OPAQUE_ORIGIN = 'null';

const STATUS_TYPES = new Set(['loading', 'ready', 'unsupported', 'error']);
const PAYLOAD_KEYS = ['assetId', 'channel', 'kind', 'message', 'namespace', 'status'];
const text = (value, max, allowEmpty = false) => typeof value === 'string'
  && (allowEmpty || value.length > 0)
  && value.length <= max
  && !/[\u0000-\u001f\u007f]/u.test(value);

function isStatusPayload(data, versioned = false) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (Object.keys(data).sort().join('|') !== (versioned?[...PAYLOAD_KEYS,'projectId','revision'].sort():PAYLOAD_KEYS).join('|')) return false;
  return data.namespace === ASSET_PREVIEW_NAMESPACE
    && data.kind === 'status'
    && text(data.assetId, 128)
    && text(data.channel, 200)
    && STATUS_TYPES.has(data.status)
    && text(data.message, 300, true);
}

export function isAllowedAssetPreviewMessage(event, {iframeWindow, expectedOrigin, assetId, channel, projectId, revision}) {
  if (!event || !iframeWindow || event.source !== iframeWindow) return false;
  if (event.origin !== expectedOrigin || expectedOrigin !== ASSET_PREVIEW_OPAQUE_ORIGIN) return false;
  return (!revision || event.data?.revision===revision && event.data?.projectId===projectId) && isStatusPayload(event.data,Boolean(revision))
    && event.data.assetId === assetId
    && event.data.channel === channel;
}

export function assetPreviewStatusRequest({assetId, channel, projectId, revision}) {
  if (!text(assetId, 128) || !text(channel, 200)) throw new TypeError('资产预览状态请求缺少有效 assetId 或 channel');
  return {namespace: ASSET_PREVIEW_NAMESPACE, kind: 'status-request', assetId, channel,...(revision?{projectId,revision}:{})};
}
