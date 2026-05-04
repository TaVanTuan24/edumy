const express = require('express');
const request = require('supertest');
const session = require('express-session');
const { validate, registerSchema, aiChatMessageSchema } = require('../middleware/validate');

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
  app.use((req, res, next) => {
    res.locals.csrfToken = 'test';
    req.csrfToken = () => 'test';
    req.flash = (type, msg) => { res.locals._flash = { type, msg }; };
    next();
  });

  // JSON API route with validation
  app.post('/api/register', validate(registerSchema), (req, res) => {
    res.json({ success: true, data: req.body });
  });

  // JSON API route with AI chat validation
  app.post('/api/chat', validate(aiChatMessageSchema), (req, res) => {
    res.json({ success: true, data: req.body });
  });

  // HTML form route with validation
  app.post('/register-form', validate(registerSchema), (req, res) => {
    res.json({ success: true });
  });

  return app;
}

describe('Joi validation integration', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  test('JSON valid register input succeeds', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ email: 'test@example.com', username: 'testuser', password: 'password123' })
      .set('Accept', 'application/json')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('test@example.com');
  });

  test('JSON missing required fields returns 400 with errors array', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ email: 'test@example.com' })
      .set('Accept', 'application/json')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  test('JSON invalid email returns 400', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ email: 'not-an-email', username: 'testuser', password: 'password123' })
      .set('Accept', 'application/json')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/email/i);
  });

  test('JSON short password returns 400', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ email: 'test@example.com', username: 'testuser', password: '123' })
      .set('Accept', 'application/json')
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  test('JSON unknown fields are stripped', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
        extraField: 'should be removed'
      })
      .set('Accept', 'application/json')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.extraField).toBeUndefined();
  });

  test('JSON valid chat message succeeds', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Hello AI' })
      .set('Accept', 'application/json')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('JSON empty message returns 400', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: '' })
      .set('Accept', 'application/json')
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  test('HTML invalid register redirects with flash', async () => {
    const res = await request(app)
      .post('/register-form')
      .type('form')
      .send({ email: 'test@example.com' })
      .set('Accept', 'text/html')
      .expect(302);

    expect(res.headers.location).toBeDefined();
  });
});