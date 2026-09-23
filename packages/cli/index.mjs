#!/usr/bin/env node
import {deliveryVerificationPlan} from '../core/delivery-verification.mjs';
import {projectDeliveryIdentity} from '../core/delivery-identity.mjs';
import {prepareInspectorUpgradePlan} from '../core/inspector-upgrade-plan.mjs';
import {resolveProjectObject} from '../core/object-context.mjs';
import {resolveProjectFile} from '../core/path-boundary.mjs';
import {runInstalledMaintenance} from './installed-maintenance.mjs';
import {synchronizeProject, inspectProjectSync, analyzeProjectSources, verifyProjectDefinition, prepareProjectSemanticReview, submitProjectSemanticReview} from '../core/workspace-host.mjs';
import {analyzeSources} from '../core/workspace-host.mjs';
import {openOrReuseWorkbench} from '../core/workspace-host.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  assertProjectMutationAuthority,
  assertTrustedCandidatePath,
  auditCapabilityArtifact,
  canonicalStringify,
  classify,
  createCapabilityPlan,
  createProjectAuthorityPlan,
  createProjectAuthorityRecoveryPlan,
  createProjectMutationPlan,
  explainProjectAuthorityPlan,
  inspectCapabilityStatus,
  inspectInstallation,
  inspectLocalLifecycle,
  inspectProjectAuthority,
  inventoryProject,
  listProjectAuthorities,
  projectAuthorityFromNaturalLanguage,
  readFacts,
  readLocalLifecycleOperationStatus,
  realProject,
  requestLocalLifecyclePlan,
  sha256,
  verify,
} from '@foundation/core';
import {createLocalLifecycleManagerServerForPlanRef, createInstalledOverviewServer} from '../core/lifecycle-manager-host.mjs';
import {receiveJourneyTransport} from '../core/workspace-host.mjs';
import {isLaunchedCandidate, discoverLaunchedCandidateRoot, runFirstInstallBootstrap, runFirstInstallDestinationSelection, readFirstInstallOperationStatus} from '../core/workspace-host.mjs';
import {inspectConversationalInstall} from '@foundation/core';
import {listenManagementCenter} from '@foundation/management-center';
import {lifecycleMenu, runLifecycleCli} from './lifecycle.mjs';
import {CLI_ROUTE_GROUPS, parseCliInvocation} from './command-contract.mjs';
import {conversationHelp} from '@foundation/core';
import {readCurrentFoundationRules} from '@foundation/core';
import {inspectProjectDelivery} from '@foundation/core';
import {createInstalledWorkbenchServer,verifyInstalledProjectBrowser} from '@foundation/management-center';
import {deriveTrustedLifecycleAuthority} from '@foundation/core';
import {readInstallationScope} from '@foundation/core';

const ROOT = path.resolve(import.meta.dirname, '../..');

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function assertReadOnlyPlanCommand(args, label) {
  if (args.includes('--plan-out')) throw new Error(`${label} plan 生成必须物理只读；由可信宿主在确认界面保存 exact plan`);
}

function readPlan(file) {
  if (!file) throw new Error('apply 必须提供由可信宿主保存的 --plan');
  const trusted = assertTrustedCandidatePath(path.resolve(file));
  return JSON.parse(fs.readFileSync(trusted, 'utf8'));
}

function runManagerCli(args, output) {
  const command = args[1];
  if (CLI_ROUTE_GROUPS.managerForbidden.includes(command)) throw new Error('manager 只支持 inspect|request-plan|open-manager|status；不存在 confirm/apply/recover/purge 命令');
  if (command === 'inspect') return output.log(JSON.stringify(inspectLocalLifecycle({installationRoot: option(args, '--root'), project: option(args, '--project')}), null, 2));
  if (command === 'request-plan') {
    const raw = option(args, '--parameters-json', '{}');
    let parameters;
    try { parameters = JSON.parse(raw); } catch { throw new Error('--parameters-json 必须是一个结构化 JSON object'); }
    return output.log(JSON.stringify(requestLocalLifecyclePlan({operation: option(args, '--operation'), parameters, previousPlanRef: option(args, '--previous-plan-ref'), previousSessionId:option(args, '--previous-session-id')}), null, 2));
  }
  if (command === 'status') return output.log(JSON.stringify(readLocalLifecycleOperationStatus({planRef: option(args, '--plan-ref')}), null, 2));
  if (command === 'open-manager') {
    for (const forbidden of ['--plan', '--path', '--root', '--target-root', '--state-root', '--action', '--port']) if (args.includes(forbidden)) throw new Error(`open-manager 不接受 ${forbidden}；只接受 opaque --plan-ref`);
    const server = createLocalLifecycleManagerServerForPlanRef({planRef: option(args, '--plan-ref')});
    // Preserve completed HTTP/SSE replies when the observing launcher releases
    // this temporary manager. A stopped pending page does not become approval.
    const stopManager=()=>{server.close();if(['pending','preview'].includes(server.managerSession.state))server.closeAllConnections();};
    process.once('SIGTERM',stopManager);process.once('SIGINT',stopManager);
    server.once('close',()=>{process.off('SIGTERM',stopManager);process.off('SIGINT',stopManager);const session=server.managerSession;process.exitCode=session.state==='completed'&&session.result?.ok!==false?0:session.state==='cancelled'?2:session.state==='expired'?3:1;});
    server.on('foundation-operation-state', session => output.log(JSON.stringify({status:'FOUNDATION_OPERATION_STATE', planRef:option(args,'--plan-ref'), sessionId:session.sessionId, operationId:session.operationId, operation:session.operation, state:session.state})));
    server.on('foundation-operation-result', session => output.log(JSON.stringify({status:'FOUNDATION_OPERATION_RESULT',responseFinished:true, planRef:option(args,'--plan-ref'), sessionId:session.sessionId, operationId:session.operationId, state:session.state, result:session.result || null, failure:session.failure || null, recordLocation:session.recordLocation}, null, 2)));
    server.listen(0, '127.0.0.1', () => output.log(JSON.stringify({ok: true, status:'AWAITING_FOUNDATION_UI_CONFIRMATION', url: `http://127.0.0.1:${server.address().port}/`, planRef:option(args,'--plan-ref'), sessionId: server.managerSession.sessionId, recordLocation:server.managerSession.recordLocation, resultRecovery:'manager status --plan-ref；卸载后只读核验安装根 uninstall-result.json，launcher 消失不是成功证明', mutationPerformed: false, managerStateMutationPerformed: true}, null, 2)));
    return;
  }
  throw new Error('manager 只支持 inspect|request-plan|open-manager|status；不存在 confirm/apply/recover/purge 命令');
}

export function createProject(project, {installationRoot, phase = 'plan', plan = null} = {}) {
  if (phase === 'plan') return createProjectAuthorityPlan({operation: 'enable', project, installationRoot, createFromTemplate: true});
  if (phase === 'apply' && plan) throw new Error('create apply 普通 API 已关闭；请通过 manager request-plan → manager open-manager 打开 Foundation 本地管理器');
  throw new Error('create 必须使用纯读 plan → Foundation 本地管理器 → exact apply，不能一步写入');
}

export function createUpgradeProjectPlan(project, {installationRoot, at = Date.now()} = {}) {
  const target = realProject(project);
  assertProjectMutationAuthority(target, {installationRoot, capability: 'foundation-facts-upgrade'});
  const currentIdentity = path.join(target, '.foundation', 'identity', 'project.json');
  const foundationFile = fs.existsSync(currentIdentity) ? currentIdentity : path.join(target, '.foundation', 'foundation.json');
  const foundation = JSON.parse(fs.readFileSync(foundationFile));
  if (foundation.dataFormatVersion !== '0.1.0') throw new Error('仅支持从 0.1.0 升级');
  const seed = {schemaVersion: '1.0.0', operation: 'foundation-facts-upgrade', project: target, from: '0.1.0', to: '0.1.1', foundationHash: sha256(fs.readFileSync(foundationFile)), createdAt: at};
  const payloadHash = sha256(canonicalStringify(seed));
  const backupRelative = `.foundation/backups/pre-upgrade-${payloadHash.slice(0, 24)}`;
  const mutationPlan = createProjectMutationPlan({
    operation: seed.operation,
    project: target,
    installationRoot,
    handlerPayload: {...seed, payloadHash, backupRelative, updatedAt: new Date(at).toISOString()},
    preserves: ['project-source', '.foundation/facts', 'components', 'assets'],
  });
  return {...seed, payloadHash, backupRelative, mutationPlan};
}

export function upgradeProject(project, {plan} = {}) {
  if (!plan) throw new Error('upgrade apply 必须提供 exact upgrade plan');
  const {payloadHash, backupRelative, mutationPlan, ...seed} = plan;
  if (seed.project !== realProject(project) || sha256(canonicalStringify(seed)) !== payloadHash || mutationPlan?.handler?.payload?.payloadHash !== payloadHash || mutationPlan?.handler?.payload?.backupRelative !== backupRelative) throw new Error('upgrade plan 已被改写或目标不匹配');
  throw new Error('upgrade apply 普通 API 已关闭；请通过 manager request-plan → manager open-manager 打开 Foundation 本地管理器');
}

function runProjectCli(args, output) {
  const command = args[1];
  if(command==='delivery-identity') {
    const project=option(args,'--project'),installationRoot=option(args,'--root');
    const state=inspectLocalLifecycle({installationRoot,project,operationRequirement:'lifecycle-inspect'});
    if(state.bridge?.installationHealth?.code!=='FOUNDATION_HEALTHY'||state.project?.state!=='enabled'||!state.project?.agreement)throw new Error('交付读回需要健康安装和当前项目绑定');
    return output.log(JSON.stringify(projectDeliveryIdentity({project,current:state.installation.current}),null,2));
  }
  if(command==='inspector-plan') {
    const project=option(args,'--project'),authority=inspectProjectAuthority(project,{installationRoot:option(args,'--root')});
    if(authority.state!=='enabled'||!authority.agreement)throw new Error('升级计划需要已核验项目绑定');
    return output.log(JSON.stringify(prepareInspectorUpgradePlan({project,installationRoot:option(args,'--root')}),null,2));
  }
  if(command==='resolve-object') {
    const project=option(args,'--project'),installationRoot=option(args,'--root');
    const authority=inspectProjectAuthority(project,{installationRoot});
    if(authority.state!=='enabled'||!authority.agreement)throw new Error('只读对象补取需要当前已核验的项目绑定');
    const input=fs.readFileSync(resolveProjectFile(project,option(args,'--input'),'复制信封'),'utf8');
    const result=resolveProjectObject({project,input});output.log(JSON.stringify(result,null,2));
    if(result.state!=='resolved')process.exitCode=2;return;
  }
  if(command==='verify-delivery')return (async()=>{
    const project=option(args,'--project'),installationRoot=option(args,'--root'),taskId=option(args,'--task-id');
    const authority=inspectProjectAuthority(project,{installationRoot});
    if(authority.state!=='enabled'||!authority.agreement)throw new Error('交付验证需要当前已核验的项目绑定');
    const plan=deliveryVerificationPlan(readFacts(project),taskId),results=[];
    for(const request of plan.requests)try {
      const {kind,...options}=request;
      const result=kind==='definition'?await verifyProjectDefinition({project,installationRoot,...options}):await verifyInstalledProjectBrowser({project,installationRoot,...options});
      results.push({request,result});
    }catch(error){results.push({request,state:'failed',reason:error.message});}
    const passed=!plan.pending.length&&results.length>0&&results.every(item=>item.result?.report?.result==='passed'||item.result?.state==='passed');
    output.log(JSON.stringify({state:passed?'passed':'pending',plan,results,nextStep:'将返回的真实报告写入项目并通过正常 sync 精确批次登记；重开后核对 delivery-identity。'},null,2));
    if(!passed)process.exitCode=2;
  })();
  if(command==='verify-browser')return verifyInstalledProjectBrowser({project:option(args,'--project'),installationRoot:option(args,'--root'),taskId:option(args,'--task-id'),assetId:option(args,'--asset-id'),scenarioId:option(args,'--scenario-id'),requirementId:option(args,'--requirement-id')}).then(result=>{output.log(JSON.stringify(result,null,2));if(result.state!=='passed')process.exitCode=2;},error=>{output.error(`错误：浏览器验证失败（${error.message}）`);process.exitCode=1;});
  if(command==='prepare-semantic-review')return Promise.resolve().then(()=>prepareProjectSemanticReview({project:option(args,'--project'),installationRoot:option(args,'--root'),taskId:option(args,'--task-id'),assetId:option(args,'--asset-id'),requirementId:option(args,'--requirement-id')})).then(result=>output.log(JSON.stringify(result,null,2)),error=>{output.error(`错误：语义核验准备失败（${error.message}）`);process.exitCode=1;});
  if(command==='submit-semantic-review')return Promise.resolve().then(()=>submitProjectSemanticReview({project:option(args,'--project'),installationRoot:option(args,'--root'),prepared:JSON.parse(fs.readFileSync(option(args,'--plan'),'utf8')),review:JSON.parse(fs.readFileSync(option(args,'--review'),'utf8'))})).then(result=>{output.log(JSON.stringify(result,null,2));if(result.report.result!=='passed')process.exitCode=2;},error=>{output.error(`错误：语义核验提交失败（${error.message}）`);process.exitCode=1;});
  if(command==='verify-definition')return verifyProjectDefinition({project:option(args,'--project'),installationRoot:option(args,'--root'),entryRoots:JSON.parse(option(args,'--entry-roots-json')),taskId:option(args,'--task-id'),assetId:option(args,'--asset-id'),requirementId:option(args,'--requirement-id')}).then(result=>{output.log(JSON.stringify(result,null,2));if(result.report.result!=='passed')process.exitCode=2;},error=>{output.error(`错误：定义验证失败（${error.message}）`);process.exitCode=1;});
  if(command==='analyze') {
    const project=option(args,'--project'),installationRoot=option(args,'--root');
    const authority=inspectProjectAuthority(project,{installationRoot});
    if(authority.state!=='enabled'||!authority.agreement)throw new Error('源码分析需要当前已核验的项目绑定');
    const entryRoots=JSON.parse(option(args,'--entry-roots-json'));
    if(!Array.isArray(entryRoots)||!entryRoots.length)throw new Error('源码分析需显式 entry roots');
    return analyzeProjectSources({project,installationRoot,entryRoots}).then(result=>{output.log(JSON.stringify(result,null,2));if(result.coverage.state==='partial')process.exitCode=2;},error=>{output.error(`错误：${error.message}`);process.exitCode=1;});
  }
  if (command === 'sync' || command === 'sync-status') {
    const payloadFile = option(args, '--payload');
    const result = command === 'sync-status' ? inspectProjectSync({project:option(args,'--project'),installationRoot:option(args,'--root')}) : synchronizeProject({project:option(args,'--project'),installationRoot:option(args,'--root'),handlerPayload:payloadFile ? JSON.parse(fs.readFileSync(payloadFile,'utf8')) : null,roundAction:option(args,'--round'),taskId:option(args,'--task-id'),identityActions:JSON.parse(option(args,'--identity-actions-json') || '[]')});
    output.log(JSON.stringify(result,null,2));
    if (['failed','conflict','stopped'].includes(result.state)) process.exitCode = 1;
    return;
  }
  if (command === 'delivery-check') return output.log(JSON.stringify(inspectProjectDelivery({installationRoot: option(args, '--root'), project: option(args, '--project'), changes: JSON.parse(option(args, '--changes-json') || '[]'), requirePreview: args.includes('--require-preview')}), null, 2));
  if (command === 'inventory') return output.log(JSON.stringify(inventoryProject(option(args, '--project', args[2]), {installationRoot: option(args, '--root')}), null, 2));
  if (command === 'status') return output.log(JSON.stringify(inspectProjectAuthority(option(args, '--project', args[2]), {installationRoot: option(args, '--root')}), null, 2));
  if (command === 'list') return output.log(JSON.stringify(listProjectAuthorities(option(args, '--root')), null, 2));
  if (command === 'explain') {
    const plan = readPlan(option(args, '--plan'));
    return output.log(option(args, '--format', 'text') === 'json' ? JSON.stringify(plan, null, 2) : explainProjectAuthorityPlan(plan));
  }
  if (CLI_ROUTE_GROUPS.projectPlanCommands.includes(command)) {
    const phase = args[2];
    if (phase === 'plan') {
      assertReadOnlyPlanCommand(args, `project ${command}`);
      const plan = createProjectAuthorityPlan({operation: command, project: option(args, '--project'), installationRoot: option(args, '--root'), rebind: args.includes('--rebind')});
      return output.log(option(args, '--format', 'text') === 'json' ? JSON.stringify(plan, null, 2) : explainProjectAuthorityPlan(plan));
    }
    if (phase === 'apply') {
      throw new Error(`project ${command} apply 普通 CLI 入口已关闭；请用 manager request-plan 取得 opaque planRef，再用 manager open-manager 打开`);
    }
  }
  if (command === 'recover') {
    const phase = args[2];
    if (phase === 'plan') { assertReadOnlyPlanCommand(args, 'project recover'); return output.log(JSON.stringify(createProjectAuthorityRecoveryPlan({installationRoot: option(args, '--root')}), null, 2)); }
    if (phase === 'apply') throw new Error('project recover apply 普通 CLI 入口已关闭；请用 manager request-plan 取得 opaque planRef，再用 manager open-manager 打开');
  }
  if (command === 'intent') return output.log(JSON.stringify(projectAuthorityFromNaturalLanguage(option(args, '--text'), {project: option(args, '--project'), installationRoot: option(args, '--root')}), null, 2));
  throw new Error('project 用法：inventory|status|list|explain|enable plan|enable apply|disable plan|disable apply|recover plan|recover apply|intent');
}

function runCreateCli(args, output) {
  const phase = args[1];
  if (phase === 'plan') {
    assertReadOnlyPlanCommand(args, 'create');
    const plan = createProjectAuthorityPlan({operation: 'enable', project: option(args, '--project'), installationRoot: option(args, '--root'), createFromTemplate: true});
    return output.log(option(args, '--format', 'text') === 'json' ? JSON.stringify(plan, null, 2) : explainProjectAuthorityPlan(plan));
  }
  if (phase === 'apply') {
    assertNoCallerConfirmation(args);
    const plan = readPlan(option(args, '--plan'));
    if (!plan.createFromTemplate || plan.operation !== 'enable') throw new Error('create apply 只能执行 createFromTemplate enable plan');
    throw new Error('create apply 普通 CLI 入口已关闭；请用 manager request-plan 取得 opaque planRef，再用 manager open-manager 打开');
  }
  throw new Error('create 必须使用 create plan 或 create apply');
}

function runCapabilityCli(args, output) {
  const command = args[1];
  const manifestFile = option(args, '--manifest');
  if (args.includes('--host-registration')) throw new Error('--host-registration 已关闭；registration identity 由当前 Foundation 安装与本地管理器只读派生');
  if (command === 'audit') return output.log(JSON.stringify(auditCapabilityArtifact(manifestFile), null, 2));
  if (command === 'status') return output.log(JSON.stringify(inspectCapabilityStatus({installationRoot: option(args, '--root'), manifestFile, project: option(args, '--project'), mutating: args.includes('--mutating')}), null, 2));
  if (CLI_ROUTE_GROUPS.capabilityPlanCommands.includes(command)) {
    const phase = args[2];
    if (phase === 'plan') {
      assertReadOnlyPlanCommand(args, `capability ${command}`);
      return output.log(JSON.stringify(createCapabilityPlan({operation: command, installationRoot: option(args, '--root'), manifestFile, project: option(args, '--project')}), null, 2));
    }
    if (phase === 'apply') throw new Error(`capability ${command} apply 普通 CLI 入口已关闭；请用 manager request-plan 取得 opaque planRef，再用 manager open-manager 打开`);
  }
  throw new Error('capability 用法：audit|status|install/register/activate/deactivate/uninstall plan|apply');
}

function runUpgradeCli(args, output) {
  const phase = args[1];
  if (phase === 'plan') { assertReadOnlyPlanCommand(args, 'upgrade'); return output.log(JSON.stringify(createUpgradeProjectPlan(option(args, '--project'), {installationRoot: option(args, '--root')}), null, 2)); }
  if (phase === 'apply') throw new Error('upgrade apply 普通 CLI 入口已关闭；请用 manager request-plan 取得 opaque planRef，再用 manager open-manager 打开');
  throw new Error('upgrade 必须使用 upgrade plan 或 upgrade apply');
}

export function installSkill() {
  throw new Error('install-skill 直写入口已关闭；使用 manager request-plan → manager open-manager → 本地管理器确认流程');
}

export function runCli(args = process.argv.slice(2), output = console) {
  const invocation = parseCliInvocation(args);
  args = invocation.argv;
  const command = args[0];
  // A payload probe reports only its own version/runtime. It neither derives
  // installed authority nor enables any lifecycle operation before current exists.
  if (command === '--foundation-health') return output.log(JSON.stringify({ok: true, version: JSON.parse(fs.readFileSync(path.join(ROOT, 'foundation-kit.json'), 'utf8')).product.version, runtime: process.execPath}));
  const authority = deriveTrustedLifecycleAuthority();
  if (authority.mode === 'platform-installed-runtime' && command !== '--help' && command !== '--foundation-health') {
    readInstallationScope(authority.installRoot, {cwd: process.cwd(), project: option(args, '--project')});
  }
  if (command === 'maintenance') return runInstalledMaintenance({authority,args,output});
  if (command === 'rules') return output.log(JSON.stringify(readCurrentFoundationRules({installationRoot: option(args, '--root'), project: option(args, '--project')}), null, 2));
  if (command === '--help') output.log(conversationHelp()+'\n随包维护：maintenance status|uninstall --install-id <身份>；maintenance update --install-id <身份> --candidate <核验材料>；maintenance resume --install-id <身份> [--operation-id <查询列出的操作>]；可用 --binding <注册记录> 核验身份。');
  if (command === '--help') output.log('单页内部通道：--journey-channel（仅 install 或 manager open-manager；需要私有 IPC 绑定，不提供确认命令）');
  if (command === 'workbench') {
    return openOrReuseWorkbench({installationRoot:option(args,'--root'),project:option(args,'--project'),createServer:createInstalledWorkbenchServer}).then(record=>output.log(JSON.stringify(record)),error=>{output.error(`错误：工作台启动失败（${error.message}）`);process.exitCode=1;});
  }
  if (command === '--help') output.log('Foundation 对话入口（真实获取与使用尚待验收）\ninspect 不查远端：发布 unknown，获取 not-checked；unsigned 不表示未发布。版本来自可信 GitHub 入口清单。\n只读检查：onboarding inspect [--destination <绝对目录>]\n候选安装：install [--destination <绝对目录>] --browser codex\n页面选择目录：install --choose-destination --browser codex [--journey-id <仅关联展示的标识>]（选择后仍须本人确认精确计划）\n安装结果：onboarding status --session-id <返回值>\n唯一工作台：workbench open --root <实际安装目录> [--project <明确选定的已接入项目>]\n诊断概览（不是工作台）：onboarding open --root <实际安装目录>\n项目/维护：manager inspect → request-plan → open-manager → status\n规则只读：rules inspect --root <安装根> [--project <项目>]\n版本、目录和 Skill 是意向；必须由用户在绑定计划的管理器页面确认。没有 confirm/apply/yes 直写入口。源码 CLI 需要开发 Node；已安装 launcher 使用私有 Runtime。');
  else if (!command) output.log(lifecycleMenu());
  else if (command === 'onboarding') {
    if (args[1] === 'open') {
      const server = createInstalledOverviewServer({installationRoot: option(args, '--root')});
      server.listen(0, '127.0.0.1', () => output.log(JSON.stringify({url: `http://127.0.0.1:${server.address().port}/`, requiredHostAction: 'open-in-codex-browser', mutationPerformed: false})));
      server.on('error', (error) => { output.error(`错误：管理中心无法启动（${error.code || 'unknown'}）`); process.exitCode = 1; });
    } else output.log(JSON.stringify(args[1] === 'status' ? readFirstInstallOperationStatus(option(args, '--session-id')) : inspectConversationalInstall({destination: option(args, '--destination'), candidateRoot: isLaunchedCandidate() ? discoverLaunchedCandidateRoot() : null}), null, 2));
  }
  else if (command === 'install' && invocation.route.length === 1 && isLaunchedCandidate()) {
    if (args.includes('--choose-destination')) runFirstInstallDestinationSelection(output, {browser: option(args, '--browser', 'codex'), journeyId: option(args, '--journey-id', null)});
    else runFirstInstallBootstrap(output, {destination: option(args, '--destination'), browser: option(args, '--browser', 'system')});
  }
  else if (CLI_ROUTE_GROUPS.lifecycleDispatch.includes(command)) runLifecycleCli(args, output);
  else if (command === 'setup') {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要 Node.js 20+');
    output.log(`setup OK：Node.js ${process.version}，无外部依赖`);
  } else if (command === 'create') runCreateCli(args, output);
  else if (command === 'manager') runManagerCli(args, output);
  else if (command === 'project') runProjectCli(args, output);
  else if (command === 'capability') runCapabilityCli(args, output);
  else if (command === 'verify') {
    const result = verify(args[1]); output.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;
  } else if (command === 'status') {
    const project = args[1];
    if (project === '--root' && args[2]) output.log(JSON.stringify(inspectInstallation(args[2]), null, 2));
    else if (!project) output.log(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'foundation-kit.json'))), null, 2));
    else output.log(JSON.stringify({verification: verify(project), foundation: readFacts(project).foundation}, null, 2));
  } else if (command === 'center') listenManagementCenter(invocation.positionals[0], Number(invocation.options['--port'] || 4173), {installationRoot: option(args, '--root')});
  else if (command === 'classify-change') output.log(JSON.stringify(classify(JSON.parse(fs.readFileSync(option(args, '--input'), 'utf8'))), null, 2));
  else if (command === 'upgrade') runUpgradeCli(args, output);
  else if (command === 'install-skill') output.log(JSON.stringify(installSkill(), null, 2));
  else if (command === 'inventory') output.log(JSON.stringify(inventoryProject(args[1]), null, 2));
  else { output.log('用法：./foundation-kit manager|install|update|repair|rollback|uninstall|doctor|extension|capability|project|setup|create|verify|center|classify-change|upgrade|inventory|status'); process.exitCode = 1; }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath || fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  try { if(process.argv.includes('--journey-channel')) await receiveJourneyTransport(); await runCli(); } catch (error) { console.error(error?.toJSON ? JSON.stringify(error.toJSON(), null, 2) : `错误：${error.message}`); process.exitCode = 1; }
}
