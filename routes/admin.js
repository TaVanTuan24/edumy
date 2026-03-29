const express = require('express');
const router = express.Router();
const Course = require('../models/course');

router.get('/', async (req, res) => {

    const courses = await Course.find({});

    res.render('admin/courseManager', { courses });

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
                    }
                });
            }
        });
    }

    res.render('admin/courseEditor', { course })

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
                    }
                });
            }
        });
    }

    res.render('admin/courseEditorNew', { course })

})
router.put('/course/:id/lesson/edit', async (req,res)=>{

const {sectionIndex,lessonIndex,name,url} = req.body

await Course.updateOne(
{_id:req.params.id},
{
$set:{
[`driveStructure.${sectionIndex}.videos.${lessonIndex}.name`]:name,
[`driveStructure.${sectionIndex}.videos.${lessonIndex}.preview`]:url
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
        const { sectionIndex, name, url } = req.body
        const parsedSectionIndex = parseInt(sectionIndex, 10)

        const course = await Course.findById(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const videos = course.driveStructure?.[parsedSectionIndex]?.videos
        if (!Array.isArray(videos)) {
            return res.status(400).json({ success: false, error: 'Invalid section index' })
        }

        videos.push({
            type: "video",
            name: name,
            preview: url,
            order: videos.length
        })

        await course.save()

        res.json({ success: true })
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
        const { sectionIndex, name } = req.body
        const parsedSectionIndex = parseInt(sectionIndex, 10)

        const course = await Course.findById(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const videos = course.driveStructure?.[parsedSectionIndex]?.videos
        if (!Array.isArray(videos)) {
            return res.status(400).json({ success: false, error: 'Invalid section index' })
        }

        videos.push({
            type: "quiz",
            name: name,
            questions: [],
            order: videos.length
        })

        await course.save()

        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }

})

// Add slide to section
router.post("/course/:id/slide/add", async (req, res) => {
    try {
        const { sectionIndex, name } = req.body
        const parsedSectionIndex = parseInt(sectionIndex, 10)

        const course = await Course.findById(req.params.id)
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' })
        }

        const videos = course.driveStructure?.[parsedSectionIndex]?.videos
        if (!Array.isArray(videos)) {
            return res.status(400).json({ success: false, error: 'Invalid section index' })
        }

        videos.push({
            type: "slide",
            name: name,
            content: "",
            order: videos.length
        })

        await course.save()

        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }

})

// Get lesson data
router.get('/course/:id/lesson/:sectionIndex/:lessonIndex', async (req, res) => {
    try {
        const { sectionIndex, lessonIndex } = req.params
        const course = await Course.findById(req.params.id)
        
        if (!course) {
            return res.json({ success: false, error: 'Course not found' })
        }
        
        const video = course.driveStructure[sectionIndex]?.videos[lessonIndex]
        
        if (!video) {
            return res.json({ success: false, error: 'Lesson not found' })
        }
        
        res.json({ success: true, video })
    } catch (err) {
        res.json({ success: false, error: err.message })
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
    const { sectionIndex, lessonIndex, slides } = req.body

    await Course.updateOne(
        { _id: req.params.id },
        {
            $set: {
                [`driveStructure.${sectionIndex}.videos.${lessonIndex}.slides`]: slides,
                [`driveStructure.${sectionIndex}.videos.${lessonIndex}.aiGenerated`]: true
            }
        }
    )

    res.json({ success: true })
})

// Update a single slide
router.put('/course/:id/lesson/slides/update', async (req, res) => {
    const { sectionIndex, lessonIndex, slideIndex, title, content } = req.body

    await Course.updateOne(
        { _id: req.params.id },
        {
            $set: {
                [`driveStructure.${sectionIndex}.videos.${lessonIndex}.slides.${slideIndex}.title`]: title,
                [`driveStructure.${sectionIndex}.videos.${lessonIndex}.slides.${slideIndex}.content`]: content
            }
        }
    )

    res.json({ success: true })
})

// Delete all slides from a lesson
router.put('/course/:id/lesson/slides/delete', async (req, res) => {
    const { sectionIndex, lessonIndex } = req.body

    await Course.updateOne(
        { _id: req.params.id },
        {
            $unset: {
                [`driveStructure.${sectionIndex}.videos.${lessonIndex}.slides`]: 1
            },
            $set: {
                [`driveStructure.${sectionIndex}.videos.${lessonIndex}.aiGenerated`]: false
            }
        }
    )

    res.json({ success: true })
})

// Generate AI slides for a lesson
router.post('/course/:id/lesson/slides/generate', async (req, res) => {
    const { sectionIndex, lessonIndex } = req.body

    // Get the lesson details
    const course = await Course.findById(req.params.id)
    const lesson = course.driveStructure[sectionIndex].videos[lessonIndex]
    const lessonTitle = lesson.name

    // Call Ollama to generate slides
    const prompt = `Create presentation slides for a lesson titled "${lessonTitle}". 

Generate 5-7 slides. Each slide should have:
- A short title (max 10 words)
- Short content points (not paragraphs, use bullet points or short sentences)

Return ONLY valid JSON in this exact format:
{
  "slides": [
    {"title": "Slide Title", "content": "Point 1\\nPoint 2\\nPoint 3"},
    ...
  ]
}

Make the content educational and beginner-friendly.`

    try {
        const axios = require('axios')
        const ai = await axios.post(
            "http://localhost:11434/api/generate",
            {
                model: "llama3.1",
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.7,
                    max_tokens: 2048
                }
            },
            { timeout: 120000 }
        )

        // Parse the response
        const responseText = ai.data.response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)

        if (!jsonMatch) {
            return res.status(500).json({ error: 'Failed to generate slides' })
        }

        const slidesData = JSON.parse(jsonMatch[0])

        // Save slides to the lesson
        await Course.updateOne(
            { _id: req.params.id },
            {
                $set: {
                    [`driveStructure.${sectionIndex}.videos.${lessonIndex}.slides`]: slidesData.slides,
                    [`driveStructure.${sectionIndex}.videos.${lessonIndex}.aiGenerated`]: true
                }
            }
        )

        res.json({ success: true, slides: slidesData.slides })
    } catch (err) {
        console.error('AI Slides Generation Error:', err.message)
        res.status(500).json({ error: 'Failed to generate slides: ' + err.message })
    }
})

module.exports = router