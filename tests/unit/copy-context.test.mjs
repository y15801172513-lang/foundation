import assert from 'node:assert/strict';
import test from 'node:test';
import {copyContextPlainText} from '@foundation/management-center/copy-context';

test('复制给 Codex 仅在真实 clipboard Promise 成功后返回成功', async () => {
  const copied = [];
  const rawText = 'scope: page\npage: page_events_home';
  const result = await copyContextPlainText({writeText: async (value) => copied.push(value)}, rawText);
  assert.deepEqual(copied, [rawText]);
  assert.deepEqual(result, {ok: true, message: '已复制给 Codex'});
});

test('clipboard 拒绝时返回可操作错误而不伪报成功', async () => {
  const result = await copyContextPlainText({writeText: async () => { throw new Error('denied'); }}, 'raw');
  assert.deepEqual(result, {ok: false, message: '复制失败，请选中原始数据后手动复制。'});
});
