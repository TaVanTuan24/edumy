'use strict';

function normalizeStoredPdfUrl(inputUrl) {
  const raw = String(inputUrl || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return raw.replace(/^http:\/\//i, 'https://');
  }
}

function isPublicCloudinaryRawUploadUrl(inputUrl) {
  const raw = normalizeStoredPdfUrl(inputUrl);
  if (!raw) return false;

  try {
    const parsed = new URL(raw);
    return /(^|\.)res\.cloudinary\.com$/i.test(parsed.hostname)
      && /\/raw\/upload\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isLikelyRestrictedCloudinaryPdfUrl(inputUrl) {
  const raw = normalizeStoredPdfUrl(inputUrl);
  if (!raw) return false;
  return /\/raw\/(authenticated|private)\//i.test(raw);
}

function getUploadedCloudinaryPdfUrl(uploadResult) {
  return normalizeStoredPdfUrl(uploadResult && uploadResult.secure_url);
}

function buildPdfDeliveryErrorMessage(status) {
  const numericStatus = Number(status) || 0;

  if (numericStatus === 401 || numericStatus === 403) {
    return 'PDF uploaded but not publicly accessible. Please check Cloudinary settings.';
  }

  if (numericStatus === 0) {
    return 'PDF uploaded, but the public Cloudinary URL could not be verified.';
  }

  return `PDF uploaded, but the public Cloudinary URL returned HTTP ${numericStatus}.`;
}

module.exports = {
  normalizeStoredPdfUrl,
  isPublicCloudinaryRawUploadUrl,
  isLikelyRestrictedCloudinaryPdfUrl,
  getUploadedCloudinaryPdfUrl,
  buildPdfDeliveryErrorMessage
};
