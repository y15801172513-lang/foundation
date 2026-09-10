import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {createAuthorizationEffect} from './human-authorization.mjs';
import {LifecycleError, sha256, canonicalStringify} from './install-contract.mjs';
import {consumeExactManagerConfirmation, failExactManagerConfirmation, publicManagerConfirmationReference, reserveExactManagerConfirmation} from './manager-confirmation.mjs';

export const OFFER_STATES = Object.freeze(['never-offered', 'offered-awaiting-response', 'accepted-plan-only', 'declined', 'uninstalled-suppress-offer', 'reopened']);
const sessionSuppression = new Set();

function fail(code, message) { throw new LifecycleError(code, message, {stage: 'offer-consent', recovery: '由用户明确打开 Foundation settings 并在本地管理器中确认 preference plan'}); }
function preferenceFile(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail('OFFER_SETTINGS_PATH_INVALID', 'offer settingsFile 必须是绝对路径');
  const file = path.resolve(value);
  let cursor = path.dirname(file);
  while (!fs.existsSync(cursor) && path.dirname(cursor) !== cursor) cursor = path.dirname(cursor);
  if (fs.existsSync(cursor) && (fs.lstatSync(cursor).isSymbolicLink() || fs.realpathSync(cursor) !== cursor)) fail('OFFER_SETTINGS_PATH_INVALID', 'offer settingsFile 祖先路径不稳定');
  return file;
}
function current(file) {
  if (!file || !fs.existsSync(file)) return {schemaVersion: '1.0.0', scope: 'foundation-global', state: 'never-offered', updatedAt: null};
  if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) fail('OFFER_SETTINGS_INVALID', 'offer preference 不是普通文件');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value?.schemaVersion !== '1.0.0' || value?.scope !== 'foundation-global' || !OFFER_STATES.includes(value?.state)) fail('OFFER_SETTINGS_INVALID', 'offer preference schema 无效');
  return value;
}

export function inspectFoundationOfferPreference({settingsFile = null} = {}) {
  const file = preferenceFile(settingsFile);
  const value = current(file);
  const sessionSuppressed = sessionSuppression.has('foundation-global');
  return {...value, state: !file && sessionSuppressed ? 'offered-awaiting-response' : value.state, available: Boolean(file), persistenceScope: file ? 'foundation-global-local-settings' : 'current-process-only', sessionSuppressed, mutationPerformed: false};
}
export function evaluateFoundationOffer({explicitGoal, materiallyNeedsFoundation, discoveryOnly = false, settingsFile = null} = {}) {
  const preference = inspectFoundationOfferPreference({settingsFile});
  const base = {schemaVersion: '1.0.0', scope: {kind: 'foundation-global'}, preference, applies: false};
  if (discoveryOnly || !explicitGoal || !materiallyNeedsFoundation) return {...base, decision: 'do-not-offer', reason: discoveryOnly ? 'metadata-discovery-is-inert' : 'current-explicit-goal-does-not-materially-need-foundation'};
  if (sessionSuppression.has('foundation-global') || ['declined', 'uninstalled-suppress-offer', 'offered-awaiting-response'].includes(preference.state)) return {...base, decision: 'suppress', reason: `preference:${preference.state}`};
  return {...base, decision: 'offer-once', reason: preference.state === 'reopened' ? 'foundation-settings-reopened' : 'first-relevant-offer'};
}
export function markFoundationOfferPresented() {
  sessionSuppression.add('foundation-global');
  return {schemaVersion: '1.0.0', state: 'offered-awaiting-response', code: 'OFFER_PREFERENCE_PERSISTENCE_UNAVAILABLE', persistenceScope: 'current-process-only', durableDecisionRecorded: false, mutationPerformed: false};
}
export function recordFoundationOfferDecision({decision} = {}) {
  if (!['decline', 'uninstall', 'reopen', 'accept'].includes(decision)) fail('OFFER_DECISION_INVALID', 'offer preference decision 无效');
  if (['decline', 'uninstall'].includes(decision)) sessionSuppression.add('foundation-global');
  return {schemaVersion: '1.0.0', available: false, state: decision === 'decline' ? 'declined' : decision === 'uninstall' ? 'uninstalled-suppress-offer' : inspectFoundationOfferPreference().state, requestedState: decision === 'reopen' ? 'reopened' : decision === 'accept' ? 'accepted-plan-only' : null, code: decision === 'reopen' ? 'OFFER_REOPEN_AUTHORITY_UNAVAILABLE' : decision === 'accept' ? 'OFFER_POSITIVE_AUTHORITY_UNAVAILABLE' : 'OFFER_PREFERENCE_PERSISTENCE_UNAVAILABLE', persistenceScope: 'current-process-only', durableDecisionRecorded: false, suppressionChanged: false, applyAuthorized: false, permission: 'open-foundation-settings-and-request-exact-plan', mutationPerformed: false};
}

export function createOfferPreferencePlan({decision, settingsFile, now = Date.now(), ttlMs = 15 * 60 * 1000}) {
  if (!['decline', 'uninstall', 'reopen', 'accept'].includes(decision)) fail('OFFER_DECISION_INVALID', 'offer preference decision 无效');
  const file = preferenceFile(settingsFile);
  if (!file) fail('OFFER_SETTINGS_PATH_REQUIRED', 'durable offer preference plan 需要 settingsFile');
  const before = current(file);
  const beforeHash = fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null;
  const state = decision === 'decline' ? 'declined' : decision === 'uninstall' ? 'uninstalled-suppress-offer' : decision === 'reopen' ? 'reopened' : 'accepted-plan-only';
  const seed = {schemaVersion: '1.0.0', operationClass: 'foundation-global-settings', operation: 'offer-preference-update', decision, requestedState: state, settingsFile: file, creates: beforeHash ? [] : [file], replacements: beforeHash ? [file] : [], deletes: [], preserves: ['all-projects', '.foundation/facts', 'capability-state'], fileCount: beforeHash ? 1 : 0, byteCount: fs.existsSync(file) ? fs.statSync(file).size : 0, protectedDataHashes: {}, expectedBeforeState: {value: before, fileHash: beforeHash}, createdAt: now, expiresAt: now + ttlMs};
  const planId = `offer-plan-${sha256(canonicalStringify(seed)).slice(0, 24)}`;
  const unsigned = {...seed, planId, operationId: planId};
  return Object.freeze({...unsigned, integrity: {algorithm: 'sha256', hash: sha256(canonicalStringify(unsigned))}});
}
export function authorizationEffectForOfferPreferencePlan(plan) {
  return createAuthorizationEffect({operationClass: plan.operationClass, operation: plan.operation, planId: plan.planId, planHash: plan.integrity?.hash, targets: [{kind: 'foundation-global-settings', path: plan.settingsFile}], actions: [`offer-preference:${plan.decision}`], creates: plan.creates, changes: plan.replacements, deletes: [], preserves: plan.preserves, expectedBeforeState: plan.expectedBeforeState});
}
function validate(plan, now) {
  const {integrity, ...unsigned} = plan || {};
  if (plan?.operation !== 'offer-preference-update' || integrity?.hash !== sha256(canonicalStringify(unsigned)) || now > plan.expiresAt) fail('OFFER_PREFERENCE_PLAN_INVALID', 'offer preference plan 无效、过期或已改写');
  const file = preferenceFile(plan.settingsFile);
  const hash = fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null;
  if (hash !== plan.expectedBeforeState.fileHash || canonicalStringify(current(file)) !== canonicalStringify(plan.expectedBeforeState.value)) fail('MANAGER_PLAN_STATE_DRIFT', 'offer preference 在 plan 后变化');
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx', mode: 0o600});
  fs.renameSync(temporary, file);
}
export function applyOfferPreferencePlan({plan, now = Date.now()}) {
  validate(plan, now);
  const effect = authorizationEffectForOfferPreferencePlan(plan);
  const reservation = reserveExactManagerConfirmation(effect);
  const reference = publicManagerConfirmationReference(reservation);
  try {
    validate(plan, now);
    consumeExactManagerConfirmation(reservation, {effectHash: effect.effectHash, intentId: plan.planId, intentPathHash: sha256(canonicalStringify(plan.expectedBeforeState))});
    const value = {schemaVersion: '1.0.0', scope: 'foundation-global', state: plan.requestedState, decision: plan.decision, updatedAt: new Date(now).toISOString(), source: 'foundation-local-manager-settings'};
    atomic(plan.settingsFile, value);
    if (['declined', 'uninstalled-suppress-offer'].includes(value.state)) sessionSuppression.add('foundation-global'); else sessionSuppression.delete('foundation-global');
    return {...value, confirmationId: reference.confirmationId, applyAuthorized: false};
  } catch (error) {
    try { failExactManagerConfirmation(reservation, {code: error.code || 'OFFER_PREFERENCE_APPLY_FAILED'}); } catch {}
    throw error;
  }
}
export function offerDecisionEffect({decision, settingsFile = null}) { return sha256(canonicalStringify({schemaVersion: '1.0.0', scope: 'foundation-global', decision, settingsFile})); }
