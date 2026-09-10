import assert from 'node:assert/strict';
import test from 'node:test';
import {buildContextRecord, contextHumanView, humanLabel, projectAssets, readFacts} from '@foundation/core';
import {EVENTS} from '../helpers/project-fixture.mjs';

function factsWithAssets() {
  const facts = readFacts(EVENTS);
  return {facts, assets: projectAssets(facts)};
}

test('页面用途没有事实时明确标为尚未登记，不猜测页面职责', () => {
  const {facts, assets} = factsWithAssets();
  const record = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets, pageId: 'page_events_home', scope: 'page'});
  const view = contextHumanView(record);

  assert.match(view.identity.summary, /用途尚未登记/);
  assert.doesNotMatch(view.identity.summary, /用于承载已登记的页面操作与关系/);
});

test('资产范围只呈现资产已登记使用页面的关系，不借用当前页面关系', () => {
  const {facts, assets} = factsWithAssets();
  const statusAsset = assets.find((asset) => asset.assetId === 'component_event_status_badge');
  const record = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets, pageId: 'page_events_home', scope: 'asset', selection: {asset: statusAsset}});

  assert.ok(record.relations.some((relation) => relation.id === 'relation_detail_quick_select'));
  assert.ok(!record.relations.some((relation) => relation.id === 'relation_events_manage'));
});

test('人类展示集中翻译内部枚举，并为未知枚举保留原值', () => {
  assert.equal(humanLabel('assetType', 'component'), '组件');
  assert.equal(humanLabel('assetType', 'design-token'), '设计变量（颜色、间距等）');
  assert.equal(humanLabel('scope', 'page-local'), '页面局部资产');
  assert.equal(humanLabel('status', 'confirmed'), '已确认');
  assert.equal(humanLabel('verification', 'verified'), '已验证');
  assert.equal(humanLabel('assetType', 'alien-record'), '未知类型（alien-record）');
});

test('设计令牌成为独立资产，保留值、引用和使用位置', () => {
  const facts = structuredClone(readFacts(EVENTS));
  facts['design-tokens'] = {items: [{id: 'token_color_brand', name: '品牌主色', value: '#16803c', references: ['token_color_green'], scope: 'project', pageIds: ['page_events_home'], status: 'confirmed', verificationStatus: 'verified'}]};
  const token = projectAssets(facts).find((asset) => asset.assetId === 'token_color_brand');

  assert.equal(token?.assetType, 'design-token');
  assert.equal(token?.value, '#16803c');
  assert.deepEqual(token?.references, ['token_color_green']);
  assert.deepEqual(token?.usedByPages.map((usage) => usage.pageId), ['page_events_home']);
});

test('没有验证记录时明确归为缺失，而不是显示无待确认项', () => {
  const {facts, assets} = factsWithAssets();
  const asset = structuredClone(assets.find((item) => item.assetId === 'component_event_card'));
  asset.verificationStatus = null;
  asset.responsibility = null;
  const record = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets: [asset], pageId: 'page_events_home', scope: 'asset', selection: {asset}});
  const gaps = contextHumanView(record).sections.find((section) => section.id === 'gaps');

  assert.ok(gaps.items.some((item) => item.includes('验证状态尚未登记')));
  assert.ok(gaps.items.some((item) => item.includes('用途尚未登记')));
  assert.ok(!gaps.items.includes('尚未发现冲突、待确认或未验证项。'));
});
