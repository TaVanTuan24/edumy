if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const Course = require('../models/course');

const MONGO_URI = String(process.env.MONGO_URI || '').trim();
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

function normalizeSlides(slides) {
  const source = Array.isArray(slides) ? slides : [];
  return source
    .map((slide, index) => ({
      title: String((slide && slide.title) || `Slide ${index + 1}`).trim(),
      content: String((slide && slide.content) || '').trim()
    }))
    .filter((slide) => slide.title.length > 0 || slide.content.length > 0);
}

function buildSlidesFromContentString(contentString, fallbackTitle) {
  const text = String(contentString || '').trim();
  if (!text) return [];
  return [{
    title: String(fallbackTitle || 'Slide').trim() || 'Slide',
    content: text
  }];
}

function migrateLesson(lesson) {
  if (!lesson || typeof lesson !== 'object') return { changed: false };

  const rawType = String(lesson.type || '').toLowerCase();
  const isSlideType = rawType === 'slide';
  const contentIsObject = lesson.content && typeof lesson.content === 'object' && !Array.isArray(lesson.content);
  const contentSlides = contentIsObject && Array.isArray(lesson.content.slides) ? lesson.content.slides : [];
  const contentString = typeof lesson.content === 'string' ? lesson.content : '';

  if (!isSlideType && !contentSlides.length && !contentString.trim()) {
    return { changed: false };
  }

  const normalizedSlides = contentSlides.length
    ? normalizeSlides(contentSlides)
    : buildSlidesFromContentString(contentString, lesson.title || 'Slide');

  const nextContent = contentIsObject ? { ...lesson.content, slides: normalizedSlides } : { slides: normalizedSlides };
  const prevContentJson = JSON.stringify(lesson.content || {});
  const nextContentJson = JSON.stringify(nextContent);
  const changed = prevContentJson !== nextContentJson || rawType === 'lecture';

  if (changed) {
    lesson.type = 'slide';
    lesson.content = nextContent;
  }

  return { changed };
}

async function run() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  await mongoose.connect(MONGO_URI);
  console.log('[migration] connected');
  console.log(`[migration] mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const courses = await Course.find({});

  let courseTouched = 0;
  let lessonTouched = 0;

  for (const course of courses) {
    let changedInCourse = false;

    for (const section of Array.isArray(course.sections) ? course.sections : []) {
      if (!section || !Array.isArray(section.lessons)) continue;

      for (const lesson of section.lessons) {
        const { changed } = migrateLesson(lesson);
        if (changed) {
          changedInCourse = true;
          lessonTouched += 1;
        }
      }
    }

    if (changedInCourse) {
      courseTouched += 1;
      if (VERBOSE) {
        console.log(`[migration] touch course: ${course._id} - ${course.title}`);
      }
      if (APPLY) {
        await course.save();
      }
    }
  }

  console.log(`[migration] courses touched: ${courseTouched}`);
  console.log(`[migration] lessons normalized: ${lessonTouched}`);
  console.log(`[migration] completed`);

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('[migration] failed:', err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
