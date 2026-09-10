export const ASSET_PREVIEW_NAMESPACE = 'ai-product-foundation-asset-preview';

const REQUEST_KEYS = ['assetId', 'channel', 'kind', 'namespace'];
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

export function assetPreviewParentOrigin(referrer) {
  try {
    const url = new URL(referrer);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch { return ''; }
}

export function isAssetPreviewStatusRequest(event, {parentWindow, parentOrigin, assetId, channel}) {
  const data = event?.data;
  if (!event || !parentWindow || event.source !== parentWindow || event.origin !== parentOrigin) return false;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (Object.keys(data).sort().join('|') !== REQUEST_KEYS.join('|')) return false;
  return data.namespace === ASSET_PREVIEW_NAMESPACE
    && data.kind === 'status-request'
    && text(data.assetId, 128)
    && text(data.channel, 200)
    && data.assetId === assetId
    && data.channel === channel;
}
