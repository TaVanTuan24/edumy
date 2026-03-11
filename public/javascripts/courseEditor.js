new Sortable(document.getElementById('sections'), {
    animation: 150
})

document.querySelectorAll('.lesson-list').forEach(list => {

    new Sortable(list, {
        animation: 150
    })

})
function addSection() {

    fetch(`/admin/course/<%=course._id%>/section`, {
        method: 'POST'
    })
        .then(res => res.json())
        .then(data => renderSections(data))

}

function deleteLesson(sectionIndex, lessonIndex) {

    fetch(`/admin/course/<%=course._id%>/section/${sectionIndex}/lesson/${lessonIndex}`, {
        method: 'DELETE'
    }).then(() => location.reload())

}
function previewVideo(url) {

    document.getElementById("videoFrame").src = url
    document.getElementById("videoModal").style.display = "block"

}
function saveSectionOrder() {

    const sections = []

    document.querySelectorAll('.section').forEach(sec => {

        sections.push(sec.dataset.index)

    })

    fetch(`/admin/course/<%=course._id%>/reorderSections`, {

        method: "POST",

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ sections })

    })

}
function saveLessonOrder(sectionIndex) {

    const lessons = []

    document.querySelectorAll('.lesson-list')[sectionIndex]
        .querySelectorAll('.lesson')
        .forEach(l => {

            lessons.push(l.innerText)

        })

    fetch(`/admin/course/<%=course._id%>/reorderLessons`, {

        method: "POST",

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ sectionIndex, lessons })

    })

}