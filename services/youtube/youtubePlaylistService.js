const axios = require('axios');

const API_BASE = 'https://www.googleapis.com/youtube/v3';

function getYoutubeApiKey() {
  return String(process.env.YOUTUBE_API_KEY || '').trim();
}

function ensureYoutubeApiKey() {
  const apiKey = getYoutubeApiKey();
  if (!apiKey) {
    const error = new Error('YouTube import requires YOUTUBE_API_KEY.');
    error.statusCode = 503;
    error.publicMessage = 'YouTube import requires YOUTUBE_API_KEY.';
    throw error;
  }
  return apiKey;
}

function createYoutubeError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

function normalizeYoutubeApiError(error) {
  if (error && error.publicMessage) return error;

  const status = Number(error && error.response && error.response.status) || 500;
  const rawMessage = String(
    error && error.response && error.response.data && error.response.data.error && error.response.data.error.message
    || error && error.message
    || ''
  ).toLowerCase();

  if (status === 403 && rawMessage.includes('quota')) {
    return createYoutubeError('YouTube API quota exceeded. Please try again later.', 429);
  }

  if (status === 404 || rawMessage.includes('playlist not found')) {
    return createYoutubeError('Playlist not found or inaccessible.', 404);
  }

  if (rawMessage.includes('private')) {
    return createYoutubeError('This playlist is private or inaccessible.', 403);
  }

  return createYoutubeError('Failed to fetch YouTube playlist data.', status || 500);
}

function parseIsoDurationToSeconds(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const match = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return (hours * 3600) + (minutes * 60) + seconds;
}

async function fetchPlaylistMeta(playlistId, apiKey) {
  const response = await axios.get(`${API_BASE}/playlists`, {
    params: {
      part: 'snippet,contentDetails',
      id: playlistId,
      key: apiKey,
      maxResults: 1
    },
    timeout: 20000
  });

  const item = Array.isArray(response.data && response.data.items) ? response.data.items[0] : null;
  if (!item) {
    const error = new Error('Playlist not found or inaccessible.');
    error.statusCode = 404;
    error.publicMessage = 'Playlist not found or inaccessible.';
    throw error;
  }

  return {
    playlistId,
    title: String(item.snippet && item.snippet.title || '').trim(),
    description: String(item.snippet && item.snippet.description || '').trim(),
    totalVideos: Number(item.contentDetails && item.contentDetails.itemCount || 0)
  };
}

async function fetchPlaylistItemsPage(playlistId, apiKey, pageToken) {
  const response = await axios.get(`${API_BASE}/playlistItems`, {
    params: {
      part: 'snippet,contentDetails,status',
      playlistId,
      key: apiKey,
      maxResults: 50,
      pageToken: pageToken || undefined
    },
    timeout: 20000
  });

  return {
    items: Array.isArray(response.data && response.data.items) ? response.data.items : [],
    nextPageToken: response.data && response.data.nextPageToken ? String(response.data.nextPageToken) : ''
  };
}

async function fetchVideoDetails(videoIds, apiKey) {
  if (!Array.isArray(videoIds) || !videoIds.length) return new Map();

  const response = await axios.get(`${API_BASE}/videos`, {
    params: {
      part: 'contentDetails,status,snippet',
      id: videoIds.join(','),
      key: apiKey,
      maxResults: 50
    },
    timeout: 20000
  });

  const map = new Map();
  const items = Array.isArray(response.data && response.data.items) ? response.data.items : [];
  items.forEach((item) => {
    map.set(String(item.id), item);
  });
  return map;
}

async function fetchPlaylistVideos(playlistId) {
  try {
    const apiKey = ensureYoutubeApiKey();
    const playlist = await fetchPlaylistMeta(playlistId, apiKey);
    const warnings = [];
    const rawItems = [];
    let nextPageToken = '';

    do {
      const page = await fetchPlaylistItemsPage(playlistId, apiKey, nextPageToken);
      rawItems.push(...page.items);
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);

    const orderedVideoIds = rawItems
      .map((item) => String(item && item.contentDetails && item.contentDetails.videoId || '').trim())
      .filter(Boolean);

    const detailMap = new Map();
    for (let index = 0; index < orderedVideoIds.length; index += 50) {
      const chunk = orderedVideoIds.slice(index, index + 50);
      const chunkMap = await fetchVideoDetails(chunk, apiKey);
      chunkMap.forEach((value, key) => detailMap.set(key, value));
    }

    const dedupe = new Set();
    const videos = [];

    rawItems.forEach((item, index) => {
      const videoId = String(item && item.contentDetails && item.contentDetails.videoId || '').trim();
      if (!videoId) {
        warnings.push(`Skipped unavailable playlist entry at position ${index + 1}.`);
        return;
      }

      if (dedupe.has(videoId)) {
        warnings.push(`Skipped duplicate video ${videoId}.`);
        return;
      }

      dedupe.add(videoId);
      const detail = detailMap.get(videoId);
      const privacyStatus = String(detail && detail.status && detail.status.privacyStatus || '').trim().toLowerCase();
      if (privacyStatus === 'private') {
        warnings.push(`Skipped private video at position ${index + 1}.`);
        return;
      }

      const snippet = item && item.snippet ? item.snippet : {};
      const detailSnippet = detail && detail.snippet ? detail.snippet : {};
      const title = String((snippet.title || detailSnippet.title || '').trim());
      if (!title || title.toLowerCase() === 'deleted video') {
        warnings.push(`Skipped deleted/unavailable video at position ${index + 1}.`);
        return;
      }

      const thumbnails = snippet.thumbnails || detailSnippet.thumbnails || {};
      const bestThumb = thumbnails.maxres || thumbnails.standard || thumbnails.high || thumbnails.medium || thumbnails.default || {};
      const durationSeconds = parseIsoDurationToSeconds(detail && detail.contentDetails && detail.contentDetails.duration);

      videos.push({
        title,
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: String(bestThumb.url || '').trim(),
        position: Number.isFinite(Number(snippet.position)) ? Number(snippet.position) : index,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null
      });
    });

    if (!videos.length) {
      throw createYoutubeError('No playable videos were found in this playlist.', 422);
    }

    return {
      playlist,
      videos: videos.sort((left, right) => left.position - right.position),
      warnings
    };
  } catch (error) {
    throw normalizeYoutubeApiError(error);
  }
}

module.exports = {
  ensureYoutubeApiKey,
  extractIsoDurationToSeconds: parseIsoDurationToSeconds,
  fetchPlaylistVideos
};
