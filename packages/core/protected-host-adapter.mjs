class ProtectedHostUnavailableError extends Error {
  constructor() {
    super('当前宿主没有独立于 AI/Foundation 进程的可信人类授权 broker；生产 mutation 已零写入停止');
    this.name = 'LifecycleError';
    this.code = 'HUMAN_AUTHORIZATION_BROKER_UNAVAILABLE';
    this.stage = 'human-authorization';
    this.retryable = false;
    this.recovery = '由受保护宿主展示 exact plan，并把单次授权直接交给 Foundation executor';
  }

  toJSON() {
    return {schemaVersion: '1.0.0', code: this.code, stage: this.stage, retryable: this.retryable, message: this.message, recovery: this.recovery, details: {}};
  }
}

export const PROTECTED_HOST_AUTHORIZATION_STATUS = Object.freeze({
  schemaVersion: '1.0.0',
  available: false,
  brokerIdentity: null,
  productionStatus: 'HUMAN_AUTHORIZATION_BROKER_UNAVAILABLE',
  aiCallableMint: false,
  persistence: 'unavailable',
});

function unavailable() {
  throw new ProtectedHostUnavailableError();
}

export function inspectProtectedHostAuthorization() {
  return PROTECTED_HOST_AUTHORIZATION_STATUS;
}

export function readCurrentHostRegistration() {
  return Object.freeze({schemaVersion: '1.0.0', available: false, identity: null, code: 'CAPABILITY_HOST_REGISTRATION_UNAVAILABLE', source: 'protected-host-unavailable', mutationPerformed: false});
}

export function reserveHumanAuthorization() {
  return unavailable();
}

export function consumeHumanAuthorization() {
  return unavailable();
}

export function failHumanAuthorizationReservation() {
  return unavailable();
}

export function verifyAuthorizedContinuation() {
  return unavailable();
}

export function readOfferPreference() {
  return {schemaVersion: '1.0.0', available: false, state: 'unknown', code: 'OFFER_PREFERENCE_PERSISTENCE_UNAVAILABLE', persistenceScope: 'current-host-unsupported'};
}

export function transitionOfferPreference() {
  return unavailable();
}
