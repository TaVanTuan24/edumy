jest.mock('../services/ai/chatOrchestrator', () => ({
  generatePromptReply: jest.fn()
}));

jest.mock('../services/ai/userAiClient', () => ({
  loadUserAiConfig: jest.fn()
}));

const { generatePromptReply } = require('../services/ai/chatOrchestrator');
const { loadUserAiConfig } = require('../services/ai/userAiClient');
const {
  applyGeneratedCourseSummary,
  generateCourseSummary,
  readStoredCourseSummary
} = require('../services/ai/courseSummaryService');

describe('courseSummaryService', () => {
  const originalSummaryModel = process.env.AI_SUMMARY_MODEL;

  afterEach(() => {
    jest.clearAllMocks();

    if (typeof originalSummaryModel === 'undefined') {
      delete process.env.AI_SUMMARY_MODEL;
    } else {
      process.env.AI_SUMMARY_MODEL = originalSummaryModel;
    }
  });

  test('generateCourseSummary uses the model from saved AI settings', async () => {
    delete process.env.AI_SUMMARY_MODEL;
    loadUserAiConfig.mockResolvedValue({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-3.5-sonnet',
      apiKey: 'sk-test'
    });
    generatePromptReply.mockResolvedValue('Short course summary.\n\n- Gain practical skills\n- Review core concepts\n- Practice with guided lessons');

    const result = await generateCourseSummary({
      title: 'Node.js Fundamentals',
      description: 'Learn backend development.',
      topic: 'Software',
      sections: [
        {
          title: 'Getting Started',
          lessons: [{ title: 'Intro', type: 'video', description: 'Overview lesson' }]
        }
      ]
    }, { userId: 'user-1' });

    expect(generatePromptReply).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: 'anthropic/claude-3.5-sonnet'
    }));
    expect(result.model).toBe('anthropic/claude-3.5-sonnet');
    expect(result.summary).toContain('Short course summary.');
  });

  test('readStoredCourseSummary supports legacy object-shaped summaries', () => {
    const generatedAt = new Date('2026-04-27T10:00:00.000Z');
    const result = readStoredCourseSummary({
      aiSummary: {
        text: 'Legacy saved summary',
        provider: 'gpt-5.4',
        generatedAt
      }
    });

    expect(result.summary).toBe('Legacy saved summary');
    expect(result.model).toBe('gpt-5.4');
    expect(result.generatedAt).toBe(generatedAt);
  });

  test('applyGeneratedCourseSummary stores the plain summary string and metadata', () => {
    const generatedAt = new Date('2026-04-27T11:00:00.000Z');
    const course = {};

    applyGeneratedCourseSummary(course, {
      summary: 'Stored summary text',
      generatedAt,
      model: 'gpt-5.5'
    });

    expect(course.aiSummary).toBe('Stored summary text');
    expect(course.aiSummaryGeneratedAt).toBe(generatedAt);
    expect(course.aiSummaryModel).toBe('gpt-5.5');
  });
});
