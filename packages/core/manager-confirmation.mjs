import {AsyncLocalStorage} from 'node:async_hooks';

import {canonicalStringify, LifecycleError} from './install-contract.mjs';

const activeManagerExecution = new AsyncLocalStorage();

function managerError(code, message, details = {}) {
  return new LifecycleError(code, message, {
    stage: 'local-lifecycle-manager',
    retryable: code === 'MANAGER_CONFIRMATION_EXPIRED' || code === 'MANAGER_PLAN_STATE_DRIFT',
    recovery: code === 'MANAGER_CONFIRMATION_REQUIRED'
      ? '只读检查或重新生成 exact plan，然后由用户在 Foundation 本地管理器中查看并点击该操作的确认按钮'
      : '返回 Foundation 本地管理器刷新计划；不要从 AI、CLI 参数或脚本制造确认状态',
    details,
  });
}

export function runWithLocalManagerConfirmation(context, callback) {
  if (!context || context.session?.state !== 'executing' || typeof context.onConsume !== 'function') {
    throw managerError('MANAGER_CONFIRMATION_INVALID', '本地管理器执行上下文无效');
  }
  return activeManagerExecution.run({...context, reservations: new Map(), consumedEffects: new Set()}, callback);
}

export function reserveExactManagerConfirmation(effect) {
  const active = activeManagerExecution.getStore();
  if (!active) throw managerError('MANAGER_CONFIRMATION_REQUIRED', '该 mutation 没有来自 Foundation 本地管理器 UI 的本次 exact confirmation', {effectHash: effect?.effectHash || null});
  const session = active.session;
  if (Date.now() > session.expiresAt) throw managerError('MANAGER_CONFIRMATION_EXPIRED', '本地管理器确认已过期，尚未写入目标', {sessionId: session.sessionId});
  const allowedEffects = session.subEffects?.length ? session.subEffects : [session.effect];
  const allowed = allowedEffects.find((entry) => entry.effectHash === effect?.effectHash && entry.planHash === effect?.planHash && canonicalStringify(entry) === canonicalStringify(effect));
  if (!allowed || active.reservations.has(effect?.effectHash) || active.consumedEffects.has(effect?.effectHash)) {
    throw managerError(active.reservations.has(effect?.effectHash) || active.consumedEffects.has(effect?.effectHash) ? 'MANAGER_CONFIRMATION_REPLAYED' : 'MANAGER_CONFIRMATION_BINDING_MISMATCH', '本地管理器确认与当前 exact effect 不一致或已被使用', {sessionId: session.sessionId, expectedEffectHashes: allowedEffects.map((entry) => entry.effectHash), receivedEffectHash: effect?.effectHash || null});
  }
  active.revalidate?.({consumedEffectHashes: [...active.consumedEffects]});
  const reservation = Object.freeze({
    schemaVersion: '1.0.0',
    confirmationId: session.sessionId,
    sessionId: session.sessionId,
    effectHash: allowed.effectHash,
    planHash: allowed.planHash,
    issuedAt: session.confirmedAt,
    expiresAt: session.expiresAt,
    decisionProvenance: {kind: 'foundation-local-manager-ui', action: session.confirmationAction},
  });
  active.reservations.set(effect.effectHash, reservation);
  return reservation;
}

export function consumeExactManagerConfirmation(reservation, intent) {
  const active = activeManagerExecution.getStore();
  if (!active || active.reservations.get(reservation?.effectHash) !== reservation || active.consumedEffects.has(reservation?.effectHash)) throw managerError('MANAGER_CONFIRMATION_REPLAYED', '本地管理器 confirmation 已消费或 reservation 不属于当前执行', {effectHash: reservation?.effectHash || null, reservedEffectHashes: active ? [...active.reservations.keys()] : [], consumedEffectHashes: active ? [...active.consumedEffects] : []});
  if (reservation.effectHash !== intent?.effectHash || typeof intent?.intentId !== 'string' || !intent.intentId || typeof intent?.intentPathHash !== 'string' || !/^[0-9a-f]{64}$/u.test(intent.intentPathHash)) {
    throw managerError('MANAGER_CONFIRMATION_BINDING_MISMATCH', 'confirmation reservation 未绑定当前 durable intent', {sessionId: reservation.sessionId});
  }
  active.revalidate?.({consumedEffectHashes: [...active.consumedEffects]});
  active.consumedEffects.add(reservation.effectHash);
  active.onConsume({intentId: intent.intentId, intentPathHash: intent.intentPathHash, consumedAt: Date.now()});
  return Object.freeze({confirmationId: reservation.confirmationId, effectHash: reservation.effectHash, intentId: intent.intentId, state: 'consumed'});
}

export function failExactManagerConfirmation(reservation, failure = {}) {
  const active = activeManagerExecution.getStore();
  if (!active || active.reservations.get(reservation?.effectHash) !== reservation || active.consumedEffects.has(reservation?.effectHash)) return {state: 'unchanged'};
  active.onFailure?.({code: failure.code || 'MANAGER_EXECUTION_FAILED', failedAt: Date.now()});
  return {state: 'failed', confirmationId: reservation.confirmationId};
}

export function verifyManagerConfirmedContinuation(evidence, binding) {
  if (!evidence || typeof (evidence.confirmationId || evidence.authorizationId) !== 'string' || evidence.effectHash !== binding?.effectHash || (evidence.intentId && evidence.intentId !== binding?.intentId)) {
    throw managerError('MANAGER_CONTINUATION_INVALID', '既有 manager confirmation 不能证明该 continuation');
  }
  return {ok: true, confirmationId: evidence.confirmationId || evidence.authorizationId, effectHash: binding.effectHash, intentId: binding.intentId};
}

export function publicManagerConfirmationReference(reservation) {
  if (!reservation) throw managerError('MANAGER_CONFIRMATION_INVALID', 'manager confirmation reservation 不存在');
  return Object.freeze({
    schemaVersion: '1.0.0',
    confirmationId: reservation.confirmationId,
    sessionId: reservation.sessionId,
    effectHash: reservation.effectHash,
    planHash: reservation.planHash,
    issuedAt: reservation.issuedAt,
    expiresAt: reservation.expiresAt,
    decisionProvenance: reservation.decisionProvenance,
  });
}
