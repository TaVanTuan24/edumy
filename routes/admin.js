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
module.exports = router