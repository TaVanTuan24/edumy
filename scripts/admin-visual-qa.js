const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const mongoose = require('mongoose');
const Course = require('../models/course');

const BASE_URL = process.env.UI_SMOKE_BASE_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.UI_SMOKE_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.UI_SMOKE_ADMIN_PASSWORD || '123';
const OUTPUT_DIR = path.join(process.cwd(), 'qa-shots', 'admin');
const MONGO_URI = String(process.env.MONGO_URI || '').trim();

async function findAdminBrowser() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function getCourseTargets() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is required for admin visual QA.');
  }

  await mongoose.connect(MONGO_URI);
  const course = await Course.findOne({}).lean();
  if (!course) {
    await mongoose.disconnect();
    return null;
  }

  let firstSlide = null;
  let firstVideo = null;
  let firstQuiz = null;
  (course.sections || []).forEach((section, sIndex) => {
    (section.lessons || []).forEach((lesson, lIndex) => {
      if (!firstSlide && String(lesson.type) === 'slide') firstSlide = { sIndex, lIndex };
      if (!firstVideo && (String(lesson.type) === 'video' || String(lesson.type) === 'lecture')) firstVideo = { sIndex, lIndex };
      if (!firstQuiz && String(lesson.type) === 'quiz') firstQuiz = { sIndex, lIndex };
    });
  });

  await mongoose.disconnect();
  return {
    courseId: String(course._id),
    firstSlide,
    firstVideo,
    firstQuiz
  };
}

async function screenshot(page, fileName, pagePath, waitForSelector) {
  await page.goto(new URL(pagePath, BASE_URL).toString(), { waitUntil: 'networkidle' });
  if (waitForSelector) {
    await page.locator(waitForSelector).first().waitFor({ state: 'visible', timeout: 15000 });
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, fileName), fullPage: true });
  console.log(`SHOT=${fileName}`);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const executablePath = await findAdminBrowser();
  if (!executablePath) {
    throw new Error('No local Edge/Chrome executable found for admin visual QA.');
  }

  const targets = await getCourseTargets();
  if (!targets) {
    throw new Error('No courses found for admin visual QA.');
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1024 }
  });
  const page = await context.newPage();

  await page.goto(new URL('/login', BASE_URL).toString(), { waitUntil: 'networkidle' });
  await page.fill('#username', ADMIN_USERNAME);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.goto(new URL('/admin', BASE_URL).toString(), { waitUntil: 'networkidle' });

  await screenshot(page, 'admin-dashboard.png', '/admin', 'h1');
  await screenshot(page, 'course-editor.png', `/admin/courses/${targets.courseId}/editor`, '#sectionsContainer');
  await screenshot(page, 'course-analytics.png', `/admin/courses/${targets.courseId}/analytics`, '.analytics-container');

  if (targets.firstSlide) {
    await screenshot(
      page,
      'slide-editor.png',
      `/admin/courses/${targets.courseId}/slide-editor?section=${targets.firstSlide.sIndex}&lesson=${targets.firstSlide.lIndex}`,
      '#slideCanvas'
    );
  }

  if (targets.firstVideo) {
    await screenshot(
      page,
      'video-settings.png',
      `/admin/courses/${targets.courseId}/video-settings?section=${targets.firstVideo.sIndex}&lesson=${targets.firstVideo.lIndex}`,
      '#timedQuizList'
    );
  }

  if (targets.firstQuiz) {
    await screenshot(
      page,
      'quiz-editor.png',
      `/admin/course/${targets.courseId}/quiz/${targets.firstQuiz.sIndex}/${targets.firstQuiz.lIndex}`,
      '#quizEditorPage'
    );
  }

  await browser.close();
}

main().catch((error) => {
  console.error('[admin-visual-qa] failed:', error);
  process.exitCode = 1;
});
