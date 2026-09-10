import assert from 'node:assert/strict';
import test from 'node:test';
import {ASSET_TYPE_CAPABILITIES, assetFilterPlan, assetPreviewContract, changeAssetFilters, comparableAssetFields, publicAssets, visibleAssetSelection} from '@foundation/management-center/asset-display';

const assets = [
  {assetId: 'component_a', assetType: 'component', name: 'A', status: 'confirmed', verificationStatus: 'verified', implementationPath: 'src/a.jsx', usedByPages: [{pageId: 'page_a'}], responsibility: '主卡片', variant: 'default'},
  {assetId: 'component_b', assetType: 'component', name: 'B', status: 'pending', verificationStatus: 'verified', implementationPath: null, usedByPages: [{pageId: 'page_b'}], responsibility: '次卡片', variant: 'compact'},
  {assetId: 'page_a', assetType: 'page', name: '页面 A', status: 'confirmed', verificationStatus: 'verified', implementationPath: 'src/main.jsx', usedByPages: [{pageId: 'page_a'}]},
  {assetId: 'interaction_a', assetType: 'interaction', name: '不独立展示', status: 'confirmed', verificationStatus: 'verified', usedByPages: [{pageId: 'page_a'}]}
];

test('资产类型能力矩阵暂缓 interaction，并只启用能区分当前类型记录的子筛选', () => {
  assert.deepEqual(Object.keys(ASSET_TYPE_CAPABILITIES), ['all', 'page', 'component', 'motion', 'design-token']);
  assert.deepEqual(publicAssets(assets).map((asset) => asset.assetId), ['component_a', 'component_b', 'page_a']);
  const componentPlan = assetFilterPlan(assets, 'component');
  assert.deepEqual(componentPlan.activeFilters, ['status', 'pageId']);
  assert.deepEqual(componentPlan.options.status, ['confirmed', 'pending']);
  assert.deepEqual(componentPlan.options.pageId, ['page_a', 'page_b']);
  assert.equal(componentPlan.options.verification, undefined);
  assert.equal(componentPlan.typeOptions.find((item) => item.value === 'design-token').disabled, true);
  for (const type of ['all', 'page', 'component', 'motion', 'design-token']) {
    const plan = assetFilterPlan(assets, type);
    assert.ok(plan.activeFilters.every((field) => ASSET_TYPE_CAPABILITIES[type].filters.includes(field)));
  }
});

test('父类型变化立即清除所有子筛选，隐藏筛选不能继续过滤', () => {
  const current = {type: 'component', status: 'pending', verification: 'unverified', pageId: 'page_b'};
  assert.deepEqual(changeAssetFilters(current, {field: 'type', value: 'page'}), {type: 'page', status: 'all', verification: 'all', pageId: 'all'});
  const normalized = changeAssetFilters(current, {field: 'status', value: 'confirmed'}, assetFilterPlan(assets, 'component'));
  assert.deepEqual(normalized, {type: 'component', status: 'confirmed', verification: 'all', pageId: 'page_b'});
});

test('筛选外的选择暂停详情且恢复结果后复用同一稳定身份', () => {
  const selected = assets[0];
  assert.equal(visibleAssetSelection(selected, [assets[1]]), null);
  assert.equal(visibleAssetSelection(selected, publicAssets(assets)), selected);
});

test('列表比较字段由类型能力驱动，不拼接通用治理字段', () => {
  const fields = comparableAssetFields(assets[0]);
  assert.deepEqual(fields.map((item) => item.key), ['responsibility', 'variant']);
  assert.ok(fields.every((item) => !/confirmed|verified/u.test(item.value)));
});

test('真实资产预览合同区分 iframe、缺少上下文与不支持类型', () => {
  assert.deepEqual(assetPreviewContract(assets[0]), {status: 'iframe', route: '/events'});
  assert.equal(assetPreviewContract(assets[1]).status, 'missing-context');
  assert.equal(assetPreviewContract(assets[2]).status, 'unsupported');
});
