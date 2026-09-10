import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const COVERAGE_FILE = path.join(ROOT, 'docs', 'current-mutation-handler-coverage.json');
const coverage = JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf8'));

const findings = [];
const expectedEntryIds = [
  'ai-bridge',
  'cli-capability',
  'cli-lifecycle',
  'cli-project-authority',
  'cli-upgrade',
  'codex-user-skill',
  'extension-adapter',
  'first-install-bootstrap',
  'http-management-center-relation',
  'node-project-mutation',
  'node-relation-helper',
  'node-skeleton-helper',
  'offer-preference',
  'uninstall-finalizer',
];
const expectedHandlerIds = [
  'extension-shadcn-apply',
  'extension-shadcn-remove-owned',
  'foundation-facts-upgrade',
  'foundation-skeleton-and-facts-create',
  'relation-facts-write',
  'page-facts-write',
];

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function requireSource(relative, fragments, label) {
  const value = source(relative);
  for (const fragment of fragments) if (!value.includes(fragment)) findings.push({code: 'ENTRYPOINT_ROUTE_MISSING', label, file: relative, fragment});
}

if (JSON.stringify(coverage.entrypoints.map((entry) => entry.id)) !== JSON.stringify(expectedEntryIds)) findings.push({code: 'ENTRYPOINT_COVERAGE_SET_MISMATCH'});
if (JSON.stringify(coverage.closedProjectHandlers) !== JSON.stringify(expectedHandlerIds)) findings.push({code: 'HANDLER_CATALOG_COVERAGE_MISMATCH'});
for (const entry of coverage.entrypoints) {
  const denied = entry.mutation === 'denied; only capability-status/plan/explain/verify';
  if (!entry.surface || !entry.entry || (!entry.dispatcher && !denied) || (!entry.lowestWriteGate && !denied)) findings.push({code: 'ENTRYPOINT_COVERAGE_INCOMPLETE', id: entry.id});
}

requireSource('packages/core/facts.mjs', ['function ensureSkeleton', 'function registerPageRelation', 'applyProjectMutationPlan({plan: mutationPlan})'], 'facts helpers');
requireSource('packages/core/extension-adapters.mjs', ['function applyExtension', 'function removeExtension', 'applyProjectMutationPlan({plan: mutationPlan})'], 'extension adapter');
requireSource('packages/cli/index.mjs', ['function upgradeProject', 'function runManagerCli', 'requestLocalLifecyclePlan({operation:', 'createLocalLifecycleManagerServerForPlanRef({planRef:', 'function runProjectCli', 'function runCapabilityCli', '普通 CLI 入口已关闭'], 'CLI');
requireSource('packages/cli/lifecycle.mjs', ['function runOperation', 'createNormalUninstallCompositePlan', '普通 CLI 入口已关闭'], 'lifecycle CLI');
requireSource('packages/core/first-install-bootstrap.mjs', ['function runFirstInstallBootstrap', 'createLocalLifecycleManagerServer({plan:', 'transferBootstrapAuthorityToInstalledState()'], 'first-install bootstrap');
requireSource('apps/management-center/src/server/center-server.mjs', ["pathname === '/__foundation/relations'", "createProjectMutationPlan({operation: 'relation-facts-write'", 'createLocalLifecycleManagerServer({plan'], 'management-center HTTP');
requireSource('packages/core/ai-bridge.mjs', ["['inspect', 'request-plan', 'open-manager', 'status']", 'AI 不得调用 confirm/apply/recover/purge'], 'AI bridge deny');
requireSource('packages/core/project-authority.mjs', ['function applyProjectMutationPlan', 'assertClosedHandlerBinding(plan)', 'consumeExactManagerConfirmationAtBoundary(reservation', 'executeClosedProjectHandler(plan)'], 'closed dispatcher');
requireSource('packages/core/transaction-engine.mjs', ['function applyLifecyclePlan', 'writeTrustedPreIntent({', 'consumeExactManagerConfirmationAtBoundary(reservation'], 'lifecycle lowest gate');
requireSource('packages/core/capability-authority.mjs', ['function applyCapabilityPlan', 'writeTrustedPreIntent({', 'consumeExactManagerConfirmationAtBoundary(reservation'], 'capability lowest gate');
requireSource('packages/core/capability-authority.mjs', ['function applyCapabilityRecoveryPlan', 'function readCapabilityRecovery', 'CAPABILITY_RECOVERY_USER_CHANGE', 'verifyTrustedPreIntentScope(read.snapshot.trustedScope)', 'recoveryProtocol: \'030R1-write-ahead\''], 'capability bounded recovery gate');
requireSource('packages/core/codex-skill-registration.mjs', ['CODEX_SKILL_SOURCE_ONLY', 'verifyCodexSkillRegistration(registration)', 'verifyCodexSkillRemoval(removal)'], 'Codex owned Skill write scope');
requireSource('packages/core/project-mutation-handlers.mjs', expectedHandlerIds, 'fixed handler catalog');

const handlerModule = await import(`${pathToFileURL(path.join(ROOT, 'packages/core/project-mutation-handlers.mjs')).href}?audit=024r8`);
if (!Object.isFrozen(handlerModule.CLOSED_PROJECT_HANDLER_IDS) || JSON.stringify(handlerModule.CLOSED_PROJECT_HANDLER_IDS) !== JSON.stringify(expectedHandlerIds)) findings.push({code: 'RUNTIME_HANDLER_CATALOG_MISMATCH'});
const handlerSource = source('packages/core/project-mutation-handlers.mjs');
for (const forbidden of ['import(', 'registerProjectMutationHandler', 'setProjectMutationHandler', 'handlerModule', 'modulePath']) if (handlerSource.includes(forbidden)) findings.push({code: 'DYNAMIC_HANDLER_SURFACE', value: forbidden});

const productionRoots = ['packages/core', 'packages/cli', 'apps/management-center/src/server'];
const writeToken = /\bfs\.(?:appendFileSync|chmodSync|copyFileSync|linkSync|mkdirSync|renameSync|rmSync|rmdirSync|truncateSync|unlinkSync|writeFileSync)\s*\(/u;
const observedWriters = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (entry.isFile() && entry.name.endsWith('.mjs') && writeToken.test(fs.readFileSync(absolute, 'utf8'))) observedWriters.push(path.relative(ROOT, absolute).replaceAll(path.sep, '/'));
  }
}
for (const relative of productionRoots) visit(path.join(ROOT, relative));
observedWriters.sort();
if (JSON.stringify(observedWriters) !== JSON.stringify(coverage.productionWriterFiles)) findings.push({code: 'UNMAPPED_PRODUCTION_WRITER', expected: coverage.productionWriterFiles, observed: observedWriters});

const result = {
  schemaVersion: '1.0.0',
  ok: findings.length === 0,
  coverageArtifact: path.relative(ROOT, COVERAGE_FILE).replaceAll(path.sep, '/'),
  entrypointCount: coverage.entrypoints.length,
  handlerCount: coverage.closedProjectHandlers.length,
  productionWriterCount: observedWriters.length,
  entrypointIds: coverage.entrypoints.map((entry) => entry.id),
  handlerIds: [...handlerModule.CLOSED_PROJECT_HANDLER_IDS],
  observedWriterFiles: observedWriters,
  unknownOrUnmapped: findings,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
