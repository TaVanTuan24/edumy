const express = require('express');
const router = express.Router();
const Course = require('../../models/course');
const ContentLibrary = require('../../models/contentLibrary');

const VALID_LESSON_TYPES = new Set(['video', 'slide', 'quiz']);

function normalizeLegacyType(rawType, fallbackItem = {}) {
    const type = String(rawType || '').trim().toLowerCase();
    if (type === 'lecture') return 'video';
    if (VALID_LESSON_TYPES.has(type)) return type;

    if (Array.isArray(fallbackItem.questions) && fallbackItem.questions.length > 0) return 'quiz';
    if (Array.isArray(fallbackItem.slides) && fallbackItem.slides.length > 0) return 'slide';
    if (typeof fallbackItem.content === 'string' && fallbackItem.content.trim().length > 0) return 'slide';

    return 'video';
}

function normalizeDriveStructure(input) {
    if (!Array.isArray(input)) return [];

    return input.map((section, sectionIndex) => {
        const normalizedSection = {
            _id: section?._id,
            section: String(section?.section || '').trim(),
            videos: []
        };

        const videos = Array.isArray(section?.videos) ? section.videos : [];
        normalizedSection.videos = videos.map((item, itemIndex) => ({
            _id: item?._id,
            type: normalizeLegacyType(item?.type, item),
            name: String(item?.name || '').trim(),
            preview: String(item?.preview || '').trim(),
            refId: String(item?.refId || '').trim(),
            content: typeof item?.content === 'string' ? item.content : '',
            slides: Array.isArray(item?.slides) ? item.slides : [],
            questions: Array.isArray(item?.questions) ? item.questions : [],
            order: Number.isFinite(item?.order) ? item.order : itemIndex
        }));

        // Keep incoming section order when present, otherwise preserve list order.
        normalizedSection.order = Number.isFinite(section?.order) ? section.order : sectionIndex;
        return normalizedSection;
    });
}

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized. Please login.' });
    }
    next();
};

router.use(isAuthenticated);

// Legacy course editor uses driveStructure and saves the whole array.
router.post('/course/reorder', async (req, res) => {
    try {
        const { courseId, driveStructure } = req.body;
        if (!courseId) {
            return res.status(400).json({ success: false, error: 'Missing courseId' });
        }

        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }

        course.driveStructure = normalizeDriveStructure(driveStructure);
        await course.save();

        res.json({ success: true, driveStructure: course.driveStructure });
    } catch (err) {
        console.error('Legacy course reorder save error:', err);
        res.status(500).json({ success: false, error: 'Failed to save course structure' });
    }
});

// ==================== SECTION ROUTES ====================

// Reorder sections
router.post('/section/reorder', async (req, res) => {
    try {
        const { courseId, sectionOrder } = req.body;
        
        const course = await Course.findById(courseId);
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
        await course.save();

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
        
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const newSection = {
            title: title || 'New Section',
            lessons: [],
            order: course.sections.length
        };

        course.sections.push(newSection);
        await course.save();

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
        
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const section = course.sections.id(sectionId);
        if (!section) {
            return res.status(404).json({ error: 'Section not found' });
        }

        section.title = title;
        await course.save();

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
        
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        course.sections.pull({ _id: sectionId });
        await course.save();

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
        const { courseId, sectionId, title, type } = req.body;
        const normalizedType = String(type || '').trim().toLowerCase();

        if (!VALID_LESSON_TYPES.has(normalizedType)) {
            return res.status(400).json({ error: 'Invalid lesson type. Use video, slide, or quiz.' });
        }
        
        const course = await Course.findById(courseId);
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
            videoUrl: '',
            slides: [],
            quiz: [],
            order: section.lessons.length
        };

        section.lessons.push(newLesson);
        await course.save();

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
        
        const course = await Course.findById(courseId);
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
        if (videoUrl !== undefined) lesson.videoUrl = videoUrl;
        if (slides !== undefined) lesson.slides = slides;
        if (quiz !== undefined) lesson.quiz = quiz;

        await course.save();

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
        
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const section = course.sections.id(sectionId);
        if (!section) {
            return res.status(404).json({ error: 'Section not found' });
        }

        section.lessons.pull({ _id: lessonId });
        await course.save();

        res.json({ success: true });
    } catch (err) {
        console.error('Delete lesson error:', err);
        res.status(500).json({ error: 'Failed to delete lesson' });
    }
});

// Reorder lessons within/between sections
router.post('/lesson/reorder', async (req, res) => {
    try {
        const { courseId, sourceSectionId, destSectionId, sourceIndex, destIndex } = req.body;
        
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const sourceSection = course.sections.id(sourceSectionId);
        const destSection = course.sections.id(destSectionId);

        if (!sourceSection || !destSection) {
            return res.status(404).json({ error: 'Section not found' });
        }

        // Get the lesson being moved
        const [movedLesson] = sourceSection.lessons.splice(sourceIndex, 1);
        
        // Insert at destination
        destSection.lessons.splice(destIndex, 0, movedLesson);

        // Update order values
        sourceSection.lessons.forEach((lesson, index) => {
            lesson.order = index;
        });
        destSection.lessons.forEach((lesson, index) => {
            lesson.order = index;
        });

        await course.save();

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

        const course = await Course.findById(courseId);
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
            slides: libraryItem.data.slides || [],
            quiz: libraryItem.data.quiz || [],
            order: section.lessons.length
        };

        section.lessons.push(newLesson);
        
        // Increment usage count
        libraryItem.usageCount += 1;
        await libraryItem.save();
        await course.save();

        const addedLesson = section.lessons[section.lessons.length - 1];
        res.json({ success: true, lesson: addedLesson });
    } catch (err) {
        console.error('Create from library error:', err);
        res.status(500).json({ error: 'Failed to create lesson from library' });
    }
});

// Save lesson to library
router.post('/lesson/to-library', async (req, res) => {
    try {
        const { courseId, sectionId, lessonId, title, type } = req.body;

        const course = await Course.findById(courseId);
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
            data.slides = lesson.slides;
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
            preview: lesson.type === 'slide' ? `${lesson.slides.length} slides` : 
                     lesson.type === 'quiz' ? `${lesson.quiz.length} questions` : 'Video lesson'
        });

        res.json({ success: true, item });
    } catch (err) {
        console.error('Save to library error:', err);
        res.status(500).json({ error: 'Failed to save to library' });
    }
});

module.exports = router;
