import {useEffect, useMemo, useState} from 'react';
import {humanLabel} from '@foundation/core/human-labels';
import {CodeText, ContentDescription, MetadataText, PageTitle, PanelTitle, SectionTitle} from '@/components/foundation/content-roles';
import {Button} from '@/components/ui/button';
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '@/components/ui/empty';
import {Field, FieldDescription, FieldLabel} from '@/components/ui/field';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {ContextDataView} from '@/features/context-panel/context-data-view';
import {filterAssets} from './workspace-projections.mjs';
import {AssetPreview} from './asset-preview';
import {assetFilterPlan, changeAssetFilters, comparableAssetFields, EMPTY_ASSET_FILTERS, normalizeAssetFilters, publicAssets, visibleAssetSelection} from './asset-display.mjs';

function FilterSelect({label, description, value, items, onValueChange}) {
  return <Field className="filter-field"><FieldLabel>{label}</FieldLabel><Select items={items} value={value} onValueChange={onValueChange}><SelectTrigger aria-label={label}><SelectValue>{items.find((item) => item.value === value)?.label}</SelectValue></SelectTrigger><SelectContent align="start" side="bottom" sideOffset={6} alignItemWithTrigger={false}><SelectGroup>{items.map((item) => <SelectItem key={item.value} value={item.value} disabled={item.disabled}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>{description ? <FieldDescription>{description}</FieldDescription> : null}</Field>;
}

function AssetMeta({asset}) {
  const fields = comparableAssetFields(asset);
  return <><MetadataText>{humanLabel('assetType', asset.assetType)}</MetadataText>{fields.length ? <MetadataText as="small">{fields.map((item) => `${item.label}：${item.value}`).join(' · ')}</MetadataText> : null}</>;
}

function AssetTechnicalInformation({asset, factsVersion}) {
  return <section className="asset-technical" aria-labelledby="asset-technical-title"><SectionTitle id="asset-technical-title">技术信息</SectionTitle><dl><div><dt>稳定 ID</dt><dd><CodeText>{asset.assetId}</CodeText></dd></div><div><dt>实现路径</dt><dd><CodeText>{asset.implementationPath || '尚未登记'}</CodeText></dd></div><div><dt>facts 版本</dt><dd>{factsVersion || '尚未登记'}</dd></div><div><dt>验证状态</dt><dd>{humanLabel('verification', asset.verificationStatus)}</dd></div></dl></section>;
}

const sameFilters = (left, right) => ['type', 'status', 'verification', 'pageId'].every((field) => left[field] === right[field]);

export function AssetManagementWorkspace({model, selectedAsset, assetRecord, assetRawText, onSelectAsset, onCopyAsset}) {
  const [filters, setFilters] = useState(EMPTY_ASSET_FILTERS);
  const plan = useMemo(() => assetFilterPlan(model.assets || [], filters.type), [model.assets, filters.type]);
  const planSignature = `${plan.type}|${plan.activeFilters.join(',')}|${Object.entries(plan.options).map(([key, values]) => `${key}:${values.join(',')}`).join('|')}`;
  useEffect(() => setFilters((current) => { const next = normalizeAssetFilters(current, plan); return sameFilters(current, next) ? current : next; }), [planSignature]);
  const exposedAssets = useMemo(() => publicAssets(model.assets || []), [model.assets]);
  const visibleAssets = useMemo(() => filterAssets(exposedAssets, {type: filters.type === 'all' ? null : filters.type, status: filters.status === 'all' ? null : filters.status, verification: filters.verification === 'all' ? null : filters.verification, pageId: filters.pageId === 'all' ? null : filters.pageId}), [exposedAssets, filters]);
  const visibleSelected = visibleAssetSelection(selectedAsset, visibleAssets);
  const childItems = (field, allLabel, labelKind) => [{value: 'all', label: allLabel}, ...(plan.options[field] || []).map((value) => ({value, label: field === 'pageId' ? model.pages.find((page) => page.id === value)?.name || value : humanLabel(labelKind, value)}))];
  const setFilter = (field) => (value) => setFilters((current) => changeAssetFilters(current, {field, value}, field === 'type' ? null : plan));
  const resetFilters = () => setFilters(EMPTY_ASSET_FILTERS);
  const hasFilters = !sameFilters(filters, EMPTY_ASSET_FILTERS);
  return <main className="work-mode-shell asset-management-workspace"><aside className="asset-list-pane"><header><PageTitle>资产管理</PageTitle><ContentDescription>{model.governance?.label || '只读投影'}</ContentDescription></header><div className="asset-filters"><FilterSelect label="资产类型" description="交互逻辑保留在事实与逻辑工作区；未登记类型会显示数量与原因，但不可选择。" value={filters.type} items={plan.typeOptions} onValueChange={setFilter('type')} />{plan.activeFilters.includes('status') ? <FilterSelect label="资产状态" value={filters.status} items={childItems('status', '全部资产状态', 'status')} onValueChange={setFilter('status')} /> : null}{plan.activeFilters.includes('pageId') ? <FilterSelect label="使用页面" value={filters.pageId} items={childItems('pageId', '全部使用页面')} onValueChange={setFilter('pageId')} /> : null}{plan.activeFilters.includes('verification') ? <FilterSelect label="验证状态" value={filters.verification} items={childItems('verification', '全部验证状态', 'verification')} onValueChange={setFilter('verification')} /> : null}</div>{hasFilters ? <Button size="sm" variant="outline" className="asset-filter-reset" onClick={resetFilters}>重置筛选</Button> : null}<MetadataText as="p" className="asset-result-count">当前显示 {visibleAssets.length} / {exposedAssets.length} 项</MetadataText>{visibleAssets.length ? <ul className="asset-list">{visibleAssets.map((asset) => <li key={asset.assetId}><Button variant={selectedAsset?.assetId === asset.assetId ? 'secondary' : 'ghost'} onClick={() => onSelectAsset(asset.assetId)}><strong>{asset.name}</strong><AssetMeta asset={asset} /></Button></li>)}</ul> : <Empty><EmptyHeader><EmptyTitle>没有符合条件的资产</EmptyTitle><EmptyDescription>当前组合没有结果；重置筛选可恢复完整清单。</EmptyDescription>{hasFilters ? <Button size="sm" variant="outline" onClick={resetFilters}>重置筛选</Button> : null}</EmptyHeader></Empty>}</aside><section className="asset-detail-pane">{visibleSelected ? <><header className="mode-heading"><div><PanelTitle>{visibleSelected.name}</PanelTitle><ContentDescription>{humanLabel('assetType', visibleSelected.assetType)} · {visibleSelected.reuseDecision || '尚未登记复用判断'}</ContentDescription></div></header><AssetPreview asset={visibleSelected} /><ContextDataView record={assetRecord} rawText={assetRawText} onCopy={onCopyAsset} scopeLabel="资产详情" excludeSectionIds={['technical']} tabsVariant="default" /><AssetTechnicalInformation asset={visibleSelected} factsVersion={assetRecord?.factsVersion || model.project?.dataFormatVersion} /></> : selectedAsset?.assetType === 'interaction' ? <Empty><EmptyHeader><EmptyTitle>交互逻辑暂不作为独立资产展示</EmptyTitle><EmptyDescription>该事实仍完整保留，请在逻辑搭建和页面关系中查看；R1 不把单条交互包装成完整项目逻辑模型。</EmptyDescription></EmptyHeader></Empty> : selectedAsset ? <Empty><EmptyHeader><EmptyTitle>当前筛选不包含所选资产</EmptyTitle><EmptyDescription>详情已暂停，避免显示与清单不一致的旧选择；重置筛选后会恢复同一稳定资产。</EmptyDescription>{hasFilters ? <Button size="sm" variant="outline" onClick={resetFilters}>重置筛选</Button> : null}</EmptyHeader></Empty> : <Empty><EmptyHeader><EmptyTitle>选择一个资产</EmptyTitle><EmptyDescription>从左侧清单选择资产后查看真实预览、白话说明、原始数据和技术信息。</EmptyDescription></EmptyHeader></Empty>}</section></main>;
}
