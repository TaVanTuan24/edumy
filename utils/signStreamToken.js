const crypto = require('crypto');

function base64UrlEncode(input) {
  const raw = Buffer.from(input).toString('base64');
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const normalized = String(input).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getSigningSecret() {
  return process.env.VR_STREAM_TOKEN_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
}

function signPayload(payloadObj) {
  const secret = getSigningSecret();
  if (!secret) {
    throw new Error('VR stream signing secret is not configured');
  }
  return crypto.createHmac('sha256', secret).update(payloadObj).digest('base64url');
}

function createStreamProxyToken(payload, ttlSeconds) {
  const now = Date.now();
  const parsedTtl = Number(ttlSeconds);
  const ttl = Number.isFinite(parsedTtl)
    ? parsedTtl
    : (Number(process.env.VR_STREAM_PROXY_TTL_SECONDS) || 300);
  const exp = now + (ttl * 1000);

  const data = {
    ...payload,
    exp
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(data));
  const signature = signPayload(encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(exp).toISOString()
  };
}

function verifyStreamProxyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) {
    return { valid: false, code: 'INVALID_INPUT', message: 'Invalid proxy token format' };
  }

  const [encodedPayload, signature] = token.split('.');
  const expected = signPayload(encodedPayload);

  if (signature !== expected) {
    return { valid: false, code: 'UNAUTHORIZED', message: 'Invalid proxy token signature' };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return { valid: false, code: 'INVALID_INPUT', message: 'Invalid proxy token payload' };
  }

  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || Date.now() > exp) {
    return { valid: false, code: 'UNAUTHORIZED', message: 'Proxy token has expired' };
  }

  return { valid: true, payload };
}

module.exports = {
  createStreamProxyToken,
  verifyStreamProxyToken
};
