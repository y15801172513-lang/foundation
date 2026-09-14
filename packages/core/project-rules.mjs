import fs from 'node:fs';
import path from 'node:path';
import {LifecycleError, sha256} from './install-contract.mjs';
import {realProject} from './path-boundary.mjs';
import {readCurrentFoundationRules} from './rules-delivery.mjs';

export const RULE_ADOPTION_PATH = '.foundation/identity/rules-adoption.json';
export const PROJECT_RULE_GUIDE = '\n<!-- foundation-project-rules:start -->\n## Foundation 项目入口\n\n仅当 .foundation/integration/binding.json 仍为 enabled，且已安装程序能验证本项目绑定时，继续 Foundation 规则流程。停用、绑定缺失、安装失效时，本段惰性，不扫描或自动重装。读取 .foundation/identity/rules-adoption.json 的安装位置线索，再用该根的稳定 bin/foundation-kit 执行 rules inspect --root <该根> --project <当前精确项目>；命令必须返回当前安装与规则校验成功。读取返回的规则正文，保留本文件其他规则和项目例外。线索、正文和本段均不是修改批准；受控事实批次仍走管理器的精确确认。旧任务先重新核验 current，不固定版本目录。\n<!-- foundation-project-rules:end -->\n';

// Read-only preparation. The closed handler snapshots and commits the returned
// two paths with the existing exact confirmation and durable rollback journal.
export function prepareProjectRulesAdoption(project, payload) {
  const root = realProject(project);
  if (!payload || Object.keys(payload).some(k => !['installationRoot', 'technology', 'generatedAt'].includes(k)) || !['react-shadcn', 'preserve'].includes(payload.technology)) throw new LifecycleError('PROJECT_RULES_INPUT_INVALID', '需明确技术栈选择 react-shadcn 或 preserve', {stage: 'project-rules'});
  const rules = readCurrentFoundationRules({installationRoot: payload.installationRoot, project: root});
  if (!rules.preparation?.factsReady) throw new LifecycleError('PROJECT_PREPARATION_REQUIRED', '项目事实尚未准备完成；按 rules inspect 的 nextStep 单独确认补齐后重新检查，不以采用代替准备', {stage: 'project-rules'});
  const read = (relative, optional = false) => {
    let cursor = root;
    for (const part of relative.split('/')) {
      cursor = path.join(cursor, part);
      let stat;
      try { stat = fs.lstatSync(cursor); } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
      if (stat.isSymbolicLink()) throw new Error('项目规则路径包含符号链接，保留并停止');
    }
    if (!fs.lstatSync(cursor).isFile()) throw new Error('项目规则路径不是普通文件');
    const bytes = fs.readFileSync(cursor);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) throw new Error('项目规则不是无损 UTF-8 文本；不改写原始字节');
    return text;
  };
  if (read('AGENTS.override.md', true) !== null) throw new Error('已有 AGENTS.override.md 优先于 AGENTS.md；请先单独确认项目入口合并，现有文件不改动');
  if (read(RULE_ADOPTION_PATH, true) !== null) throw new Error('已有项目采用记录；本操作不覆盖用户例外或静默迁移');
  const previous = read('AGENTS.md', true) || '';
  if (previous.includes('foundation-project-rules:')) throw new Error('已有 Foundation 指引但缺少可匹配采用记录；保留并核实');
  const guide = previous + PROJECT_RULE_GUIDE;
  if (Buffer.byteLength(guide) > 24 * 1024) throw new Error('项目规则过长，无法保证宿主读取；先人工整理，不截断用户规则');
  const identity = JSON.parse(read('.foundation/identity/project.json'));
  const mode = identity.projectKind === 'new' && payload.technology === 'react-shadcn' ? 'shadcn-first' : 'preserve-and-inventory';
  const adoption = {schemaVersion: '1.0.0', projectId: identity.projectId, installationRoot: payload.installationRoot, authority: 'discovery-hint-and-project-preferences-only', ruleMajor: 1, adoptedRuleVersion: rules.ruleVersion, adoptedProgramVersion: rules.programVersion, technology: payload.technology, governanceMode: mode, exceptions: [], guideSha256: sha256(PROJECT_RULE_GUIDE), createdAt: payload.generatedAt, hostDiscoveryVerified: false};
  return {files: [{path: 'AGENTS.md', content: guide}, {path: RULE_ADOPTION_PATH, content: `${JSON.stringify(adoption, null, 2)}\n`}], currentIdentityHash: rules.currentIdentityHash, endpointIdentity: rules.endpointIdentity, adoption};
}
