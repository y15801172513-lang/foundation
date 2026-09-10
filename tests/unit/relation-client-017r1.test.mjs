import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPageRelations, recoverPageRelationConflict, RelationRequestError, savePageRelation, saveRelationWithRollback} from '@foundation/management-center/relation-client';

test('关系客户端携带 nonce 与版本并透传服务端真实错误', async () => {
  let request;
  const payload = {relation: {id: 'relation_new'}, version: 'next'};
  const result = await savePageRelation({draft: {from: 'page_a', to: 'page_b'}, version: 'before', nonce: 'nonce', fetchImpl: async (url, options) => { request = {url, options}; return {ok: true, status: 201, json: async () => payload}; }});
  assert.deepEqual(result, payload);
  assert.equal(request.options.headers['x-foundation-write-nonce'], 'nonce');
  assert.equal(JSON.parse(request.options.body).expectedVersion, 'before');
  await assert.rejects(() => savePageRelation({draft: {}, nonce: 'nonce', fetchImpl: async () => ({ok: false, status: 409, json: async () => ({error: '关系事实已更新，请刷新后重试', code: 'version_conflict', currentVersion: 'current', refreshUrl: '/__foundation/relations/current'})})}), (error) => error instanceof RelationRequestError && error.status === 409 && error.currentVersion === 'current' && error.refreshUrl === '/__foundation/relations/current');
});

test('026: 关系客户端只打开 exact manager，不把 pending plan 伪装成已保存事实', async () => {
  let opened = null;
  const pending = await savePageRelation({
    draft: {from: 'a', to: 'b'},
    nonce: 'nonce',
    openManager: (url) => { opened = url; },
    fetchImpl: async () => ({ok: true, status: 202, json: async () => ({ok: true, state: 'pending-manager-confirmation', managerUrl: 'http://127.0.0.1:43210/', sessionId: 'manager-session-00000000-0000-0000-0000-000000000000', planHash: 'a'.repeat(64)})}),
  });
  assert.equal(opened, 'http://127.0.0.1:43210/');
  assert.equal(pending.state, 'pending-manager-confirmation');
  assert.equal('relation' in pending, false);
});

test('关系客户端按 409 指引刷新最新事实，并区分刷新失败', async () => {
  let requested = null;
  const current = await loadPageRelations({refreshUrl: '/__foundation/relations/current', fetchImpl: async (url) => { requested = url; return {ok: true, status: 200, json: async () => ({relations: [{id: 'relation_current'}], version: 'current'})}; }});
  assert.equal(requested, '/__foundation/relations/current');
  assert.deepEqual(current, {relations: [{id: 'relation_current'}], version: 'current'});
  await assert.rejects(() => loadPageRelations({fetchImpl: async () => ({ok: false, status: 503, json: async () => ({error: '读取失败'})})}), (error) => error instanceof RelationRequestError && error.status === 503 && /读取失败/.test(error.message));
});

test('409 恢复刷新画布但保留用户草稿，重试版本来自最新关系事实', async () => {
  const draft = {from: 'page_a', to: 'page_b', trigger: '用户仍在编辑的触发器'};
  const conflict = new RelationRequestError('版本冲突', {status: 409, code: 'version_conflict', currentVersion: 'server-current', refreshUrl: '/current'});
  let refreshed = null;
  const recovery = await recoverPageRelationConflict({error: conflict, draft}, {load: async ({refreshUrl}) => {
    assert.equal(refreshUrl, '/current');
    return {relations: [{id: 'latest'}], version: 'latest-version'};
  }, onRefresh: (latest) => { refreshed = latest; }});
  assert.deepEqual(recovery, {draft, retryVersion: 'latest-version', relations: [{id: 'latest'}]});
  assert.deepEqual(refreshed, {relations: [{id: 'latest'}], version: 'latest-version'});
  await assert.rejects(() => recoverPageRelationConflict({error: new Error('普通失败'), draft}), /普通失败/);
});

test('optimistic 关系保存失败必定回滚，成功才提交服务端响应', async () => {
  let rollbacks = 0; let commits = 0;
  await assert.rejects(() => saveRelationWithRollback({draft: {}}, {save: async () => { throw new Error('服务端拒绝'); }, onRollback: () => { rollbacks += 1; }, onCommit: () => { commits += 1; }}), /服务端拒绝/);
  assert.deepEqual({rollbacks, commits}, {rollbacks: 1, commits: 0});
  const payload = await saveRelationWithRollback({draft: {}}, {save: async () => ({relation: {id: 'saved'}, version: 'next'}), onRollback: () => { rollbacks += 1; }, onCommit: () => { commits += 1; }});
  assert.equal(payload.relation.id, 'saved');
  assert.deepEqual({rollbacks, commits}, {rollbacks: 1, commits: 1});
});
