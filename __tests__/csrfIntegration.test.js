const express = require('express');
const request = require('supertest');
const session = require('express-session');
const { csrfProtection, csrfTokenOnly } = require('../middleware/csrf');

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true }
  }));

  // Mimic server.js skip logic for /skip-csrf
  app.use((req, res, next) => {
    if (req.path === '/skip-csrf') {
      return csrfTokenOnly(req, res, next);
    }
    return csrfProtection(req, res, next);
  });

  // GET endpoint - safe method, no CSRF validation
  app.get('/page', (req, res) => {
    res.json({ csrfToken: res.locals.csrfToken });
  });

  // POST endpoint - requires CSRF
  app.post('/action', (req, res) => {
    res.json({ success: true, body: req.body });
  });

  // PUT endpoint - requires CSRF
  app.put('/resource', (req, res) => {
    res.json({ success: true });
  });

  // DELETE endpoint - requires CSRF
  app.delete('/resource', (req, res) => {
    res.json({ success: true });
  });

  // Skip CSRF route
  app.post('/skip-csrf', (req, res) => {
    res.json({ success: true, token: res.locals.csrfToken });
  });

  return app;
}

describe('CSRF integration', () => {
  let app;
  let agent;

  beforeEach(() => {
    app = createApp();
    agent = request.agent(app);
  });

  test('GET request succeeds and returns CSRF token', async () => {
    const res = await agent.get('/page').expect(200);
    expect(res.body.csrfToken).toBeTruthy();
    expect(typeof res.body.csrfToken).toBe('string');
  });

  test('POST without CSRF token returns 403 JSON', async () => {
    const res = await agent
      .post('/action')
      .send({ data: 'test' })
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('EBADCSRFTOKEN');
  });

  test('POST with valid CSRF token succeeds', async () => {
    // First get a token
    const getRes = await agent.get('/page').expect(200);
    const token = getRes.body.csrfToken;

    // POST with token in header
    const res = await agent
      .post('/action')
      .send({ data: 'test' })
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .set('x-csrf-token', token)
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('POST with body _csrf token succeeds', async () => {
    const getRes = await agent.get('/page').expect(200);
    const token = getRes.body.csrfToken;

    const res = await agent
      .post('/action')
      .send(`_csrf=${encodeURIComponent(token)}`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('PUT without token returns 403', async () => {
    const res = await agent
      .put('/resource')
      .set('Accept', 'application/json')
      .expect(403);

    expect(res.body.code).toBe('EBADCSRFTOKEN');
  });

  test('DELETE without token returns 403', async () => {
    const res = await agent
      .delete('/resource')
      .set('Accept', 'application/json')
      .expect(403);

    expect(res.body.code).toBe('EBADCSRFTOKEN');
  });

  test('POST with tampered token returns 403', async () => {
    const getRes = await agent.get('/page').expect(200);
    const token = getRes.body.csrfToken;
    const parts = token.split('.');
    parts[1] = 'tampered' + parts[1];
    const tamperedToken = parts.join('.');

    const res = await agent
      .post('/action')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .set('x-csrf-token', tamperedToken)
      .expect(403);

    expect(res.body.code).toBe('EBADCSRFTOKEN');
  });

  test('skip CSRF route does not require token', async () => {
    const res = await agent
      .post('/skip-csrf')
      .send({ data: 'test' })
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTruthy();
  });
});