import fs from 'node:fs';
import {foundationFiles, readFacts, validateFacts} from './facts.mjs';
import {inspectPreviewConfig} from './preview-config.mjs';

export * from './classification.mjs';
export * from './assets.mjs';
export * from './human-labels.mjs';
export * from './identity.mjs';
export * from './git-identity.mjs';
export * from './context.mjs';
export * from './facts.mjs';
export * from './governance.mjs';
export * from './ui-policy.mjs';
export * from './path-boundary.mjs';
export * from './preview-config.mjs';
export * from './product-version.mjs';
export * from './install-contract.mjs';
export * from './platform-bootstrap.mjs';
export * from './platform-paths.mjs';
export * from './ai-bridge.mjs';
export * from './extension-adapters.mjs';
export * from './candidate-package.mjs';
export * from './runtime-descriptor.mjs';
export {
  assertTrustedCandidatePath,
  deriveTrustedLifecycleAuthority,
  snapshotTrustedTarget,
} from './trusted-authority.mjs';
export {UNINSTALL_MODE_MATRIX, inspectLifecycleRecovery, inspectInstallation} from './transaction-engine.mjs';
export {
  PROJECT_AUTHORITY_STATES,
  PROJECT_BINDING_VERSION,
  inspectProjectAuthority,
  inventoryProject,
  createProjectAuthorityPlan,
  inspectProjectAuthorityRecovery,
  createProjectAuthorityRecoveryPlan,
  assertProjectMutationAuthority,
  createProjectMutationPlan,
  inspectProjectMutationRecovery,
  createProjectMutationRecoveryPlan,
  listProjectAuthorities,
  listProjectAuthorityRecords,
  explainProjectAuthorityPlan,
  projectAuthorityFromNaturalLanguage,
} from './project-authority.mjs';
export {CAPABILITY_STATUS_CODES, inspectCapabilityTransaction, discoverCapabilityMetadata, auditCapabilityArtifact, createCapabilityPlan, inspectCapabilityStatus} from './capability-authority.mjs';
export {OFFER_STATES, inspectFoundationOfferPreference, evaluateFoundationOffer, createOfferPreferencePlan} from './offer-consent.mjs';
export {LOCAL_LIFECYCLE_MANAGER_VERSION, LOCAL_LIFECYCLE_AI_SURFACE, LOCAL_LIFECYCLE_AI_TOOLS, inspectLocalLifecycle, requestLocalLifecyclePlan, openLocalLifecycleManagerPlan, readLocalLifecycleOperationStatus} from './lifecycle-manager.mjs';
export {PROJECT_LAYOUT_VERSION, PROJECT_LAYOUT_PATHS, inspectProjectLayout, snapshotProtectedProjectData, createProjectLayoutMigrationPlan, createProjectDataPurgePlan, createNormalUninstallProjectPlan, createNormalUninstallCompositePlan} from './project-layout.mjs';

export function verify(project) {
  const root = foundationFiles(project);
  if (!fs.existsSync(root)) return {ok: false, errors: ['缺少 .foundation']};
  const errors = [];
  let facts;
  try { facts = readFacts(project); } catch (error) { errors.push(`读取事实失败：${error.message}`); }
  if (facts) {
    const preview = inspectPreviewConfig(project, {facts});
    errors.push(...preview.errors);
    errors.push(...validateFacts(facts, {previewConfig: preview.ok ? preview.config : undefined, projectRoot: project}));
  }
  return {ok: errors.length === 0, errors};
}
