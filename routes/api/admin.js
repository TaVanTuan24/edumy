const express = require('express');
const router = express.Router();
const { isLoggedIn, isAdmin } = require('../../middleware');
const Course = require('../../models/course');
const ContentLibrary = require('../../models/contentLibrary');
const {
    syncCourseContent
} = require('../../utils/courseContentAdapter');
const { prepareLessonForWrite, syncCourseAggregateFields } = require('../../utils/courseStats');

const VALID_LESSON_TYPES = new Set(['video', 'slide', 'quiz']);

router.use(isLoggedIn, isAdmin);

async function loadCourseForEditing(courseId) {
    const course = await Course.findById(courseId);
    if (!course) return null;
    syncCourseContent(course);
    return course;
}

async function saveCourseContent(course) {
    console.log('[CourseEditor][API] canonical sections before save:', JSON.stringify(
        (course.sections || []).map((section) => ({
            id: String(section && section._id || ''),
            title: String(section && section.title || ''),
            lessons: Array.isArray(section && section.lessons)
                ? section.lessons.map((lesson) => ({
                    id: String(lesson && lesson._id || ''),
                    title: String(lesson && lesson.title || ''),
                    type: String(lesson && lesson.type || '')
                }))
                : []
        }))
    ));
    syncCourseContent(course);
    syncCourseAggregateFields(course);
    await course.save();
    console.log('[CourseEditor][API] canonical sections after save:', JSON.stringify(
        (course.sections || []).map((section) => ({
            id: String(section && section._id || ''),
            title: String(section && section.title || ''),
            lessons: Array.isArray(section && section.lessons)
                ? section.lessons.map((lesson) => ({
                    id: String(lesson && lesson._id || ''),
                    title: String(lesson && lesson.title || ''),
                    type: String(lesson && lesson.type || '')
                }))
                : []
        }))
    ));
    return course;
}

function reindexSections(course) {
    course.sections = (Array.isArray(course.sections) ? course.sections : []).map((section, index) => {
        section.order = index;
        section.lessons = (Array.isArray(section.lessons) ? section.lessons : []).map((lesson, lessonIndex) => {
            lesson.order = lessonIndex;
            return lesson;
        });
        return section;
    });
}

// ==================== SECTION ROUTES ====================

// Reorder sections
router.post('/section/reorder', async (req, res) => {
    try {
        const { courseId, sectionOrder } = req.body;
        
        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        // Reorder sections based on the new order
        const reorderedSections = sectionOrder.map((sectionId, index) => {
            const section = course.sections.id(sectionId);
            if (section) {
                section.order = index;
                return section;
            }
            return null;
        }).filter(s => s !== null);

        course.sections = reorderedSections;
        reindexSections(course);
        await saveCourseContent(course);

        res.json({ success: true, sections: course.sections });
    } catch (err) {
        console.error('Reorder sections error:', err);
        res.status(500).json({ error: 'Failed to reorder sections' });
    }
});

// Add new section
router.post('/section', async (req, res) => {
    try {
        const { courseId, title } = req.body;
        
        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const newSection = {
            title: title || 'New Section',
            lessons: [],
            order: course.sections.length
        };

        course.sections.push(newSection);
        reindexSections(course);
        await saveCourseContent(course);

        const addedSection = course.sections[course.sections.length - 1];
        res.json({ success: true, section: addedSection });
    } catch (err) {
        console.error('Add section error:', err);
        res.status(500).json({ error: 'Failed to add section' });
    }
});

// Update section
router.put('/section/:courseId/:sectionId', async (req, res) => {
    try {
        const { courseId, sectionId } = req.params;
        const { title } = req.body;
        
        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const section = course.sections.id(sectionId);
        if (!section) {
            return res.status(404).json({ error: 'Section not found' });
        }

        section.title = title;
        await saveCourseContent(course);

        res.json({ success: true, section });
    } catch (err) {
        console.error('Update section error:', err);
        res.status(500).json({ error: 'Failed to update section' });
    }
});

// Delete section
router.delete('/section/:courseId/:sectionId', async (req, res) => {
    try {
        const { courseId, sectionId } = req.params;
        
        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        course.sections.pull({ _id: sectionId });
        reindexSections(course);
        await saveCourseContent(course);

        res.json({ success: true });
    } catch (err) {
        console.error('Delete section error:', err);
        res.status(500).json({ error: 'Failed to delete section' });
    }
});

// ==================== LESSON ROUTES ====================

// Add lesson to section
router.post('/lesson', async (req, res) => {
    try {
        const { courseId, sectionId, title, type, videoUrl, preview, description } = req.body;
        console.log('[CourseEditor][API] incoming add lesson payload:', JSON.stringify({ courseId, sectionId, title, type, videoUrl, preview, description }));
        const normalizedType = String(type || '').trim().toLowerCase();

        if (!VALID_LESSON_TYPES.has(normalizedType)) {
            return res.status(400).json({ error: 'Invalid lesson type. Use video, slide, or quiz.' });
        }
        
        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const section = course.sections.id(sectionId);
        if (!section) {
            return res.status(404).json({ error: 'Section not found' });
        }

        const newLesson = {
            title: title || 'New Lesson',
            type: normalizedType,
            videoUrl: String(videoUrl || preview || '').trim(),
            preview: String(preview || videoUrl || '').trim(),
            refId: '',
            description: String(description || '').trim(),
            content: normalizedType === 'slide' ? { slides: [] } : normalizedType === 'quiz' ? { questions: [] } : {},
            quiz: [],
            order: section.lessons.length
        };

        if (normalizedType === 'video' && newLesson.videoUrl) {
            newLesson.content.videoUrl = newLesson.videoUrl;
        }

        await prepareLessonForWrite(newLesson, { debug: true, allowDriveLookup: true });

        section.lessons.push(newLesson);
        reindexSections(course);
        await saveCourseContent(course);

        console.log('Saved item:', newLesson);

        const addedLesson = section.lessons[section.lessons.length - 1];
        res.json({ success: true, lesson: addedLesson, sectionId });
    } catch (err) {
        console.error('Add lesson error:', err);
        res.status(500).json({ error: 'Failed to add lesson' });
    }
});

// Update lesson
router.put('/lesson/:courseId/:sectionId/:lessonId', async (req, res) => {
    try {
        const { courseId, sectionId, lessonId } = req.params;
        const { title, type, videoUrl, slides, quiz } = req.body;
        
        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const section = course.sections.id(sectionId);
        if (!section) {
            return res.status(404).json({ error: 'Section not found' });
        }

        const lesson = section.lessons.id(lessonId);
        if (!lesson) {
            return res.status(404).json({ error: 'Lesson not found' });
        }

        // Update fields
        if (title !== undefined) lesson.title = title;
        if (type !== undefined) lesson.type = type;
        if (videoUrl !== undefined) {
            lesson.videoUrl = videoUrl;
            lesson.preview = videoUrl;
        }
        if (slides !== undefined) {
            lesson.content = lesson.content || {};
            lesson.content.slides = Array.isArray(slides) ? slides : [];
        }
        if (quiz !== undefined) {
            lesson.quiz = Array.isArray(quiz) ? quiz : [];
            lesson.content = lesson.content || {};
            lesson.content.questions = lesson.quiz;
        }

        await prepareLessonForWrite(lesson, { debug: true, allowDriveLookup: true });

        await saveCourseContent(course);

        res.json({ success: true, lesson });
    } catch (err) {
        console.error('Update lesson error:', err);
        res.status(500).json({ error: 'Failed to update lesson' });
    }
});

// Delete lesson
router.delete('/lesson/:courseId/:sectionId/:lessonId', async (req, res) => {
    try {
        const { courseId, sectionId, lessonId } = req.params;
        
        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const section = course.sections.id(sectionId);
        if (!section) {
            return res.status(404).json({ error: 'Section not found' });
        }

        section.lessons.pull({ _id: lessonId });
        reindexSections(course);
        await saveCourseContent(course);

        res.json({ success: true });
    } catch (err) {
        console.error('Delete lesson error:', err);
        res.status(500).json({ error: 'Failed to delete lesson' });
    }
});

// Reorder lessons within/between sections
router.post('/lesson/reorder', async (req, res) => {
    try {
        const {
            courseId,
            sourceSectionId,
            destSectionId,
            sourceSectionIndex,
            destSectionIndex,
            sourceIndex,
            destIndex
        } = req.body;
        console.log('[CourseEditor][API] incoming reorder payload:', JSON.stringify({
            courseId,
            sourceSectionId,
            destSectionId,
            sourceSectionIndex,
            destSectionIndex,
            sourceIndex,
            destIndex
        }));
        
        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        console.log('[CourseEditor][API] canonical sections before reorder:', JSON.stringify(
            (course.sections || []).map((section) => ({
                id: String(section && section._id || ''),
                title: String(section && section.title || ''),
                lessonIds: Array.isArray(section && section.lessons) ? section.lessons.map((lesson) => String(lesson && lesson._id || '')) : []
            }))
        ));

        const parsedSourceSectionIndex = parseInt(sourceSectionIndex, 10);
        const parsedDestSectionIndex = parseInt(destSectionIndex, 10);
        const parsedSourceIndex = parseInt(sourceIndex, 10);
        const parsedDestIndex = parseInt(destIndex, 10);

        const sourceSection = sourceSectionId
            ? course.sections.id(sourceSectionId)
            : (!Number.isNaN(parsedSourceSectionIndex) ? course.sections?.[parsedSourceSectionIndex] : null);
        const destSection = destSectionId
            ? course.sections.id(destSectionId)
            : (!Number.isNaN(parsedDestSectionIndex) ? course.sections?.[parsedDestSectionIndex] : null);

        if (!sourceSection || !destSection) {
            return res.status(404).json({ error: 'Section not found' });
        }

        if (
            Number.isNaN(parsedSourceIndex)
            || Number.isNaN(parsedDestIndex)
            || parsedSourceIndex < 0
            || parsedSourceIndex >= sourceSection.lessons.length
            || parsedDestIndex < 0
            || parsedDestIndex > destSection.lessons.length
        ) {
            return res.status(400).json({ error: 'Invalid reorder indexes' });
        }

        // Get the lesson being moved
        const [movedLesson] = sourceSection.lessons.splice(parsedSourceIndex, 1);
        if (!movedLesson) {
            return res.status(400).json({ error: 'Lesson not found at source index' });
        }
        
        // Insert at destination
        destSection.lessons.splice(parsedDestIndex, 0, movedLesson);

        // Update order values
        sourceSection.lessons.forEach((lesson, index) => {
            lesson.order = index;
        });
        destSection.lessons.forEach((lesson, index) => {
            lesson.order = index;
        });

        reindexSections(course);
        await saveCourseContent(course);

        console.log('[CourseEditor][API] canonical sections after reorder:', JSON.stringify(
            (course.sections || []).map((section) => ({
                id: String(section && section._id || ''),
                title: String(section && section.title || ''),
                lessonIds: Array.isArray(section && section.lessons) ? section.lessons.map((lesson) => String(lesson && lesson._id || '')) : []
            }))
        ));

        res.json({ success: true, sections: course.sections });
    } catch (err) {
        console.error('Reorder lesson error:', err);
        res.status(500).json({ error: 'Failed to reorder lesson' });
    }
});

// ==================== CONTENT LIBRARY ROUTES ====================

// Get library items for current user
router.get('/library', async (req, res) => {
    try {
        const { type } = req.query;
        const query = { userId: req.user._id };
        
        if (type) {
            query.type = type;
        }

        const items = await ContentLibrary.find(query)
            .sort({ updatedAt: -1 })
            .limit(50);

        res.json({ success: true, items });
    } catch (err) {
        console.error('Get library error:', err);
        res.status(500).json({ error: 'Failed to get library items' });
    }
});

// Add item to library
router.post('/library', async (req, res) => {
    try {
        const { type, title, data, tags } = req.body;

        // Create preview string
        let preview = '';
        if (type === 'slide' && data.slides) {
            preview = `${data.slides.length} slides`;
        } else if (type === 'quiz' && data.quiz) {
            preview = `${data.quiz.length} questions`;
        } else if (type === 'video' && data.videoUrl) {
            preview = 'Video lesson';
        }

        const item = await ContentLibrary.create({
            userId: req.user._id,
            type,
            title,
            data,
            preview,
            tags: tags || []
        });

        res.json({ success: true, item });
    } catch (err) {
        console.error('Add to library error:', err);
        res.status(500).json({ error: 'Failed to add to library' });
    }
});

// Delete library item
router.delete('/library/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const item = await ContentLibrary.findOneAndDelete({
            _id: id,
            userId: req.user._id
        });

        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Delete library item error:', err);
        res.status(500).json({ error: 'Failed to delete library item' });
    }
});

// Create lesson from library item
router.post('/lesson/from-library', async (req, res) => {
    try {
        const { courseId, sectionId, libraryItemId } = req.body;

        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const section = course.sections.id(sectionId);
        if (!section) {
            return res.status(404).json({ error: 'Section not found' });
        }

        const libraryItem = await ContentLibrary.findById(libraryItemId);
        if (!libraryItem) {
            return res.status(404).json({ error: 'Library item not found' });
        }

        // Create lesson from library data
        const newLesson = {
            title: libraryItem.title,
            type: libraryItem.type === 'lesson' ? 'video' : libraryItem.type,
            videoUrl: libraryItem.data.videoUrl || '',
            preview: libraryItem.data.videoUrl || '',
            refId: String(libraryItem._id),
            content: {
                slides: libraryItem.data.slides || [],
                questions: libraryItem.data.quiz || []
            },
            quiz: libraryItem.data.quiz || [],
            order: section.lessons.length
        };

        await prepareLessonForWrite(newLesson, { debug: true, allowDriveLookup: true });

        section.lessons.push(newLesson);
        
        // Increment usage count
        libraryItem.usageCount += 1;
        await libraryItem.save();
        reindexSections(course);
        await saveCourseContent(course);

        const addedLesson = section.lessons[section.lessons.length - 1];
        res.json({ success: true, lesson: addedLesson });
    } catch (err) {
        console.error('Create from library error:', err);
        res.status(500).json({ error: 'Failed to create lesson from library' });
    }
});

router.post('/course/add-item', async (req, res) => {
    try {
        const { courseId, sectionId, type, refId } = req.body;

        if (!courseId || !sectionId || !type || !refId) {
            return res.status(400).json({ success: false, error: 'Missing data' });
        }

        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }

        const section = course.sections.id(sectionId)
            || (Array.isArray(course.sections)
                ? course.sections.find((entry) => String(entry._id) === String(sectionId))
                : null);
        if (!section) {
            return res.status(404).json({ success: false, error: 'Section not found' });
        }

        const libraryItem = await ContentLibrary.findById(refId);
        if (!libraryItem) {
            return res.status(404).json({ success: false, error: 'Library item not found' });
        }

        const normalizedType = type === 'lesson' ? 'video' : type;
        const newLesson = {
            title: libraryItem.title || ('New ' + normalizedType),
            type: normalizedType,
            videoUrl: normalizedType === 'video' ? (libraryItem.data?.videoUrl || '') : '',
            preview: normalizedType === 'video' ? (libraryItem.data?.videoUrl || '') : '',
            refId: String(libraryItem._id),
            content: {},
            quiz: [],
            order: section.lessons.length
        };

        if (normalizedType === 'slide') {
            newLesson.content = { slides: libraryItem.data?.slides || [] };
        } else if (normalizedType === 'quiz') {
            const quiz = libraryItem.data?.quiz || [];
            newLesson.content = { questions: quiz };
            newLesson.quiz = quiz;
        }

        await prepareLessonForWrite(newLesson, { debug: true, allowDriveLookup: true });

        section.lessons.push(newLesson);

        libraryItem.usageCount += 1;
        await libraryItem.save();
        reindexSections(course);
        await saveCourseContent(course);

        const newItem = section.lessons[section.lessons.length - 1] || null;

        res.json({ success: true, item: newItem });
    } catch (err) {
        console.error('Add library item error:', err);
        res.status(500).json({ success: false, error: 'Failed to add item' });
    }
});

// Save lesson to library
router.post('/lesson/to-library', async (req, res) => {
    try {
        const { courseId, sectionId, lessonId, title } = req.body;

        const course = await loadCourseForEditing(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const section = course.sections.id(sectionId);
        if (!section) {
            return res.status(404).json({ error: 'Section not found' });
        }

        const lesson = section.lessons.id(lessonId);
        if (!lesson) {
            return res.status(404).json({ error: 'Lesson not found' });
        }

        // Prepare data based on lesson type
        let data = {};
        if (lesson.type === 'slide') {
            data.slides = Array.isArray(lesson.content && lesson.content.slides) ? lesson.content.slides : [];
        } else if (lesson.type === 'quiz') {
            data.quiz = lesson.quiz;
        } else if (lesson.type === 'video') {
            data.videoUrl = lesson.videoUrl;
        }

        // Create library item
        const item = await ContentLibrary.create({
            userId: req.user._id,
            type: lesson.type,
            title: title || lesson.title,
            data,
            preview: lesson.type === 'slide' ? `${(data.slides || []).length} slides` : 
                     lesson.type === 'quiz' ? `${lesson.quiz.length} questions` : 'Video lesson'
        });

        res.json({ success: true, item });
    } catch (err) {
        console.error('Save to library error:', err);
        res.status(500).json({ error: 'Failed to save to library' });
    }
});

module.exports = router;
