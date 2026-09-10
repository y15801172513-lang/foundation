import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STORE = path.join(ROOT, '.tmp', '027R1', 'test-host', 'authorization');
const KEY = Buffer.from('024R7 TEST ONLY protected host key; never package this adapter', 'utf8');
const BROKER_ID = 'test-only-protected-host-broker';
const HOST_ID = 'test-only-local-host';

class HostAuthorizationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LifecycleError';
    this.code = code;
    this.stage = 'human-authorization';
    this.retryable = false;
    this.recovery = '测试必须由 test-only protected host 签发与 exact effect 匹配的单次授权';
    this.details = details;
  }

  toJSON() {
    return {schemaVersion: '1.0.0', code: this.code, stage: this.stage, retryable: this.retryable, message: this.message, recovery: this.recovery, details: this.details};
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sign(payload) {
  return crypto.createHmac('sha256', KEY).update(canonical(payload)).digest('hex');
}

function verify(document) {
  if (!document || typeof document !== 'object') return null;
  const {integrity, ...payload} = document;
  const expected = sign(payload);
  if (integrity?.algorithm !== 'test-only-hmac-sha256' || integrity?.brokerId !== BROKER_ID || typeof integrity.hash !== 'string') return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(integrity.hash, 'hex'))) return null;
  return payload;
}

function write(file, payload) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({...payload, integrity: {algorithm: 'test-only-hmac-sha256', brokerId: BROKER_ID, hash: sign(payload)}}, null, 2)}\n`, {mode: 0o600, flag: 'wx'});
  fs.renameSync(temporary, file);
}

function lock(callback) {
  fs.mkdirSync(STORE, {recursive: true});
  const file = path.join(STORE, '.ledger.lock');
  const deadline = Date.now() + 5_000;
  let descriptor;
  while (descriptor === undefined) {
    try { descriptor = fs.openSync(file, 'wx', 0o600); }
    catch (error) {
      if (error?.code !== 'EEXIST' || Date.now() >= deadline) throw new HostAuthorizationError('HUMAN_AUTHORIZATION_BUSY', 'test protected-host ledger 正被另一个 executor 使用', {cause: error.code});
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify({pid: process.pid, nonce: crypto.randomUUID()})}\n`);
    fs.closeSync(descriptor); descriptor = null;
    return callback();
  } finally {
    if (descriptor !== null && descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
    try { fs.rmSync(file); } catch {}
  }
}

function records() {
  if (!fs.existsSync(STORE)) return [];
  return fs.readdirSync(STORE).filter((name) => name.startsWith('authorization-') && name.endsWith('.json')).sort().flatMap((name) => {
    const file = path.join(STORE, name);
    try { const payload = verify(JSON.parse(fs.readFileSync(file, 'utf8'))); return payload ? [{file, payload}] : []; }
    catch { return []; }
  });
}

export function resetTestAuthorizationHost() {
  fs.rmSync(STORE, {recursive: true, force: true});
}

export function issueTestHumanAuthorization(effect, {now = Date.now(), ttlMs = 60_000, state = 'issued', decision = 'approved', overrides = {}} = {}) {
  if (!effect?.effectHash) throw new Error('test authorization requires effect');
  const authorizationId = `authorization-${crypto.randomUUID()}`;
  const payload = {
    schemaVersion: '1.0.0',
    authorizationId,
    nonceHash: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
    brokerId: BROKER_ID,
    hostId: HOST_ID,
    hostUserSession: {osUser: 'test-user', sessionId: 'test-session', privilege: 'standard'},
    decisionProvenance: {kind: 'direct-human-test-fixture', decision, displayedPlanId: effect.planId, displayedEffectHash: effect.effectHash},
    operationClass: effect.operationClass,
    operation: effect.operation,
    effectHash: effect.effectHash,
    planId: effect.planId,
    planHash: effect.planHash,
    installId: effect.installId,
    projectId: effect.projectId,
    capabilityIds: effect.capabilityIds,
    targets: effect.targets,
    expectedBeforeState: effect.expectedBeforeState,
    createdAt: now,
    expiresAt: now + ttlMs,
    consumedAt: null,
    cancelledAt: state === 'revoked' ? now : null,
    state,
    ...overrides,
  };
  write(path.join(STORE, `${authorizationId}.json`), payload);
  return {authorizationId, effectHash: effect.effectHash};
}

export function inspectTestHumanAuthorization(authorizationId) {
  const file = path.join(STORE, `${authorizationId}.json`);
  if (!fs.existsSync(file)) return null;
  return verify(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function recordTestDirectOfferDecision(decision, {now = Date.now()} = {}) {
  if (!['accept', 'decline', 'uninstall', 'reopen'].includes(decision)) throw new Error('invalid direct test offer decision');
  const decisionId = `offer-decision-${crypto.randomUUID()}`;
  const payload = {schemaVersion: '1.0.0', decisionId, scope: 'foundation-global', decision, provenance: 'direct-human-test-fixture', state: 'pending', createdAt: now};
  write(path.join(STORE, `${decisionId}.json`), payload);
  return {decisionId};
}

export function inspectProtectedHostAuthorization() {
  return {schemaVersion: '1.0.0', available: true, brokerIdentity: BROKER_ID, productionStatus: 'test-only', aiCallableMint: false, persistence: 'test-host-ledger'};
}

export function readCurrentHostRegistration() {
  return Object.freeze({schemaVersion: '1.0.0', available: true, identity: 'codex-test-host-registration', source: 'test-only-protected-host', mutationPerformed: false});
}

export function reserveHumanAuthorization(effect) {
  return lock(() => {
    const matches = records().filter(({payload}) => payload.effectHash === effect.effectHash);
    const issued = matches.find(({payload}) => payload.state === 'issued');
    if (!issued) {
      const prior = matches.at(-1)?.payload;
      const code = prior?.state === 'consumed' || prior?.state === 'reserved' ? 'HUMAN_AUTHORIZATION_REPLAYED'
        : prior?.state === 'revoked' ? 'HUMAN_AUTHORIZATION_REVOKED'
          : prior?.state === 'expired' ? 'HUMAN_AUTHORIZATION_EXPIRED'
            : 'HUMAN_AUTHORIZATION_REQUIRED';
      throw new HostAuthorizationError(code, '没有可用于该 exact effect 的 issued 单次人类授权', {effectHash: effect.effectHash, priorState: prior?.state || null});
    }
    const record = issued.payload;
    if (record.expiresAt < Date.now()) {
      write(issued.file, {...record, state: 'expired'});
      throw new HostAuthorizationError('HUMAN_AUTHORIZATION_EXPIRED', '人类授权已过期', {authorizationId: record.authorizationId});
    }
    if (record.decisionProvenance?.kind !== 'direct-human-test-fixture' || record.decisionProvenance?.decision !== 'approved'
      || record.planId !== effect.planId || record.planHash !== effect.planHash || canonical(record.targets) !== canonical(effect.targets)
      || canonical(record.expectedBeforeState) !== canonical(effect.expectedBeforeState) || record.operation !== effect.operation
      || record.operationClass !== effect.operationClass || record.installId !== effect.installId || record.projectId !== effect.projectId
      || canonical(record.capabilityIds) !== canonical(effect.capabilityIds)) {
      throw new HostAuthorizationError('HUMAN_AUTHORIZATION_BINDING_MISMATCH', '授权 receipt 与 exact operation/effect/target/before-state 不一致', {authorizationId: record.authorizationId});
    }
    const reservationId = `reservation-${crypto.randomUUID()}`;
    const reserved = {...record, state: 'reserved', reservedAt: Date.now(), reservationId, reservedByPid: process.pid};
    write(issued.file, reserved);
    return {schemaVersion: '1.0.0', authorizationId: record.authorizationId, reservationId, brokerId: BROKER_ID, hostId: HOST_ID, effectHash: effect.effectHash, issuedAt: record.createdAt, expiresAt: record.expiresAt, decisionProvenance: record.decisionProvenance};
  });
}

export function consumeHumanAuthorization(reservation, intent) {
  return lock(() => {
    const file = path.join(STORE, `${reservation.authorizationId}.json`);
    const record = fs.existsSync(file) ? verify(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
    if (!record || record.state !== 'reserved' || record.reservationId !== reservation.reservationId || record.effectHash !== intent.effectHash) throw new HostAuthorizationError('HUMAN_AUTHORIZATION_RESERVATION_INVALID', 'reservation 不能与 durable intent 原子绑定');
    const consumed = {...record, state: 'consumed', consumedAt: Date.now(), intentId: intent.intentId, intentPathHash: intent.intentPathHash || null};
    write(file, consumed);
    return {authorizationId: consumed.authorizationId, effectHash: consumed.effectHash, intentId: consumed.intentId, consumedAt: consumed.consumedAt, state: consumed.state};
  });
}

export function failHumanAuthorizationReservation(reservation, failure = {}) {
  return lock(() => {
    const file = path.join(STORE, `${reservation.authorizationId}.json`);
    const record = fs.existsSync(file) ? verify(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
    if (!record || record.reservationId !== reservation.reservationId) return {state: 'manual-action-required'};
    const failed = {...record, state: failure.intentWritten ? 'consumed' : 'revoked', failedAt: Date.now(), failureCode: failure.code || 'MUTATION_FAILED', intentId: failure.intentId || record.intentId || null};
    write(file, failed);
    return {state: failed.state, authorizationId: failed.authorizationId};
  });
}

export function verifyAuthorizedContinuation(evidence, {effectHash, intentId}) {
  const file = path.join(STORE, `${evidence?.authorizationId}.json`);
  const record = fs.existsSync(file) ? verify(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
  if (!record || record.state !== 'consumed' || record.effectHash !== effectHash || record.intentId !== intentId) throw new HostAuthorizationError('HUMAN_AUTHORIZATION_CONTINUATION_INVALID', '原 durable authorization 不能证明该 recovery/finalizer continuation');
  return {ok: true, authorizationId: record.authorizationId, effectHash, intentId};
}

export function readOfferPreference() {
  const file = path.join(STORE, 'offer-preference.json');
  if (!fs.existsSync(file)) return {schemaVersion: '1.0.0', available: true, scope: 'foundation-global', state: 'never-offered', code: null, persistenceScope: 'test-shared-host'};
  const payload = verify(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!payload || payload.scope !== 'foundation-global') throw new HostAuthorizationError('OFFER_PREFERENCE_INVALID', 'test host offer preference 签名/范围无效');
  return {...payload, available: true, code: null, persistenceScope: 'test-shared-host'};
}

export function transitionOfferPreference({scope, transition, requestedState, directDecisionReference}) {
  return lock(() => {
    if (scope?.kind !== 'foundation-global') throw new HostAuthorizationError('OFFER_SCOPE_INVALID', 'offer preference scope 无效');
    const expected = {accept: 'accepted-plan-only', decline: 'declined', uninstall: 'uninstalled-suppress-offer', reopen: 'reopened', 'offer-presented': 'offered-awaiting-response'};
    if (expected[transition] !== requestedState) throw new HostAuthorizationError('OFFER_TRANSITION_INVALID', 'offer preference transition/state 不匹配');
    let provenance = 'protected-host-presentation';
    let decisionId = null;
    if (transition !== 'offer-presented') {
      decisionId = directDecisionReference?.decisionId;
      const decisionFile = decisionId ? path.join(STORE, `${decisionId}.json`) : null;
      const direct = decisionFile && fs.existsSync(decisionFile) ? verify(JSON.parse(fs.readFileSync(decisionFile, 'utf8'))) : null;
      if (!direct || direct.state !== 'pending' || direct.scope !== 'foundation-global' || direct.decision !== transition || direct.provenance !== 'direct-human-test-fixture') throw new HostAuthorizationError('HUMAN_AUTHORIZATION_REQUIRED', 'offer preference transition 缺少 direct protected-host decision');
      write(decisionFile, {...direct, state: 'consumed', consumedAt: Date.now()});
      provenance = direct.provenance;
    }
    const previous = readOfferPreference();
    const payload = {schemaVersion: '1.0.0', scope: 'foundation-global', state: requestedState, provenance, directDecisionId: decisionId, previousState: previous.state, updatedAt: Date.now()};
    write(path.join(STORE, 'offer-preference.json'), payload);
    return {...payload, available: true, code: null, persistenceScope: 'test-shared-host'};
  });
}
