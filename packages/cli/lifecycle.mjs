import fs from 'node:fs';

import {
  ANT_ADAPTER,
  SHADCN_ADAPTER,
  createLifecyclePlan,
  createNormalUninstallCompositePlan,
  explainLifecyclePlan,
  inspectInstallation,
  inspectLifecycleRecovery,
  inspectPlatform,
  listProjectAuthorityRecords,
  productVersion,
  validateCandidate,
  validateVersionMirrors,
} from '@foundation/core';
import {CLI_ROUTE_GROUPS, parseCliInvocation} from './command-contract.mjs';

const adapterByName = {shadcn: SHADCN_ADAPTER, ant: ANT_ADAPTER};

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function options(args, name) {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]] : []);
}

function emitPlan(plan, format, output) {
  if (format === 'json') return output.log(JSON.stringify(plan, null, 2));
  if (plan.operation === 'normal-uninstall') {
    return output.log([
      `计划 ${plan.planId}：正常卸载 Foundation`,
      `Foundation 安装根：${plan.installationRoot}`,
      `可访问项目：${plan.projectPlan.accessible.map((entry) => `${entry.projectId} (${entry.realPath})`).join('、') || '无'}`,
      `不可安全 detach：${plan.residuals.map((entry) => `${entry.projectId || 'unknown'} (${entry.lastKnownPath || 'unknown'}): ${entry.reason}`).join('、') || '无'}`,
      `删除：${plan.deletes.join('、')}`,
      `保留：${plan.preserves.join('、')}`,
      `计划完整性 SHA-256：${plan.integrity.hash}`,
      '确认：必须在 Foundation 本地管理器中选择取消且不改变，或对 exact accessible set 继续。',
    ].join('\n'));
  }
  output.log(explainLifecyclePlan(plan));
}

function candidateBinding(candidateRoot) {
  const runtimeIdentity = inspectPlatform();
  const {platform, arch} = runtimeIdentity;
  const checked = validateCandidate(candidateRoot, {platform, arch, requireRuntime: true});
  if (!checked.ok) throw Object.assign(new Error(checked.error.message), checked.error);
  const runtimeFile = checked.manifest.files.find((record) => record.path === checked.manifest.runtime.path);
  return {path: checked.root, manifestHash: checked.manifest.candidateHash, runtimeHash: runtimeFile.sha256, bytes: checked.manifest.totalBytes, version: checked.manifest.productVersion, acquisition: 'local-ingestion'};
}

function lifecyclePlan(operation, args) {
  const targetRoot = option(args, '--root');
  const sandboxRoot = option(args, '--sandbox-root');
  if (!targetRoot || !sandboxRoot) throw new Error(`${operation} plan 必须提供 --root 和 --sandbox-root`);
  const format = option(args, '--format', 'text');
  if (!['text', 'json'].includes(format)) throw new Error('--format 只支持 text 或 json');
  const current = inspectInstallation(targetRoot).current;
  const candidateRoot = option(args, '--candidate');
  if (args.includes('--platform') || args.includes('--arch')) throw new Error('--platform/--arch runtime override 已关闭；计划只绑定当前受保护 runtime identity');
  const bound = candidateRoot ? candidateBinding(candidateRoot) : null;
  const targetVersion = option(args, '--target-version', bound?.version || (operation === 'uninstall' ? current?.version : null));
  const profile = option(args, '--profile', 'core');
  const aiChoice = option(args, '--ai-bridge');
  if (profile === 'custom' && !['on', 'off'].includes(aiChoice)) throw new Error('custom 必须用 --ai-bridge on|off 独立选择 AI 接入；组件扩展继续用 --extension');
  const plan = createLifecyclePlan({
      operation,
      profile,
      mode: option(args, '--mode'),
      targetRoot,
      sandboxRoot,
      currentVersion: current?.version || null,
      targetVersion,
      candidate: bound,
      recoverySnapshot: operation === 'recover' ? inspectLifecycleRecovery(targetRoot) : null,
      extensions: options(args, '--extension').length ? options(args, '--extension') : undefined,
      aiBridge: aiChoice === 'on',
    });
  return {
    format,
    plan: operation === 'uninstall' ? createNormalUninstallCompositePlan({lifecyclePlan: plan, projects: listProjectAuthorityRecords(targetRoot)}) : plan,
  };
}

function runOperation(operation, args, output) {
  const phase = args[1];
  if (phase === 'plan') {
    const {plan, format} = lifecyclePlan(operation, args);
    if (args.includes('--plan-out')) throw new Error('plan 生成必须物理只读；请由可信宿主在确认界面保存 exact plan，而不是让 Foundation CLI 写 plan 文件');
    emitPlan(plan, format, output);
    return;
  }
  if (phase === 'apply') throw new Error(`${operation} apply 普通 CLI 入口已关闭；请用 manager request-plan 取得 opaque planRef，再用 manager open-manager 打开，并在 Foundation 本地管理器中确认`);
  output.log('请用 foundation-kit manager request-plan 请求 exact plan，再用 manager open-manager 打开 opaque planRef。');
}

function runExtension(args, output) {
  const phase = args[1] || 'list';
  if (phase === 'list') {
    output.log(JSON.stringify(Object.values(adapterByName).map((adapter) => ({name: adapter.name, status: adapter.status, explanation: adapter.explain()})), null, 2));
    return;
  }
  const name = option(args, '--adapter');
  const adapter = adapterByName[name];
  if (!adapter) throw new Error('extension 必须提供 --adapter shadcn|ant');
  if (phase === 'detect') {
    output.log(JSON.stringify(adapter.detect(option(args, '--project')), null, 2));
    return;
  }
  if (phase === 'plan') {
    const registryFile = option(args, '--registry');
    const plan = adapter.plan({project: option(args, '--project'), installationRoot: option(args, '--root'), registry: registryFile ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : undefined});
    if (args.includes('--plan-out')) throw new Error('extension plan 必须物理只读；由可信宿主保存 exact plan');
    output.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (['apply', 'remove'].includes(phase)) throw new Error(`extension ${phase} 普通 CLI 入口已关闭；请用 manager request-plan → manager open-manager`);
  throw new Error(`未知 extension 阶段：${phase}`);
}

export function lifecycleMenu() {
  return `Foundation\n\n你想做什么？\n1. 安装或重新安装\n2. 查看状态与电脑环境\n3. 检查更新\n4. 修复\n5. 回退到上一个版本\n6. 卸载\n7. 管理 AI 与组件扩展\n\n任何写入前都会先生成不可变计划并等待本次确认。`;
}

export function runLifecycleCli(args, output = console) {
  args = parseCliInvocation(args).argv;
  const command = args[0];
  if (CLI_ROUTE_GROUPS.lifecycleCommands.includes(command)) return runOperation(command, args, output);
  if (command === 'doctor') {
    const root = option(args, '--root');
    output.log(JSON.stringify({ok: true, productVersion: productVersion(), versions: validateVersionMirrors(), platform: inspectPlatform({targetRoot: root}), installation: root ? inspectInstallation(root) : null, productionDistribution: 'pending'}, null, 2));
    return;
  }
  if (command === 'extension') return runExtension(args, output);
  throw new Error(`未知生命周期命令：${command}`);
}
