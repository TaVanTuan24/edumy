const {
  buildSlidePrompt,
  parseAiSlideResponse,
  createFallbackResolvedSlides
} = require('../utils/aiSlidePipeline');

describe('aiSlidePipeline', () => {
  test('buildSlidePrompt enforces semantic template-based output', () => {
    const prompt = buildSlidePrompt({
      topic: 'Applications of Artificial Intelligence',
      count: 4,
      style: 'professional',
      language: 'English'
    });

    expect(prompt).toContain('Return JSON only');
    expect(prompt).toContain('Do not use coordinates');
    expect(prompt).toContain('Language: English');
    expect(prompt).toContain('"slides"');
    expect(prompt).toContain('3 to 6 bullet points');
    expect(prompt).toContain('[object Object]');
  });

  test('parseAiSlideResponse resolves semantic slides into concrete editor elements', () => {
    const raw = JSON.stringify({
      slides: [
        {
          template: 'bullet-list',
          title: 'Applications of Artificial Intelligence',
          bullets: [
            'Healthcare diagnosis support',
            'Fraud detection in banking',
            'Personalized learning systems',
            'Industrial automation'
          ]
        }
      ]
    });

    const result = parseAiSlideResponse(raw, {
      topic: 'Artificial Intelligence',
      requestedCount: 4,
      style: 'professional'
    });

    expect(result.semanticSlides).toHaveLength(1);
    expect(result.semanticSlides[0].template).toBe('bullet-list');
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0].validation.valid).toBe(true);
    expect(result.slides[0].elements.length).toBeGreaterThanOrEqual(2);
    result.slides[0].elements.forEach((element) => {
      expect(element.type).toBe('text');
      expect(typeof element.x).toBe('number');
      expect(typeof element.width).toBe('number');
      expect(element.width).toBeGreaterThan(0);
      expect(element.height).toBeGreaterThan(0);
    });
  });

  test('dense bullet slides are split to protect readability', () => {
    const raw = JSON.stringify({
      slides: [
        {
          template: 'bullet-list',
          title: 'Machine Learning Workflow',
          bullets: [
            'Collect raw data from multiple sources',
            'Clean and label training examples carefully',
            'Train baseline and advanced models',
            'Evaluate with business and technical metrics',
            'Deploy the best model safely',
            'Monitor drift and retrain continuously'
          ]
        }
      ]
    });

    const result = parseAiSlideResponse(raw, {
      topic: 'Machine Learning Workflow',
      requestedCount: 4,
      style: 'professional'
    });

    expect(result.semanticSlides).toHaveLength(2);
    expect(result.slides).toHaveLength(2);
    expect(result.semanticSlides[0].bullets.length).toBeLessThanOrEqual(4);
    expect(result.semanticSlides[1].title).toContain('(cont.)');
    result.slides.forEach((slide) => {
      expect(slide.validation.valid).toBe(true);
    });
  });

  test('fallback slides remain renderable in the current editor schema', () => {
    const slides = createFallbackResolvedSlides('Data Science Overview');

    expect(slides).toHaveLength(1);
    expect(slides[0].template).toBeTruthy();
    expect(Array.isArray(slides[0].elements)).toBe(true);
    expect(slides[0].elements[0]).toEqual(expect.objectContaining({
      type: 'text',
      width: expect.any(Number),
      height: expect.any(Number)
    }));
  });
});
