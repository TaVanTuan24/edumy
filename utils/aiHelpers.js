/**
 * Shared utility functions used by AI services and controllers.
 */

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function chunkText(text) {
  if (!text) return [];
  return String(text).match(/[\s\S]{1,500}/g) || [];
}

function normalizeVideoUrl(url) {
  return String(url || '').trim().replace(/\?.*$/, '');
}

function extractYouTubeVideoId(url) {
  const text = String(url || '').trim();
  if (!text) return '';

  const watchMatch = text.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
  if (watchMatch && watchMatch[1]) return watchMatch[1];

  const shortMatch = text.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
  if (shortMatch && shortMatch[1]) return shortMatch[1];

  const embedMatch = text.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/);
  if (embedMatch && embedMatch[1]) return embedMatch[1];

  return '';
}

module.exports = {
  stripHtml,
  chunkText,
  normalizeVideoUrl,
  extractYouTubeVideoId
};