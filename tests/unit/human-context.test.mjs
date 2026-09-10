import assert from 'node:assert/strict';
import test from 'node:test';
import {buildContextRecord, contextHumanView, contextPlainText, projectAssets, readFacts} from '@foundation/core';
import {EVENTS} from '../helpers/project-fixture.mjs';

function pageRecord() {
  const facts = readFacts(EVENTS);
  return buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets: projectAssets(facts), pageId: 'page_events_home', scope: 'page'});
}

test('同一 ContextRecord 稳定产生结构化中文视图与完整原始文本', () => {
  const record = pageRecord();
  const view = contextHumanView(record);
  assert.equal(view.identity.title, '当前事件');
  assert.match(view.identity.summary, /当前事件/);
  assert.ok(view.sections.some((section) => section.id === 'actions' && section.items.some((item) => item.includes('点击事件'))));
  assert.ok(view.sections.some((section) => section.id === 'technical' && section.collapsed));
  assert.equal(contextPlainText(record), contextPlainText(structuredClone(record)));
});

test('页面与组件 scope 使用各自 record，页面说明不读取无关组件选择', () => {
  const facts = readFacts(EVENTS);
  const assets = projectAssets(facts);
  const page = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets, pageId: 'page_events_home', scope: 'page'});
  const component = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets, pageId: 'page_events_home', scope: 'component', selection: {component: facts.components.items.find((item) => item.id === 'component_event_card'), instanceId: 'event_card_page_events_home_event_component_context', variant: 'current', eventId: 'event_component_context'}});
  assert.equal(contextHumanView(page).identity.title, '当前事件');
  assert.equal(contextHumanView(component).identity.title, 'EventCard');
  assert.doesNotMatch(contextHumanView(page).identity.summary, /EventCard/);
});

test('缺失、待确认、冲突和未验证项在白话视图保留为明确栏目', () => {
  const record = pageRecord();
  record.conflicts = ['字段尚未登记'];
  record.unverified = ['pending'];
  const gaps = contextHumanView(record).sections.find((section) => section.id === 'gaps');
  assert.ok(gaps.items.some((item) => item.includes('字段尚未登记')));
  assert.ok(gaps.items.some((item) => item.includes('未验证：待确认')));
});
