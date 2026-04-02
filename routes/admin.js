const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Course = require('../models/course');
const User = require('../models/user');
const UserCourseProgress = require('../models/userCourseProgress');

function normalizeItemType(rawType, fallbackType) {
    if (typeof rawType === 'string') {
        const value = rawType.trim().toLowerCase();
        if (value === 'lecture') return 'video';
        if (['video', 'slide', 'quiz'].includes(value)) return value;
    }
    return fallbackType;
}

function normalizeSlidesPayload(slides) {
    const source = Array.isArray(slides) ? slides : []

    return source.map((slide, index) => {
        const hasElements = Array.isArray(slide?.elements) && slide.elements.length > 0
        const fallbackText = String(slide?.text || slide?.content || '').trim()

        const rawElements = hasElements
            ? slide.elements
            : (fallbackText
                ? [{
                    id: `el-${index + 1}-1`,
                    type: 'text',
                    x: 80,
                    y: 80,
                    text: fallbackText,
                    fontSize: 28,
                    color: '#1c1d1f',
                    align: 'left',
                    bold: false
                }]
                : [])

        const normalizedElements = rawElements.map((element, elementIndex) => {
            const normalizedType = element?.type === 'image' ? 'image' : 'text'

            const normalized = {
                id: String(element?.id || `el-${index + 1}-${elementIndex + 1}`),
                type: normalizedType,
                x: Number.isFinite(Number(element?.x)) ? Number(element.x) : 0,
                y: Number.isFinite(Number(element?.y)) ? Number(element.y) : 0
            }

            if (normalizedType === 'text') {
                normalized.text = String(element?.text || '').trim()
                normalized.fontSize = Number.isFinite(Number(element?.fontSize)) ? Number(element.fontSize) : 28
                normalized.color = String(element?.color || '#1c1d1f')

                const align = String(element?.align || 'left').toLowerCase()
                normalized.align = ['left', 'center', 'right'].includes(align) ? align : 'left'
                normalized.bold = Boolean(element?.bold)
            } else {
                normalized.src = String(element?.src || '').trim()
            }

            return normalized
        })

        return {
            id: String(slide?.id || `slide-${index + 1}`),
            elements: normalizedElements
        }
    })
}

function parseTimestampToSeconds(rawValue) {
    const value = String(rawValue || '').trim()
    if (!value) return 0

    if (/^\d+$/.test(value)) {
        return Math.max(0, parseInt(value, 10))
    }

    const parts = value.split(':').map((part) => part.trim())
    if (parts.length === 2) {
        const minutes = parseInt(parts[0], 10)
        const seconds = parseInt(parts[1], 10)
        if (!Number.isNaN(minutes) && !Number.isNaN(seconds)) {
            return Math.max(0, (minutes * 60) + seconds)
        }
    }

    return 0
}

function normalizeInteractiveQuizPayload(quizzes) {
    const source = Array.isArray(quizzes) ? quizzes : []

    return source
        .map((entry, index) => {
            const options = (Array.isArray(entry && entry.options) ? entry.options : [])
                .map((opt) => String(opt || '').trim())
                .filter(Boolean)
                .slice(0, 4)

            while (options.length < 4) {
                options.push('')
            }

            const rawTime = entry && (entry.triggerTimeSec ?? entry.timestamp ?? entry.time)
            const triggerTimeSec = parseTimestampToSeconds(rawTime)
            const parsedCorrect = Number(entry && entry.correctOptionIndex)

            const normalized = {
                triggerTimeSec,
                question: String(entry && entry.question || '').trim(),
                options,
                correctOptionIndex: Number.isFinite(parsedCorrect) && parsedCorrect >= 0 && parsedCorrect <= 3 ? parsedCorrect : 0,
                explanation: String(entry && entry.explanation || '').trim(),
                pauseOnShow: entry && entry.pauseOnShow === false ? false : true,
                order: Number.isFinite(Number(entry && entry.order)) ? Number(entry.order) : index
            }

            if (entry && entry._id && mongoose.isValidObjectId(entry._id)) {
                normalized._id = entry._id
            }

            return normalized
        })
        .filter((entry) => entry.question)
        .sort((a, b) => {
            const byTime = a.triggerTimeSec - b.triggerTimeSec
            if (byTime !== 0) return byTime
            return a.order - b.order
        })
        .map((entry, index) => ({ ...entry, order: index }))
}

function countTotalLessons(course) {
    if (!course || !Array.isArray(course.driveStructure)) return 0;
    return course.driveStructure.reduce((total, section) => {
        const items = Array.isArray(section && section.videos) ? section.videos : [];
        return total + items.length;
    }, 0);
}

function buildLessonTitleMap(course) {
    const map = new Map();
    if (!course || !Array.isArray(course.driveStructure)) return map;

    course.driveStructure.forEach((section) => {
        const items = Array.isArray(section && section.videos) ? section.videos : [];
        items.forEach((item) => {
            if (!item || !item._id) return;
            map.set(String(item._id), item.name || item.title || 'Lesson');
        });
    });

    return map;
}

function averageQuizPercent(quizResults) {
    const results = Array.isArray(quizResults) ? quizResults : [];
    let totalScore = 0;
    let totalPossible = 0;

    results.forEach((entry) => {
        const score = Number(entry && entry.score) || 0;
        const total = Number(entry && entry.total) || 0;
        if (total > 0) {
            totalScore += score;
            totalPossible += total;
        }
    });

    if (!totalPossible) return 0;
    return Math.round((totalScore / totalPossible) * 100);
}

router.get('/', async (req, res) => {

    const courses = await Course.find({});

    res.render('admin/courseManager', { courses });

});

router.get('/ai/quiz', async (req, res) => {
    res.render('admin/aiQuiz');
});

router.get('/ai/slide', async (req, res) => {
    res.render('admin/aiSlide', { courseId: req.query.courseId || '' });
});
router.get('/courses/:id/editor', async (req, res) => {

    const course = await Course.findById(req.params.id)

    // Normalize driveStructure - ensure all items have type field
    if (course.driveStructure) {
        course.driveStructure.forEach(section => {
            if (section.videos && Array.isArray(section.videos)) {
                section.videos.forEach(item => {
                    if (!item.type) {
                        item.type = "video"; // Default to video for backward compatibility
                    } else if (item.type === 'lecture') {
                        item.type = 'video';
                    }
                });
            }
        });
    }

    res.render('admin/courseEditor', { course })

})

router.get('/courses/:id/video-settings', async (req, res) => {
    const course = await Course.findById(req.params.id)
    if (!course) {
        return res.status(404).send('Course not found')
    }

    const sectionIndex = parseInt(req.query.section, 10)
    const lessonIndex = parseInt(req.query.lesson, 10)

    if (Number.isNaN(sectionIndex) || Number.isNaN(lessonIndex)) {
        return res.status(400).send('Missing section or lesson index')
    }

    const lesson = course.driveStructure?.[sectionIndex]?.videos?.[lessonIndex]
    if (!lesson) {
        return res.status(404).send('Lesson not found')
    }

    const normalizedType = normalizeItemType(lesson.type, 'video')
    if (normalizedType !== 'video') {
        return res.status(400).send('Advanced video settings are only available for video lessons')
    }

    const interactiveQuizzesRaw = Array.isArray(lesson?.content?.interactiveQuizzes)
        ? lesson.content.interactiveQuizzes
        : Array.isArray(lesson?.interactiveQuizzes)
            ? lesson.interactiveQuizzes
            : []

    const interactiveQuizzes = normalizeInteractiveQuizPayload(interactiveQuizzesRaw)
    const videoUrl = String(lesson.preview || (lesson.content && lesson.content.videoUrl) || lesson.refId || '')

    res.render('admin/videoSettings', {
        course,
        lesson,
        sectionIndex,
        lessonIndex,
        videoUrl,
        interactiveQuizzes
    })
})

router.get('/courses/:id/analytics', async (req, res) => {
    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.status(404).send('Course not found');
    }

    const courseId = course._id;
    const users = await User.find({
        $or: [
            { enrolledCourseIds: courseId },
            { enrolledCourses: courseId },
            { enrolledCourses: { $elemMatch: { courseId: courseId } } }
        ]
    });

    const progressDocs = await UserCourseProgress.find({ course: courseId }).lean();
    const progressByUser = new Map(progressDocs.map((doc) => [String(doc.user), doc]));

    const totalLessons = countTotalLessons(course);
    const completionRates = users.map((user) => {
        const progress = progressByUser.get(String(user._id));
        const completed = progress && Array.isArray(progress.completedLessons)
            ? progress.completedLessons.length
            : 0;
        return totalLessons ? Math.round((completed / totalLessons) * 100) : 0;
    });

    const totalStudents = users.length;
    const avgCompletion = completionRates.length
        ? Math.round(completionRates.reduce((a, b) => a + b, 0) / completionRates.length)
        : 0;

    let totalQuizScore = 0;
    let totalQuizPossible = 0;
    const quizBuckets = new Map();

    progressDocs.forEach((doc) => {
        (doc.quizResults || []).forEach((entry) => {
            const score = Number(entry && entry.score) || 0;
            const total = Number(entry && entry.total) || 0;
            const quizId = String(entry && entry.quizId || '');

            if (total > 0) {
                totalQuizScore += score;
                totalQuizPossible += total;
            }

            if (!quizId || total <= 0) return;
            const current = quizBuckets.get(quizId) || { totalScore: 0, totalPossible: 0 };
            current.totalScore += score;
            current.totalPossible += total;
            quizBuckets.set(quizId, current);
        });
    });

    const avgQuizScore = totalQuizPossible
        ? Math.round((totalQuizScore / totalQuizPossible) * 100)
        : 0;

    const quizLabels = Array.from(quizBuckets.keys());
    const quizAverages = quizLabels.map((key) => {
        const bucket = quizBuckets.get(key);
        if (!bucket || !bucket.totalPossible) return 0;
        return Math.round((bucket.totalScore / bucket.totalPossible) * 100);
    });

    const now = Date.now();
    const activeWindowMs = 7 * 24 * 60 * 60 * 1000;
    const activeUsers = progressDocs.filter((doc) => {
        const last = doc.lastAccessed ? new Date(doc.lastAccessed).getTime() : 0;
        return last && now - last <= activeWindowMs;
    }).length;

    const progressBuckets = [0, 0, 0, 0];
    completionRates.forEach((rate) => {
        if (rate < 25) progressBuckets[0] += 1;
        else if (rate < 50) progressBuckets[1] += 1;
        else if (rate < 75) progressBuckets[2] += 1;
        else progressBuckets[3] += 1;
    });

    const studentRows = users.map((user) => {
        const progress = progressByUser.get(String(user._id));
        const completed = progress && Array.isArray(progress.completedLessons)
            ? progress.completedLessons.length
            : 0;
        const progressRate = totalLessons ? Math.round((completed / totalLessons) * 100) : 0;
        const avgScore = averageQuizPercent(progress && progress.quizResults);
        const status = progressRate >= 80 ? 'Active' : 'At Risk';

        return {
            id: String(user._id),
            name: user.username || user.email || 'User',
            progressRate,
            avgScore,
            status
        };
    });

    const insights = [];
    if (avgCompletion < 50) insights.push('Many students are dropping early.');
    if (avgQuizScore < 50) insights.push('Quiz difficulty may be too high.');
    if (activeUsers < totalStudents * 0.3) insights.push('Low engagement detected.');

    const lessonTitleMap = buildLessonTitleMap(course);
    const lessonCounts = new Map();
    progressDocs.forEach((doc) => {
        if (!doc.lessonViews) return;
        const entries = doc.lessonViews instanceof Map
            ? Array.from(doc.lessonViews.entries())
            : Object.entries(doc.lessonViews);
        entries.forEach(([lessonId, count]) => {
            const current = Number(lessonCounts.get(lessonId) || 0);
            lessonCounts.set(lessonId, current + Number(count || 0));
        });
    });

    const topLessons = Array.from(lessonCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lessonId, count]) => ({
            lessonId,
            title: lessonTitleMap.get(String(lessonId)) || 'Lesson',
            count
        }));

    res.render('admin/course-analytics', {
        course,
        users,
        analytics: {
            totalStudents,
            avgCompletion,
            avgQuizScore,
            activeUsers,
            progressBuckets,
            quizLabels,
            quizAverages,
            studentRows,
            insights,
            topLessons
        }
    });
});

router.get('/courses/:courseId/user/:userId', async (req, res) => {
    const { courseId, userId } = req.params;

    const course = await Course.findById(courseId);
    if (!course) {
        return res.status(404).send('Course not found');
    }

    const progress = await UserCourseProgress.findOne({ user: userId, course: courseId });
    const totalLessons = countTotalLessons(course);
    const completed = progress ? progress.completedLessons.length : 0;
    const quizResults = progress ? progress.quizResults : [];

    res.render('admin/user-progress', {
        course,
        progress,
        totalLessons,
        completed,
        quizResults
    });
});

router.get('/courses/:id/slide-editor', async (req, res) => {
    const course = await Course.findById(req.params.id)

    if (!course) {
        return res.status(404).send('Course not found')
    }

    const sectionIndex = parseInt(req.query.section, 10)
    const lessonIndex = parseInt(req.query.lesson, 10)

    const lesson = Number.isNaN(sectionIndex) || Number.isNaN(lessonIndex)
        ? null
        : course.driveStructure?.[sectionIndex]?.videos?.[lessonIndex] || null

    const slideData = Array.isArray(lesson?.content?.slides)
        ? lesson.content.slides
        : []

    res.render('admin/slideEditor', {
        course,
        slideData,
        sectionIndex: Number.isNaN(sectionIndex) ? '' : sectionIndex,
        lessonIndex: Number.isNaN(lessonIndex) ? '' : lessonIndex,
        lessonTitle: lesson?.name || ''
    })
})

router.put('/course/:id/slide-editor/save', async (req, res) => {
    try {
        const { sectionIndex, lessonIndex, title, content } = req.body

        const parsedSectionIndex = parseInt(sectionIndex, 10)
        const parsedLessonIndex = parseInt(lessonIndex, 10)

        if (Number.isNaN(parsedSectionIndex) || Number.isNaN(parsedLessonIndex)) {
            return res.status(400).json({ success: false, error: 'Invalid sectionIndex or lessonIndex' })
        }

        const normalizedSlides = normalizeSlidesPayload(content && content.slides)

        if (!normalizedSlides.length) {
            return res.status(400).json({ success: false, error: 'Slide content missing' })
        }

        await Course.updateOne(
            { _id: req.params.id },
            {
                $set: {
                    [`driveStructure.${parsedSectionIndex}.videos.${parsedLessonIndex}.type`]: 'slide',
                    [`driveStructure.${parsedSectionIndex}.videos.${parsedLessonIndex}.name`]: String(title || 'Slide Lesson').trim(),
                    [`driveStructure.${parsedSectionIndex}.videos.${parsedLessonIndex}.content`]: {
                        slides: normalizedSlides
                    },
                    [`driveStructure.${parsedSectionIndex}.videos.${parsedLessonIndex}.aiGenerated`]: false
                }
            }
        )

        return res.json({ success: true })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

// New Udemy-style course editor (3-column layout)
router.get('/courses/:id/editor-new', async (req, res) => {

    const course = await Course.findById(req.params.id)

    // Normalize driveStructure - ensure all items have type field
    if (course.driveStructure) {
        course.driveStructure.forEach(section => {
            if (section.videos && Array.isArray(section.videos)) {
                section.videos.forEach(item => {
                    if (!item.type) {
                        item.type = "video"; // Default to video for backward compatibility
                    } else if (item.type === 'lecture') {
                        item.type = 'video';
                    }
                });
            }
        });
    }

    res.render('admin/courseEditorNew', { course })

})
router.put('/course/:id/lesson/edit', async (req,res)=>{

const {sectionIndex,lessonIndex,name,url,interactiveQuizzes} = req.body

const parsedSectionIndex = parseInt(sectionIndex, 10)
const parsedLessonIndex = parseInt(lessonIndex, 10)
const normalizedInteractiveQuizzes = normalizeInteractiveQuizPayload(interactiveQuizzes)

await Course.updateOne(
{_id:req.params.id},
{
$set:{
[`driveStructure.${parsedSectionIndex}.videos.${parsedLessonIndex}.name`]:name,
[`driveStructure.${parsedSectionIndex}.videos.${parsedLessonIndex}.preview`]:url,
[`driveStructure.${parsedSectionIndex}.videos.${parsedLessonIndex}.interactiveQuizzes`]:normalizedInteractiveQuizzes,
[`driveStructure.${parsedSectionIndex}.videos.${parsedLessonIndex}.content.interactiveQuizzes`]:normalizedInteractiveQuizzes
}
}
)

res.send("updated")

})
router.delete('/course/:id/lesson/delete', async (req, res) => {

    const { sectionIndex, lessonIndex } = req.body

    await Course.updateOne(
        { _id: req.params.id },
        {
            $pull: {
                [`driveStructure.${sectionIndex}.videos`]: {
                    $eq: (await Course.findById(req.params.id))
                        .driveStructure[sectionIndex].videos[lessonIndex]
                }
            }
        }
    )

    res.json({ success: true })

})
router.put('/course/:id/lesson/add', async (req, res) => {
    try {
        const { sectionIndex, name, url, type } = req.body
        const parsedSectionIndex = parseInt(sectionIndex, 10)
        const itemType = normalizeItemType(type, 'video')

        const course = await Course.findById(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const videos = course.driveStructure?.[parsedSectionIndex]?.videos
        if (!Array.isArray(videos)) {
            return res.status(400).json({ success: false, error: 'Invalid section index' })
        }

        const newItem = {
            type: itemType,
            name: name,
            preview: url,
            order: videos.length
        }

        videos.push(newItem)

        await course.save()

        console.log('Saved item:', newItem)

        res.json({ success: true, item: newItem })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }

})
router.put('/course/:id/lesson/reorder', async (req, res) => {
    try {
        const {
            sectionIndex,
            lessons,
            sourceSectionIndex,
            destSectionIndex,
            sourceIndex,
            destIndex
        } = req.body

        const course = await Course.findById(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        // Backward-compatible mode: replace one section list directly.
        if (Array.isArray(lessons) && sectionIndex !== undefined) {
            const parsedSectionIndex = parseInt(sectionIndex, 10)
            if (Number.isNaN(parsedSectionIndex)) {
                return res.status(400).json({ success: false, error: 'Invalid section index' })
            }

            const normalizedLessons = lessons.map((item, idx) => ({
                ...item,
                order: idx
            }))

            course.driveStructure[parsedSectionIndex].videos = normalizedLessons
            await course.save()
            return res.json({ success: true })
        }

        // Preferred mode: move one item between positions/sections.
        const fromSection = parseInt(sourceSectionIndex, 10)
        const toSection = parseInt(destSectionIndex, 10)
        const fromIndex = parseInt(sourceIndex, 10)
        const toIndex = parseInt(destIndex, 10)

        if ([fromSection, toSection, fromIndex, toIndex].some(Number.isNaN)) {
            return res.status(400).json({ success: false, error: 'Invalid reorder payload' })
        }

        const sourceVideos = course.driveStructure?.[fromSection]?.videos
        const destinationVideos = course.driveStructure?.[toSection]?.videos

        if (!Array.isArray(sourceVideos) || !Array.isArray(destinationVideos)) {
            return res.status(400).json({ success: false, error: 'Invalid section references' })
        }

        if (fromIndex < 0 || fromIndex >= sourceVideos.length) {
            return res.status(400).json({ success: false, error: 'Invalid source index' })
        }

        const [movedItem] = sourceVideos.splice(fromIndex, 1)

        if (toIndex < 0 || toIndex > destinationVideos.length) {
            return res.status(400).json({ success: false, error: 'Invalid destination index' })
        }

        destinationVideos.splice(toIndex, 0, movedItem)

        sourceVideos.forEach((item, idx) => {
            item.order = idx
        })

        if (fromSection !== toSection) {
            destinationVideos.forEach((item, idx) => {
                item.order = idx
            })
        }

        await course.save()

        res.json({
            success: true,
            sourceSectionIndex: fromSection,
            destSectionIndex: toSection
        })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }

})
router.put('/course/:id/section/edit', async (req, res) => {

    const { sectionIndex, name } = req.body

    await Course.updateOne(
        { _id: req.params.id },
        {
            $set: {
                [`driveStructure.${sectionIndex}.section`]: name
            }
        }
    )

    res.json({ success: true })

})
router.post("/course/:id/section/add", async (req, res) => {

    const { name } = req.body

    await Course.findByIdAndUpdate(
        req.params.id,
        {
            $push: {
                driveStructure: {
                    section: name,
                    videos: []
                }
            }
        }
    )

    res.json({ success: true })

})
router.post("/course/:id/quiz/add", async (req, res) => {
    try {
        const { sectionIndex, name, type } = req.body
        const parsedSectionIndex = parseInt(sectionIndex, 10)
        const itemType = normalizeItemType(type, 'quiz')

        const course = await Course.findById(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const videos = course.driveStructure?.[parsedSectionIndex]?.videos
        if (!Array.isArray(videos)) {
            return res.status(400).json({ success: false, error: 'Invalid section index' })
        }

        const newItem = {
            type: itemType,
            name: name,
            questions: [],
            order: videos.length
        }

        videos.push(newItem)

        await course.save()

        console.log('Saved item:', newItem)

        res.json({ success: true, item: newItem })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }

})

// Add slide to section
router.post("/course/:id/slide/add", async (req, res) => {
    try {
        const { sectionIndex, name, type } = req.body
        const parsedSectionIndex = parseInt(sectionIndex, 10)
        const itemType = normalizeItemType(type, 'slide')

        const course = await Course.findById(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const videos = course.driveStructure?.[parsedSectionIndex]?.videos
        if (!Array.isArray(videos)) {
            return res.status(400).json({ success: false, error: 'Invalid section index' })
        }

        const newItem = {
            type: itemType,
            name: name,
            content: {
                slides: []
            },
            order: videos.length
        }

        videos.push(newItem)

        await course.save()

        console.log('Saved item:', newItem)

        res.json({ success: true, item: newItem })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }

})

// Get lesson data
router.get('/course/:id/lesson/:sectionIndex/:lessonIndex', async (req, res) => {
    try {
        const { sectionIndex, lessonIndex } = req.params
        const course = await Course.findById(req.params.id).lean()
        
        if (!course) {
            return res.json({ success: false, error: 'Course not found' })
        }
        
        const lesson = course.driveStructure[sectionIndex]?.videos[lessonIndex]
        
        if (!lesson) {
            return res.json({ success: false, error: 'Lesson not found' })
        }

        console.log('RAW LESSON FROM API:', lesson)
        res.json({ success: true, lesson })
    } catch (err) {
        res.json({ success: false, error: err.message })
    }
})

router.get('/course/:id/lesson/:sectionIndex/:lessonIndex/interactive-quizzes', async (req, res) => {
    try {
        const { sectionIndex, lessonIndex } = req.params
        const course = await Course.findById(req.params.id).lean()

        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = course.driveStructure?.[sectionIndex]?.videos?.[lessonIndex]
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        const fromContent = Array.isArray(lesson?.content?.interactiveQuizzes) ? lesson.content.interactiveQuizzes : []
        const fromRoot = Array.isArray(lesson?.interactiveQuizzes) ? lesson.interactiveQuizzes : []
        const interactiveQuizzes = normalizeInteractiveQuizPayload(fromContent.length ? fromContent : fromRoot)

        return res.json({ success: true, interactiveQuizzes })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.put('/course/:id/lesson/:sectionIndex/:lessonIndex/interactive-quizzes', async (req, res) => {
    try {
        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        const interactiveQuizzes = normalizeInteractiveQuizPayload(req.body && req.body.interactiveQuizzes)

        await Course.updateOne(
            { _id: req.params.id },
            {
                $set: {
                    [`driveStructure.${parsedSectionIndex}.videos.${parsedLessonIndex}.interactiveQuizzes`]: interactiveQuizzes,
                    [`driveStructure.${parsedSectionIndex}.videos.${parsedLessonIndex}.content.interactiveQuizzes`]: interactiveQuizzes
                }
            }
        )

        return res.json({ success: true, interactiveQuizzes })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.post('/course/:id/lesson/:sectionIndex/:lessonIndex/interactive-quizzes', async (req, res) => {
    try {
        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        const course = await Course.findById(req.params.id)

        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = course.driveStructure?.[parsedSectionIndex]?.videos?.[parsedLessonIndex]
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        const existing = Array.isArray(lesson.content?.interactiveQuizzes)
            ? lesson.content.interactiveQuizzes
            : Array.isArray(lesson.interactiveQuizzes)
                ? lesson.interactiveQuizzes
                : []

        const appended = normalizeInteractiveQuizPayload([...(existing || []), req.body || {}])
        lesson.interactiveQuizzes = appended
        lesson.content = lesson.content || {}
        lesson.content.interactiveQuizzes = appended

        await course.save()
        return res.json({ success: true, interactiveQuizzes: appended })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.patch('/course/:id/lesson/:sectionIndex/:lessonIndex/interactive-quizzes/reorder', async (req, res) => {
    try {
        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        const orderedIds = Array.isArray(req.body && req.body.orderedIds)
            ? req.body.orderedIds.map((id) => String(id))
            : []

        const course = await Course.findById(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = course.driveStructure?.[parsedSectionIndex]?.videos?.[parsedLessonIndex]
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        const current = Array.isArray(lesson.content?.interactiveQuizzes)
            ? lesson.content.interactiveQuizzes
            : Array.isArray(lesson.interactiveQuizzes)
                ? lesson.interactiveQuizzes
                : []

        const byId = new Map((current || []).map((entry) => [String(entry && entry._id), entry]))
        const reordered = []

        orderedIds.forEach((id) => {
            if (byId.has(id)) reordered.push(byId.get(id))
        })

        current.forEach((entry) => {
            if (!reordered.includes(entry)) reordered.push(entry)
        })

        const normalized = normalizeInteractiveQuizPayload(reordered)
        lesson.interactiveQuizzes = normalized
        lesson.content = lesson.content || {}
        lesson.content.interactiveQuizzes = normalized

        await course.save()
        return res.json({ success: true, interactiveQuizzes: normalized })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.delete('/course/:id/lesson/:sectionIndex/:lessonIndex/interactive-quizzes/:quizId', async (req, res) => {
    try {
        const parsedSectionIndex = parseInt(req.params.sectionIndex, 10)
        const parsedLessonIndex = parseInt(req.params.lessonIndex, 10)
        const quizId = String(req.params.quizId)

        const course = await Course.findById(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const lesson = course.driveStructure?.[parsedSectionIndex]?.videos?.[parsedLessonIndex]
        if (!lesson) {
            return res.status(404).json({ success: false, error: 'Lesson not found' })
        }

        const current = Array.isArray(lesson.content?.interactiveQuizzes)
            ? lesson.content.interactiveQuizzes
            : Array.isArray(lesson.interactiveQuizzes)
                ? lesson.interactiveQuizzes
                : []

        const filtered = current.filter((entry) => String(entry && entry._id) !== quizId)
        const normalized = normalizeInteractiveQuizPayload(filtered)

        lesson.interactiveQuizzes = normalized
        lesson.content = lesson.content || {}
        lesson.content.interactiveQuizzes = normalized

        await course.save()
        return res.json({ success: true, interactiveQuizzes: normalized })
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message })
    }
})

router.get(
    "/course/:courseId/quiz/:sectionIndex/:quizIndex",
    async (req, res) => {

        const { courseId, sectionIndex, quizIndex } = req.params

        const course = await Course.findById(courseId)

        const quiz =
            course.driveStructure[sectionIndex].videos[quizIndex]

        res.render("admin/quizEditor", {
            course,
            quiz,
            sectionIndex,
            quizIndex
        })

    })
router.post(
    "/course/:courseId/quiz/question/add",
    async (req, res) => {
        try {
            const { courseId } = req.params
            const {
                sectionIndex,
                quizIndex,
                question = "",
                options = [],
                correct,
                correctIndex
            } = req.body

            const parsedSectionIndex = parseInt(sectionIndex, 10)
            const parsedQuizIndex = parseInt(quizIndex, 10)

            if (Number.isNaN(parsedSectionIndex) || Number.isNaN(parsedQuizIndex)) {
                return res.status(400).json({ success: false, error: "Invalid sectionIndex or quizIndex" })
            }

            const normalizedQuestion = String(question).trim()
            const normalizedOptions = (Array.isArray(options) ? options : [])
                .map(opt => {
                    if (typeof opt === 'string') return { text: opt.trim(), correct: false }
                    if (opt && typeof opt === 'object') {
                        return {
                            text: String(opt.text || '').trim(),
                            correct: Boolean(opt.correct)
                        }
                    }
                    return { text: '', correct: false }
                })
                .filter(opt => opt.text.length > 0)

            const fallbackCorrectIndex = parseInt(correct, 10)
            const parsedCorrectIndex = parseInt(correctIndex, 10)
            const finalCorrectIndex = Number.isNaN(parsedCorrectIndex) ? fallbackCorrectIndex : parsedCorrectIndex

            if (normalizedOptions.length < 2) {
                return res.status(400).json({ success: false, error: "At least 2 options are required" })
            }

            if (Number.isNaN(finalCorrectIndex) || finalCorrectIndex < 0 || finalCorrectIndex >= normalizedOptions.length) {
                return res.status(400).json({ success: false, error: "A valid correct answer must be selected" })
            }

            const optionObjects = normalizedOptions.map((opt, i) => ({
                text: opt.text,
                correct: i === finalCorrectIndex
            }))

            const quizPath = `driveStructure.${parsedSectionIndex}.videos.${parsedQuizIndex}.questions`

            await Course.updateOne(
                { _id: courseId },
                {
                    $push: {
                        [quizPath]: {
                            question: normalizedQuestion,
                            options: optionObjects
                        }
                    }
                }
            )

            const course = await Course.findById(courseId)
            const questions = course.driveStructure?.[parsedSectionIndex]?.videos?.[parsedQuizIndex]?.questions || []
            const questionIndex = questions.length - 1

            res.json({
                success: true,
                questionIndex,
                question: questions[questionIndex]
            })
        } catch (err) {
            res.status(500).json({ success: false, error: err.message })
        }
    })
router.put(
    "/course/:courseId/quiz/question/update",
    async (req, res) => {
        try {
            const { courseId } = req.params
            const {
                sectionIndex,
                quizIndex,
                questionIndex,
                question = "",
                options = [],
                correctIndex
            } = req.body

            const parsedSectionIndex = parseInt(sectionIndex, 10)
            const parsedQuizIndex = parseInt(quizIndex, 10)
            const parsedQuestionIndex = parseInt(questionIndex, 10)
            const parsedCorrectIndex = parseInt(correctIndex, 10)

            if (
                Number.isNaN(parsedSectionIndex) ||
                Number.isNaN(parsedQuizIndex) ||
                Number.isNaN(parsedQuestionIndex)
            ) {
                return res.status(400).json({ success: false, error: "Invalid indexes" })
            }

            const normalizedQuestion = String(question).trim()
            const normalizedOptions = (Array.isArray(options) ? options : [])
                .map(opt => {
                    if (typeof opt === 'string') return { text: opt.trim(), correct: false }
                    if (opt && typeof opt === 'object') {
                        return {
                            text: String(opt.text || '').trim(),
                            correct: Boolean(opt.correct)
                        }
                    }
                    return { text: '', correct: false }
                })
                .filter(opt => opt.text.length > 0)

            if (!normalizedQuestion) {
                return res.status(400).json({ success: false, error: "Question cannot be empty" })
            }

            if (normalizedOptions.length < 2) {
                return res.status(400).json({ success: false, error: "At least 2 options are required" })
            }

            if (Number.isNaN(parsedCorrectIndex) || parsedCorrectIndex < 0 || parsedCorrectIndex >= normalizedOptions.length) {
                return res.status(400).json({ success: false, error: "A valid correct answer must be selected" })
            }

            const optionObjects = normalizedOptions.map((opt, i) => ({
                text: opt.text,
                correct: i === parsedCorrectIndex
            }))

            await Course.updateOne(
                { _id: courseId },
                {
                    $set: {
                        [`driveStructure.${parsedSectionIndex}.videos.${parsedQuizIndex}.questions.${parsedQuestionIndex}.question`]: normalizedQuestion,
                        [`driveStructure.${parsedSectionIndex}.videos.${parsedQuizIndex}.questions.${parsedQuestionIndex}.options`]: optionObjects
                    }
                }
            )

            res.json({ success: true })
        } catch (err) {
            res.status(500).json({ success: false, error: err.message })
        }
    })
router.delete(
    "/course/:courseId/quiz/question/delete",
    async (req, res) => {
        try {
            const { courseId } = req.params
            const { sectionIndex, quizIndex, questionIndex } = req.body

            const parsedSectionIndex = parseInt(sectionIndex, 10)
            const parsedQuizIndex = parseInt(quizIndex, 10)
            const parsedQuestionIndex = parseInt(questionIndex, 10)

            if (
                Number.isNaN(parsedSectionIndex) ||
                Number.isNaN(parsedQuizIndex) ||
                Number.isNaN(parsedQuestionIndex)
            ) {
                return res.status(400).json({ success: false, error: "Invalid indexes" })
            }

            const course = await Course.findById(courseId)
            const questions = course.driveStructure?.[parsedSectionIndex]?.videos?.[parsedQuizIndex]?.questions || []

            if (parsedQuestionIndex < 0 || parsedQuestionIndex >= questions.length) {
                return res.status(400).json({ success: false, error: "Question index out of range" })
            }

            questions.splice(parsedQuestionIndex, 1)

            course.driveStructure[parsedSectionIndex].videos[parsedQuizIndex].questions = questions
            await course.save()

            res.json({ success: true })
        } catch (err) {
            res.status(500).json({ success: false, error: err.message })
        }
    })
router.put(
    "/course/:courseId/quiz/question/reorder",
    async (req, res) => {
        try {
            const { courseId } = req.params
            const { sectionIndex, quizIndex, order } = req.body

            const parsedSectionIndex = parseInt(sectionIndex, 10)
            const parsedQuizIndex = parseInt(quizIndex, 10)

            if (Number.isNaN(parsedSectionIndex) || Number.isNaN(parsedQuizIndex)) {
                return res.status(400).json({ success: false, error: "Invalid sectionIndex or quizIndex" })
            }

            const course = await Course.findById(courseId)

            let questions =
                course.driveStructure[parsedSectionIndex]
                    .videos[parsedQuizIndex]
                    .questions

            const normalizedOrder = (Array.isArray(order) ? order : []).map(i => parseInt(i, 10))
            const isValidOrder =
                normalizedOrder.length === questions.length &&
                normalizedOrder.every(i => !Number.isNaN(i) && i >= 0 && i < questions.length)

            if (!isValidOrder) {
                return res.status(400).json({ success: false, error: "Invalid question order" })
            }

            questions =
                normalizedOrder.map(i => questions[i])

            course.driveStructure[parsedSectionIndex]
                .videos[parsedQuizIndex]
                .questions = questions

            await course.save()

            res.json({ success: true })
        } catch (err) {
            res.status(500).json({ success: false, error: err.message })
        }
    })
router.get(
    "/course/:courseId/quiz/:sectionIndex/:quizIndex",
    async (req, res) => {

        const { courseId, sectionIndex, quizIndex } = req.params

        const course = await Course.findById(courseId)

        const quiz =
            course.driveStructure[sectionIndex].videos[quizIndex]

        res.render("quizPlayer", { quiz })

    })

// ==================== SLIDES MANAGEMENT ====================

// Add slides to a lesson
router.put('/course/:id/lesson/slides/add', async (req, res) => {
    const { sectionIndex, lessonIndex, slides, content } = req.body

    const normalizedSlides = normalizeSlidesPayload(
        Array.isArray(slides) ? slides : (content && content.slides)
    )

    if (!normalizedSlides.length) {
        return res.status(400).json({ success: false, error: 'Slide content missing' })
    }

    await Course.updateOne(
        { _id: req.params.id },
        {
            $set: {
                [`driveStructure.${sectionIndex}.videos.${lessonIndex}.content`]: {
                    slides: normalizedSlides
                },
                [`driveStructure.${sectionIndex}.videos.${lessonIndex}.aiGenerated`]: true
            }
        }
    )

    res.json({ success: true })
})

// Update a single slide
router.put('/course/:id/lesson/slides/update', async (req, res) => {
    const { sectionIndex, lessonIndex, slideIndex, title, content } = req.body

    const slidePathBase = `driveStructure.${sectionIndex}.videos.${lessonIndex}`

    await Course.updateOne(
        { _id: req.params.id },
        {
            $set: {
                [`${slidePathBase}.content.slides.${slideIndex}.title`]: title,
                [`${slidePathBase}.content.slides.${slideIndex}.content`]: content
            }
        }
    )

    res.json({ success: true })
})

// Delete all slides from a lesson
router.put('/course/:id/lesson/slides/delete', async (req, res) => {
    const { sectionIndex, lessonIndex } = req.body

    const slidePathBase = `driveStructure.${sectionIndex}.videos.${lessonIndex}`

    await Course.updateOne(
        { _id: req.params.id },
        {
            $set: {
                [`${slidePathBase}.content`]: { slides: [] },
                [`${slidePathBase}.aiGenerated`]: false
            }
        }
    )

    res.json({ success: true })
})


module.exports = router