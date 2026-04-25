const BASE_URL = process.env.UI_SMOKE_BASE_URL || 'http://localhost:3000';

function absoluteUrl(path) {
  return new URL(path, BASE_URL).toString();
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  capture(response) {
    const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    setCookie.forEach((header) => {
      const [pair] = String(header || '').split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) return;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) return;
      this.cookies.set(name, value);
    });
  }

  header() {
    return Array.from(this.cookies.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

async function request(path, options = {}, jar) {
  const headers = new Headers(options.headers || {});
  if (jar) {
    const cookie = jar.header();
    if (cookie) headers.set('Cookie', cookie);
  }

  const response = await fetch(absoluteUrl(path), {
    redirect: 'manual',
    ...options,
    headers
  });

  if (jar) {
    jar.capture(response);
  }

  return response;
}

async function getHtml(path, jar) {
  const response = await request(path, {}, jar);
  return {
    status: response.status,
    location: response.headers.get('location') || '',
    html: await response.text()
  };
}

function extractCsrf(html) {
  const match = String(html || '').match(/name="_csrf"\s+value="([^"]+)"/i);
  return match ? match[1] : '';
}

function extractFirstCourseId(html) {
  const match = String(html || '').match(/\/explore\/([a-f0-9]{24})\/preview/i);
  return match ? match[1] : '';
}

function extractTitle(html) {
  const match = String(html || '').match(/<title>([^<]+)<\/title>/i);
  return match ? match[1] : '';
}

async function registerUser(username, email, password) {
  const jar = new CookieJar();
  const registerPage = await getHtml('/register', jar);
  const csrf = extractCsrf(registerPage.html);
  if (!csrf) throw new Error('Missing CSRF token on register page.');

  const body = new URLSearchParams({
    _csrf: csrf,
    username,
    email,
    password
  });

  const response = await request('/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  }, jar);

  return { jar, response };
}

async function loginUser(username, password) {
  const jar = new CookieJar();
  const loginPage = await getHtml('/login', jar);
  const csrf = extractCsrf(loginPage.html);
  if (!csrf) throw new Error('Missing CSRF token on login page.');

  const body = new URLSearchParams({
    _csrf: csrf,
    username,
    password
  });

  const response = await request('/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  }, jar);

  return { jar, response };
}

function logResult(label, value) {
  console.log(`${label}=${value}`);
}

async function runGuestChecks() {
  const home = await getHtml('/', null);
  const explore = await getHtml('/explore', null);
  logResult('GUEST_HOME_STATUS', home.status);
  logResult('GUEST_EXPLORE_STATUS', explore.status);
  logResult('GUEST_HOME_TITLE', extractTitle(home.html));
}

async function runLearnerChecks() {
  const username = `ui_learner_${Date.now()}`;
  const email = `${username}@example.com`;
  const password = 'QaPass123!';
  const { jar } = await registerUser(username, email, password);

  const dashboard = await getHtml('/courses', jar);
  const explore = await getHtml('/explore', jar);
  const courseId = extractFirstCourseId(explore.html);

  logResult('LEARNER_DASHBOARD_STATUS', dashboard.status);
  logResult('LEARNER_EXPLORE_STATUS', explore.status);
  logResult('LEARNER_COURSE_ID', courseId || 'NONE');

  if (!courseId) return;

  const preview = await getHtml(`/explore/${courseId}/preview`, jar);
  const previewCsrf = extractCsrf(preview.html);
  if (previewCsrf) {
    await request(`/explore/${courseId}/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ _csrf: previewCsrf })
    }, jar);
  }

  const course = await getHtml(`/courses/${courseId}`, jar);
  logResult('LEARNER_COURSE_STATUS', course.status);
  logResult('LEARNER_COURSE_HAS_STAGE', /learning-stage-header/.test(course.html));
  logResult('LEARNER_COURSE_HAS_AI_DOCK', /lesson-ai-dock/.test(course.html));
}

async function runAdminChecks() {
  const adminUsername = process.env.UI_SMOKE_ADMIN_USERNAME || '';
  const adminPassword = process.env.UI_SMOKE_ADMIN_PASSWORD || '';
  if (!adminUsername || !adminPassword) {
    logResult('ADMIN_CHECKS', 'SKIPPED');
    return;
  }

  const { jar } = await loginUser(adminUsername, adminPassword);
  const admin = await getHtml('/admin', jar);
  const editor = await getHtml('/admin', jar);
  logResult('ADMIN_STATUS', admin.status);
  logResult('ADMIN_HAS_DASHBOARD', /Admin Dashboard/.test(admin.html));
  logResult('ADMIN_EDITOR_SMOKE', editor.status);
}

async function main() {
  await runGuestChecks();
  await runLearnerChecks();
  await runAdminChecks();
}

main().catch((error) => {
  console.error('[ui-smoke] failed:', error);
  process.exitCode = 1;
});
