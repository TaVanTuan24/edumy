const { formatDuration } = require('../../utils/duration');
const { generatePromptReply } = require('../ai/chatOrchestrator');
const { fetchPlaylistVideos } = require('./youtubePlaylistService');
const { extractPlaylistId } = require('./youtubeUrlParser');

function buildVideoLessons(videos) {
  return (Array.isArray(videos) ? videos : []).map((video, index) => ({
    id: `youtube-${video.videoId}-${index + 1}`,
    title: String(video.title || '').trim() || `Video ${index + 1}`,
    source: 'youtube',
    videoId: String(video.videoId || '').trim(),
    url: String(video.url || '').trim(),
    thumbnail: String(video.thumbnail || '').trim(),
    durationSeconds: Number.isFinite(Number(video.durationSeconds)) ? Number(video.durationSeconds) : null,
    durationFormatted: Number.isFinite(Number(video.durationSeconds)) ? formatDuration(Number(video.durationSeconds)) : '',
    position: index
  }));
}

function buildGroupingPrompt(playlistTitle, videos, options = {}) {
  const topic = String(options.topic || '').trim();
  const courseTitle = String(options.courseTitle || '').trim();
  return [
    'Group this YouTube playlist into meaningful course sections.',
    'Return strict JSON only.',
    'Every video index must appear exactly once.',
    'Keep the original order inside each section.',
    'Do not invent videos.',
    '',
    `Playlist title: ${playlistTitle}`,
    courseTitle ? `Proposed course title: ${courseTitle}` : '',
    topic ? `Topic: ${topic}` : '',
    '',
    'Videos:',
    ...videos.map((video, index) => `#${index}: ${video.title}${video.durationFormatted ? ` (${video.durationFormatted})` : ''}`),
    '',
    'Return format:',
    '{',
    '  "sections": [',
    '    {',
    '      "title": "Section name",',
    '      "description": "optional short summary",',
    '      "videoIndexes": [0, 1, 2]',
    '    }',
    '  ]',
    '}'
  ].filter(Boolean).join('\n');
}

function parseAiJson(raw) {
  const cleaned = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function validateGroupedSections(parsed, videoCount) {
  const sections = Array.isArray(parsed && parsed.sections) ? parsed.sections : [];
  if (!sections.length) return null;

  const seen = new Set();
  const normalized = [];

  for (const section of sections) {
    const indexes = Array.isArray(section && section.videoIndexes)
      ? section.videoIndexes.map((value) => Number(value)).filter((value) => Number.isInteger(value))
      : [];
    if (!indexes.length) continue;

    for (const index of indexes) {
      if (index < 0 || index >= videoCount || seen.has(index)) {
        return null;
      }
      seen.add(index);
    }

    normalized.push({
      title: String(section && section.title || '').trim() || `Section ${normalized.length + 1}`,
      description: String(section && section.description || '').trim(),
      videoIndexes: indexes.slice()
    });
  }

  if (seen.size !== videoCount) {
    return null;
  }

  return normalized;
}

function deterministicSections(videos) {
  const source = Array.isArray(videos) ? videos : [];
  const chunkSize = source.length <= 8 ? source.length : source.length <= 24 ? 6 : 8;
  const sections = [];

  for (let index = 0; index < source.length; index += chunkSize) {
    sections.push({
      title: `Section ${sections.length + 1}`,
      description: '',
      videoIndexes: source.slice(index, index + chunkSize).map((_video, offset) => index + offset)
    });
  }

  return sections;
}

async function groupVideosIntoSections(videos, options = {}) {
  const safeVideos = Array.isArray(videos) ? videos : [];
  if (!safeVideos.length) return { sections: [], strategy: 'none', model: '' };

  const prompt = buildGroupingPrompt(String(options.playlistTitle || ''), safeVideos, options);
  const attempts = ['gpt-5.5', 'gpt-5.4', 'grok-api'];

  for (const model of attempts) {
    try {
      const raw = await generatePromptReply({
        userId: options.userId,
        model,
        prompt,
        options: {
          temperature: 0.2,
          topP: 0.9,
          maxTokens: 1400,
          timeoutMs: 120000
        }
      });
      const parsed = parseAiJson(raw);
      const validated = validateGroupedSections(parsed, safeVideos.length);
      if (validated) {
        return {
          sections: validated,
          strategy: 'ai',
          model
        };
      }
    } catch (_error) {
      // Try the next model, then deterministic fallback.
    }
  }

  return {
    sections: deterministicSections(safeVideos),
    strategy: 'deterministic',
    model: ''
  };
}

function buildImportPreview({ playlist, sections, lessons, warnings, grouping }) {
  const previewSections = sections.map((section, sectionIndex) => ({
    id: `section-${sectionIndex + 1}`,
    title: section.title || `Section ${sectionIndex + 1}`,
    description: section.description || '',
    videos: section.videoIndexes.map((videoIndex) => ({
      ...lessons[videoIndex],
      index: videoIndex
    }))
  }));

  return {
    playlistTitle: playlist.title,
    playlistDescription: playlist.description,
    totalVideos: lessons.length,
    sections: previewSections,
    warnings: Array.isArray(warnings) ? warnings : [],
    groupingStrategy: grouping.strategy,
    groupingModel: grouping.model
  };
}

function buildCourseSectionsFromPreview(previewSections) {
  return (Array.isArray(previewSections) ? previewSections : [])
    .map((section, sectionIndex) => {
      const videos = Array.isArray(section && section.videos) ? section.videos : [];
      const lessons = videos.map((video, lessonIndex) => ({
        title: String(video && video.title || '').trim() || `Video ${lessonIndex + 1}`,
        type: 'video',
        videoUrl: String(video && video.url || '').trim(),
        preview: String(video && video.url || '').trim(),
        refId: String(video && video.videoId || '').trim(),
        durationSeconds: Number.isFinite(Number(video && video.durationSeconds)) ? Number(video.durationSeconds) : null,
        durationFormatted: String(video && video.durationFormatted || '').trim(),
        content: {
          videoUrl: String(video && video.url || '').trim(),
          source: 'youtube',
          youtubeVideoId: String(video && video.videoId || '').trim(),
          thumbnailUrl: String(video && video.thumbnail || '').trim(),
          durationSeconds: Number.isFinite(Number(video && video.durationSeconds)) ? Number(video.durationSeconds) : null,
          durationFormatted: String(video && video.durationFormatted || '').trim()
        },
        order: lessonIndex
      }));

      return {
        title: String(section && section.title || '').trim() || `Section ${sectionIndex + 1}`,
        lessons,
        order: sectionIndex
      };
    })
    .filter((section) => Array.isArray(section.lessons) && section.lessons.length > 0);
}

async function previewYoutubeImport({ playlistUrl, userId, options = {} }) {
  const playlistId = options.playlistId || extractPlaylistId(playlistUrl);
  if (!playlistId) {
    const error = new Error('Invalid YouTube playlist URL.');
    error.statusCode = 400;
    error.publicMessage = 'Invalid YouTube playlist URL.';
    throw error;
  }

  const imported = await fetchPlaylistVideos(playlistId);
  const lessons = buildVideoLessons(imported.videos);
  const grouping = await groupVideosIntoSections(lessons, {
    ...options,
    playlistTitle: imported.playlist.title,
    userId
  });

  return buildImportPreview({
    playlist: imported.playlist,
    sections: grouping.sections,
    lessons,
    warnings: imported.warnings,
    grouping
  });
}

module.exports = {
  buildVideoLessons,
  groupVideosIntoSections,
  buildCourseSectionsFromPreview,
  previewYoutubeImport
};
