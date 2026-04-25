'use strict';

function getContentObject(lesson) {
  return lesson && typeof lesson.content === 'object' && lesson.content ? lesson.content : {};
}

function hasCustomSlides(lesson) {
  const content = getContentObject(lesson);
  const slides = Array.isArray(content.slides)
    ? content.slides
    : Array.isArray(lesson && lesson.slides)
      ? lesson.slides
      : [];
  return slides.length > 0;
}

function hasPdfContent(lesson) {
  const content = getContentObject(lesson);
  const pdf = content.pdf || (lesson && lesson.pdf);
  if (typeof pdf === 'string') return Boolean(pdf.trim());
  if (!pdf || typeof pdf !== 'object') return false;
  return Boolean(String(pdf.url || '').trim());
}

function getLessonContentMode(lesson) {
  const slides = hasCustomSlides(lesson);
  const pdf = hasPdfContent(lesson);

  if (slides && pdf) return 'hybrid';
  if (pdf) return 'pdf';
  if (slides) return 'slides';
  return 'empty';
}

module.exports = {
  getLessonContentMode,
  hasCustomSlides,
  hasPdfContent
};
