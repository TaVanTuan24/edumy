const express = require('express');
const router = express.Router();
const Course = require('../models/course');

router.get('/', async (req, res) => {

    const courses = await Course.find({});

    res.render('admin/courseManager', { courses });

});
router.get('/courses/:id/editor', async (req, res) => {

    const course = await Course.findById(req.params.id)

    res.render('admin/courseEditor', { course })

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
module.exports = router