const crypto = require('crypto');

function cspNonce(req, res, next) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  next();
}

module.exports = { cspNonce };