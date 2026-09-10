import {
  consumeHumanAuthorization,
  failHumanAuthorizationReservation,
  issueTestHumanAuthorization,
  reserveHumanAuthorization,
  verifyAuthorizedContinuation,
} from './test-protected-host-adapter.mjs';

export const reserveExactManagerConfirmation = reserveHumanAuthorization;
export const consumeExactManagerConfirmation = consumeHumanAuthorization;
export const failExactManagerConfirmation = failHumanAuthorizationReservation;

export function verifyManagerConfirmedContinuation(evidence, binding) {
  return verifyAuthorizedContinuation(evidence, binding);
}

export function publicManagerConfirmationReference(reservation) {
  return {
    schemaVersion: '1.0.0',
    confirmationId: reservation.authorizationId,
    sessionId: reservation.reservationId,
    authorizationId: reservation.authorizationId,
    reservationId: reservation.reservationId,
    brokerId: reservation.brokerId,
    hostId: reservation.hostId,
    effectHash: reservation.effectHash,
    planHash: null,
    issuedAt: reservation.issuedAt,
    expiresAt: reservation.expiresAt,
    decisionProvenance: reservation.decisionProvenance,
  };
}

export function runWithLocalManagerConfirmation(_context, callback) {
  for (const effect of _context.session.subEffects?.length ? _context.session.subEffects : [_context.session.effect]) issueTestHumanAuthorization(effect);
  return callback();
}
