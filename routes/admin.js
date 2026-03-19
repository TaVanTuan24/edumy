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

    const { sectionIndex, name, url } = req.body

    await Course.updateOne(
        { _id: req.params.id },
        {
            $push: {
                [`driveStructure.${sectionIndex}.videos`]: {
                    type: "video",
                    name: name,
                    preview: url
                }
            }
        }
    )

    res.json({ success: true })

})
router.put('/course/:id/lesson/reorder', async (req, res) => {

    const { sectionIndex, lessons } = req.body

    await Course.updateOne(
        { _id: req.params.id },
        {
            $set: {
                [`driveStructure.${sectionIndex}.videos`]: lessons
            }
        }
    )

    res.json({ success: true })

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

    const { sectionIndex, name } = req.body

    await Course.findByIdAndUpdate(
        req.params.id,
        {
            $push: {
                [`driveStructure.${sectionIndex}.videos`]: {
                    type: "quiz",
                    name: name,
                    questions: []
                }
            }
        }
    )

    res.json({ success: true })

})

// Add slide to section
router.post("/course/:id/slide/add", async (req, res) => {

    const { sectionIndex, name } = req.body

    await Course.findByIdAndUpdate(
        req.params.id,
        {
            $push: {
                [`driveStructure.${sectionIndex}.videos`]: {
                    type: "slide",
                    name: name,
                    content: ""
                }
            }
        }
    )

    res.json({ success: true })

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

        const { courseId } = req.params
        const { sectionIndex, quizIndex, question, options, correct } = req.body

        const quizPath =
            `driveStructure.${sectionIndex}.videos.${quizIndex}.questions`

        const optionObjects =
            options.map((text, i) => ({
                text,
                correct: i === correct
            }))

        await Course.updateOne(
            { _id: courseId },
            {
                $push: {
                    [quizPath]: {
                        question,
                        options: optionObjects
                    }
                }
            }
        )

        res.json({ success: true })

    })
router.put(
    "/course/:courseId/quiz/question/reorder",
    async (req, res) => {

        const { courseId } = req.params
        const { sectionIndex, quizIndex, order } = req.body

        const course = await Course.findById(courseId)

        let questions =
            course.driveStructure[sectionIndex]
                .videos[quizIndex]
                .questions

        questions =
            order.map(i => questions[i])

        course.driveStructure[sectionIndex]
            .videos[quizIndex]
            .questions = questions

        await course.save()

        res.json({ success: true })

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