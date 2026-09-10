import {canonicalStringify, LifecycleError, sha256} from './install-contract.mjs';
import {
  consumeExactManagerConfirmation,
  failExactManagerConfirmation,
  publicManagerConfirmationReference,
  reserveExactManagerConfirmation,
  verifyManagerConfirmedContinuation,
} from './manager-confirmation.mjs';

export const HUMAN_AUTHORIZATION_VERSION = '1.0.0';

function normalizedTarget(target) {
  if (!target || typeof target !== 'object' || typeof target.path !== 'string' || !target.path) throw new LifecycleError('AUTHORIZATION_EFFECT_INVALID', '授权 effect 缺少 exact target path', {stage: 'human-authorization'});
  return {kind: target.kind || 'path', id: target.id || null, path: target.path, canonicalPath: target.canonicalPath || target.path, identity: target.identity || null};
}

export function createAuthorizationEffect({
  operationClass,
  operation,
  planId,
  planHash,
  installId = null,
  projectId = null,
  capabilityIds = [],
  targets = [],
  actions = [],
  creates = [],
  changes = [],
  deletes = [],
  preserves = [],
  expectedBeforeState = null,
  recoveryScope = null,
}) {
  if (typeof operationClass !== 'string' || !operationClass || typeof operation !== 'string' || !operation || typeof planId !== 'string' || !planId || !/^[0-9a-f]{64}$/u.test(planHash || '')) {
    throw new LifecycleError('AUTHORIZATION_EFFECT_INVALID', '授权 effect 必须绑定 operation class、operation、plan ID 和 immutable plan hash', {stage: 'human-authorization'});
  }
  const seed = {
    schemaVersion: HUMAN_AUTHORIZATION_VERSION,
    operationClass,
    operation,
    planId,
    planHash,
    installId,
    projectId,
    capabilityIds: [...capabilityIds].sort(),
    targets: targets.map(normalizedTarget).sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`)),
    actions: [...actions],
    creates: [...creates],
    changes: [...changes],
    deletes: [...deletes],
    preserves: [...preserves],
    expectedBeforeState,
    recoveryScope,
  };
  return Object.freeze({...seed, effectHash: sha256(canonicalStringify(seed))});
}

export function authorizationEffectForLifecyclePlan(plan, extra = {}) {
  return createAuthorizationEffect({
    operationClass: plan.operation === 'uninstall' ? 'foundation-owned-deletion' : plan.operation === 'recover' ? 'foundation-recovery' : 'foundation-lifecycle',
    operation: plan.operation,
    planId: plan.planId,
    planHash: plan.integrity?.hash,
    installId: plan.installId,
    targets: [
      {kind: 'foundation-installation', id: plan.installId, path: plan.targetRoot, canonicalPath: plan.targetRoot, identity: plan.authority?.targetSnapshot?.identity || null},
      ...(plan.bootstrap?.managerState?.path ? [{kind: 'foundation-bootstrap-state', id: plan.planId, path: plan.bootstrap.managerState.path, canonicalPath: plan.bootstrap.managerState.path, identity: null}] : []),
    ],
    actions: plan.actions || [],
    creates: plan.operation === 'install' ? ['foundation-installation-root', 'application', 'private-runtime', 'shim', 'state'] : [],
    changes: ['foundation-control-plane'],
    deletes: plan.operation === 'uninstall' ? [`uninstall-mode:${plan.mode}`] : [],
    preserves: ['user-projects', '.foundation/facts', 'project-owned-source-assets-components'],
    expectedBeforeState: {currentVersion: plan.currentVersion || null, targetSnapshot: plan.authority?.targetSnapshot || null, candidateHash: plan.candidate?.manifestHash || null, bootstrap: plan.bootstrap || null, ...(plan.hostCleanup ? {hostCleanup:plan.hostCleanup} : {})},
    recoveryScope: plan.recoverySnapshot || null,
    ...extra,
  });
}

export function authorizationEffectForProjectPlan(plan, extra = {}) {
  return createAuthorizationEffect({
    operationClass: 'foundation-project-authority',
    operation: `project-${plan.operation}${plan.rebind ? '-rebind' : ''}${plan.createFromTemplate ? '-create' : ''}`,
    planId: plan.planId,
    planHash: plan.integrity?.hash,
    installId: plan.installId || null,
    projectId: plan.projectId,
    targets: [
      {kind: 'product-project', id: plan.projectId, path: plan.project, canonicalPath: plan.project, identity: plan.projectSnapshot?.identity || null},
      {kind: 'foundation-installation', id: plan.installId || null, path: plan.installationRoot, canonicalPath: plan.installationRoot, identity: null},
    ],
    actions: plan.changes || [],
    creates: plan.operation === 'enable' ? plan.changes || [] : [],
    changes: plan.changes || [],
    deletes: [],
    preserves: plan.preserves || [],
    expectedBeforeState: {projectSnapshot: plan.projectSnapshot, portableBeforeHash: plan.portableBeforeHash, registryBeforeHash: plan.registryBeforeHash, installationIntegrityHash: plan.currentIntegrityHash},
    ...extra,
  });
}

export function authorizationEffectForProjectMutationPlan(plan, extra = {}) {
  return createAuthorizationEffect({
    operationClass: 'foundation-project-mutation',
    operation: plan.operation,
    planId: plan.planId,
    planHash: plan.integrity?.hash,
    installId: plan.installId,
    projectId: plan.projectId,
    capabilityIds: plan.capabilityIds || [],
    targets: [{kind: 'product-project', id: plan.projectId, path: plan.project, canonicalPath: plan.project, identity: plan.projectSnapshot?.identity || null}],
    actions: plan.actions || [],
    creates: plan.creates || [],
    changes: plan.changes || [],
    deletes: plan.deletes || [],
    preserves: plan.preserves || [],
    expectedBeforeState: {
      projectSnapshot: plan.projectSnapshot,
      authorityState: plan.authorityState,
      handler: plan.handler ? {
        handlerId: plan.handler.handlerId,
        handlerVersion: plan.handler.handlerVersion,
        payloadHash: plan.handler.payloadHash,
        allowedWriteSet: plan.handler.allowedWriteSet,
        beforeStateHash: plan.handler.beforeStateHash,
      } : null,
    },
    ...extra,
  });
}

export function authorizationEffectForProjectMutationRecoveryPlan(plan, extra = {}) {
  return createAuthorizationEffect({
    operationClass: 'foundation-project-mutation-recovery',
    operation: plan.operation,
    planId: plan.planId,
    planHash: plan.integrity?.hash,
    targets: [{kind: 'product-project', path: plan.project}],
    actions: plan.actions || [],
    changes: plan.changes || [],
    preserves: plan.preserves || [],
    expectedBeforeState: plan.recoverySnapshot,
    recoveryScope: (plan.recoverySnapshot?.pending || []).map((entry) => ({
      intentId: entry.intentId,
      effectHash: entry.effectHash,
      planHash: entry.planHash,
      fileHash: entry.fileHash,
      handlerId: entry.beforeState?.authorized?.handler?.handlerId || null,
    })),
    ...extra,
  });
}

export function authorizationEffectForCapabilityPlan(plan, extra = {}) {
  return createAuthorizationEffect({
    operationClass: 'foundation-capability-control-plane',
    operation: `capability-${plan.operation}`,
    planId: plan.planId,
    planHash: plan.integrity?.hash,
    installId: plan.installId,
    capabilityIds: [plan.capabilityId, ...(plan.dependencyCapabilityIds || [])],
    targets: [{kind: 'foundation-installation', id: plan.installId, path: plan.installationRoot}, ...(plan.project ? [{kind: 'product-project', id: null, path: plan.project}] : []), ...((plan.codexIntegration || plan.codexRemoval || plan.codexRecoveryDestination) ? [{kind: 'codex-user-skill', id: plan.capabilityId, path: plan.codexRecoveryDestination || (plan.codexIntegration || plan.codexRemoval).destination}] : [])],
    actions: plan.actions || [],
    changes: ['capability-receipt', 'host-registration', 'activation-state'],
    deletes: plan.operation === 'recover' ? plan.deletes || [] : plan.operation === 'uninstall' ? ['owned-capability-registration-and-receipt'] : [],
    recoveryScope: plan.operation === 'recover' ? plan.before : null,
    preserves: plan.preserves || [],
    expectedBeforeState: plan.before,
    ...extra,
  });
}

export function authorizationEffectForProjectRecoveryPlan(plan, extra = {}) {
  return createAuthorizationEffect({
    operationClass: 'foundation-project-authority-recovery',
    operation: 'project-authority-recover',
    planId: plan.planId,
    planHash: plan.integrity?.hash,
    installId: plan.installId,
    targets: [
      {kind: 'foundation-installation', id: plan.installId, path: plan.installationRoot},
      ...[...new Set((plan.recoverySnapshot?.journals || []).map((entry) => entry.project).filter((value) => typeof value === 'string' && value))].map((project) => ({kind: 'product-project', id: null, path: project})),
    ],
    actions: plan.changes || [],
    changes: plan.changes || [],
    preserves: plan.preserves || [],
    expectedBeforeState: plan.recoverySnapshot,
    recoveryScope: plan.recoverySnapshot?.journals || [],
    ...extra,
  });
}

export function reserveExactManagerConfirmationAtBoundary(effect) {
  return reserveExactManagerConfirmation(effect);
}

export function consumeExactManagerConfirmationAtBoundary(reservation, intent) {
  if (!reservation || reservation.effectHash !== intent?.effectHash) throw new LifecycleError('MANAGER_CONFIRMATION_BINDING_MISMATCH', 'manager confirmation 与 durable intent 不一致', {stage: 'human-authorization'});
  return consumeExactManagerConfirmation(reservation, intent);
}

export function failExactManagerConfirmationAtBoundary(reservation, failure) {
  return failExactManagerConfirmation(reservation, failure);
}

export function verifyManagerConfirmedContinuationAtBoundary(evidence, effectHash, intentId) {
  return verifyManagerConfirmedContinuation(evidence, {effectHash, intentId});
}

export function publicManagerConfirmationEvidence(reservation) {
  const reference = publicManagerConfirmationReference(reservation);
  return {...reference, authorizationId: reference.confirmationId};
}

// Source-only compatibility names for inherited 024 tests. Production callers use
// the manager-named boundary above; all aliases still fail closed outside a live
// local-manager execution context.
export const reserveExactHumanAuthorization = reserveExactManagerConfirmationAtBoundary;
export const consumeExactHumanAuthorization = consumeExactManagerConfirmationAtBoundary;
export const failExactHumanAuthorization = failExactManagerConfirmationAtBoundary;
export const verifyExactAuthorizedContinuation = verifyManagerConfirmedContinuationAtBoundary;
export const publicAuthorizationReference = publicManagerConfirmationEvidence;
