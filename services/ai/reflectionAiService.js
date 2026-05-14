'use strict';

const { aiConfig } = require('../../config/ai');
const { generatePromptReply } = require('./chatOrchestrator');
const logger = require('../../utils/logger');

/**
 * Generate 3-5 reflection / exit ticket suggestions for a lesson.
 *
 * @param {Object} params
 * @param {string} params.userId - The user requesting generation (for BYOK routing)
 * @param {string} params.lessonTitle
 * @param {string} params.lessonType
 * @param {string} params.lessonDescription
 * @param {string} params.lessonSummary - Brief summary or objectives
 * @param {string} params.mainContent - Transcript, slide text, or lesson body
 * @param {string} params.existingQuizQuestions - Text of existing quiz questions
 * @returns {Promise<Array>} Array of suggestion objects
 */
async function generateReflectionSuggestions({
  userId,
  lessonTitle = '',
  lessonType = '',
  lessonDescription = '',
  lessonSummary = '',
  mainContent = '',
  existingQuizQuestions = ''
} = {}) {
  // Truncate long content to stay within token limits
  const maxContentLen = 4000;
  const truncatedContent = String(mainContent || '').slice(0, maxContentLen);
  const truncatedQuiz = String(existingQuizQuestions || '').slice(0, 1500);

  const prompt = `You are an instructional design assistant. Create 3-5 Reflection / Exit Ticket prompts for the lesson below.

The goal is to help learners self-explain, reflect, identify areas of confusion, or connect knowledge to real-world scenarios.

Do NOT create multiple-choice questions. Do NOT ask for right/wrong answers. Each prompt should encourage the learner to explain in their own words.

Return ONLY valid JSON (no markdown, no commentary). Output must follow this exact schema:
{
  "suggestions": [
    {
      "title": "Exit Ticket",
      "prompt": "...",
      "purpose": "...",
      "suggestedMinLength": 50,
      "required": true,
      "rubric": {
        "good": "...",
        "partial": "...",
        "weak": "..."
      },
      "webOnly": true
    }
  ]
}

Lesson context:
- Title: ${lessonTitle || 'Untitled'}
- Type: ${lessonType || 'N/A'}
- Description: ${lessonDescription || 'N/A'}
- Summary/Objectives: ${lessonSummary || 'N/A'}
- Main content/transcript: ${truncatedContent || 'N/A'}
- Existing quiz questions: ${truncatedQuiz || 'None'}

Constraints:
- Content must be relevant to the lesson.
- Do not create overly generic questions.
- Do not create true/false or right/wrong questions.
- Prefer questions that require the learner to explain in their own words.
- Output must be valid JSON, no additional text.`;

  try {
    const response = await generatePromptReply({
      userId,
      model: aiConfig.chatModel,
      prompt,
      options: {
        temperature: 0.5,
        topP: 0.9,
        maxTokens: 2500,
        timeoutMs: aiConfig.providers.openai.timeoutMs
      }
    });

    const parsed = parseSuggestionsJson(String(response || ''));
    return parsed;
  } catch (err) {
    logger.error({ err }, '[ReflectionAI] Failed to generate suggestions');
    throw err;
  }
}

/**
 * Generate AI summary of reflection submissions for course manager.
 *
 * @param {Object} params
 * @param {string} params.userId - The user requesting summary
 * @param {string} params.lessonTitle
 * @param {string} params.lessonPrompt - The reflection prompt
 * @param {Array}  params.submissions - Array of { answer, submittedAt }
 * @returns {Promise<Object>} Summary object
 */
async function generateReflectionSummary({
  userId,
  lessonTitle = '',
  lessonPrompt = '',
  submissions = []
} = {}) {
  if (!submissions.length) {
    return {
      commonUnderstandings: [],
      commonConfusions: [],
      representativeResponses: [],
      improvementSuggestions: [],
      overallInsight: 'No submissions available to analyze.'
    };
  }

  // Limit to 50 submissions to control token usage
  const limited = submissions.slice(0, 50);
  const submissionsText = limited
    .map((s, i) => `[${i + 1}] ${String(s.answer || '').trim()}`)
    .join('\n\n');

  const prompt = `You are a learning analytics assistant for a course manager. Below are learner Reflection / Exit Ticket responses for a lesson. Summarize the data qualitatively to help the course manager improve the lesson. Do NOT grade individual learners. Do NOT make sensitive comments about specific learners. Do NOT reveal learner identities.

Return ONLY valid JSON (no markdown, no commentary). Output must follow this exact schema:
{
  "commonUnderstandings": [],
  "commonConfusions": [],
  "representativeResponses": [],
  "improvementSuggestions": [],
  "overallInsight": ""
}

Lesson: ${lessonTitle || 'Untitled'}
Reflection prompt: ${lessonPrompt || 'N/A'}
Number of submissions: ${submissions.length}

Learner responses:
${submissionsText}

Constraints:
- Focus on lesson quality and overall comprehension level.
- Do not evaluate or rank individual learners.
- Do not fabricate content not present in submissions.
- If data is too limited, state that insights are constrained.
- Output must be valid JSON, no additional text.`;

  try {
    const response = await generatePromptReply({
      userId,
      model: aiConfig.chatModel,
      prompt,
      options: {
        temperature: 0.3,
        topP: 0.9,
        maxTokens: 2000,
        timeoutMs: aiConfig.providers.openai.timeoutMs
      }
    });

    const parsed = parseSummaryJson(String(response || ''));
    return parsed;
  } catch (err) {
    logger.error({ err }, '[ReflectionAI] Failed to generate summary');
    throw err;
  }
}

// ---- JSON parsing helpers ----

function parseSuggestionsJson(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return [];

  const normalized = extractJson(text);

  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.suggestions)) return parsed.suggestions;
    return [];
  } catch {
    // Try to find array within the text
    const firstBracket = normalized.indexOf('[');
    const lastBracket = normalized.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      try {
        return JSON.parse(normalized.slice(firstBracket, lastBracket + 1));
      } catch {
        return [];
      }
    }
    return [];
  }
}

function parseSummaryJson(rawText) {
  const text = String(rawText || '').trim();

  const fallback = {
    commonUnderstandings: [],
    commonConfusions: [],
    representativeResponses: [],
    improvementSuggestions: [],
    overallInsight: 'Could not parse AI summary.'
  };

  if (!text) return fallback;

  const normalized = extractJson(text);

  try {
    const parsed = JSON.parse(normalized);
    return {
      commonUnderstandings: Array.isArray(parsed.commonUnderstandings) ? parsed.commonUnderstandings : [],
      commonConfusions: Array.isArray(parsed.commonConfusions) ? parsed.commonConfusions : [],
      representativeResponses: Array.isArray(parsed.representativeResponses) ? parsed.representativeResponses : [],
      improvementSuggestions: Array.isArray(parsed.improvementSuggestions) ? parsed.improvementSuggestions : [],
      overallInsight: String(parsed.overallInsight || '').trim() || fallback.overallInsight
    };
  } catch {
    return fallback;
  }
}

function extractJson(text) {
  // Strip markdown code fences
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  return text.trim();
}

module.exports = {
  generateReflectionSuggestions,
  generateReflectionSummary
};