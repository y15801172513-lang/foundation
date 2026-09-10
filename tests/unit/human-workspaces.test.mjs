import assert from 'node:assert/strict';
import test from 'node:test';
import {projectAssets, readFacts} from '@foundation/core';
import {filterAssets, informationLogicModel, previewSidebarModel} from '@foundation/management-center/workspace-projections';
import {createWorkspaceState, transitionWorkspace} from '@foundation/management-center/state';
import {EVENTS} from '../helpers/project-fixture.mjs';

test('information_logic 以当前页面为中心输出进入、去向、触发和条件', () => {
  const facts = readFacts(EVENTS);
  const model = informationLogicModel({pages: facts.pages.items, relations: facts.relations.items, assets: projectAssets(facts), pageId: 'page_events_home'});
  assert.equal(model.page.name, '当前事件');
  assert.equal(model.incoming.length, 1);
  assert.equal(model.outgoing.length, 2);
  assert.ok(model.outgoing.some((relation) => relation.trigger === '点击事件' && relation.condition === '当前事件'));
  assert.ok(model.assets.some((asset) => asset.assetId === 'component_event_card'));
});

test('资产筛选、选择和使用位置保持同一稳定资产身份', () => {
  const facts = readFacts(EVENTS);
  const assets = projectAssets(facts);
  const components = filterAssets(assets, {type: 'component'});
  assert.equal(components.length, assets.filter((asset) => asset.assetType === 'component').length);
  const homeAssets = filterAssets(assets, {pageId: 'page_events_home'});
  assert.ok(homeAssets.some((asset) => asset.assetId === 'component_event_card'));
  assert.ok(filterAssets(assets, {verification: 'verified'}).every((asset) => asset.verificationStatus === 'verified'));
  assert.ok(filterAssets(assets, {status: 'confirmed'}).every((asset) => asset.status === 'confirmed'));
});

test('信息与逻辑把验证枚举翻译为人类标签', () => {
  const facts = readFacts(EVENTS);
  const assets = projectAssets(facts).map((asset) => asset.assetId === 'component_event_card' ? {...asset, verificationStatus: 'unverified'} : asset);
  const model = informationLogicModel({pages: facts.pages.items, relations: facts.relations.items, assets, pageId: 'page_events_home'});
  assert.ok(model.gaps.includes('EventCard：未验证'));
  assert.ok(!model.gaps.some((gap) => gap.includes('unverified')));
});

test('逻辑搭建是正式 buildingMode，不再保留双写 mode', () => {
  const next = transitionWorkspace(createWorkspaceState(), {type: 'set-building-mode', mode: 'logic'});
  assert.equal(next.buildingMode, 'logic');
  assert.equal(next.workspaceArea, 'building');
  assert.equal('workMode' in next, false);
});

test('资产选择跨模式保持稳定 ID，页面组件选择同步到同一资产', () => {
  const selected = transitionWorkspace(createWorkspaceState(), {type: 'set-asset', assetId: 'component_event_card'});
  const information = transitionWorkspace(selected, {type: 'set-building-mode', mode: 'logic'});
  const component = transitionWorkspace(information, {type: 'set-component', componentId: 'component_event_status_badge', pageId: 'page_event_detail'});
  assert.equal(information.assetId, 'component_event_card');
  assert.equal(component.assetId, 'component_event_status_badge');
});

test('预览侧栏连续投影页面关系、真实逻辑和缺口，不生成猜测', () => {
  const facts = readFacts(EVENTS);
  const view = previewSidebarModel({pages: facts.pages.items, relations: facts.relations.items, interactions: facts.interactions.items, pageId: 'page_events_home'});
  assert.equal(view.page.id, 'page_events_home');
  assert.ok(view.incoming.every((item) => item.to === 'page_events_home'));
  assert.ok(view.outgoing.some((item) => item.trigger === '点击事件' && item.condition === '当前事件'));
  assert.ok(view.stateChanges.some((item) => item.id === 'interaction_event_state'));
  assert.deepEqual(view.gaps, []);
  const missing = previewSidebarModel({pages: [{id: 'page_unknown', name: '未知页', entry: true}], relations: [], interactions: [], pageId: 'page_unknown'});
  assert.ok(missing.gaps.some((gap) => gap.includes('页面 未知页 尚未验证') && gap.includes('下一步')));
});

test('页面任务缺口覆盖关系、交互和相关资产的未验证、待确认与冲突', () => {
  const pages = [{id: 'page_home', name: '首页', entry: true, verificationStatus: 'verified'}];
  const relations = [{id: 'relation_loop', from: 'page_home', to: 'page_home', verificationStatus: 'unverified', pending: ['绑定触发器']}];
  const interactions = [{id: 'interaction_state', name: '状态变化', pageIds: ['page_home'], verificationStatus: 'pending', conflicts: ['状态来源不一致']}];
  const assets = [{assetId: 'component_card', name: '卡片', usedByPages: [{pageId: 'page_home'}], verificationStatus: 'verified', missing: ['空态示例']}];
  const view = previewSidebarModel({pages, relations, interactions, assets, pageId: 'page_home'});
  assert.ok(view.gaps.some((gap) => gap.includes('关系 relation_loop 尚未验证')));
  assert.ok(view.gaps.some((gap) => gap.includes('关系 relation_loop 待确认：绑定触发器') && gap.includes('下一步')));
  assert.ok(view.gaps.some((gap) => gap.includes('交互 状态变化 冲突：状态来源不一致')));
  assert.ok(view.gaps.some((gap) => gap.includes('资产 卡片 缺少：空态示例')));
});
