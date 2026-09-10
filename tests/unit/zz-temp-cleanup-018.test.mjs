import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {makeTempDirectory, removeTempDirectory, ROOT} from '../helpers/project-fixture.mjs';

test('关系和 018 fixture 通过 after/finally 清理，不触碰既有 .tmp 资产', () => {
  const temporaryRoot = path.join(ROOT, '.tmp');
  const leaked = fs.existsSync(temporaryRoot) ? fs.readdirSync(temporaryRoot, {withFileTypes: true}).filter((entry) => entry.isDirectory() && /^(?:relation-017|relation-018|relation-http|asset-018)/u.test(entry.name)).map((entry) => entry.name).sort() : [];
  assert.deepEqual(leaked, []);
});

test('fixture 清理器只清理 .tmp 内明确目录并拒绝越界路径', () => {
  const temporary = makeTempDirectory('asset-018-cleanup-contract-');
  removeTempDirectory(temporary);
  assert.equal(fs.existsSync(temporary), false);
  assert.throws(() => removeTempDirectory(ROOT), /拒绝清理 \.tmp 外路径/u);
});
