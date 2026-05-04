/**
 * Shared request helper utilities.
 */

function wantsJson(req) {
  const acceptHeader = String(req.get('Accept') || '').toLowerCase();
  const contentType = String(req.get('Content-Type') || '').toLowerCase();
  return Boolean(
    req.xhr
    || acceptHeader.includes('application/json')
    || contentType.includes('application/json')
    || (req.path && req.path.startsWith('/api/'))
    || (req.originalUrl && req.originalUrl.startsWith('/api/'))
    || (req.originalUrl && req.originalUrl.startsWith('/ai/'))
  );
}

module.exports = { wantsJson };