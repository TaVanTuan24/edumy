if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const Course = require('../models/course');

const MONGO_URL = process.env.DB_URL || 'mongodb://localhost:27017/edumy';
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

function migrateLegacyItem(item) {
  if (!item || typeof item !== 'object') return { changed: false };

  const rawType = String(item.type || '').toLowerCase();
  const isSlideType = rawType === 'slide';
  const looksLikeSlide = Array.isArray(item.slides) && item.slides.length > 0;
  const contentIsObject = item.content && typeof item.content === 'object' && !Array.isArray(item.content);
  const contentSlides = contentIsObject && Array.isArray(item.content.slides) ? item.content.slides : [];
  const contentString = typeof item.content === 'string' ? item.content : '';

  if (!isSlideType && !looksLikeSlide && !contentSlides.length && !contentString.trim()) {
    return { changed: false };
  }

  const normalizedSlides = contentSlides.length
    ? normalizeSlides(contentSlides)
    : looksLikeSlide
      ? normalizeSlides(item.slides)
      : buildSlidesFromContentString(contentString, item.name || item.title || 'Slide');

  const nextContent = contentIsObject ? { ...item.content, slides: normalizedSlides } : { slides: normalizedSlides };

  const prevSlidesJson = JSON.stringify(Array.isArray(item.slides) ? item.slides : []);
  const nextSlidesJson = JSON.stringify(normalizedSlides);
  const prevContentJson = JSON.stringify(item.content || {});
  const nextContentJson = JSON.stringify(nextContent);

  const changed = prevSlidesJson !== nextSlidesJson || prevContentJson !== nextContentJson || rawType === 'lecture';

  if (changed) {
    item.type = 'slide';
    item.slides = normalizedSlides;
    item.content = nextContent;
  }

  return { changed };
}

async function run() {
  await mongoose.connect(MONGO_URL);
  console.log(`[migration] connected: ${MONGO_URL}`);
  console.log(`[migration] mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const courses = await Course.find({});

  let courseTouched = 0;
  let lessonTouched = 0;

  for (const course of courses) {
    let changedInCourse = false;

    if (Array.isArray(course.driveStructure)) {
      for (const section of course.driveStructure) {
        if (!section || !Array.isArray(section.videos)) continue;

        for (const item of section.videos) {
          const { changed } = migrateLegacyItem(item);
          if (changed) {
            changedInCourse = true;
            lessonTouched += 1;
          }
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
