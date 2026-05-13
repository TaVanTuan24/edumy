// TC-27: Audit log
// Kiểm tra thao tác quản trị tạo AuditLog, log được ghi ở thao tác chính

jest.mock('../models/AuditLog', () => ({
  create: jest.fn()
}));

const AuditLog = require('../models/AuditLog');
const { logAuditEvent } = require('../utils/auditLogger');

describe('TC-27: Audit log', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('logAuditEvent', () => {
    test('creates audit log with required fields', async () => {
      AuditLog.create.mockResolvedValue({});

      await logAuditEvent({
        userId: 'user-1',
        action: 'course_created',
        targetType: 'course',
        targetId: 'course-1',
        metadata: { title: 'New Course' }
      });

      expect(AuditLog.create).toHaveBeenCalledTimes(1);
      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        user: 'user-1',
        action: 'course_created',
        targetType: 'course',
        targetId: 'course-1'
      }));
    });

    test('extracts userId from req.user when not provided directly', async () => {
      AuditLog.create.mockResolvedValue({});

      const req = { user: { _id: 'user-from-req' } };
      await logAuditEvent({
        req,
        action: 'course_published',
        targetType: 'course',
        targetId: 'course-2'
      });

      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        user: 'user-from-req',
        action: 'course_published'
      }));
    });

    test('defaults targetType to system when not provided', async () => {
      AuditLog.create.mockResolvedValue({});

      await logAuditEvent({
        userId: 'user-1',
        action: 'health_check'
      });

      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        targetType: 'system'
      }));
    });

    test('does not throw when DB write fails', async () => {
      AuditLog.create.mockRejectedValue(new Error('DB down'));

      await expect(logAuditEvent({
        userId: 'user-1',
        action: 'test_action',
        targetType: 'test'
      })).resolves.not.toThrow();
    });

    test('handles missing optional fields gracefully', async () => {
      AuditLog.create.mockResolvedValue({});

      await logAuditEvent({
        action: 'minimal_action'
      });

      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        action: 'minimal_action',
        targetType: 'system',
        targetId: ''
      }));
    });
  });

  describe('Audit log metadata sanitization', () => {
    test('removes sensitive keys from metadata', async () => {
      AuditLog.create.mockResolvedValue({});

      await logAuditEvent({
        userId: 'user-1',
        action: 'settings_updated',
        targetType: 'user',
        targetId: 'user-1',
        metadata: {
          name: 'John',
          password: 'secret123',
          token: 'bearer-abc',
          secret: 'hidden',
          safeField: 'visible'
        }
      });

      const callArgs = AuditLog.create.mock.calls[0][0];
      expect(callArgs.metadata.name).toBe('John');
      expect(callArgs.metadata.safeField).toBe('visible');
      expect(callArgs.metadata.password).toBeUndefined();
      expect(callArgs.metadata.token).toBeUndefined();
      expect(callArgs.metadata.secret).toBeUndefined();
    });

    test('sanitizes nested objects', async () => {
      AuditLog.create.mockResolvedValue({});

      await logAuditEvent({
        userId: 'user-1',
        action: 'test',
        targetType: 'test',
        metadata: {
          nested: {
            apiKey: 'secret-key',
            safe: 'visible'
          }
        }
      });

      const callArgs = AuditLog.create.mock.calls[0][0];
      expect(callArgs.metadata.nested.safe).toBe('visible');
      expect(callArgs.metadata.nested.apiKey).toBeUndefined();
    });
  });

  describe('Audit log for admin operations', () => {
    test('course creation generates audit log', async () => {
      AuditLog.create.mockResolvedValue({});

      await logAuditEvent({
        userId: 'admin-1',
        action: 'course_created',
        targetType: 'course',
        targetId: 'course-new',
        metadata: { title: 'AI Course', importSource: 'youtube' }
      });

      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        action: 'course_created',
        targetType: 'course'
      }));
    });

    test('course status change generates audit log', async () => {
      AuditLog.create.mockResolvedValue({});

      await logAuditEvent({
        userId: 'admin-1',
        action: 'course_published',
        targetType: 'course',
        targetId: 'course-1',
        metadata: { previousStatus: 'draft', newStatus: 'published' }
      });

      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        action: 'course_published'
      }));
    });

    test('user role change generates audit log', async () => {
      AuditLog.create.mockResolvedValue({});

      await logAuditEvent({
        userId: 'admin-1',
        action: 'user_role_changed',
        targetType: 'user',
        targetId: 'user-2',
        metadata: { previousRole: 'student', newRole: 'instructor' }
      });

      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        action: 'user_role_changed',
        targetType: 'user'
      }));
    });
  });
});