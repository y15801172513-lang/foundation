import assert from 'node:assert/strict';
import test from 'node:test';
import {buildInspectorCopyPayload, buildInspectorTaskContext, enrichInspectorObject, INSPECTOR_COPY_CATEGORIES, inspectorScopeRecommendation, suggestedInspectorScope} from '../../apps/management-center/src/workspace/inspector-context.mjs';

const object = {inspectorId: 'component:component_event_action:event_action_manage', name: '管理事件', role: 'button', componentId: 'component_event_action', instanceId: 'event_action_manage', pageId: 'page_events_home', path: ['main', 'header', 'button'], ancestorIds: ['dom:main', 'dom:header'], layout: {display: 'inline-flex', width: '120px'}, style: {fontSize: '14px', color: 'rgb(1, 2, 3)'}, relatedLogic: [{id: 'relation_manage', trigger: '管理事件', condition: null, from: 'page_events_home', to: 'page_events_manage'}], usageLocations: [{pageId: 'page_events_home', instanceId: 'event_action_manage'}], gaps: ['运行绑定待验证'], factsUpdatedAt: '2026-08-29T10:00:00.000Z'};

test('自动选择的最外围内容仍按普通对象名称收敛相关逻辑', () => {
  const previewRoot = enrichInspectorObject({...object, name: 'Foundation 当前事件管理事件', role: 'div', componentId: null, instanceId: null, registeredComponent: false}, {pages: [{id: 'page_events_home', name: '当前事件'}], assets: [], relations: [{id: 'relation_enter', trigger: '返回首页', from: 'page_events_manage', to: 'page_events_home'}, {id: 'relation_leave', trigger: '管理事件', from: 'page_events_home', to: 'page_events_manage'}, {id: 'relation_other', trigger: '无关', from: 'page_other', to: 'page_else'}]});
  assert.deepEqual(previewRoot.relatedLogic.map((item) => item.id), ['relation_leave']);
});

test('检查器任务上下文按 scope 收敛，排除完整 DOM、computed style 和无关 facts', () => {
  assert.equal(suggestedInspectorScope(object, '调整所有同类按钮'), 'component asset');
  assert.equal(suggestedInspectorScope(object, '只改这里的间距'), 'instance');
  const text = buildInspectorTaskContext({project: {name: '事件项目', projectId: 'project_events'}, page: {id: 'page_events_home', name: '当前事件', preview: '/events'}, object, target: '只改这里的间距'});
  assert.match(text, /scope: instance/);
  assert.match(text, /管理事件/);
  assert.match(text, /relation_manage/);
  assert.doesNotMatch(text, /outerHTML|computedStyle|all relations|全项目 facts/i);
});

test('对象复制五类主题共享定位信封，并排除无关主题事实', () => {
  assert.deepEqual(INSPECTOR_COPY_CATEGORIES.map((item) => item.id), ['full', 'identity', 'logic', 'layout', 'impact']);
  const input = {project: {name: '事件项目', projectId: 'project_events'}, page: {id: 'page_events_home', name: '当前事件', preview: '/events'}, object};
  const payloads = Object.fromEntries(INSPECTOR_COPY_CATEGORIES.map(({id}) => [id, buildInspectorCopyPayload({...input, category: id})]));
  for (const payload of Object.values(payloads)) {
    assert.match(payload, /project stable identity: project_events/);
    assert.match(payload, /page: page_events_home; route=\/events/);
    assert.match(payload, /object stable identity: component:component_event_action:event_action_manage/);
    assert.match(payload, /required ancestor chain: dom:main > dom:header/);
    assert.match(payload, /facts version timestamp: 2026-08-29T10:00:00.000Z/);
  }
  assert.match(payloads.full, /relation_manage|inline-flex|运行绑定待验证/);
  assert.doesNotMatch(payloads.identity, /relation_manage|inline-flex|运行绑定待验证/);
  assert.doesNotMatch(payloads.logic, /fontSize|known usage/);
  assert.doesNotMatch(payloads.layout, /relation_manage|known usage/);
});

test('默认修改范围使用可行动中文建议，不暴露内部 local layout candidate', () => {
  const registered = inspectorScopeRecommendation(object);
  assert.equal(registered.label, '建议修改组件资产');
  assert.equal(registered.confidence, '高');
  const local = inspectorScopeRecommendation({role: 'section', registeredComponent: false});
  assert.equal(local.label, '建议只修改当前位置');
  assert.doesNotMatch(Object.values(local).join(' '), /local layout candidate|component asset/);
});
