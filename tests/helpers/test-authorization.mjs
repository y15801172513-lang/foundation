import {applyCapabilityPlan} from '../../packages/core/capability-authority.mjs';
import {applyLifecyclePlan} from '../../packages/core/transaction-engine.mjs';
import {applyProjectAuthorityPlan, applyProjectAuthorityRecoveryPlan, applyProjectMutationRecoveryPlan} from '../../packages/core/project-authority.mjs';
import {
  authorizationEffectForCapabilityPlan,
  authorizationEffectForLifecyclePlan,
  authorizationEffectForProjectMutationPlan,
  authorizationEffectForProjectMutationRecoveryPlan,
  authorizationEffectForProjectPlan,
  authorizationEffectForProjectRecoveryPlan,
} from '../../packages/core/human-authorization.mjs';
import {loadTrustedAuthorityKey} from '../../packages/core/trusted-authority.mjs';
import {issueTestHumanAuthorization} from '../fixtures/test-protected-host-adapter.mjs';
import {configureRuntimeControl} from '../fixtures/test-runtime-surface.mjs';

export function authorizeLifecycle(plan, options) {
  loadTrustedAuthorityKey({create: true});
  return issueTestHumanAuthorization(authorizationEffectForLifecyclePlan(plan), options);
}

export function applyLifecycleForTest(plan, options = {}) {
  authorizeLifecycle(plan);
  configureRuntimeControl(options);
  try { return applyLifecyclePlan({plan, now: plan.createdAt + 1}); }
  finally { configureRuntimeControl(null); }
}

export function authorizeProject(plan, options) {
  loadTrustedAuthorityKey({create: true});
  return issueTestHumanAuthorization(authorizationEffectForProjectPlan(plan), options);
}

export function applyProjectForTest(plan, options = {}) {
  authorizeProject(plan);
  configureRuntimeControl(options);
  try { return applyProjectAuthorityPlan({plan, now: plan.createdAt + 1}); }
  finally { configureRuntimeControl(null); }
}

export function authorizeProjectMutation(plan, options) {
  loadTrustedAuthorityKey({create: true});
  return issueTestHumanAuthorization(authorizationEffectForProjectMutationPlan(plan), options);
}

export function authorizeCapability(plan, options) {
  loadTrustedAuthorityKey({create: true});
  return issueTestHumanAuthorization(authorizationEffectForCapabilityPlan(plan), options);
}

export function applyCapabilityForTest(plan, options = {}) {
  authorizeCapability(plan);
  return applyCapabilityPlan({plan, now: plan.createdAt + 1, ...options});
}

export function applyProjectRecoveryForTest(plan, options = {}) {
  issueTestHumanAuthorization(authorizationEffectForProjectRecoveryPlan(plan));
  return applyProjectAuthorityRecoveryPlan({plan, now: plan.createdAt + 1, ...options});
}

export function applyProjectMutationRecoveryForTest(plan, options = {}) {
  issueTestHumanAuthorization(authorizationEffectForProjectMutationRecoveryPlan(plan));
  return applyProjectMutationRecoveryPlan({plan, now: plan.createdAt + 1, ...options});
}
