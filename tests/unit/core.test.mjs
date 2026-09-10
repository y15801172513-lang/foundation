import assert from 'node:assert/strict';
import test from 'node:test';
import {buildContextText, classify, readFacts, readPreviewConfig, resolveComponentSelection, stableId, validateFacts, verify} from '@foundation/core';
import {DEMO} from '../helpers/project-fixture.mjs';

test('稳定 ID、六类变化判断与 demo 校验保持确定性', () => {
  assert.equal(stableId('page', 'home'), stableId('page', 'home'));
  assert.notEqual(stableId('page', 'home'), stableId('page', 'other'));
  const cases = [
    [{changeType: 'copy_or_data'}, 'same_instance'],
    [{changeType: 'repeatable_style_or_state', samePurpose: true, sameStructure: true}, 'variant'],
    [{applyToAll: true}, 'base_update'],
    [{structuralChange: 'fundamental'}, 'new_component'],
    [{singleLocation: true, explicitSpecialHandling: true}, 'local_exception'],
    [{}, 'needs_user_decision']
  ];
  for (const [input, expected] of cases) assert.equal(classify(input).label, expected);
  assert.deepEqual(verify(DEMO), {ok: true, errors: []});
});

test('facts 类型、跨引用与 preview 路由使用同一合同', () => {
  const facts = readFacts(DEMO);
  const preview = readPreviewConfig(DEMO, {facts});
  assert.deepEqual(validateFacts(facts, {previewConfig: preview, projectRoot: DEMO}), []);
  const broken = structuredClone(facts);
  broken.relations.items[0].from = 'page_missing';
  broken.components.items[0].usageLocations[0].pageId = 'page_missing';
  const errors = validateFacts(broken, {previewConfig: preview, projectRoot: DEMO});
  assert.ok(errors.some((error) => error.includes('relations.json.items[0].from') && error.includes('page_missing')));
  assert.ok(errors.some((error) => error.includes('usageLocations[0].pageId') && error.includes('page_missing')));
});

test('复制上下文由 facts 页面、关系与组件的公开实现生成', () => {
  const facts = readFacts(DEMO);
  const pages = facts.pages.items.map((page) => ({...page, route: page.preview}));
  const button = facts.components.items.find((item) => item.id === 'component_button');
  const context = buildContextText({project: facts.foundation, pages, relations: facts.relations.items, component: button, pageId: 'page_home'});
  for (const required of ['current page: 首页', 'selected component: 基础 Button', 'usage locations:', 'outgoing relations:', 'verification status:']) assert.ok(context.includes(required));
});

test('组件选择按稳定 ID、变体和实例使用位置解析，并生成动态上下文', () => {
  const facts = readFacts(DEMO);
  const pages = facts.pages.items.map((page) => ({...page, route: page.preview}));
  const primary = resolveComponentSelection(facts.components.items, {componentId: 'component_button', instanceId: 'button_instance_home', variant: 'primary', pageId: 'page_home'});
  const secondary = resolveComponentSelection(facts.components.items, {componentId: 'component_button', instanceId: 'button_instance_detail', variant: 'secondary', pageId: 'page_detail'});
  assert.equal(primary.component.id, 'component_button');
  assert.equal(primary.variant, 'primary');
  assert.equal(secondary.component.id, 'component_button_secondary');
  assert.equal(secondary.variant, 'secondary');
  const context = buildContextText({project: facts.foundation, pages, relations: facts.relations.items, component: secondary.component, selection: secondary, pageId: 'page_detail'});
  for (const required of ['selected component: Button Secondary 变体', 'variant: secondary', 'instance id: button_instance_detail', 'current page: 详情页']) assert.ok(context.includes(required));
});
