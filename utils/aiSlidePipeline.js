const ALLOWED_TEMPLATES = Object.freeze([
  'title-center',
  'title-content',
  'bullet-list',
  'two-column',
  'section-divider',
  'title-left-content-right',
  'summary-slide'
]);

const CANVAS = Object.freeze({
  width: 1280,
  height: 720,
  paddingX: 88,
  paddingY: 64,
  columnGap: 44,
  blockGap: 18,
  lineHeight: 1.25
});

const TYPOGRAPHY = Object.freeze({
  title: { max: 36, min: 24 },
  subtitle: { max: 22, min: 16 },
  body: { max: 24, min: 16 },
  bullet: { max: 22, min: 16 },
  callout: { max: 20, min: 15 }
});

const DENSITY = Object.freeze({
  maxBullets: 6,
  maxBulletWords: 12,
  maxTitleWords: 12,
  maxSubtitleWords: 16,
  maxBodyWords: 34,
  maxTotalWords: 44
});

const THEME_PRESETS = Object.freeze({
  professional: {
    theme: 'light',
    titleColor: '#10233f',
    bodyColor: '#1f2937',
    accentColor: '#1d4ed8',
    surfaceColor: '#eff6ff'
  },
  minimal: {
    theme: 'light',
    titleColor: '#111827',
    bodyColor: '#374151',
    accentColor: '#0f766e',
    surfaceColor: '#f0fdfa'
  },
  modern: {
    theme: 'light',
    titleColor: '#0f172a',
    bodyColor: '#334155',
    accentColor: '#ea580c',
    surfaceColor: '#fff7ed'
  },
  dark: {
    theme: 'dark',
    titleColor: '#f8fafc',
    bodyColor: '#cbd5e1',
    accentColor: '#38bdf8',
    surfaceColor: '#0f172a'
  }
});

const TEMPLATE_FIELDS = Object.freeze({
  'title-center': ['title', 'subtitle'],
  'title-content': ['title', 'subtitle', 'body'],
  'bullet-list': ['title', 'subtitle', 'bullets'],
  'two-column': ['title', 'subtitle', 'leftColumn', 'rightColumn'],
  'section-divider': ['title', 'subtitle', 'callout'],
  'title-left-content-right': ['title', 'subtitle', 'bullets', 'callout'],
  'summary-slide': ['title', 'summary', 'bullets']
});

function buildSlidePrompt({ topic, count, style, language }) {
  const safeTopic = String(topic || '').trim();
  const safeCount = Math.min(Math.max(Number(count) || 4, 1), 8);
  const safeStyle = String(style || 'professional').trim().toLowerCase();
  const safeLanguage = String(language || 'English').trim();

  return [
    'You are a professional presentation slide generator.',
    '',
    'Your job is to create clean, concise, visually structured slide content.',
    '',
    'Rules:',
    '- Return JSON only',
    '- Do not include explanations',
    '- Do not use coordinates',
    '- Use only structured content',
    '- Each slide must have:',
    '  - 1 clear title',
    '  - 3 to 6 bullet points',
    '- Keep bullet points short (max 10-12 words)',
    '- Avoid repetition between slides',
    '- Avoid placeholders like [object Object]',
    '- Avoid generic content like "Point 1"',
    '- Content must be meaningful and educational',
    '- Use semantic fields only',
    '- Do not include x, y, width, height, style, or layout geometry',
    '',
    `Presentation topic: ${safeTopic}`,
    `Desired number of slides: ${safeCount}`,
    `Visual style: ${safeStyle}`,
    `Language: ${safeLanguage}`,
    '',
    'Return format:',
    '{',
    '  "slides": [',
    '    {',
    '      "template": "bullet-list",',
    '      "title": "...",',
    '      "bullets": ["...", "...", "..."]',
    '    }',
    '  ]',
    '}'
  ].join('\n');
}

function cleanAiResponse(text) {
  return String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .replace(/`json/gi, '')
    .trim();
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const objectMatch = String(text || '').match(/\{[\s\S]*\}/);
    if (!objectMatch) throw err;
    return JSON.parse(objectMatch[0]);
  }
}

function parseAiSlideResponse(raw, options = {}) {
  const cleaned = cleanAiResponse(raw);
  const parsed = safeParseJSON(cleaned);
  const rawSlides = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed && parsed.slides)
      ? parsed.slides
      : [];

  const semanticSlides = normalizeDeck(rawSlides, options);
  const { slides, examples } = resolveDeck(semanticSlides, options);

  return {
    semanticSlides,
    slides,
    examples
  };
}

function createFallbackResolvedSlides(topic) {
  const semanticSlides = normalizeDeck([{
    template: 'title-content',
    title: String(topic || 'Presentation').trim() || 'Presentation',
    subtitle: 'Key ideas',
    body: 'Use the slide editor to refine this draft.'
  }], { topic });

  return resolveDeck(semanticSlides, { topic }).slides;
}

function resolveDraftSlides(rawSlides, options = {}) {
  const semanticSlides = normalizeDeck(Array.isArray(rawSlides) ? rawSlides : [], options);
  const { slides, examples } = resolveDeck(semanticSlides, options);

  return {
    semanticSlides,
    slides,
    examples
  };
}

function normalizeDeck(rawSlides, options = {}) {
  const requestedCount = Math.min(Math.max(Number(options.requestedCount) || rawSlides.length || 4, 1), 8);
  const topic = String(options.topic || '').trim();
  const normalized = [];

  rawSlides.forEach((slide, index) => {
    normalized.push(...expandSlideByDensity(normalizeSemanticSlide(slide, index, topic)));
  });

  if (!normalized.length) {
    normalized.push(...expandSlideByDensity(normalizeSemanticSlide({}, 0, topic)));
  }

  return normalized.slice(0, requestedCount).map((slide, index) => ({
    ...slide,
    id: `semantic-slide-${index + 1}`
  }));
}

function normalizeSemanticSlide(rawSlide, index, topic) {
  const source = rawSlide && typeof rawSlide === 'object' ? rawSlide : {};
  const template = normalizeTemplate(source.template || source.layout || inferTemplateFromShape(source));
  const title = limitWords(normalizeText(source.title || source.heading || fallbackTitle(index, topic)), DENSITY.maxTitleWords);
  const subtitle = limitWords(normalizeText(source.subtitle || source.summary || source.tagline), DENSITY.maxSubtitleWords);
  const bullets = normalizeBullets(
    source.bullets
    || source.points
    || source.items
    || source.content
    || source.body
  );
  const leftColumn = normalizeColumn(source.leftColumn, source.leftItems, source.leftHeading);
  const rightColumn = normalizeColumn(source.rightColumn, source.rightItems, source.rightHeading);
  const body = limitWords(normalizeText(source.body || source.content || source.description), DENSITY.maxBodyWords);
  const callout = limitWords(normalizeText(source.callout || source.highlight), DENSITY.maxSubtitleWords);
  const summary = limitWords(normalizeText(source.summary || source.takeaway), DENSITY.maxBodyWords);

  const slide = {
    template,
    title,
    subtitle,
    body,
    bullets,
    leftColumn,
    rightColumn,
    callout,
    summary
  };

  return removeUnusedFields(slide);
}

function inferTemplateFromShape(source) {
  if (source.leftColumn || source.rightColumn || source.leftItems || source.rightItems) {
    return 'two-column';
  }
  if (source.summary || source.takeaway) {
    return 'summary-slide';
  }
  if (Array.isArray(source.bullets || source.points || source.items)) {
    return 'bullet-list';
  }
  if (source.callout || source.highlight) {
    return 'section-divider';
  }
  return 'title-content';
}

function normalizeTemplate(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (ALLOWED_TEMPLATES.includes(normalized)) return normalized;
  return 'title-content';
}

function normalizeText(value) {
  if (value == null) return '';

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
      .replace(/\s+/g, ' ')
      .replace(/\u2022/g, '')
      .trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  if (typeof value === 'object') {
    const prioritizedKeys = ['text', 'title', 'heading', 'label', 'name', 'value', 'content', 'summary', 'description'];
    for (const key of prioritizedKeys) {
      if (value[key]) return normalizeText(value[key]);
    }

    if (Array.isArray(value.items) || Array.isArray(value.bullets)) {
      return normalizeText(value.items || value.bullets);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  return '';
}

function normalizeBullets(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\n|(?<=[.!?])\s+/)
      : [];

  return source
    .map((item) => limitWords(normalizeText(item), DENSITY.maxBulletWords))
    .filter(Boolean)
    .slice(0, DENSITY.maxBullets);
}

function normalizeColumn(column, fallbackItems, fallbackHeading) {
  const source = column && typeof column === 'object' ? column : {};
  const heading = limitWords(
    normalizeText(source.heading || source.title || fallbackHeading),
    6
  );
  const items = normalizeBullets(source.items || source.bullets || fallbackItems);
  return heading || items.length ? { heading, items } : null;
}

function limitWords(text, maxWords) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function countWords(value) {
  return normalizeText(value).split(' ').filter(Boolean).length;
}

function fallbackTitle(index, topic) {
  if (topic) return `${limitWords(topic, 7)} ${index > 0 ? index + 1 : ''}`.trim();
  return `Slide ${index + 1}`;
}

function removeUnusedFields(slide) {
  const allowed = TEMPLATE_FIELDS[slide.template] || TEMPLATE_FIELDS['title-content'];
  const result = { template: slide.template };

  allowed.forEach((field) => {
    if (field === 'leftColumn' || field === 'rightColumn') {
      if (slide[field]) result[field] = slide[field];
      return;
    }

    if (field === 'bullets') {
      if (Array.isArray(slide.bullets) && slide.bullets.length) result.bullets = slide.bullets;
      return;
    }

    if (slide[field]) result[field] = slide[field];
  });

  if (!result.title) {
    result.title = slide.title || 'Untitled Slide';
  }

  if (result.template === 'bullet-list' && (!Array.isArray(result.bullets) || !result.bullets.length)) {
    result.bullets = normalizeBullets(slide.body || slide.subtitle || 'Key point');
  }

  if (result.template === 'two-column') {
    if (!result.leftColumn) {
      result.leftColumn = { heading: 'Key points', items: result.bullets ? result.bullets.slice(0, 3) : ['Point 1'] };
    }
    if (!result.rightColumn) {
      result.rightColumn = { heading: 'Details', items: result.bullets ? result.bullets.slice(3) : ['Point 2'] };
    }
  }

  return result;
}

function expandSlideByDensity(slide) {
  const totalWords = Object.values(slide).reduce((sum, value) => {
    if (Array.isArray(value)) {
      return sum + value.reduce((inner, item) => inner + countWords(item), 0);
    }
    if (value && typeof value === 'object') {
      const headingWords = countWords(value.heading);
      const itemWords = Array.isArray(value.items)
        ? value.items.reduce((inner, item) => inner + countWords(item), 0)
        : 0;
      return sum + headingWords + itemWords;
    }
    return sum + countWords(value);
  }, 0);

  if (slide.template === 'bullet-list' && Array.isArray(slide.bullets) && slide.bullets.length > 4) {
    const first = slide.bullets.slice(0, 4);
    const second = slide.bullets.slice(4);
    return [
      { ...slide, bullets: first },
      { ...slide, title: `${slide.title} (cont.)`, bullets: second, subtitle: '' }
    ];
  }

  if (slide.template === 'bullet-list' && totalWords > DENSITY.maxTotalWords) {
    const compactBullets = slide.bullets.slice(0, 4);
    return [{ ...slide, bullets: compactBullets }];
  }

  if (slide.template === 'title-content' && slide.body && countWords(slide.body) > 22) {
    return [{
      template: 'bullet-list',
      title: slide.title,
      subtitle: slide.subtitle,
      bullets: normalizeBullets(slide.body)
    }];
  }

  return [slide];
}

function resolveDeck(semanticSlides, options = {}) {
  const stylePreset = THEME_PRESETS[String(options.style || 'professional').toLowerCase()] || THEME_PRESETS.professional;
  const resolvedSlides = [];

  semanticSlides.forEach((slide, index) => {
    resolvedSlides.push(resolveSingleSlide(slide, index, stylePreset));
  });

  return {
    slides: resolvedSlides,
    examples: semanticSlides.slice(0, 3)
  };
}

function resolveSingleSlide(slide, index, stylePreset) {
  const context = {
    index,
    stylePreset,
    theme: stylePreset.theme,
    id: `slide-${index + 1}`
  };

  const elements = resolveTemplate(slide, context);
  const validation = validateResolvedSlide(elements);

  return {
    id: context.id,
    template: slide.template,
    theme: context.theme,
    semantic: slide,
    validation,
    elements
  };
}

function resolveTemplate(slide, context) {
  switch (slide.template) {
    case 'title-center':
      return resolveTitleCenter(slide, context);
    case 'bullet-list':
      return resolveBulletList(slide, context);
    case 'two-column':
      return resolveTwoColumn(slide, context);
    case 'section-divider':
      return resolveSectionDivider(slide, context);
    case 'title-left-content-right':
      return resolveTitleLeftContentRight(slide, context);
    case 'summary-slide':
      return resolveSummarySlide(slide, context);
    case 'title-content':
    default:
      return resolveTitleContent(slide, context);
  }
}

function resolveTitleCenter(slide, context) {
  const titleBox = { x: 180, y: 180, width: 920, height: 118 };
  const subtitleBox = { x: 220, y: 326, width: 840, height: 110 };

  return [
    createTextElement(slide.title, titleBox, 'title', context, { align: 'center', bold: true }),
    ...(slide.subtitle ? [createTextElement(slide.subtitle, subtitleBox, 'subtitle', context, { align: 'center' })] : [])
  ];
}

function resolveTitleContent(slide, context) {
  const titleBox = { x: 88, y: 70, width: 1104, height: 86 };
  const subtitleBox = { x: 88, y: 166, width: 1000, height: 58 };
  const bodyBox = { x: 88, y: 252, width: 1104, height: 340 };

  return [
    createTextElement(slide.title, titleBox, 'title', context, { bold: true }),
    ...(slide.subtitle ? [createTextElement(slide.subtitle, subtitleBox, 'subtitle', context)] : []),
    ...(slide.body ? [createTextElement(slide.body, bodyBox, 'body', context)] : [])
  ];
}

function resolveBulletList(slide, context) {
  const titleBox = { x: 88, y: 68, width: 1104, height: 82 };
  const subtitleBox = { x: 88, y: 156, width: 960, height: 48 };
  const bodyTop = slide.subtitle ? 226 : 188;
  const bulletArea = { x: 108, y: bodyTop, width: 1050, height: 400 };
  const bulletBoxes = stackBoxes(slide.bullets || [], bulletArea, 62);

  return [
    createTextElement(slide.title, titleBox, 'title', context, { bold: true }),
    ...(slide.subtitle ? [createTextElement(slide.subtitle, subtitleBox, 'subtitle', context)] : []),
    ...bulletBoxes.map((box, index) => createTextElement(slide.bullets[index], box, 'bullet', context, { bullet: true }))
  ];
}

function resolveTwoColumn(slide, context) {
  const titleBox = { x: 88, y: 66, width: 1104, height: 78 };
  const subtitleBox = { x: 88, y: 150, width: 1000, height: 46 };
  const columnsTop = slide.subtitle ? 226 : 188;
  const columnWidth = Math.floor((CANVAS.width - (CANVAS.paddingX * 2) - CANVAS.columnGap) / 2);
  const leftX = CANVAS.paddingX;
  const rightX = leftX + columnWidth + CANVAS.columnGap;

  const leftElements = resolveColumn(slide.leftColumn, { x: leftX, y: columnsTop, width: columnWidth, height: 380 }, context);
  const rightElements = resolveColumn(slide.rightColumn, { x: rightX, y: columnsTop, width: columnWidth, height: 380 }, context);

  return [
    createTextElement(slide.title, titleBox, 'title', context, { bold: true }),
    ...(slide.subtitle ? [createTextElement(slide.subtitle, subtitleBox, 'subtitle', context)] : []),
    ...leftElements,
    ...rightElements
  ];
}

function resolveSectionDivider(slide, context) {
  const titleBox = { x: 132, y: 222, width: 780, height: 102 };
  const subtitleBox = { x: 132, y: 338, width: 760, height: 72 };
  const calloutBox = { x: 940, y: 204, width: 200, height: 120 };

  return [
    createTextElement(slide.title, titleBox, 'title', context, { bold: true }),
    ...(slide.subtitle ? [createTextElement(slide.subtitle, subtitleBox, 'subtitle', context)] : []),
    ...(slide.callout ? [createTextElement(slide.callout, calloutBox, 'callout', context, { align: 'center', accent: true })] : [])
  ];
}

function resolveTitleLeftContentRight(slide, context) {
  const titleBox = { x: 88, y: 86, width: 360, height: 224 };
  const subtitleBox = { x: 88, y: 322, width: 320, height: 90 };
  const rightArea = { x: 520, y: 118, width: 620, height: 420 };
  const bulletBoxes = stackBoxes(slide.bullets || [], rightArea, 60);

  return [
    createTextElement(slide.title, titleBox, 'title', context, { bold: true }),
    ...(slide.subtitle ? [createTextElement(slide.subtitle, subtitleBox, 'subtitle', context)] : []),
    ...bulletBoxes.map((box, index) => createTextElement(slide.bullets[index], box, 'bullet', context, { bullet: true })),
    ...(slide.callout ? [createTextElement(slide.callout, { x: 520, y: 560, width: 560, height: 72 }, 'callout', context, { accent: true })] : [])
  ];
}

function resolveSummarySlide(slide, context) {
  const titleBox = { x: 88, y: 64, width: 1104, height: 80 };
  const summaryBox = { x: 88, y: 152, width: 1104, height: 78 };
  const bulletBoxes = stackBoxes(slide.bullets || [], { x: 108, y: 262, width: 1020, height: 280 }, 56);

  return [
    createTextElement(slide.title, titleBox, 'title', context, { bold: true }),
    ...(slide.summary ? [createTextElement(slide.summary, summaryBox, 'subtitle', context)] : []),
    ...bulletBoxes.map((box, index) => createTextElement(slide.bullets[index], box, 'bullet', context, { bullet: true }))
  ];
}

function resolveColumn(column, area, context) {
  const safeColumn = column || { heading: '', items: [] };
  const items = Array.isArray(safeColumn.items) ? safeColumn.items : [];
  const headingBox = { x: area.x, y: area.y, width: area.width, height: 40 };
  const itemAreaTop = safeColumn.heading ? area.y + 58 : area.y;
  const itemBoxes = stackBoxes(items, {
    x: area.x,
    y: itemAreaTop,
    width: area.width,
    height: area.height - (itemAreaTop - area.y)
  }, 56);

  return [
    ...(safeColumn.heading ? [createTextElement(safeColumn.heading, headingBox, 'subtitle', context, { bold: true })] : []),
    ...itemBoxes.map((box, index) => createTextElement(items[index], box, 'bullet', context, { bullet: true }))
  ];
}

function stackBoxes(items, area, minHeight) {
  const count = Math.max(items.length, 1);
  const availableHeight = area.height - ((count - 1) * CANVAS.blockGap);
  const boxHeight = Math.max(minHeight, Math.floor(availableHeight / count));
  const boxes = [];

  items.forEach((_, index) => {
    boxes.push({
      x: area.x,
      y: area.y + index * (boxHeight + CANVAS.blockGap),
      width: area.width,
      height: boxHeight
    });
  });

  return boxes;
}

function createTextElement(text, box, role, context, extra = {}) {
  const style = role === 'title'
    ? TYPOGRAPHY.title
    : role === 'subtitle'
      ? TYPOGRAPHY.subtitle
      : role === 'callout'
        ? TYPOGRAPHY.callout
        : role === 'bullet'
          ? TYPOGRAPHY.bullet
          : TYPOGRAPHY.body;

  const fitted = fitTextToBox(text, box, style.max, style.min, {
    lineHeight: CANVAS.lineHeight,
    bullet: extra.bullet
  });

  return {
    id: `${context.id}-${role}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'text',
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
    text: extra.bullet ? `• ${fitted.text}` : fitted.text,
    fontSize: fitted.fontSize,
    color: extra.accent ? context.stylePreset.accentColor : (role === 'title' ? context.stylePreset.titleColor : context.stylePreset.bodyColor),
    align: extra.align || 'left',
    bold: Boolean(extra.bold),
    styles: {
      fontSize: fitted.fontSize,
      color: extra.accent ? context.stylePreset.accentColor : (role === 'title' ? context.stylePreset.titleColor : context.stylePreset.bodyColor),
      fontWeight: extra.bold ? 700 : 400,
      textAlign: extra.align || 'left'
    }
  };
}

function fitTextToBox(text, box, maxFont, minFont, options = {}) {
  const normalized = normalizeText(text);
  let fontSize = maxFont;
  let fittedText = normalized;

  while (fontSize >= minFont) {
    const metrics = measureTextBlock(normalized, box.width, fontSize, options.lineHeight || 1.25);
    if (metrics.height <= box.height) {
      return { fontSize, text: normalized };
    }
    fontSize -= 1;
  }

  fittedText = trimTextToBox(normalized, box.width, box.height, minFont, options.lineHeight || 1.25);
  return { fontSize: minFont, text: fittedText };
}

function measureTextBlock(text, width, fontSize, lineHeight) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const charWidth = fontSize * 0.56;
  const maxCharsPerLine = Math.max(8, Math.floor(width / charWidth));
  let lines = 1;
  let current = 0;

  words.forEach((word) => {
    const tokenLength = word.length + (current > 0 ? 1 : 0);
    if ((current + tokenLength) > maxCharsPerLine) {
      lines += 1;
      current = word.length;
    } else {
      current += tokenLength;
    }
  });

  return {
    lines,
    height: Math.ceil(lines * fontSize * lineHeight)
  };
}

function trimTextToBox(text, width, height, fontSize, lineHeight) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  let current = words.join(' ');

  while (current.length > 0) {
    const metrics = measureTextBlock(current, width, fontSize, lineHeight);
    if (metrics.height <= height) return current;
    words.pop();
    current = `${words.join(' ')}…`;
  }

  return '…';
}

function validateResolvedSlide(elements) {
  const issues = [];
  const boxes = elements.map((element) => ({
    x: Number(element.x || 0),
    y: Number(element.y || 0),
    width: Number(element.width || 0),
    height: Number(element.height || 0)
  }));

  boxes.forEach((box, index) => {
    if ((box.x + box.width) > CANVAS.width || (box.y + box.height) > CANVAS.height) {
      issues.push(`Element ${index + 1} exceeds slide bounds.`);
    }
  });

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlap(boxes[i], boxes[j])) {
        issues.push(`Element ${i + 1} overlaps element ${j + 1}.`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

function boxesOverlap(a, b) {
  return !(
    (a.x + a.width) <= b.x
    || (b.x + b.width) <= a.x
    || (a.y + a.height) <= b.y
    || (b.y + b.height) <= a.y
  );
}

module.exports = {
  ALLOWED_TEMPLATES,
  CANVAS,
  TEMPLATE_FIELDS,
  buildSlidePrompt,
  parseAiSlideResponse,
  createFallbackResolvedSlides,
  resolveDraftSlides
};
