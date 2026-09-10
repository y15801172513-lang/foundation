import fs from 'node:fs';
import path from 'node:path';
import {conversationHelpMarkdown} from '../packages/core/conversation-commands.mjs';

const root = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
const start = '<!-- foundation-command-catalog:start -->';
const end = '<!-- foundation-command-catalog:end -->';
const section = `${start}\n${conversationHelpMarkdown()}\n${end}`;
for (const relative of ['skills/ai-product-foundation-kit/SKILL.md', 'docs/conversation-commands.md']) {
  const file = path.join(root, relative);
  if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) throw new Error('帮助同步拒绝符号链接或非普通文件');
  const before = fs.readFileSync(file, 'utf8');
  const from = before.indexOf(start), to = before.indexOf(end);
  if (from < 0 || to < from || before.indexOf(start, from + 1) >= 0) throw new Error('帮助目录标记缺失或重复');
  const after = before.slice(0, from) + section + before.slice(to + end.length);
  if (before !== after) {
    if (!process.argv.includes('--write')) throw new Error(`指令目录已漂移：${relative}`);
    fs.writeFileSync(file, after);
  }
}
console.log('指令目录与 Skill/文档一致');
