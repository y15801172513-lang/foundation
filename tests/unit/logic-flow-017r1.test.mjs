import assert from 'node:assert/strict';
import test from 'node:test';
import {isValidPageConnection, logicFlowModel, relationPresentation} from '@foundation/management-center/workspace-projections';

const pages = [{id: 'page_a', name: 'A', preview: '/a'}, {id: 'page_b', name: 'B', preview: '/b'}, {id: 'page_c', name: 'C', preview: '/c'}];
const relations = [
  {id: 'relation_ab_one', from: 'page_a', to: 'page_b', trigger: '打开', condition: null, status: 'registered', verificationStatus: 'unverified', runtimeBinding: 'pending'},
  {id: 'relation_ab_two', from: 'page_a', to: 'page_b', trigger: '确认', condition: '有效', status: 'registered', verificationStatus: 'unverified', runtimeBinding: 'pending'},
  {id: 'relation_ba', from: 'page_b', to: 'page_a', trigger: '返回', condition: null, status: 'confirmed', verificationStatus: 'verified'},
  {id: 'relation_self', from: 'page_c', to: 'page_c', trigger: '切换实体', targetEntity: 'next', status: 'confirmed', verificationStatus: 'verified'}
];

test('逻辑画布稳定投影页面、并行边、合法环、自连和唯一 Handle', () => {
  const first = logicFlowModel({pages, relations, currentPageId: 'page_b'});
  const second = logicFlowModel({pages: [...pages].reverse(), relations: [...relations].reverse(), currentPageId: 'page_b'});
  assert.deepEqual(first.nodes.map(({id, position}) => ({id, position})), second.nodes.map(({id, position}) => ({id, position})));
  assert.deepEqual(first.edges.map((edge) => edge.id), second.edges.map((edge) => edge.id));
  assert.equal(first.nodes.length, 3);
  assert.equal(first.edges.length, 4);
  assert.ok(first.edges.find((edge) => edge.id === 'relation_self'));
  assert.equal(new Set(first.edges.map((edge) => `${edge.source}:${edge.sourceHandle}:${edge.id}`)).size, first.edges.length);
  assert.equal(new Set(first.edges.map((edge) => edge.sourceHandle)).size, first.edges.length);
  assert.equal(new Set(first.edges.map((edge) => edge.targetHandle)).size, first.edges.length);
  assert.equal(first.edges.some((edge) => edge.sourceHandle === 'new-source' || edge.targetHandle === 'new-target'), false);
  assert.equal(first.nodes.find((node) => node.id === 'page_b').data.current, true);
});

test('连接校验拒绝无效端点、重复和退化自连，允许语义多边与合法自连', () => {
  assert.equal(isValidPageConnection({connection: {source: null, target: 'page_b'}, pages, relations}), false);
  assert.equal(isValidPageConnection({connection: {source: 'page_a', target: 'missing'}, pages, relations}), false);
  assert.equal(isValidPageConnection({connection: {source: 'page_a', target: 'page_b'}, pages, relations, draft: {trigger: '打开', condition: null}}), false);
  assert.equal(isValidPageConnection({connection: {source: 'page_a', target: 'page_b'}, pages, relations, draft: {trigger: '另一个动作'}}), true);
  assert.equal(isValidPageConnection({connection: {source: 'page_c', target: 'page_c'}, pages, relations, draft: {trigger: '切换'}}), false);
  assert.equal(isValidPageConnection({connection: {source: 'page_c', target: 'page_c'}, pages, relations, draft: {trigger: '切换', targetState: 'archived'}}), true);
});

test('关系生命周期与运行绑定分别展示，不把登记冒充运行跳转', () => {
  assert.deepEqual(relationPresentation(relations[0]), {lifecycle: 'registered', lifecycleLabel: '关系已登记', runtimeBinding: 'pending', runtimeLabel: '触发器待绑定'});
  assert.equal(relationPresentation(relations[2]).lifecycle, 'verified');
  assert.equal(relationPresentation(relations[2]).runtimeBinding, 'unbound');
});
