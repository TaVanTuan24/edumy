function extractPlaylistId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || '').toLowerCase();

    if (!host.includes('youtube.com') && !host.includes('youtu.be')) {
      return '';
    }

    const direct = parsed.searchParams.get('list');
    if (direct) return direct.trim();

    return '';
  } catch {
    return '';
  }
}

function isYouTubePlaylistUrl(input) {
  return Boolean(extractPlaylistId(input));
}

module.exports = {
  extractPlaylistId,
  isYouTubePlaylistUrl
};
