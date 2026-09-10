import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {ROOT} from '../helpers/project-fixture.mjs';
import {
  ASSET_PREVIEW_NAMESPACE,
  ASSET_PREVIEW_OPAQUE_ORIGIN,
  ASSET_PREVIEW_SANDBOX,
  assetPreviewStatusRequest,
  isAllowedAssetPreviewMessage
} from '../../apps/management-center/src/features/preview/asset-preview-policy.mjs';
import {assetPreviewParentOrigin, isAssetPreviewStatusRequest} from '../../examples/foundation-events/src/asset-preview-protocol.mjs';

const iframeWindow = {};
const context = {
  iframeWindow,
  expectedOrigin: ASSET_PREVIEW_OPAQUE_ORIGIN,
  assetId: 'component_event_card',
  channel: 'asset-preview-channel-021'
};
const ready = {
  namespace: ASSET_PREVIEW_NAMESPACE,
  kind: 'status',
  assetId: context.assetId,
  channel: context.channel,
  status: 'ready',
  message: ''
};

test('资产 iframe 使用不透明 origin，不能同时保留脚本与同源能力', () => {
  assert.equal(ASSET_PREVIEW_SANDBOX, 'allow-scripts');
  assert.equal(ASSET_PREVIEW_OPAQUE_ORIGIN, 'null');
  assert.doesNotMatch(ASSET_PREVIEW_SANDBOX, /allow-same-origin/u);
  const source = fs.readFileSync(path.join(ROOT, 'apps/management-center/src/workspace/asset-preview.jsx'), 'utf8');
  assert.doesNotMatch(source, /allow-same-origin/u);
  assert.match(source, /sandbox=\{ASSET_PREVIEW_SANDBOX\}/u);
});

test('资产状态桥严格校验 source、opaque origin、消息类型与完整 payload 形状', () => {
  const event = {source: iframeWindow, origin: 'null', data: ready};
  assert.equal(isAllowedAssetPreviewMessage(event, context), true);
  assert.equal(isAllowedAssetPreviewMessage({...event, source: {}}, context), false);
  assert.equal(isAllowedAssetPreviewMessage({...event, origin: 'http://127.0.0.1:4317'}, context), false);
  assert.equal(isAllowedAssetPreviewMessage({...event, origin: 'http://evil.invalid'}, context), false);
  assert.equal(isAllowedAssetPreviewMessage({...event, data: {...ready, kind: 'write-request'}}, context), false);
  assert.equal(isAllowedAssetPreviewMessage({...event, data: {...ready, status: 'selected'}}, context), false);
  assert.equal(isAllowedAssetPreviewMessage({...event, data: {...ready, message: {nonce: 'stolen'}}}, context), false);
  assert.equal(isAllowedAssetPreviewMessage({...event, data: {...ready, writeNonce: 'stolen'}}, context), false);
  assert.equal(isAllowedAssetPreviewMessage({...event, data: {...ready, channel: 'other'}}, context), false);
  assert.equal(isAllowedAssetPreviewMessage({...event, data: {...ready, assetId: 'component_other'}}, context), false);
});

test('iframe load 后的状态握手只接受精确父来源与精确只读请求', () => {
  assert.equal(assetPreviewParentOrigin('http://127.0.0.1:4317/'), 'http://127.0.0.1:4317');
  assert.equal(assetPreviewParentOrigin('javascript:alert(1)'), '');
  const request = assetPreviewStatusRequest({assetId: context.assetId, channel: context.channel});
  assert.deepEqual(request, {namespace: ASSET_PREVIEW_NAMESPACE, kind: 'status-request', assetId: context.assetId, channel: context.channel});
  const parentWindow = {};
  const childContext = {parentWindow, parentOrigin: 'http://127.0.0.1:4317', assetId: context.assetId, channel: context.channel};
  const event = {source: parentWindow, origin: childContext.parentOrigin, data: request};
  assert.equal(isAssetPreviewStatusRequest(event, childContext), true);
  assert.equal(isAssetPreviewStatusRequest({...event, source: {}}, childContext), false);
  assert.equal(isAssetPreviewStatusRequest({...event, origin: 'http://evil.invalid'}, childContext), false);
  assert.equal(isAssetPreviewStatusRequest({...event, data: {...request, writeNonce: 'stolen'}}, childContext), false);
  assert.equal(isAssetPreviewStatusRequest({...event, data: {...request, channel: 'other'}}, childContext), false);
});
