/**
 * Course Editor JavaScript
 * Clean architecture - all logic in external file
 */
(function() {
    'use strict';

    // ==================== CONFIGURATION ====================
    let courseId = '';
    let currentLibraryTab = 'lesson';
    let courseData = [];
    let sortableInstances = [];

    // ==================== INITIALIZATION ====================
    document.addEventListener('DOMContentLoaded', function() {
        initEditor();
    });

    function initEditor() {
        // Get course ID from data attribute
        const courseElement = document.body.dataset.courseId;
        if (courseElement) {
            courseId = courseElement;
        }

        // Parse course data from data attribute
        parseCourseData();

        // Initialize sortable lists
        initSortable();

        // Setup event delegation
        setupEventDelegation();

        // Open first section by default
        openFirstSection();
    }

    function parseCourseData() {
        const dataEl = document.getElementById('course-data');
        if (dataEl) {
            try {
                courseData = JSON.parse(dataEl.textContent);
            } catch(e) {
                courseData = [];
            }
        }
    }

    // ==================== SORTABLE ====================
    function initSortable() {
        document.querySelectorAll('.lesson-list').forEach((list, index) => {
            const sortable = new Sortable(list, {
                animation: 150,
                handle: '.drag-handle',
                ghostClass: 'dragging',
                onEnd: function(evt) {
                    saveOrder();
                }
            });
            sortableInstances[index] = sortable;
        });
    }

    // ==================== EVENT DELEGATION ====================
    function setupEventDelegation() {
        // Main click handler for all interactive elements
        document.addEventListener('click', handleMainClick);

        // Library tab switching
        document.addEventListener('click', handleLibraryTabClick);

        // Section collapse toggle
        document.addEventListener('click', handleSectionToggle);

        // Drag and drop handlers for lesson lists
        document.addEventListener('dragover', handleDragOver, false);
        document.addEventListener('dragleave', handleDragLeave, false);
        document.addEventListener('drop', handleDrop, false);
    }

    function handleMainClick(e) {
        // Handle save course button
        if (e.target.closest('.top-bar .btn-primary')) {
            saveCourse();
            return;
        }

        // Handle add section button
        if (e.target.closest('.add-section-btn')) {
            addSection();
            return;
        }

        // Handle edit section button
        const editSectionBtn = e.target.closest('.edit-section-btn');
        if (editSectionBtn) {
            e.stopPropagation();
            const sectionId = editSectionBtn.dataset.sectionId;
            editSection(sectionId);
            return;
        }

        // Handle delete section button
        const deleteSectionBtn = e.target.closest('.delete-section-btn');
        if (deleteSectionBtn) {
            e.stopPropagation();
            const sectionId = deleteSectionBtn.dataset.sectionId;
            deleteSection(sectionId);
            return;
        }

        // Handle edit item button
        const editItemBtn = e.target.closest('.edit-btn');
        if (editItemBtn) {
            e.stopPropagation();
            const id = editItemBtn.dataset.id;
            const type = editItemBtn.dataset.type;
            if (id && type) {
                editItem(type, id);
            }
            return;
        }

        // Handle delete item (trash icon)
        const deleteItemBtn = e.target.closest('.lesson-item .fa-trash');
        if (deleteItemBtn) {
            const itemEl = deleteItemBtn.closest('.lesson-item');
            const sectionId = itemEl.dataset.sectionId;
            const itemId = itemEl.dataset.itemId;
            if (sectionId && itemId) {
                e.stopPropagation();
                deleteItem(sectionId, itemId);
            }
            return;
        }

        // Handle lesson item click - load into editor panel
        const lessonItem = e.target.closest('.lesson-item');
        if (lessonItem) {
            const sectionIndex = lessonItem.dataset.sectionIndex;
            const lessonIndex = lessonItem.dataset.lessonIndex;
            const type = lessonItem.dataset.type;
            const itemId = lessonItem.dataset.itemId;
            const itemName = lessonItem.querySelector('.item-title')?.textContent;
            loadLessonIntoEditor(sectionIndex, lessonIndex, type, itemId, itemName);
            return;
        }

        // Handle add video button
        const addVideoBtn = e.target.closest('.add-item-btn[data-item-type="video"]');
        if (addVideoBtn) {
            const sectionIndex = addVideoBtn.dataset.sectionIndex;
            addVideo(sectionIndex);
            return;
        }

        // Handle add slide button
        const addSlideBtn = e.target.closest('.add-item-btn[data-item-type="slide"]');
        if (addSlideBtn) {
            const sectionIndex = addSlideBtn.dataset.sectionIndex;
            addSlide(sectionIndex);
            return;
        }

        // Handle add quiz button
        const addQuizBtn = e.target.closest('.add-item-btn[data-item-type="quiz"]');
        if (addQuizBtn) {
            const sectionIndex = addQuizBtn.dataset.sectionIndex;
            addQuiz(sectionIndex);
            return;
        }

        // Handle library toggle button
        if (e.target.closest('.library-add-btn') || e.target.closest('.library-popup-header .close-btn')) {
            toggleLibrary();
            return;
        }

        // Handle no sections - add section button
        const addSectionEmptyBtn = e.target.closest('.add-section-empty-btn');
        if (addSectionEmptyBtn) {
            addSection();
            return;
        }
    }

    function handleLibraryTabClick(e) {
        const tabBtn = e.target.closest('.library-tabs button');
        if (tabBtn) {
            const type = tabBtn.dataset.tabType;
            if (type) {
                switchLibraryTab(type, tabBtn);
            }
        }
    }

    function handleSectionToggle(e) {
        const header = e.target.closest('.section-header');
        if (!header || header.querySelector('.edit-section-btn')?.contains(e.target) || 
            header.querySelector('.delete-section-btn')?.contains(e.target)) {
            return;
        }

        const index = header.dataset.sectionIndex;
        const content = document.getElementById(`section-content-${index}`);
        const icon = document.getElementById(`icon-${index}`);

        if (!content) return;

        const isOpen = content.style.display === 'block';
        content.style.display = isOpen ? 'none' : 'block';

        if (icon) {
            icon.classList.toggle('fa-chevron-down', !isOpen);
            icon.classList.toggle('fa-chevron-right', isOpen);
        }
    }

    // ==================== SECTION FUNCTIONS ====================
    async function addSection() {
        const title = prompt('Section title:');
        if (!title) return;

        const newSection = {
            _id: 'section-' + Date.now(),
            section: title,
            videos: []
        };

        try {
            const res = await fetch('/api/admin/course/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId,
                    driveStructure: [...courseData, newSection]
                })
            });
            const data = await res.json();
            if (data.success) location.reload();
        } catch(e) {
            alert('Failed to add section');
        }
    }

    async function editSection(sectionId) {
        const currentTitle = document.getElementById('title-' + sectionId).textContent;
        const newTitle = prompt('Section title:', currentTitle);
        if (!newTitle) return;

        const updated = courseData.map(s => 
            s._id === sectionId ? { ...s, section: newTitle } : s
        );

        await saveCourseOrder(updated);
    }

    async function deleteSection(sectionId) {
        if (!confirm('Delete this section?')) return;

        const updated = courseData.filter(s => s._id !== sectionId);
        await saveCourseOrder(updated);
    }

    async function saveCourseOrder(sections) {
        try {
            const res = await fetch('/api/admin/course/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseId, driveStructure: sections })
            });
            const data = await res.json();
            if (data.success) {
                location.reload();
            }
        } catch(e) {
            alert('Failed to save');
        }
    }

    // ==================== ITEM FUNCTIONS ====================
    async function addVideo(sectionIndex) {
        const name = prompt('Video name?');
        if (!name) return;

        const url = prompt('Video URL?');
        if (!url) return;

        try {
            const res = await fetch(`/admin/course/${courseId}/lesson/add`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    sectionIndex: parseInt(sectionIndex), 
                    name: name, 
                    url: url 
                })
            });
            
            const data = await res.json();
            
            if (data.success) {
                location.reload();
            } else {
                alert('Failed to add video');
            }
        } catch (err) {
            alert('Error occurred');
        }
    }

    async function addSlide(sectionIndex) {
        const name = prompt('Slide name?');
        if (!name) return;

        try {
            const res = await fetch(`/admin/course/${courseId}/slide/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    sectionIndex: parseInt(sectionIndex), 
                    name: name
                })
            });
            
            const data = await res.json();
            
            if (data.success) {
                location.reload();
            } else {
                alert('Failed to add slide');
            }
        } catch (err) {
            alert('Error occurred');
        }
    }

    async function addQuiz(sectionIndex) {
        const name = prompt('Quiz name?');
        if (!name) return;

        try {
            const res = await fetch(`/admin/course/${courseId}/quiz/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    sectionIndex: parseInt(sectionIndex), 
                    name: name
                })
            });
            
            const data = await res.json();
            
            if (data.success) {
                location.reload();
            } else {
                alert('Failed to add quiz');
            }
        } catch (err) {
            alert('Error occurred');
        }
    }

    function editItem(type, id) {
        if (!id) {
            alert('Item not found. Please reload.');
            return;
        }
        
        if (type === 'video') {
            window.location.href = '/admin/lesson/' + id + '/edit';
        } else if (type === 'slide') {
            window.location.href = '/admin/slide/' + id + '/edit';
        } else if (type === 'quiz') {
            window.location.href = '/admin/quiz/' + id + '/edit';
        }
    }

    async function deleteItem(sectionId, itemId) {
        if (!confirm('Delete this item?')) return;

        const updated = courseData.map(s => {
            if (s._id === sectionId) {
                return { ...s, videos: s.videos.filter(i => i._id !== itemId) };
            }
            return s;
        });

        await saveCourseOrder(updated);
    }

    // ==================== LESSON EDITOR PANEL ====================
    function loadLessonIntoEditor(sectionIndex, lessonIndex, type, itemId, itemName) {
        const placeholder = document.getElementById('editorPlaceholder');
        const editorContent = document.getElementById('editorContent');
        
        placeholder.style.display = 'none';
        editorContent.style.display = 'block';
        
        if (type === 'video') {
            editorContent.innerHTML = buildVideoEditorHTML(sectionIndex, lessonIndex, itemId, itemName);
            fetchVideoData(sectionIndex, lessonIndex);
            setupSaveLessonHandler();
        } else if (type === 'slide') {
            editorContent.innerHTML = buildSlideEditorHTML(sectionIndex, lessonIndex, itemId, itemName);
            setupSaveLessonHandler();
        } else if (type === 'quiz') {
            editorContent.innerHTML = buildQuizEditorHTML(sectionIndex, lessonIndex, itemId, itemName);
            setupSaveLessonHandler();
        }
    }

    function buildVideoEditorHTML(sectionIndex, lessonIndex, itemId, itemName) {
        return `
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">Edit Video</h5>
                    <span class="badge bg-secondary">Section: ${sectionIndex}, Lesson: ${lessonIndex}</span>
                </div>
                <div class="card-body">
                    <input type="hidden" id="lesson-section-index" value="${sectionIndex}">
                    <input type="hidden" id="lesson-index" value="${lessonIndex}">
                    <input type="hidden" id="lesson-id" value="${itemId}">
                    <input type="hidden" id="lesson-type" value="video">
                    
                    <div class="mb-3">
                        <label class="form-label">Video Name</label>
                        <input type="text" class="form-control" id="lesson-name" value="${itemName || ''}">
                    </div>
                    <div class="mb-3">
                        <label class="form-label">Video URL</label>
                        <input type="text" class="form-control" id="lesson-url" placeholder="Enter video URL">
                    </div>
                    <div class="mb-3">
                        <button class="btn btn-primary save-lesson-btn">
                            <i class="fas fa-save"></i> Save Changes
                        </button>
                        <a href="/admin/lesson/${itemId}/edit" class="btn btn-secondary">
                            <i class="fas fa-edit"></i> Advanced Edit
                        </a>
                    </div>
                </div>
            </div>
        `;
    }

    function buildSlideEditorHTML(sectionIndex, lessonIndex, itemId, itemName) {
        return `
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">Edit Slide</h5>
                    <span class="badge bg-secondary">Section: ${sectionIndex}, Lesson: ${lessonIndex}</span>
                </div>
                <div class="card-body">
                    <input type="hidden" id="lesson-section-index" value="${sectionIndex}">
                    <input type="hidden" id="lesson-index" value="${lessonIndex}">
                    <input type="hidden" id="lesson-id" value="${itemId}">
                    <input type="hidden" id="lesson-type" value="slide">
                    
                    <div class="mb-3">
                        <label class="form-label">Slide Name</label>
                        <input type="text" class="form-control" id="lesson-name" value="${itemName || ''}">
                    </div>
                    <div class="mb-3">
                        <button class="btn btn-primary save-lesson-btn">
                            <i class="fas fa-save"></i> Save Changes
                        </button>
                        <a href="/admin/slide/${itemId}/edit" class="btn btn-secondary">
                            <i class="fas fa-edit"></i> Advanced Edit
                        </a>
                    </div>
                </div>
            </div>
        `;
    }

    function buildQuizEditorHTML(sectionIndex, lessonIndex, itemId, itemName) {
        return `
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">Edit Quiz</h5>
                    <span class="badge bg-secondary">Section: ${sectionIndex}, Lesson: ${lessonIndex}</span>
                </div>
                <div class="card-body">
                    <input type="hidden" id="lesson-section-index" value="${sectionIndex}">
                    <input type="hidden" id="lesson-index" value="${lessonIndex}">
                    <input type="hidden" id="lesson-id" value="${itemId}">
                    <input type="hidden" id="lesson-type" value="quiz">
                    
                    <div class="mb-3">
                        <label class="form-label">Quiz Name</label>
                        <input type="text" class="form-control" id="lesson-name" value="${itemName || ''}">
                    </div>
                    <div class="mb-3">
                        <button class="btn btn-primary save-lesson-btn">
                            <i class="fas fa-save"></i> Save Changes
                        </button>
                        <a href="/admin/quiz/${itemId}/edit" class="btn btn-secondary">
                            <i class="fas fa-edit"></i> Advanced Edit
                        </a>
                        <a href="/admin/course/${courseId}/quiz/${sectionIndex}/${lessonIndex}" class="btn btn-info">
                            <i class="fas fa-question"></i> Quiz Editor
                        </a>
                    </div>
                </div>
            </div>
        `;
    }

    function setupSaveLessonHandler() {
        const saveBtn = document.querySelector('.save-lesson-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveLesson);
        }
    }

    async function fetchVideoData(sectionIndex, lessonIndex) {
        try {
            const res = await fetch(`/admin/course/${courseId}/lesson/${sectionIndex}/${lessonIndex}`);
            const data = await res.json();
            
            if (data.video && data.video.preview) {
                const urlInput = document.getElementById('lesson-url');
                if (urlInput) {
                    urlInput.value = data.video.preview;
                }
            }
        } catch (err) {
            // Silently fail - user can still enter URL manually
        }
    }

    async function saveLesson() {
        const sectionIndex = document.getElementById('lesson-section-index')?.value;
        const lessonIndex = document.getElementById('lesson-index')?.value;
        const itemId = document.getElementById('lesson-id')?.value;
        const name = document.getElementById('lesson-name')?.value;
        const url = document.getElementById('lesson-url')?.value;
        
        try {
            const res = await fetch(`/admin/course/${courseId}/lesson/edit`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sectionIndex: parseInt(sectionIndex),
                    lessonIndex: parseInt(lessonIndex),
                    name: name,
                    url: url
                })
            });
            
            if (res.ok) {
                alert('Saved successfully!');
                location.reload();
            } else {
                alert('Failed to save');
            }
        } catch (err) {
            alert('Error occurred: ' + err.message);
        }
    }

    // ==================== DRAG & DROP ====================
    function handleDragOver(e) {
        const lessonList = e.target.closest('.lesson-list');
        if (lessonList) {
            e.preventDefault();
            lessonList.classList.add('drag-over');
        }
    }

    function handleDragLeave(e) {
        const lessonList = e.target.closest('.lesson-list');
        if (lessonList) {
            lessonList.classList.remove('drag-over');
        }
    }

    async function handleDrop(e) {
        const lessonList = e.target.closest('.lesson-list');
        if (!lessonList) return;
        
        e.preventDefault();
        lessonList.classList.remove('drag-over');

        const data = e.dataTransfer.getData('application/json');
        if (data) {
            const item = JSON.parse(data);
            if (item.fromLibrary) {
                const sectionId = lessonList.dataset.sectionId;
                await addItemToSection(sectionId, item.type, item.id);
            }
        }

        await saveOrder();
    }

    async function addItemToSection(sectionId, type, refId) {
        try {
            const res = await fetch('/api/admin/course/add-item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId,
                    sectionId,
                    type,
                    refId
                })
            });
            const data = await res.json();
            if (data.success) {
                location.reload();
            }
        } catch(e) {
            alert('Failed to add item');
        }
    }

    async function saveOrder() {
        const sections = [];
        
        document.querySelectorAll('.section-card').forEach(card => {
            const sectionId = card.dataset.sectionId;
            const sectionTitle = document.getElementById('title-' + sectionId).textContent;
            const videos = [];

            card.querySelectorAll('.lesson-item').forEach(video => {
                videos.push({
                    _id: video.dataset.itemId,
                    type: video.dataset.type,
                    refId: video.dataset.refId
                });
            });

            sections.push({ _id: sectionId, section: sectionTitle, videos });
        });

        await saveCourseOrder(sections);
    }

    // ==================== LIBRARY FUNCTIONS ====================
    function toggleLibrary() {
        const popup = document.getElementById('libraryPopup');
        popup.classList.toggle('show');
    }

    function switchLibraryTab(type, clickedBtn) {
        currentLibraryTab = type;
        
        document.querySelectorAll('.library-tabs button').forEach(btn => {
            btn.classList.remove('active');
        });
        
        if (clickedBtn) {
            clickedBtn.classList.add('active');
        }

        loadLibraryItems();
    }

    async function loadLibraryItems() {
        const content = document.getElementById('libraryContent');
        if (!content) return;
        
        content.innerHTML = '<div class="library-empty"><i class="fas fa-spinner fa-spin"></i></div>';

        try {
            const res = await fetch('/api/admin/library?type=' + currentLibraryTab);
            const data = await res.json();

            if (!data.success || !data.items.length) {
                content.innerHTML = '<div class="library-empty"><p>No ' + currentLibraryTab + 's in library</p></div>';
                return;
            }

            const icons = { video: 'fa-play-circle', slide: 'fa-file-alt', quiz: 'fa-question-circle' };
            const colors = { video: '#dc3545', slide: '#0d6efd', quiz: '#198754' };

            content.innerHTML = data.items.map(item => `
                <div class="library-item" 
                     draggable="true" 
                     data-id="${item._id}"
                     data-type="${item.type}">
                    <div class="lib-icon" style="color: ${colors[item.type]}">
                        <i class="fas ${icons[item.type]}"></i>
                    </div>
                    <span class="lib-title">${item.title}</span>
                </div>
            `).join('');

            // Attach drag handlers to library items
            content.querySelectorAll('.library-item').forEach(item => {
                item.addEventListener('dragstart', handleLibraryDrag);
            });

        } catch(e) {
            content.innerHTML = '<div class="library-empty"><p>Error loading</p></div>';
        }
    }

    function handleLibraryDrag(e) {
        const libraryItem = e.target.closest('.library-item');
        if (!libraryItem) return;

        const item = {
            fromLibrary: true,
            id: libraryItem.dataset.id,
            type: libraryItem.dataset.type
        };
        e.dataTransfer.setData('application/json', JSON.stringify(item));
    }

    // ==================== SAVE COURSE ====================
    function saveCourse() {
        alert('Course saved!');
    }

    // ==================== UTILITY ====================
    function openFirstSection() {
        const first = document.getElementById('section-content-0');
        if (first) {
            first.style.display = 'block';
            const firstIcon = document.getElementById('icon-0');
            if (firstIcon) {
                firstIcon.classList.remove('fa-chevron-right');
                firstIcon.classList.add('fa-chevron-down');
            }
        }
    }

})();
