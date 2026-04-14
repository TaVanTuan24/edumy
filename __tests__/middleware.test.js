const {
  sanitizeReturnTo,
  storeReturnTo,
  isLoggedIn,
  isAdmin
} = require('../middleware');

function createResponse() {
  return {
    locals: {},
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis()
  };
}

describe('middleware', () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;
  const originalAdminUserIds = process.env.ADMIN_USER_IDS;

  afterEach(() => {
    if (typeof originalAdminEmails === 'undefined') {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = originalAdminEmails;
    }

    if (typeof originalAdminUserIds === 'undefined') {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = originalAdminUserIds;
    }
  });

  test('sanitizeReturnTo only allows same-origin or relative targets', () => {
    const req = {
      protocol: 'http',
      get: jest.fn().mockImplementation((header) => {
        if (header === 'host') return 'localhost:3000';
        return '';
      })
    };

    expect(sanitizeReturnTo('/courses/123?tab=notes', req)).toBe('/courses/123?tab=notes');
    expect(sanitizeReturnTo('http://localhost:3000/admin', req)).toBe('/admin');
    expect(sanitizeReturnTo('https://evil.example.com/phish', req)).toBeNull();
  });

  test('storeReturnTo prefers session value and clears it after use', () => {
    const req = {
      session: { returnTo: '/dashboard?filter=recent' },
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost:3000')
    };
    const res = createResponse();

    storeReturnTo(req, res, jest.fn());

    expect(res.locals.returnTo).toBe('/dashboard?filter=recent');
    expect(req.session.returnTo).toBeUndefined();
  });

  test('isLoggedIn redirects guests to /login and stores the requested URL', () => {
    const req = {
      xhr: false,
      originalUrl: '/admin/courses/123/editor',
      session: {},
      isAuthenticated: jest.fn().mockReturnValue(false),
      get: jest.fn().mockReturnValue('text/html'),
      flash: jest.fn()
    };
    const res = createResponse();
    const next = jest.fn();

    isLoggedIn(req, res, next);

    expect(req.session.returnTo).toBe('/admin/courses/123/editor');
    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('isAdmin blocks access when ADMIN_EMAILS is not configured', () => {
    delete process.env.ADMIN_EMAILS;
    process.env.ADMIN_USER_IDS = '123456789012345678901234';

    const req = {
      xhr: false,
      user: { _id: '000000000000000000000000', email: 'admin@example.com' },
      get: jest.fn().mockReturnValue('text/html'),
      flash: jest.fn()
    };
    const res = createResponse();
    const next = jest.fn();

    isAdmin(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/courses');
    expect(next).not.toHaveBeenCalled();
  });

  test('isAdmin allows configured admin emails', () => {
    process.env.ADMIN_EMAILS = 'admin@example.com, owner@example.com';
    delete process.env.ADMIN_USER_IDS;

    const req = {
      xhr: false,
      user: { email: 'Admin@Example.com' },
      get: jest.fn().mockReturnValue('text/html'),
      flash: jest.fn()
    };
    const res = createResponse();
    const next = jest.fn();

    isAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('isAdmin allows the configured admin user id', () => {
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_USER_IDS;

    const req = {
      xhr: false,
      user: { _id: '68a69b0a055071b7e4410b8f', email: 'someone@example.com' },
      get: jest.fn().mockReturnValue('text/html'),
      flash: jest.fn()
    };
    const res = createResponse();
    const next = jest.fn();

    isAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
