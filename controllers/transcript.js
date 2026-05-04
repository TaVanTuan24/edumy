const mongoose = require('mongoose');
const Video = require('../models/video');
const Transcript = require('../models/Transcript');
const ExpressError = require('../utils/ExpressError');
const { aiConfig } = require('../config/ai');
const { generatePromptReply } = require('../services/ai/chatOrchestrator');

let fetchTranscriptFn = null;

async function getFetchTranscript() {
  if (fetchTranscriptFn) return fetchTranscriptFn;

  const ytModule = await import('youtube-transcript/dist/youtube-transcript.esm.js');
  fetchTranscriptFn = ytModule && ytModule.fetchTranscript;

  if (typeof fetchTranscriptFn !== 'function') {
    throw new ExpressError('Failed to initialize YouTube transcript provider', 500);
  }

  return fetchTranscriptFn;
}

function extractYouTubeId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const idPattern = /^[a-zA-Z0-9_-]{11}$/;
  if (idPattern.test(raw)) return raw;

  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || '').toLowerCase();
    const path = String(parsed.pathname || '');

    if (host.includes('youtu.be')) {
      const token = path.replace(/^\//, '').split('/')[0];
      return token || '';
    }

    if (host.includes('youtube.com')) {
      const fromQuery = parsed.searchParams.get('v') || parsed.searchParams.get('vi');
      if (fromQuery) return fromQuery;

      const embedMatch = path.match(/^\/embed\/([^/?#]+)/i);
      if (embedMatch) return embedMatch[1];

      const shortsMatch = path.match(/^\/shorts\/([^/?#]+)/i);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    return '';
  }

  return '';
}

function formatSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;

  if (hh > 0) {
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function parseTimestampToSeconds(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return 0;

  if (/^\d+$/.test(raw)) {
    return Math.max(0, Number(raw));
  }

  const hhmmss = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hhmmss) {
    return (Number(hhmmss[1]) * 3600) + (Number(hhmmss[2]) * 60) + Number(hhmmss[3]);
  }

  const mmss = raw.match(/^(\d{1,3}):(\d{2})$/);
  if (mmss) {
    return (Number(mmss[1]) * 60) + Number(mmss[2]);
  }

  return 0;
}

function getTranscriptTimeScale(segments) {
  const source = Array.isArray(segments) ? segments : [];
  if (!source.length) return 1;

  const durations = source
    .map((entry) => Math.max(0, Number(entry && entry.duration) || 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const offsets = source
    .map((entry) => Math.max(0, Number(entry && entry.offset) || 0))
    .filter((n) => Number.isFinite(n) && n > 0);

  const medianDuration = durations.length
    ? durations[Math.floor(durations.length / 2)]
    : 0;
  const maxOffset = offsets.length ? Math.max(...offsets) : 0;

  // youtube-transcript may return milliseconds depending on source track.
  if (medianDuration > 120 || maxOffset > 100000) {
    return 1000;
  }

  return 1;
}

function normalizeSegmentTime(value, scale) {
  const parsed = Math.max(0, Number(value) || 0);
  if (!parsed) return 0;
  return parsed / (scale || 1);
}

function inferVideoDurationFromTranscript(transcriptSegments) {
  const segments = Array.isArray(transcriptSegments) ? transcriptSegments : [];
  const scale = getTranscriptTimeScale(segments);
  let maxEnd = 0;

  for (const segment of segments) {
    const offset = normalizeSegmentTime(segment && segment.offset, scale);
    const duration = normalizeSegmentTime(segment && segment.duration, scale);
    const end = offset + duration;
    if (end > maxEnd) maxEnd = end;
  }

  return Math.max(0, Math.floor(maxEnd));
}

function _findNearestTranscriptOffset(transcriptOffsets, targetSeconds) {
  const offsets = Array.isArray(transcriptOffsets) ? transcriptOffsets : [];
  if (!offsets.length) return Math.max(0, Math.floor(targetSeconds));

  let nearest = offsets[0];
  let minDistance = Math.abs(nearest - targetSeconds);

  for (let i = 1; i < offsets.length; i += 1) {
    const candidate = offsets[i];
    const distance = Math.abs(candidate - targetSeconds);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = candidate;
    }
  }

  return Math.max(0, Math.floor(nearest));
}

function findNearestTranscriptOffsetAtOrAfter(transcriptOffsets, targetSeconds, fallbackMax) {
  const offsets = Array.isArray(transcriptOffsets) ? transcriptOffsets : [];
  if (!offsets.length) {
    return Math.max(0, Math.floor(targetSeconds));
  }

  const target = Math.max(0, Number(targetSeconds) || 0);
  for (let i = 0; i < offsets.length; i += 1) {
    if (offsets[i] >= target) return Math.floor(offsets[i]);
  }

  if (Number.isFinite(Number(fallbackMax))) {
    return Math.max(0, Math.min(Math.floor(fallbackMax), Math.floor(offsets[offsets.length - 1])));
  }

  return Math.floor(offsets[offsets.length - 1]);
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchText(value) {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'where', 'what',
    'which', 'your', 'have', 'has', 'had', 'will', 'would', 'about', 'after', 'before',
    'trong', 'nhung', 'nhung', 'nhung', 'khi', 'voi', 'cho', 'mot', 'cac', 'la', 'duoc',
    'nhu', 'nay', 'kia', 'roi', 'dang', 'vua', 'ban', 'toi', 'anh', 'chi', 'em', 'va',
    'cua', 'tren', 'duoi', 'sau', 'truoc', 'neu', 'thi', 'hay', 'de', 'lam', 'hoc', 'bai'
  ]);

  return normalizeSearchText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function buildTranscriptSearchIndex(transcriptSegments, scale, startWindow, endWindow) {
  const source = Array.isArray(transcriptSegments) ? transcriptSegments : [];

  return source
    .map((segment) => {
      const offset = normalizeSegmentTime(segment && segment.offset, scale);
      const text = String(segment && segment.text || '').trim();
      return {
        offset,
        text,
        normalizedText: normalizeSearchText(text),
        tokenSet: new Set(tokenizeSearchText(text))
      };
    })
    .filter((entry) => entry.text && entry.offset >= startWindow && entry.offset <= endWindow)
    .sort((a, b) => a.offset - b.offset);
}

function estimateConceptMatch(quiz, transcriptIndex, startWindow, endWindow) {
  const safeStart = Math.max(0, Number(startWindow) || 0);
  const safeEnd = Math.max(safeStart, Number(endWindow) || safeStart);
  const source = Array.isArray(transcriptIndex) ? transcriptIndex : [];
  if (!source.length) {
    return {
      readyOffset: safeStart,
      bestScore: 0,
      strongMatch: false
    };
  }

  const quizContext = [
    quiz && quiz.question,
    quiz && Array.isArray(quiz.options) ? quiz.options.join(' ') : '',
    quiz && quiz.explanation
  ].join(' ');

  const keywords = Array.from(new Set(tokenizeSearchText(quizContext))).slice(0, 24);
  if (!keywords.length) {
    return {
      readyOffset: safeStart,
      bestScore: 0,
      strongMatch: false
    };
  }

  let firstStrongOffset = null;
  let bestOffset = safeStart;
  let bestScore = 0;

  for (const entry of source) {
    let overlap = 0;
    let longestMatchLength = 0;

    for (const keyword of keywords) {
      if (entry.tokenSet.has(keyword) || entry.normalizedText.includes(keyword)) {
        overlap += 1;
        if (keyword.length > longestMatchLength) longestMatchLength = keyword.length;
      }
    }

    if (overlap > bestScore) {
      bestScore = overlap;
      bestOffset = entry.offset;
    }

    const isStrong = overlap >= 2 || (overlap >= 1 && longestMatchLength >= 6);
    if (isStrong && firstStrongOffset === null) {
      firstStrongOffset = entry.offset;
    }
  }

  if (bestScore <= 0) {
    return {
      readyOffset: safeStart,
      bestScore: 0,
      strongMatch: false
    };
  }

  // Wait a bit after concept appears so learners likely already saw the explanation.
  const firstLearnedOffset = firstStrongOffset === null ? bestOffset : firstStrongOffset;
  const conceptReadyOffset = Math.max(firstLearnedOffset + 20, bestOffset + 45);

  const readyOffset = Math.max(safeStart, Math.min(safeEnd, conceptReadyOffset));

  return {
    readyOffset,
    bestScore,
    strongMatch: firstStrongOffset !== null || bestScore >= 2
  };
}

function distributeQuizTimestampsEvenly(quizItems, transcriptSegments, options = {}) {
  const quizzes = Array.isArray(quizItems) ? quizItems.slice() : [];
  if (!quizzes.length) return [];

  const strictMode = Boolean(options && options.strictMode);

  const durationSec = inferVideoDurationFromTranscript(transcriptSegments);
  if (durationSec <= 0) return quizzes;

  const scale = getTranscriptTimeScale(transcriptSegments);

  const transcriptOffsets = (Array.isArray(transcriptSegments) ? transcriptSegments : [])
    .map((segment) => normalizeSegmentTime(segment && segment.offset, scale))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  // Lock intro region: avoid showing quizzes too early in the video.
  let introLockSec = Math.max(120, Math.floor(durationSec * 0.08));
  introLockSec = Math.min(introLockSec, Math.floor(durationSec * 0.35));
  const outroPaddingSec = Math.min(30, Math.floor(durationSec * 0.05));

  let startWindow = Math.max(0, introLockSec);
  let endWindow = Math.max(startWindow + 60, durationSec - outroPaddingSec);

  if (endWindow > durationSec) {
    endWindow = durationSec;
  }

  if (startWindow >= endWindow) {
    startWindow = 0;
    endWindow = durationSec;
  }

  const windowOffsets = transcriptOffsets.filter((offset) => offset >= startWindow && offset <= endWindow);
  const candidateOffsets = windowOffsets.length ? windowOffsets : transcriptOffsets;
  const transcriptIndex = buildTranscriptSearchIndex(transcriptSegments, scale, startWindow, endWindow);

  const count = quizzes.length;
  const range = Math.max(1, endWindow - startWindow);
  const step = range / (count + 1);
  let minGap = Math.max(30, Math.floor(step * 0.55));

  if (count > 1 && (minGap * (count - 1)) > range) {
    minGap = Math.max(10, Math.floor(range / (count - 1)));
  }

  let previous = startWindow - minGap;

  const scheduled = quizzes.map((item, index) => {
    // Target positions are spread uniformly in the unlocked timeline window.
    const idealTarget = Math.max(startWindow, Math.min(endWindow, Math.round(startWindow + (step * (index + 1)))));
    const conceptMatch = estimateConceptMatch(item, transcriptIndex, startWindow, endWindow);

    if (strictMode && !conceptMatch.strongMatch) {
      return null;
    }

    const conceptReadyTarget = conceptMatch.readyOffset;
    const currentSuggestion = parseTimestampToSeconds(item && item.suggestedTimestamp);
    const weightedTarget = Math.round((idealTarget * 0.8) + (currentSuggestion * 0.2));
    const gatedTarget = Math.max(weightedTarget, conceptReadyTarget);

    let chosenOffset = findNearestTranscriptOffsetAtOrAfter(candidateOffsets, gatedTarget, endWindow);
    chosenOffset = Math.max(startWindow, Math.min(endWindow, chosenOffset));

    if (chosenOffset - previous < minGap) {
      chosenOffset = Math.min(endWindow, previous + minGap);
      chosenOffset = findNearestTranscriptOffsetAtOrAfter(candidateOffsets, chosenOffset, endWindow);
      chosenOffset = Math.max(startWindow, Math.min(endWindow, chosenOffset));
    }

    previous = Math.max(previous, chosenOffset);

    return {
      ...item,
      suggestedTimestamp: formatSeconds(chosenOffset)
    };
  });

  return strictMode ? scheduled.filter(Boolean) : scheduled;
}

function parseQuizJson(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return [];

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const normalized = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  const tryParse = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.quiz)) return parsed.quiz;
      if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
      return [];
    } catch {
      return null;
    }
  };

  const direct = tryParse(normalized);
  if (Array.isArray(direct)) return direct;

  const firstArrayIndex = normalized.indexOf('[');
  const lastArrayIndex = normalized.lastIndexOf(']');
  if (firstArrayIndex >= 0 && lastArrayIndex > firstArrayIndex) {
    const arraySlice = normalized.slice(firstArrayIndex, lastArrayIndex + 1);
    const arrayParsed = tryParse(arraySlice);
    if (Array.isArray(arrayParsed)) return arrayParsed;
  }

  const firstObjectIndex = normalized.indexOf('{');
  const lastObjectIndex = normalized.lastIndexOf('}');
  if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
    const objectSlice = normalized.slice(firstObjectIndex, lastObjectIndex + 1);
    const objectParsed = tryParse(objectSlice);
    if (Array.isArray(objectParsed)) return objectParsed;
  }

  return [];
}

function normalizeQuizItems(items) {
  const source = Array.isArray(items) ? items : [];

  const letterMap = { A: 0, B: 1, C: 2, D: 3 };

  function toOptionText(option) {
    if (typeof option === 'string') return option.trim();
    if (!option || typeof option !== 'object') return '';
    return String(option.text || option.option || option.value || option.answer || '').trim();
  }

  function normalizeOptions(entry) {
    let rawOptions = [];

    if (Array.isArray(entry && entry.options)) {
      rawOptions = entry.options;
    } else if (Array.isArray(entry && entry.answers)) {
      rawOptions = entry.answers;
    } else if (entry && typeof entry === 'object') {
      rawOptions = ['A', 'B', 'C', 'D']
        .map((key) => entry[key] || entry[key.toLowerCase()] || (entry.optionsMap && entry.optionsMap[key]))
        .filter((value) => value !== undefined && value !== null);
    }

    const options = rawOptions
      .map((opt) => toOptionText(opt))
      .filter(Boolean)
      .slice(0, 4);

    while (options.length < 4) {
      options.push('');
    }

    return options;
  }

  function inferCorrectAnswer(entry, options) {
    const rawCorrect = String(entry && entry.correctAnswer || entry && entry.correct || entry && entry.answer || '').trim();
    const upperCorrect = rawCorrect.toUpperCase();
    if (letterMap[upperCorrect] !== undefined) {
      return upperCorrect;
    }

    const numericCorrect = Number(entry && (entry.correctOptionIndex ?? entry.correctIndex));
    if (Number.isFinite(numericCorrect) && numericCorrect >= 0 && numericCorrect <= 3) {
      return ['A', 'B', 'C', 'D'][numericCorrect];
    }

    const rawOptions = Array.isArray(entry && entry.options)
      ? entry.options
      : Array.isArray(entry && entry.answers)
        ? entry.answers
        : [];

    const fromOptionFlagIndex = rawOptions.findIndex((opt) => opt && typeof opt === 'object' && (opt.correct === true || opt.isCorrect === true));
    if (fromOptionFlagIndex >= 0 && fromOptionFlagIndex <= 3) {
      return ['A', 'B', 'C', 'D'][fromOptionFlagIndex];
    }

    if (rawCorrect) {
      const byTextIndex = options.findIndex((opt) => opt.toLowerCase() === rawCorrect.toLowerCase());
      if (byTextIndex >= 0 && byTextIndex <= 3) {
        return ['A', 'B', 'C', 'D'][byTextIndex];
      }
    }

    return 'A';
  }

  function normalizeTimestamp(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return '00:00';

    const hhmmss = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (hhmmss) {
      const totalSeconds = (Number(hhmmss[1]) * 3600) + (Number(hhmmss[2]) * 60) + Number(hhmmss[3]);
      return formatSeconds(totalSeconds);
    }

    const mmss = raw.match(/^(\d{1,3}):(\d{2})$/);
    if (mmss) return `${String(mmss[1]).padStart(2, '0')}:${mmss[2]}`;

    const secondsOnly = raw.match(/^\d+$/);
    if (secondsOnly) return formatSeconds(Number(raw));

    const embedded = raw.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (embedded) return normalizeTimestamp(embedded[1]);

    return '00:00';
  }

  return source
    .map((entry) => {
      const question = String(entry && entry.question || entry && entry.prompt || '').trim();
      if (!question) return null;

      const options = normalizeOptions(entry);
      if (options.filter(Boolean).length < 2) return null;

      const correct = inferCorrectAnswer(entry, options);
      const explanation = String(entry && entry.explanation || entry && entry.reason || '').trim();
      const suggestedTimestamp = normalizeTimestamp(entry && entry.suggestedTimestamp || entry && entry.timestamp || entry && entry.time);

      return {
        question,
        options,
        correctAnswer: correct,
        explanation,
        suggestedTimestamp
      };
    })
    .filter((item) => item && item.question);
}

async function repairQuizFormat(rawOutput, numberOfQuestions, userId) {
  const repairPrompt = `Convert the following content into VALID JSON only.\n\nRules:\n- Return ONLY a JSON array.\n- Exactly ${numberOfQuestions} items when possible.\n- Each item fields: question (string), options (array of 4 strings), correctAnswer (A/B/C/D), explanation (string), suggestedTimestamp (mm:ss).\n- Do not include markdown fences.\n\nContent to convert:\n${String(rawOutput || '').slice(0, 12000)}`;

  return generatePromptReply({
    userId,
    model: aiConfig.chatModel,
    prompt: repairPrompt,
    options: {
      temperature: 0.1,
      topP: 0.9,
      maxTokens: 2200,
      timeoutMs: aiConfig.providers.openai.timeoutMs
    }
  });
}

function normalizeExternalErrorMessage(err, fallback) {
  if (!err) return fallback;

  const fromMessage = String(err && err.message || '').trim();
  if (fromMessage) return fromMessage;

  const fromResponseMessage = String(err && err.response && err.response.data && (err.response.data.message || err.response.data.error) || '').trim();
  if (fromResponseMessage) return fromResponseMessage;

  const fromCode = String(err && err.code || '').trim();
  if (fromCode) return fromCode;

  return fallback;
}

module.exports.fetchAndSaveTranscript = async (req, res) => {
  const { videoId } = req.params;

  if (!mongoose.isValidObjectId(videoId)) {
    throw new ExpressError('Video not found', 404);
  }

  const video = await Video.findById(videoId);
  if (!video) {
    throw new ExpressError('Video not found', 404);
  }

  const youtubeVideoId = extractYouTubeId(video.youtubeVideoId || video.url);
  if (!youtubeVideoId) {
    throw new ExpressError('Only YouTube videos are supported for transcript generation', 400);
  }

  let transcriptRows;
  try {
    const fetchTranscript = await getFetchTranscript();
    transcriptRows = await fetchTranscript(youtubeVideoId);
  } catch (err) {
    const rawMessage = normalizeExternalErrorMessage(err, 'Failed to fetch transcript from YouTube');
    const lower = rawMessage.toLowerCase();

    if (lower.includes('transcript is disabled')) {
      throw new ExpressError('Transcript is disabled for this YouTube video', 422);
    }

    if (lower.includes('no transcripts are available')) {
      throw new ExpressError('No transcript is available for this YouTube video', 422);
    }

    if (lower.includes('too many requests') || lower.includes('captcha')) {
      throw new ExpressError('YouTube is rate-limiting transcript requests. Please try again later.', 429);
    }

    if (lower.includes('impossible to retrieve youtube video id')) {
      throw new ExpressError('Invalid YouTube video URL/ID for transcript generation', 400);
    }

    throw new ExpressError(`Failed to fetch transcript: ${rawMessage}`, 502);
  }
  const transcriptSource = Array.isArray(transcriptRows) ? transcriptRows : [];
  const sourceScale = getTranscriptTimeScale(transcriptSource);

  const segments = transcriptSource
    .map((row) => ({
      videoId: video._id,
      offset: normalizeSegmentTime(row && row.offset, sourceScale),
      duration: normalizeSegmentTime(row && row.duration, sourceScale),
      text: String(row && row.text || '').trim()
    }))
    .filter((segment) => segment.text);

  await Transcript.deleteMany({ videoId: video._id });

  const inserted = segments.length ? await Transcript.insertMany(segments) : [];
  const transcriptIds = inserted.map((item) => item._id);

  video.youtubeVideoId = youtubeVideoId;
  video.source = 'youtube';
  video.transcripts = transcriptIds;
  await video.save();

  return res.json({
    success: true,
    message: 'Transcript fetched and saved successfully',
    count: inserted.length
  });
};

module.exports.aiGenerateQuiz = async (req, res) => {
  const { videoId } = req.params;
  const requestedCount = parseInt(req.body && req.body.numberOfQuestions, 10);
  const numberOfQuestions = Math.min(Math.max(Number.isNaN(requestedCount) ? 5 : requestedCount, 1), 15);
  const strictMode = Boolean(req.body && req.body.strictMode);

  if (!mongoose.isValidObjectId(videoId)) {
    throw new ExpressError('Video not found', 404);
  }

  const video = await Video.findById(videoId)
    .populate({
      path: 'transcripts',
      options: { sort: { offset: 1 } }
    });

  if (!video) {
    throw new ExpressError('Video not found', 404);
  }

  const transcriptSegments = Array.isArray(video.transcripts) ? video.transcripts : [];
  if (!transcriptSegments.length) {
    throw new ExpressError('No transcript found for this video. Please fetch transcript first.', 400);
  }

  const transcriptScale = getTranscriptTimeScale(transcriptSegments);

  const fullTranscript = transcriptSegments
    .map((segment) => {
      const offsetSec = normalizeSegmentTime(segment && segment.offset, transcriptScale);
      return `[${formatSeconds(offsetSec)}] ${String(segment && segment.text || '').trim()}`;
    })
    .filter(Boolean)
    .join('\n');

  const prompt = `You are an expert instructional designer for serious learning outcomes.\n\nGiven the transcript below, generate EXACTLY ${numberOfQuestions} multiple-choice quiz questions that support LEARNING, not trivial recall.\n\nPedagogical requirements:\n- Focus on core concepts, mechanisms, trade-offs, mistakes to avoid, and practical application.\n- Use Bloom levels mix: understanding, applying, analyzing (not only remembering).\n- Avoid vague or superficial questions.\n- Include plausible distractors that represent common misconceptions.\n- Explanation must teach: briefly explain why the correct answer is correct and why a typical wrong idea is wrong.\n- Questions should progress from foundational to more advanced ideas.\n\nStrict output requirements:\n- Return ONLY valid JSON (no markdown, no commentary).\n- Output must be a JSON array of objects.\n- Each object must contain these fields exactly:\n  - question: string\n  - options: array of exactly 4 strings\n  - correctAnswer: one of "A", "B", "C", "D"\n  - explanation: string\n  - suggestedTimestamp: string in mm:ss or hh:mm:ss format near where the concept appears\n\nTranscript:\n${fullTranscript}`;

  let aiResponse;
  try {
    aiResponse = await generatePromptReply({
      userId: req.user && req.user._id,
      model: aiConfig.chatModel,
      prompt,
      options: {
        temperature: 0.35,
        topP: 0.9,
        maxTokens: 2600,
        timeoutMs: aiConfig.providers.openai.timeoutMs
      }
    });
  } catch (err) {
    const rawMessage = normalizeExternalErrorMessage(err, 'Failed to call the configured AI provider');

    throw new ExpressError(`AI quiz generation failed: ${rawMessage}`, 502);
  }

  const rawOutput = String(aiResponse || '');
  const parsedQuiz = parseQuizJson(rawOutput);
  let normalizedQuiz = normalizeQuizItems(parsedQuiz);

  if (!normalizedQuiz.length) {
    try {
      const repairedOutput = await repairQuizFormat(rawOutput, numberOfQuestions, req.user && req.user._id);
      const repairedParsed = parseQuizJson(repairedOutput);
      normalizedQuiz = normalizeQuizItems(repairedParsed);
    } catch {
      // Keep original failure behavior below if repair step fails.
    }
  }

  if (!normalizedQuiz.length) {
    throw new ExpressError('AI returned an invalid quiz format', 422);
  }

  const distributedQuiz = distributeQuizTimestampsEvenly(normalizedQuiz, transcriptSegments, { strictMode });

  if (!distributedQuiz.length) {
    throw new ExpressError('Strict mode removed all questions because they do not match transcript topics strongly enough', 422);
  }

  return res.json({
    success: true,
    count: distributedQuiz.length,
    quiz: distributedQuiz,
    strictMode
  });
};
