import assert from 'node:assert/strict';
import test from 'node:test';
import {addEvent, changeEventStatus, cloneInitialEvents, currentReturnTarget, detailTarget, eventReturnTarget, sanitizeReturnTarget} from '../../examples/foundation-events/src/event-state.mjs';

test('事件状态机保持唯一重要当前事件，并支持归档、删除、恢复和新增', () => {
  const initial = cloneInitialEvents();
  assert.equal(initial.filter((event) => event.status === 'current' && event.important).length, 1);
  const archived = changeEventStatus(initial, 'event_010_complete', 'archived');
  assert.equal(archived.find((event) => event.id === 'event_010_complete').status, 'archived');
  assert.equal(archived.filter((event) => event.status === 'current' && event.important).length, 1);
  const deleted = changeEventStatus(archived, 'event_component_context', 'deleted');
  assert.equal(deleted.find((event) => event.id === 'event_component_context').status, 'deleted');
  const restored = changeEventStatus(deleted, 'event_install_pending', 'current');
  assert.equal(restored.find((event) => event.id === 'event_install_pending').status, 'current');
  assert.equal(restored.filter((event) => event.status === 'current' && event.important).length, 1);
  const added = addEvent(restored, {title: 'Local event', summary: '真实本地状态'});
  assert.equal(added[0].status, 'current');
  assert.equal(added.filter((event) => event.status === 'current' && event.important).length, 1);
});

test('详情返回来源只接受项目内白名单，并保留管理标签', () => {
  assert.equal(sanitizeReturnTarget('/events/manage?tab=archived'), '/events/manage?tab=archived');
  assert.equal(sanitizeReturnTarget('https://evil.invalid'), '/events');
  assert.equal(eventReturnTarget({from: 'manage', tab: 'deleted'}), '/events/manage?tab=deleted');
  assert.equal(eventReturnTarget({from: 'manage', tab: 'unknown'}), '/events/manage?tab=current');
  assert.equal(eventReturnTarget({from: 'outside', tab: 'archived'}), '/events');
});

test('任意详情层级继承最初进入页作为唯一返回锚点', () => {
  const origin = currentReturnTarget({pathname: '/events/manage', tab: 'archived'});
  const firstDetail = detailTarget('event_install_pending', origin);
  const firstUrl = new URL(firstDetail, 'http://foundation.local');
  const nestedOrigin = currentReturnTarget({pathname: '/events/detail', returnTo: firstUrl.searchParams.get('returnTo')});
  const nestedDetail = detailTarget('event_assets_figma_later', nestedOrigin);
  const nestedUrl = new URL(nestedDetail, 'http://foundation.local');
  assert.equal(nestedUrl.searchParams.get('returnTo'), '/events/manage?tab=archived');
  assert.equal(eventReturnTarget({returnTo: nestedUrl.searchParams.get('returnTo')}), '/events/manage?tab=archived');
  assert.equal(eventReturnTarget({returnTo: 'https://evil.invalid'}), '/events');
});
