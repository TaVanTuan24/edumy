const express = require('express');
const request = require('supertest');

// Simulate health check logic from server.js
function createHealthApp(mongoReadyState = 1) {
  const app = express();
  const appVersion = '2.0.0';
  const isProduction = false;

  // Mock mongoose connection state
  const mockMongoose = { connection: { readyState: mongoReadyState } };

  app.get('/health', (_req, res) => {
    const mongoReady = mockMongoose.connection.readyState === 1;
    const mem = process.memoryUsage();
    const uptime = process.uptime();

    const aiConfigured = Boolean(
      String(process.env.AI_API_KEY || '').trim()
      || String(process.env.AI_BASE_URL || '').trim()
    );

    const status = mongoReady ? 'ok' : 'degraded';
    const httpStatus = mongoReady ? 200 : 503;

    res.status(httpStatus).json({
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.round(uptime),
      environment: isProduction ? 'production' : 'development',
      version: appVersion,
      memory: { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed },
      dependencies: {
        mongodb: { status: mongoReady ? 'ok' : 'disconnected', readyState: mockMongoose.connection.readyState },
        ai: { status: aiConfigured ? 'configured' : 'not_configured' }
      }
    });
  });

  return app;
}

describe('Health check', () => {
  test('returns 200 when MongoDB is connected', async () => {
    const app = createHealthApp(1);
    const res = await request(app).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('2.0.0');
    expect(res.body.dependencies.mongodb.status).toBe('ok');
  });

  test('returns 503 when MongoDB is disconnected', async () => {
    const app = createHealthApp(0);
    const res = await request(app).get('/health').expect(503);

    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.mongodb.status).toBe('disconnected');
  });

  test('reports AI as not configured when no env vars set', async () => {
    const oldKey = process.env.AI_API_KEY;
    const oldBase = process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_BASE_URL;

    const app = createHealthApp(1);
    const res = await request(app).get('/health').expect(200);

    expect(res.body.dependencies.ai.status).toBe('not_configured');

    // Restore
    if (oldKey) process.env.AI_API_KEY = oldKey;
    if (oldBase) process.env.AI_BASE_URL = oldBase;
  });

  test('reports AI as configured when env vars are set', async () => {
    const oldKey = process.env.AI_API_KEY;
    process.env.AI_API_KEY = 'test-key';

    const app = createHealthApp(1);
    const res = await request(app).get('/health').expect(200);

    expect(res.body.dependencies.ai.status).toBe('configured');

    // Restore
    if (oldKey) process.env.AI_API_KEY = oldKey;
    else delete process.env.AI_API_KEY;
  });

  test('does not expose secrets', async () => {
    process.env.SESSION_SECRET = 'super-secret-value';
    process.env.AI_API_KEY = 'sk-secret-key';
    process.env.MONGO_URI = 'mongodb://secret:pass@host/db';

    const app = createHealthApp(1);
    const res = await request(app).get('/health').expect(200);
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('super-secret-value');
    expect(body).not.toContain('sk-secret-key');
    expect(body).not.toContain('secret:pass');

    delete process.env.SESSION_SECRET;
    delete process.env.AI_API_KEY;
    delete process.env.MONGO_URI;
  });

  test('includes memory and uptime fields', async () => {
    const app = createHealthApp(1);
    const res = await request(app).get('/health').expect(200);

    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.memory).toBeDefined();
    expect(typeof res.body.memory.rss).toBe('number');
    expect(typeof res.body.memory.heapTotal).toBe('number');
    expect(typeof res.body.memory.heapUsed).toBe('number');
  });
});