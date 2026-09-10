import assert from 'node:assert/strict';
import test from 'node:test';
import {isAllowedPreviewMessage, PREVIEW_NAMESPACE} from '@foundation/management-center/bridge-policy';

test('iframe bridge 同时校验 namespace、origin 与 event.source', () => {
  const iframeWindow = {};
  const base = {source: iframeWindow, origin: 'http://127.0.0.1:4317', data: {namespace: PREVIEW_NAMESPACE, kind: 'preview-ready', pageId: 'page_events_home', route: '/events'}};
  const policy = {iframeWindow, currentOrigin: 'http://127.0.0.1:4317', preview: {allowedOrigins: ['self']}};
  assert.equal(isAllowedPreviewMessage(base, policy), true);
  assert.equal(isAllowedPreviewMessage({...base, source: {}}, policy), false);
  assert.equal(isAllowedPreviewMessage({...base, origin: 'http://evil.invalid'}, policy), false);
  assert.equal(isAllowedPreviewMessage({...base, data: {...base.data, namespace: 'other'}}, policy), false);
  assert.equal(isAllowedPreviewMessage({...base, data: {...base.data, kind: 'unknown-kind'}}, policy), false);
  assert.equal(isAllowedPreviewMessage({...base, data: {...base.data, kind: 'inspect-selected', object: {name: '按钮'}}}, policy), false);
  const descriptor = {inspectorId: 'component:component_event_action:event_action_manage', name: '管理事件', role: 'button', componentId: 'component_event_action', instanceId: 'event_action_manage', registeredComponent: true};
  const inspected = {version: 1, inspectorId: descriptor.inspectorId, pageId: 'page_events_home', name: '管理事件', role: 'button', componentId: 'component_event_action', instanceId: 'event_action_manage', registeredComponent: true, path: ['main', 'header', 'button'], ancestorIds: ['dom:main', 'dom:main/header'], tree: [{inspectorId: 'dom:main', name: 'main', role: 'main', componentId: null, instanceId: null, registeredComponent: false, summary: 'main', children: [{...descriptor, summary: 'component_event_action', children: []}]}], hierarchy: {parent: null, current: descriptor, children: []}, layout: {display: 'inline-flex'}, style: {color: 'rgb(0, 0, 0)'}};
  assert.equal(isAllowedPreviewMessage({...base, data: {...base.data, object: {name: '伪造预览'}}}, policy), false);
  assert.equal(isAllowedPreviewMessage({...base, data: {...base.data, object: inspected}}, policy), true);
  assert.equal(isAllowedPreviewMessage({...base, data: {...base.data, kind: 'inspect-selected', object: inspected}}, policy), true);
});
