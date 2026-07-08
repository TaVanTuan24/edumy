/**
 * Central resolver for the JWT signing/verification secret.
 *
 * A dedicated JWT_SECRET is strongly preferred so the JWT signing key is independent
 * from the session cookie signing key (SESSION_SECRET). If JWT_SECRET is not set we fall
 * back to SESSION_SECRET for backward compatibility with already-issued VR tokens, and
 * warn once so operators can rotate to a dedicated key.
 *
 * Both the signing side (createVRToken) and the verification side (attachJwtUser,
 * isVRAuthenticated) must use this helper so the two never diverge.
 */

const logger = require('./logger');

let warnedAboutFallback = false;

function getJwtSecret() {
  const dedicated = String(process.env.JWT_SECRET || '').trim();
  if (dedicated) {
    return dedicated;
  }

  const sessionSecret = String(process.env.SESSION_SECRET || '').trim();
  if (sessionSecret) {
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      logger.warn('[jwt] JWT_SECRET is not set; falling back to SESSION_SECRET. Set a dedicated JWT_SECRET so JWT and session signing keys are independent.');
    }
    return sessionSecret;
  }

  return '';
}

module.exports = { getJwtSecret };
