jest.mock('../services/analyticsEventService', () => {
  const ANALYTICS_EVENTS = Object.freeze({
    LESSON_STARTED: 'lesson_started',
    LESSON_COMPLETED: 'lesson_completed',
    VIDEO_PROGRESS: 'video_progress',
    COURSE_ENROLLED: 'course_enrolled',
    COURSE_COMPLETED: 'course_completed',
    QUIZ_ATTEMPT_STARTED: 'quiz_attempt_started',
    QUIZ_QUESTION_ANSWERED: 'quiz_question_answered',
    QUIZ_COMPLETED: 'quiz_completed',
    AI_QUESTION_ASKED: 'ai_question_asked',
    NOTIFICATION_CLICKED: 'notification_clicked'
  });

  return {
    ANALYTICS_EVENTS,
    trackEventSafe: jest.fn()
  };
});

const express = require('express');
const request = require('supertest');
const analyticsRoutes = require('../routes/analytics');
const { trackEventSafe } = require('../services/analyticsEventService');

function createApp({ authenticated = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = () => authenticated;
    req.user = authenticated ? { _id: '68a69b0a055071b7e4410b8f' } : null;
    req.flash = jest.fn();
    next();
  });
  app.use('/analytics', analyticsRoutes);
  return app;
}

describe('analytics route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects unauthenticated requests', async () => {
    const app = createApp({ authenticated: false });

    const res = await request(app)
      .post('/analytics/events')
      .set('Accept', 'application/json')
      .send({ eventType: 'lesson_started' })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(trackEventSafe).not.toHaveBeenCalled();
  });

  test('accepts valid authenticated event', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/analytics/events')
      .set('Accept', 'application/json')
      .send({
        eventType: 'video_progress',
        courseId: '68a69b0a055071b7e4410b8f',
        lessonId: 'lesson-1',
        metadata: {
          currentTime: 120,
          duration: 600,
          watchedPercent: 20
        }
      })
      .expect(200);

    expect(res.body).toEqual({ success: true });
    expect(trackEventSafe).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'video_progress',
      course: '68a69b0a055071b7e4410b8f',
      lessonId: 'lesson-1',
      source: 'client'
    }));
  });

  test('rejects invalid eventType', async () => {
    const app = createApp();

    await request(app)
      .post('/analytics/events')
      .set('Accept', 'application/json')
      .send({ eventType: 'unknown_event' })
      .expect(400);

    expect(trackEventSafe).not.toHaveBeenCalled();
  });

  test('client cannot override userId', async () => {
    const app = createApp();

    await request(app)
      .post('/analytics/events')
      .set('Accept', 'application/json')
      .send({
        eventType: 'lesson_started',
        user: '000000000000000000000000',
        courseId: '68a69b0a055071b7e4410b8f'
      })
      .expect(400);

    expect(trackEventSafe).not.toHaveBeenCalled();
  });

  test('rejects oversized metadata', async () => {
    const app = createApp();

    await request(app)
      .post('/analytics/events')
      .set('Accept', 'application/json')
      .send({
        eventType: 'video_progress',
        metadata: {
          value: 'x'.repeat(11000)
        }
      })
      .expect(400);

    expect(trackEventSafe).not.toHaveBeenCalled();
  });
});
