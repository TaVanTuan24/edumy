// TC-24: Kiểm tra quyền
// Kiểm tra truy cập route trái quyền, request bị từ chối, hệ thống chặn thao tác trái quyền

const {
  sanitizeReturnTo,
  isLoggedIn,
  isAdmin,
  isAdminUser,
  userCanManageCourse
} = require('../middleware');

function createResponse() {
  return {
    locals: {},
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis()
  };
}

describe('TC-24: Permission check', () => {
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

  describe('Authentication (isLoggedIn)', () => {
    test('unauthenticated user is redirected to /login', () => {
      const req = {
        xhr: false,
        originalUrl: '/courses/123',
        session: {},
        isAuthenticated: jest.fn().mockReturnValue(false),
        get: jest.fn().mockReturnValue('text/html'),
        flash: jest.fn()
      };
      const res = createResponse();
      const next = jest.fn();

      isLoggedIn(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith('/login');
      expect(next).not.toHaveBeenCalled();
      expect(req.session.returnTo).toBe('/courses/123');
    });

    test('authenticated user passes through', () => {
      const req = {
        isAuthenticated: jest.fn().mockReturnValue(true)
      };
      const res = createResponse();
      const next = jest.fn();

      isLoggedIn(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  describe('Admin authorization (isAdmin)', () => {
    test('non-admin user is blocked from admin routes', () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      const req = {
        xhr: false,
        user: { email: 'user@example.com' },
        get: jest.fn().mockReturnValue('text/html'),
        flash: jest.fn()
      };
      const res = createResponse();
      const next = jest.fn();

      isAdmin(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith('/courses');
      expect(next).not.toHaveBeenCalled();
    });

    test('admin user passes admin check', () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      const req = {
        xhr: false,
        user: { email: 'admin@example.com' },
        get: jest.fn().mockReturnValue('text/html'),
        flash: jest.fn()
      };
      const res = createResponse();
      const next = jest.fn();

      isAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    test('isAdminUser utility returns true for admin email', () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      const user = { email: 'admin@example.com' };
      expect(isAdminUser(user)).toBe(true);
    });

    test('isAdminUser utility returns false for non-admin email', () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      const user = { email: 'user@example.com' };
      expect(isAdminUser(user)).toBe(false);
    });
  });

  describe('Course management authorization', () => {
    test('course author can manage their course', () => {
      const user = { _id: 'user-1' };
      const course = { author: 'user-1' };

      const canManage = userCanManageCourse(user, course);
      expect(canManage).toBe(true);
    });

    test('non-author cannot manage course (unless admin)', () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      const user = { _id: 'user-2', email: 'other@example.com' };
      const course = { author: 'user-1' };

      const canManage = userCanManageCourse(user, course);
      expect(canManage).toBe(false);
    });

    test('admin can manage any course', () => {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      const user = { _id: 'user-admin', email: 'admin@example.com' };
      const course = { author: 'user-1' };

      const canManage = userCanManageCourse(user, course);
      expect(canManage).toBe(true);
    });
  });

  describe('URL sanitization (open redirect prevention)', () => {
    test('same-origin URL is allowed', () => {
      const req = {
        protocol: 'http',
        get: jest.fn().mockReturnValue('localhost:3000')
      };

      expect(sanitizeReturnTo('/courses/123', req)).toBe('/courses/123');
    });

    test('external URL is blocked', () => {
      const req = {
        protocol: 'http',
        get: jest.fn().mockReturnValue('localhost:3000')
      };

      expect(sanitizeReturnTo('https://evil.com/phish', req)).toBeNull();
    });

    test('absolute same-origin URL is normalized', () => {
      const req = {
        protocol: 'http',
        get: jest.fn().mockReturnValue('localhost:3000')
      };

      expect(sanitizeReturnTo('http://localhost:3000/admin', req)).toBe('/admin');
    });
  });
});