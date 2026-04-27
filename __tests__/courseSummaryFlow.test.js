function createResponse() {
  return {
    redirectedTo: '',
    renderedView: '',
    renderedData: null,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    redirect(path) {
      this.redirectedTo = path;
      return this;
    },
    render(view, data) {
      this.renderedView = view;
      this.renderedData = data;
      return this;
    },
    json(payload) {
      this.jsonPayload = payload;
      return this;
    }
  };
}

describe('course summary controller flow', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createCourse generates the AI summary once and saves it', async () => {
    const generateCourseSummary = jest.fn().mockResolvedValue({
      summary: 'Stored summary',
      generatedAt: new Date('2026-04-27T12:00:00.000Z'),
      model: 'gpt-5.5'
    });
    const logAuditEvent = jest.fn().mockResolvedValue();

    let saveCount = 0;
    const Course = jest.fn(function Course(data) {
      Object.assign(this, data);
      this._id = 'course-1';
      this.images = [];
      this.sections = Array.isArray(data.sections) ? data.sections : [];
      this.save = jest.fn(async () => {
        saveCount += 1;
        return this;
      });
    });
    Course.findById = jest.fn();

    jest.doMock('../models/course', () => Course);
    jest.doMock('../utils/driveScanner', () => jest.fn());
    jest.doMock('../models/progress', () => ({ findOne: jest.fn() }));
    jest.doMock('../models/note', () => ({ find: jest.fn() }));
    jest.doMock('../models/user', () => ({ findById: jest.fn() }));
    jest.doMock('../models/userCourseProgress', () => ({}));
    jest.doMock('../models/discussion', () => ({ find: jest.fn() }));
    jest.doMock('../utils/gamification', () => ({
      awardGamification: jest.fn(),
      buildGamificationViewModel: jest.fn(),
      recordLearningActivity: jest.fn()
    }));
    jest.doMock('../utils/auditLogger', () => ({ logAuditEvent }));
    jest.doMock('../services/learnerDashboardService', () => ({ buildLearnerDashboard: jest.fn() }));
    jest.doMock('../utils/courseLifecycle', () => ({ getEffectiveCourseStatus: jest.fn() }));
    jest.doMock('../utils/lessonLocator', () => ({ findLessonContext: jest.fn() }));
    jest.doMock('../services/lessonAiContextService', () => ({
      buildLessonAiContext: jest.fn(),
      buildLessonAiPrompt: jest.fn()
    }));
    jest.doMock('../services/ai/chatOrchestrator', () => ({ generatePromptReply: jest.fn() }));
    jest.doMock('../services/ai/courseSummaryService', () => ({
      applyGeneratedCourseSummary: jest.fn((course, result) => {
        course.aiSummary = result.summary;
        course.aiSummaryGeneratedAt = result.generatedAt;
        course.aiSummaryModel = result.model;
        return course;
      }),
      clearGeneratedCourseSummary: jest.fn((course) => {
        course.aiSummary = '';
        course.aiSummaryGeneratedAt = null;
        course.aiSummaryModel = '';
        return course;
      }),
      generateCourseSummary
    }));
    jest.doMock('../config/ai', () => ({ normalizeAiModel: jest.fn((model) => model) }));
    jest.doMock('../services/youtube/youtubeCourseImportService', () => ({ buildCourseSectionsFromPreview: jest.fn((sections) => sections) }));
    jest.doMock('../utils/courseContentAdapter', () => ({
      getCanonicalSections: jest.fn((course) => course.sections || []),
      syncCourseContent: jest.fn()
    }));

    const courses = require('../controllers/courses');
    const req = {
      body: {
        course: {
          title: 'AI Basics',
          description: 'Course description',
          topic: 'AI',
          importSource: 'youtube',
          sections: []
        }
      },
      files: [],
      user: { _id: 'user-1' },
      flash: jest.fn()
    };
    const res = createResponse();

    await courses.createCourse(req, res);

    expect(generateCourseSummary).toHaveBeenCalledTimes(1);
    expect(generateCourseSummary).toHaveBeenCalledWith(expect.objectContaining({ _id: 'course-1' }), { userId: 'user-1' });
    expect(saveCount).toBe(2);
    expect(logAuditEvent).toHaveBeenCalled();
    expect(res.redirectedTo).toBe('/courses/course-1');
    expect(Course.mock.instances[0].aiSummary).toBe('Stored summary');
    expect(Course.mock.instances[0].aiSummaryModel).toBe('gpt-5.5');
  });

  test('createCourse still creates the course when summary generation fails', async () => {
    const generateCourseSummary = jest.fn().mockRejectedValue(new Error('provider unavailable'));

    let saveCount = 0;
    const Course = jest.fn(function Course(data) {
      Object.assign(this, data);
      this._id = 'course-2';
      this.images = [];
      this.sections = Array.isArray(data.sections) ? data.sections : [];
      this.save = jest.fn(async () => {
        saveCount += 1;
        return this;
      });
    });
    Course.findById = jest.fn();

    jest.doMock('../models/course', () => Course);
    jest.doMock('../utils/driveScanner', () => jest.fn());
    jest.doMock('../models/progress', () => ({ findOne: jest.fn() }));
    jest.doMock('../models/note', () => ({ find: jest.fn() }));
    jest.doMock('../models/user', () => ({ findById: jest.fn() }));
    jest.doMock('../models/userCourseProgress', () => ({}));
    jest.doMock('../models/discussion', () => ({ find: jest.fn() }));
    jest.doMock('../utils/gamification', () => ({
      awardGamification: jest.fn(),
      buildGamificationViewModel: jest.fn(),
      recordLearningActivity: jest.fn()
    }));
    jest.doMock('../utils/auditLogger', () => ({ logAuditEvent: jest.fn().mockResolvedValue() }));
    jest.doMock('../services/learnerDashboardService', () => ({ buildLearnerDashboard: jest.fn() }));
    jest.doMock('../utils/courseLifecycle', () => ({ getEffectiveCourseStatus: jest.fn() }));
    jest.doMock('../utils/lessonLocator', () => ({ findLessonContext: jest.fn() }));
    jest.doMock('../services/lessonAiContextService', () => ({
      buildLessonAiContext: jest.fn(),
      buildLessonAiPrompt: jest.fn()
    }));
    jest.doMock('../services/ai/chatOrchestrator', () => ({ generatePromptReply: jest.fn() }));
    jest.doMock('../services/ai/courseSummaryService', () => ({
      applyGeneratedCourseSummary: jest.fn((course, result) => {
        course.aiSummary = result.summary;
        course.aiSummaryGeneratedAt = result.generatedAt;
        course.aiSummaryModel = result.model;
        return course;
      }),
      clearGeneratedCourseSummary: jest.fn((course) => {
        course.aiSummary = '';
        course.aiSummaryGeneratedAt = null;
        course.aiSummaryModel = '';
        return course;
      }),
      generateCourseSummary
    }));
    jest.doMock('../config/ai', () => ({ normalizeAiModel: jest.fn((model) => model) }));
    jest.doMock('../services/youtube/youtubeCourseImportService', () => ({ buildCourseSectionsFromPreview: jest.fn((sections) => sections) }));
    jest.doMock('../utils/courseContentAdapter', () => ({
      getCanonicalSections: jest.fn((course) => course.sections || []),
      syncCourseContent: jest.fn()
    }));

    const courses = require('../controllers/courses');
    const req = {
      body: {
        course: {
          title: 'AI Basics',
          description: 'Course description',
          topic: 'AI',
          importSource: 'youtube',
          sections: []
        }
      },
      files: [],
      user: { _id: 'user-1' },
      flash: jest.fn()
    };
    const res = createResponse();

    await courses.createCourse(req, res);

    expect(generateCourseSummary).toHaveBeenCalledTimes(1);
    expect(saveCount).toBe(2);
    expect(res.redirectedTo).toBe('/courses/course-2');
    expect(req.flash).toHaveBeenCalledWith('success', 'Successfully made a new course. AI summary could not be generated yet.');
    expect(Course.mock.instances[0].aiSummary).toBe('');
  });

  test('previewCourse reads the saved summary and does not generate a new one', async () => {
    const readStoredCourseSummary = jest.fn().mockReturnValue({
      summary: 'Saved summary from MongoDB',
      generatedAt: new Date('2026-04-27T12:00:00.000Z'),
      model: 'gpt-5.5'
    });
    const generateCourseSummary = jest.fn();
    const courseDoc = {
      _id: 'course-3',
      title: 'Saved course',
      description: 'Stored description',
      topic: 'AI',
      sections: [],
      reviews: []
    };

    const Course = {
      findById: jest.fn(() => ({
        populate: jest.fn().mockResolvedValue(courseDoc)
      }))
    };
    const User = {
      findById: jest.fn(() => ({
        select: jest.fn().mockResolvedValue({
          findEnrollment: jest.fn().mockReturnValue(null)
        })
      }))
    };

    jest.doMock('../models/course', () => Course);
    jest.doMock('../models/user', () => User);
    jest.doMock('../utils/courseContentAdapter', () => ({ syncCourseContent: jest.fn() }));
    jest.doMock('../utils/courseStats', () => ({ buildStoredCourseStats: jest.fn(() => ({ totalLessonCount: 0, totalSectionCount: 0, totalVideoCount: 0, formattedDuration: '' })) }));
    jest.doMock('../utils/courseReviews', () => ({ summarizeCourseReviews: jest.fn(() => ({ reviewCount: 0, averageRating: null })) }));
    jest.doMock('../utils/courseLifecycle', () => ({ isCourseCatalogVisible: jest.fn(() => true) }));
    jest.doMock('../middleware', () => ({
      isAdminUser: jest.fn(() => false),
      userCanManageCourse: jest.fn(() => true)
    }));
    jest.doMock('../services/ai/courseSummaryService', () => ({
      isCourseSummaryStale: jest.fn(() => false),
      readStoredCourseSummary,
      generateCourseSummary
    }));

    const explore = require('../controllers/explore');
    const req = {
      params: { id: 'course-3' },
      user: { _id: 'user-1' },
      flash: jest.fn()
    };
    const res = createResponse();

    await explore.previewCourse(req, res);

    expect(readStoredCourseSummary).toHaveBeenCalledWith(courseDoc);
    expect(generateCourseSummary).not.toHaveBeenCalled();
    expect(res.renderedView).toBe('courses/preview-modern');
    expect(res.renderedData.aiSummaryState.summary).toBe('Saved summary from MongoDB');
  });
});
