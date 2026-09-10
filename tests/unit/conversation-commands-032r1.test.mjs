import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {conversationCommands, conversationHelp} from '../../packages/core/conversation-commands.mjs';
import {parseCliInvocation} from '../../packages/cli/command-contract.mjs';
import {createInstalledWorkbenchServer} from '../../apps/management-center/src/server/center-server.mjs';

test('032R1 one catalog, six conversation-only intents, help independent of installation', () => {
  assert.deepEqual(conversationCommands.map(c=>c.id), ['help','open','status','update','connect','uninstall']);
  assert.equal(new Set(conversationCommands.map(c=>c.alias)).size,6);
  for(const c of conversationCommands) for(const key of ['chinese','alias','purpose','prerequisite','confirmation','route']) assert.ok(c[key]);
  assert.match(conversationHelp(),/不是终端 fd/);
  assert.equal(conversationCommands.find(c=>c.id==='open').route,'workbench open --root');
  assert.deepEqual(parseCliInvocation(['workbench','open','--root','/isolated/安装']).route,['workbench','open']);
  assert.throws(()=>parseCliInvocation(['fd','open']));
  execFileSync(process.execPath,['scripts/sync-conversation-help.mjs'],{cwd:new URL('../../',import.meta.url)});
});

test('032R1 static guidance covers semantic corpus and zero-action boundaries (not host semantics evidence)', () => {
  const skill=fs.readFileSync(new URL('../../skills/ai-product-foundation-kit/SKILL.md',import.meta.url),'utf8');
  for(const text of ['给我foundation指令list','Foundation 有哪些命令','Foundation 怎么用','Foundation 能做什么','fd help','给我指令','不要卸载，只给我命令','更新会删除什么','多工具','不是有限关键词','缺注册记录时仍可解释','不扫描','同一记录','不要在此发送 final','capability-uninstall','capability-register']) assert.ok(skill.includes(text),text);
  assert.match(skill,/旧安装.*未声明 workbench/);
  assert.match(skill,/installed current/);
  assert.match(skill,/不执行终端 fd/);
});

test('032R1 missing or invalid installation refuses workbench without scanning or source fallback', () => {
  assert.throws(()=>createInstalledWorkbenchServer({}),/缺少安装位置/);
  assert.throws(()=>createInstalledWorkbenchServer({installationRoot:'/nonexistent-foundation-032r1'}));
});
