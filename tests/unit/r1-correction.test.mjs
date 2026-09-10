import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {assetDisplayRecord} from '@foundation/management-center/asset-display';
import {createProject} from '@foundation/cli';
import {buildContextRecord, contextPlainText, eventStatusInstanceId, inventoryExistingProject, projectAssets, readFacts, validateFacts} from '@foundation/core';
import {EVENTS, makeTempDirectory, removeTempDirectory} from '../helpers/project-fixture.mjs';
import {componentSelectionMessage} from '../../examples/foundation-events/src/bridge.mjs';

function eventFacts() { return readFacts(EVENTS); }

function treeSha(root) {
  const files = fs.readdirSync(root, {recursive: true, withFileTypes: true}).filter((entry) => entry.isFile()).map((entry) => path.relative(root, path.join(entry.parentPath, entry.name))).sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  return hash.digest('hex');
}

test('不存在的实现路径被拒绝并指出事实、资产和字段', () => {
  const facts = eventFacts();
  facts.components.items[0].implementationMapping = 'src/components/not-found.jsx';
  const errors = validateFacts(facts, {projectRoot: EVENTS});
  assert.ok(errors.some((error) => error.includes('components.json 资产 component_event_card 字段 implementationMapping') && error.includes('不存在')));
});

test('实现路径绝对路径与路径穿越都被拒绝', () => {
  for (const invalid of ['/tmp/outside.jsx', '../outside.jsx']) {
    const facts = eventFacts();
    facts.components.items[0].implementationMapping = invalid;
    const errors = validateFacts(facts, {projectRoot: EVENTS});
    assert.ok(errors.some((error) => error.includes('component_event_card') && error.includes('项目内相对文件路径')), invalid);
  }
});

test('实现路径通过符号链接逃逸被拒绝', (t) => {
  const parent = makeTempDirectory('r1-014a-symlink-');
  t.after(() => removeTempDirectory(parent));
  const project = path.join(parent, 'project');
  fs.cpSync(EVENTS, project, {recursive: true});
  const outside = path.join(parent, 'outside.jsx');
  fs.writeFileSync(outside, 'export default null;');
  try { fs.symlinkSync(outside, path.join(project, 'escape.jsx')); } catch (error) { if (error.code === 'EPERM') return t.skip('当前 Windows 权限不允许创建符号链接'); throw error; }
  const facts = readFacts(project);
  facts.components.items[0].implementationMapping = 'escape.jsx';
  assert.ok(validateFacts(facts, {projectRoot: project}).some((error) => error.includes('符号链接逃出项目根目录')));
});

test('未登记 dependencies、composes 与 usedByComponents 被拒绝', () => {
  const facts = eventFacts();
  Object.assign(facts.components.items[0], {dependencies: ['asset_missing'], composes: ['component_missing'], usedByComponents: ['component_absent']});
  const errors = validateFacts(facts, {projectRoot: EVENTS});
  for (const field of ['dependencies', 'composes', 'usedByComponents']) assert.ok(errors.some((error) => error.includes(`字段 ${field}`)), field);
});

test('Figma 与 change 中的无效资产引用被拒绝', () => {
  const facts = eventFacts();
  facts.figma.items[0].assetId = 'component_missing';
  facts.changes.items[0].affectedAssets.push('figma_r1_event_card');
  const errors = validateFacts(facts, {projectRoot: EVENTS});
  assert.ok(errors.some((error) => error.includes('figma.json') && error.includes('component_missing')));
  assert.ok(errors.some((error) => error.includes('changes.json') && error.includes('figma_r1_event_card')));
});

test('跨组件重复 instanceId 被拒绝', () => {
  const facts = eventFacts();
  facts.components.items[1].usageLocations[0].instanceId = facts.components.items[0].usageLocations[0].instanceId;
  const errors = validateFacts(facts, {projectRoot: EVENTS});
  assert.ok(errors.some((error) => error.includes('跨组件重复') && error.includes('component_event_card_featured')));
});

test('同页同状态的两个事件产生不同 EventStatus 身份', () => {
  const first = eventStatusInstanceId('page_event_detail', 'event_alpha', 'current');
  const second = eventStatusInstanceId('page_event_detail', 'event_beta', 'current');
  assert.notEqual(first, second);
  assert.equal(first, 'event_status_page_event_detail_event_alpha_current');
});

test('组件 bridge 消息保留事件身份与真实运行状态', () => {
  const message = componentSelectionMessage({componentId: 'component_event_status_badge', instanceId: eventStatusInstanceId('page_event_detail', 'event_alpha', 'current'), variant: 'current', eventId: 'event_alpha', eventState: 'current', pageId: 'page_event_detail'});
  assert.equal(message.eventId, 'event_alpha');
  assert.equal(message.eventState, 'current');
  assert.equal(message.pageId, 'page_event_detail');
});

test('页面 ContextRecord 输出真实影响页面且不含 Figma 映射 ID', () => {
  const facts = eventFacts();
  const record = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets: projectAssets(facts), pageId: 'page_events_home', scope: 'page'});
  assert.ok(record.impactPages.includes('page_events_home'));
  assert.ok(record.impactPages.includes('page_events_manage'));
  assert.ok(!record.impactComponents.some((id) => id.startsWith('figma_')));
  assert.match(contextPlainText(record), /impact pages: .*page_events_home/);
});

test('组件 ContextRecord 输出组件与使用页面影响', () => {
  const facts = eventFacts();
  const component = facts.components.items.find((item) => item.id === 'component_event_card');
  const record = buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets: projectAssets(facts), selection: {component, instanceId: 'event_card_page_events_home_event_component_context', eventId: 'event_component_context', variant: 'current'}, pageId: 'page_events_home', scope: 'component'});
  assert.ok(record.impactComponents.includes('component_event_card'));
  assert.ok(record.impactPages.includes('page_events_home'));
  assert.ok(record.impactPages.includes('page_events_manage'));
});

test('相同 facts 独立生成两次复制原文完全一致', () => {
  const generate = () => { const facts = eventFacts(); return contextPlainText(buildContextRecord({project: facts.foundation, pages: facts.pages.items, relations: facts.relations.items, assets: projectAssets(facts), pageId: 'page_events_home', scope: 'page'})); };
  assert.equal(generate(), generate());
});

test('已有项目首次盘点返回五类结果且文件 SHA 完全不变', (t) => {
  const temporary = makeTempDirectory('r1-014a-inventory-');
  t.after(() => removeTempDirectory(temporary));
  const project = path.join(temporary, 'existing');
  fs.mkdirSync(path.join(project, 'src/components'), {recursive: true});
  fs.writeFileSync(path.join(project, 'src/index.jsx'), 'import {Card} from "./components/Card"; export const App=()=> <Card onClick={()=>{}} />;');
  fs.writeFileSync(path.join(project, 'src/components/Card.jsx'), 'export const Card=()=> <button onClick={()=>{}}>Card</button>;');
  fs.writeFileSync(path.join(project, 'src/components/Card.css'), '@keyframes enter{from{opacity:0}to{opacity:1}} .card{animation:enter .1s}');
  const before = treeSha(project);
  const result = inventoryExistingProject(project);
  const after = treeSha(project);
  assert.equal(result.governanceMode, 'preserve-and-inventory');
  assert.ok(result.pages.length > 0 && result.components.length > 0 && result.interactions.length > 0 && result.motions.length > 0);
  assert.ok(result.duplicateCandidates.length > 0);
  assert.deepEqual(result.migration, {authorized: false, performed: false});
  assert.equal(after, before);
});

test('新项目 create 不再允许一步写入，必须先绑定 installation 生成 plan', (t) => {
  const temporary = makeTempDirectory('r1-014a-create-');
  t.after(() => removeTempDirectory(temporary));
  const target = path.join(temporary, 'new-project');
  assert.throws(() => createProject(target), (error) => error.code === 'INSTALLATION_ROOT_REQUIRED');
  assert.equal(fs.existsSync(target), false);
});

test('资产管理消费真实 implementationPath 与 usedByPages', () => {
  const facts = eventFacts();
  const asset = projectAssets(facts).find((item) => item.assetId === 'component_event_card');
  const display = assetDisplayRecord(asset);
  assert.equal(display.implementationPath, 'src/components/event-card.jsx');
  assert.deepEqual(display.usedByPages.map((usage) => usage.pageId), ['page_events_home', 'page_events_manage']);
  assert.match(display.usageLabel, /当前事件/);
  assert.match(display.usageLabel, /事件管理/);
});
