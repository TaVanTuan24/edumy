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
    const sortableInstances = new Map();
    let sortableScriptLoading = false;
    let sortableInitAttempts = 0;
    const HIT_TEST_DEBUG = false;
    let highlightedHitElement = null;
    let addItemModal = null;
    let addItemState = {
        type: 'video',
        sectionIndex: null,
        submitting: false
    };

    // ==================== INITIALIZATION ====================
    document.addEventListener('DOMContentLoaded', function() {
        initEditor();
    });

    function initEditor() {
        console.log('[CourseEditor] initEditor start');

        // Get course ID from data attribute
        const courseElement = document.body.dataset.courseId;
        if (courseElement) {
            courseId = courseElement;
        }
        console.log('[CourseEditor] courseId:', courseId || '(missing)');

        // Parse course data from data attribute
        parseCourseData();

        // Initialize sortable lists
        initSortable();

        // Setup event delegation
        setupEventDelegation();

        // Runtime pointer hit-test debugger for drag blockers.
        initHitTestDebugger();

        // Prevent text selection when interacting with drag handle
        bindDragHandleGuards();

        // Setup reusable add-item modal
        initAddItemModal();

        // Open first section by default
        openFirstSection();

        // Retry Sortable init once visible DOM settles.
        window.setTimeout(initSortable, 150);
    }

    function initHitTestDebugger() {
        if (!HIT_TEST_DEBUG) return;

        document.body.classList.add('hit-test-mode');
        console.log('[CourseEditor][HitTest] Debug mode enabled');

        document.addEventListener('pointerdown', function(e) {
            const x = e.clientX;
            const y = e.clientY;
            const topElement = document.elementFromPoint(x, y);

            if (highlightedHitElement) {
                highlightedHitElement.classList.remove('hit-test-active');
            }
            highlightedHitElement = topElement;
            if (highlightedHitElement) {
                highlightedHitElement.classList.add('hit-test-active');
            }

            const isDragTarget = Boolean(topElement && topElement.closest('.lesson-item, .drag-handle'));
            const styles = topElement ? window.getComputedStyle(topElement) : null;

            console.log('[CourseEditor][HitTest] pointerdown target:', {
                eventTarget: e.target,
                topElement,
                isDragTarget,
                position: styles ? styles.position : '(n/a)',
                zIndex: styles ? styles.zIndex : '(n/a)',
                pointerEvents: styles ? styles.pointerEvents : '(n/a)'
            });

            if (!isDragTarget && topElement) {
                const blockingAncestor = topElement.closest('.library-popup, .library-add-btn, .top-bar, .modal, .editor-panel, .sidebar');
                console.warn('[CourseEditor][HitTest] Possible blocking layer detected:', {
                    blockingAncestor,
                    topElement
                });
            }
        }, true);
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
        sortableInitAttempts += 1;
        const sectionsContainer = document.getElementById('sectionsContainer');
        if (!sectionsContainer) {
            console.error('[CourseEditor] ERROR: #sectionsContainer not found. Sortable init aborted.');
            setReorderStatus('Drag container not found', 'error');
            return;
        }

        const lists = sectionsContainer.querySelectorAll('.lesson-list');
        console.log(`[CourseEditor] initSortable attempt ${sortableInitAttempts}; lists found:`, lists.length);
        console.log('[CourseEditor] typeof Sortable =', typeof Sortable);

        if (!lists.length && sortableInitAttempts < 5) {
            window.setTimeout(initSortable, 200);
            return;
        }

        if (typeof Sortable === 'undefined') {
            console.warn('[CourseEditor] Sortable not found, loading from CDN fallback');
            loadSortableScript();
            return;
        }

        const currentLists = new Set(Array.from(lists));

        // Destroy stale instances that no longer exist in DOM/current render.
        sortableInstances.forEach((instance, element) => {
            if (!currentLists.has(element) || !element.isConnected) {
                if (instance && typeof instance.destroy === 'function') {
                    instance.destroy();
                }
                sortableInstances.delete(element);
                console.log('[CourseEditor] Destroy stale sortable instance');
            }
        });

        lists.forEach((list) => {
            if (sortableInstances.has(list)) {
                console.log('[CourseEditor] Already initialized:', list.dataset.sectionIndex);
                return;
            }

            console.log('[CourseEditor] Init sortable:', list.dataset.sectionIndex);

            const sortable = new Sortable(list, {
                group: {
                    name: 'course-editor-items',
                    pull: true,
                    put: true
                },
                draggable: '.lesson-item',
                animation: 180,
                easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
                handle: '.drag-handle',
                forceFallback: true,
                fallbackClass: 'sortable-fallback',
                fallbackOnBody: true,
                fallbackTolerance: 0,
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass: 'sortable-drag',
                delayOnTouchOnly: false,
                delay: 0,
                touchStartThreshold: 0,
                onStart: function() {
                    document.body.classList.add('is-sorting');
                    console.log('DRAG START');
                    console.log('[CourseEditor] DRAG START target check:', document.activeElement);
                    setReorderStatus('Dragging item...', 'saving');
                },
                onMove: function(evt) {
                    document.querySelectorAll('.lesson-list.sortable-over').forEach(el => {
                        el.classList.remove('sortable-over');
                    });
                    if (evt && evt.to) {
                        evt.to.classList.add('sortable-over');
                    }
                },
                onEnd: function(evt) {
                    document.body.classList.remove('is-sorting');
                    console.log('DRAG END', {
                        oldIndex: evt.oldIndex,
                        newIndex: evt.newIndex,
                        from: evt.from?.dataset?.sectionIndex,
                        to: evt.to?.dataset?.sectionIndex
                    });
                    document.querySelectorAll('.lesson-list.sortable-over').forEach(el => {
                        el.classList.remove('sortable-over');
                    });
                    persistLessonReorder(evt);
                }
            });
            sortableInstances.set(list, sortable);
            list.dataset.sortableReady = 'true';
            console.log('[CourseEditor] Sortable initialized for section:', list.dataset.sectionIndex);
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

        // Native drag handlers are only for dragging library items into lessons.
        document.addEventListener('dragover', handleDragOver, false);
        document.addEventListener('dragleave', handleDragLeave, false);
        document.addEventListener('drop', handleDrop, false);
    }

    function bindDragHandleGuards() {
        document.addEventListener('mousedown', function(e) {
            if (e.target.closest('.drag-handle')) {
                e.stopPropagation();
            }
        }, true);

        document.addEventListener('touchstart', function(e) {
            if (e.target.closest('.drag-handle')) {
                e.stopPropagation();
            }
        }, { capture: true, passive: true });

        document.addEventListener('selectstart', function(e) {
            if (document.body.classList.contains('is-sorting')) {
                e.preventDefault();
            }
        });
    }

    function loadSortableScript() {
        if (sortableScriptLoading) return;
        sortableScriptLoading = true;
        setReorderStatus('Loading drag and drop...', 'saving');

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js';
        script.onload = function() {
            sortableScriptLoading = false;
            console.log('[CourseEditor] Sortable script loaded from CDN fallback');
            initSortable();
            setReorderStatus('Drag and drop ready', 'saved', true);
        };
        script.onerror = function() {
            sortableScriptLoading = false;
            console.error('[CourseEditor] Failed to load Sortable script from CDN fallback');
            setReorderStatus('Failed to load drag-and-drop library', 'error');
        };
        document.head.appendChild(script);
    }

    function handleMainClick(e) {
        // Ignore delegated click handlers while dragging is active.
        if (document.body.classList.contains('is-sorting')) {
            e.preventDefault();
            return;
        }

        // Do not treat drag-handle interaction as a regular item click.
        if (e.target.closest('.drag-handle')) {
            return;
        }

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
            const sectionIndex = editSectionBtn.closest('.section-header')?.dataset.sectionIndex;
            startInlineSectionRename(sectionId, sectionIndex);
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
            setActiveLesson(lessonItem);
            const sectionIndex = lessonItem.dataset.sectionIndex;
            const lessonIndex = lessonItem.dataset.lessonIndex;
            const type = lessonItem.dataset.type;
            const itemId = lessonItem.dataset.itemId;
            const itemName = lessonItem.querySelector('.item-title')?.textContent;
            loadLessonIntoEditor(sectionIndex, lessonIndex, type, itemId, itemName);
            return;
        }

        const sectionTitle = e.target.closest('.section-title');
        if (sectionTitle) {
            const sectionId = sectionTitle.id.replace('title-', '');
            const sectionIndex = sectionTitle.dataset.sectionIndex;
            startInlineSectionRename(sectionId, sectionIndex);
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
            header.querySelector('.delete-section-btn')?.contains(e.target) ||
            e.target.closest('.section-title') ||
            e.target.closest('.section-title-input')) {
            return;
        }

        const index = header.dataset.sectionIndex;
        const content = document.getElementById(`section-content-${index}`);
        const icon = document.getElementById(`icon-${index}`);
        const sectionCard = header.closest('.section-card');

        if (!content) return;

        const isOpen = !sectionCard?.classList.contains('is-collapsed');
        if (sectionCard) {
            sectionCard.classList.toggle('is-collapsed', isOpen);
        }

        content.style.maxHeight = isOpen ? '0px' : `${content.scrollHeight + 16}px`;

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

    async function editSection(sectionId, sectionIndex, newTitle) {
        const trimmedTitle = String(newTitle || '').trim();
        if (!trimmedTitle) return;

        try {
            const res = await fetch(`/admin/course/${courseId}/section/edit`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sectionIndex: parseInt(sectionIndex, 10),
                    name: trimmedTitle
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to update section title');
            }

            const titleEl = document.getElementById('title-' + sectionId);
            if (titleEl) titleEl.textContent = trimmedTitle;
        } catch (err) {
            alert('Failed to update section title');
        }
    }

    function startInlineSectionRename(sectionId, sectionIndex) {
        const titleEl = document.getElementById('title-' + sectionId);
        if (!titleEl || titleEl.querySelector('input')) return;

        const currentTitle = titleEl.textContent.trim();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'section-title-input';
        input.value = currentTitle;

        titleEl.textContent = '';
        titleEl.appendChild(input);
        input.focus();
        input.select();

        const commit = async () => {
            const nextTitle = input.value.trim() || currentTitle;
            titleEl.textContent = nextTitle;
            if (nextTitle !== currentTitle) {
                await editSection(sectionId, sectionIndex, nextTitle);
            }
        };

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                input.blur();
            }
            if (ev.key === 'Escape') {
                titleEl.textContent = currentTitle;
            }
        });

        input.addEventListener('blur', commit, { once: true });
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
        openAddItemModal('video', sectionIndex);
    }

    async function addSlide(sectionIndex) {
        openAddItemModal('slide', sectionIndex);
    }

    async function addQuiz(sectionIndex) {
        openAddItemModal('quiz', sectionIndex);
    }

    function initAddItemModal() {
        const modalEl = document.getElementById('addItemModal');
        const form = document.getElementById('addItemForm');
        const nameInput = document.getElementById('addItemName');
        const urlInput = document.getElementById('addItemUrl');
        const descriptionInput = document.getElementById('addItemDescription');

        if (!modalEl || !form || !nameInput || !urlInput || !descriptionInput) return;
        if (!window.bootstrap || !window.bootstrap.Modal) return;

        addItemModal = new window.bootstrap.Modal(modalEl, {
            keyboard: true,
            backdrop: true,
            focus: true
        });

        form.addEventListener('input', function() {
            validateAddItemForm();
            hideAddItemError();
        });

        form.addEventListener('submit', handleAddItemSubmit);

        form.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter') return;
            if (e.shiftKey) return;
            if (e.target && e.target.tagName === 'TEXTAREA') return;

            e.preventDefault();
            const submitBtn = document.getElementById('addItemSubmitBtn');
            if (submitBtn && !submitBtn.disabled) {
                submitBtn.click();
            }
        });

        modalEl.addEventListener('shown.bs.modal', function() {
            nameInput.focus();
        });

        modalEl.addEventListener('hidden.bs.modal', resetAddItemForm);
    }

    function openAddItemModal(type, sectionIndex) {
        if (!addItemModal) return;

        addItemState.type = type;
        addItemState.sectionIndex = parseInt(sectionIndex, 10);

        const modalTitle = document.getElementById('addItemModalLabel');
        const modalSubtitle = document.getElementById('addItemModalSubtitle');
        const submitLabel = document.getElementById('addItemSubmitLabel');
        const nameInput = document.getElementById('addItemName');
        const urlGroup = document.getElementById('addItemUrlGroup');
        const urlInput = document.getElementById('addItemUrl');

        const config = {
            video: {
                title: 'Add New Video',
                subtitle: 'Add a lesson video to this section.',
                submit: 'Create Video',
                placeholder: 'e.g. Introduction to Variables',
                showUrl: true
            },
            slide: {
                title: 'Add New Slide',
                subtitle: 'Create a slide lesson for this section.',
                submit: 'Create Slide',
                placeholder: 'e.g. Chapter Summary Slides',
                showUrl: false
            },
            quiz: {
                title: 'Add New Quiz',
                subtitle: 'Create a quiz for this section.',
                submit: 'Create Quiz',
                placeholder: 'e.g. Module 1 Knowledge Check',
                showUrl: false
            }
        };

        const ui = config[type] || config.video;

        if (modalTitle) modalTitle.textContent = ui.title;
        if (modalSubtitle) modalSubtitle.textContent = ui.subtitle;
        if (submitLabel) submitLabel.textContent = ui.submit;
        if (nameInput) nameInput.placeholder = ui.placeholder;

        if (urlGroup) {
            urlGroup.classList.toggle('d-none', !ui.showUrl);
        }

        if (urlInput && !ui.showUrl) {
            urlInput.value = '';
            urlInput.classList.remove('is-invalid');
        }

        hideAddItemError();
        validateAddItemForm();
        addItemModal.show();
    }

    function resetAddItemForm() {
        const form = document.getElementById('addItemForm');
        const nameInput = document.getElementById('addItemName');
        const urlInput = document.getElementById('addItemUrl');
        const descriptionInput = document.getElementById('addItemDescription');

        if (form) form.reset();
        if (nameInput) nameInput.classList.remove('is-invalid');
        if (urlInput) urlInput.classList.remove('is-invalid');
        if (descriptionInput) descriptionInput.classList.remove('is-invalid');

        addItemState.submitting = false;
        setAddItemLoading(false);
        hideAddItemError();
        validateAddItemForm();
    }

    function validateAddItemForm() {
        const nameInput = document.getElementById('addItemName');
        const urlInput = document.getElementById('addItemUrl');
        const urlGroup = document.getElementById('addItemUrlGroup');
        const submitBtn = document.getElementById('addItemSubmitBtn');

        if (!nameInput || !submitBtn) return false;

        const name = nameInput.value.trim();
        const urlValue = urlInput ? urlInput.value.trim() : '';
        const urlVisible = urlGroup ? !urlGroup.classList.contains('d-none') : false;

        let isValid = true;

        if (!name) {
            nameInput.classList.add('is-invalid');
            isValid = false;
        } else {
            nameInput.classList.remove('is-invalid');
        }

        if (urlInput && urlVisible && urlValue) {
            const isUrlValid = /^https?:\/\//i.test(urlValue);
            if (!isUrlValid) {
                urlInput.classList.add('is-invalid');
                isValid = false;
            } else {
                urlInput.classList.remove('is-invalid');
            }
        } else if (urlInput) {
            urlInput.classList.remove('is-invalid');
        }

        submitBtn.disabled = !isValid || addItemState.submitting;
        return isValid;
    }

    function setAddItemLoading(loading) {
        const submitBtn = document.getElementById('addItemSubmitBtn');
        const spinner = document.getElementById('addItemSubmitSpinner');
        const label = document.getElementById('addItemSubmitLabel');

        addItemState.submitting = loading;

        if (submitBtn) {
            submitBtn.disabled = loading || !validateAddItemForm();
        }
        if (spinner) {
            spinner.classList.toggle('d-none', !loading);
        }
        if (label && loading) {
            label.textContent = 'Creating...';
        } else if (label) {
            label.textContent = addItemState.type === 'video' ? 'Create Video' : addItemState.type === 'slide' ? 'Create Slide' : 'Create Quiz';
        }
    }

    function showAddItemError(message) {
        const errorEl = document.getElementById('addItemError');
        if (!errorEl) return;
        errorEl.textContent = message;
        errorEl.classList.remove('d-none');
    }

    function hideAddItemError() {
        const errorEl = document.getElementById('addItemError');
        if (!errorEl) return;
        errorEl.classList.add('d-none');
        errorEl.textContent = '';
    }

    async function handleAddItemSubmit(e) {
        e.preventDefault();

        if (addItemState.submitting) return;
        if (!validateAddItemForm()) {
            showAddItemError('Please fix the highlighted fields before submitting.');
            return;
        }

        hideAddItemError();
        setAddItemLoading(true);

        const nameInput = document.getElementById('addItemName');
        const urlInput = document.getElementById('addItemUrl');

        const name = nameInput ? nameInput.value.trim() : '';
        const url = urlInput ? urlInput.value.trim() : '';

        const config = {
            video: {
                endpoint: `/admin/course/${courseId}/lesson/add`,
                method: 'PUT',
                payload: {
                    sectionIndex: addItemState.sectionIndex,
                    name,
                    url
                }
            },
            slide: {
                endpoint: `/admin/course/${courseId}/slide/add`,
                method: 'POST',
                payload: {
                    sectionIndex: addItemState.sectionIndex,
                    name
                }
            },
            quiz: {
                endpoint: `/admin/course/${courseId}/quiz/add`,
                method: 'POST',
                payload: {
                    sectionIndex: addItemState.sectionIndex,
                    name
                }
            }
        };

        const current = config[addItemState.type] || config.video;

        try {
            const res = await fetch(current.endpoint, {
                method: current.method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(current.payload)
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                showAddItemError(data.error || `Unable to create ${addItemState.type}. Please try again.`);
                return;
            }

            addItemModal.hide();
            location.reload();
        } catch (err) {
            showAddItemError('Network error while creating item. Please try again.');
        } finally {
            setAddItemLoading(false);
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

        if (placeholder) {
            placeholder.classList.add('d-none');
        }
        if (editorContent) {
            editorContent.classList.remove('d-none');
        }
        
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
        if (document.body.classList.contains('is-sorting')) return;
        const lessonList = e.target.closest('.lesson-list');
        if (lessonList && hasLibraryPayload(e)) {
            e.preventDefault();
            lessonList.classList.add('drag-over');
        }
    }

    function handleDragLeave(e) {
        if (document.body.classList.contains('is-sorting')) return;
        const lessonList = e.target.closest('.lesson-list');
        if (lessonList && hasLibraryPayload(e)) {
            lessonList.classList.remove('drag-over');
        }
    }

    async function handleDrop(e) {
        if (document.body.classList.contains('is-sorting')) return;
        const lessonList = e.target.closest('.lesson-list');
        if (!lessonList) return;
        
        e.preventDefault();
        lessonList.classList.remove('drag-over');

        if (!hasLibraryPayload(e)) return;

        const data = e.dataTransfer.getData('application/json');
        if (data) {
            const item = JSON.parse(data);
            if (item.fromLibrary) {
                const sectionId = lessonList.dataset.sectionId;
                await addItemToSection(sectionId, item.type, item.id);
            }
        }
    }

    function hasLibraryPayload(e) {
        if (!e || !e.dataTransfer || !e.dataTransfer.types) return false;
        const types = Array.from(e.dataTransfer.types);
        return types.includes('application/json');
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

    async function persistLessonReorder(evt) {
        if (!evt || evt.oldIndex === undefined || evt.newIndex === undefined) return;

        const sourceSectionIndex = parseInt(evt.from?.dataset?.sectionIndex, 10);
        const destSectionIndex = parseInt(evt.to?.dataset?.sectionIndex, 10);
        const sourceIndex = evt.oldIndex;
        const destIndex = evt.newIndex;

        if (
            Number.isNaN(sourceSectionIndex) ||
            Number.isNaN(destSectionIndex) ||
            sourceIndex === undefined ||
            destIndex === undefined
        ) {
            return;
        }

        if (sourceSectionIndex === destSectionIndex && sourceIndex === destIndex) {
            refreshLessonIndexes(sourceSectionIndex);
            return;
        }

        moveItemInCourseData(sourceSectionIndex, destSectionIndex, sourceIndex, destIndex);
        refreshLessonIndexes(sourceSectionIndex);
        if (sourceSectionIndex !== destSectionIndex) {
            refreshLessonIndexes(destSectionIndex);
        }

        setReorderStatus('Saving order...', 'saving');

        try {
            const res = await fetch(`/admin/course/${courseId}/lesson/reorder`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceSectionIndex,
                    destSectionIndex,
                    sourceIndex,
                    destIndex
                })
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                setReorderStatus('Failed to save order. Restoring...', 'error');
                setTimeout(() => location.reload(), 700);
                return;
            }

            setReorderStatus('Order saved', 'saved', true);
        } catch (err) {
            setReorderStatus('Network error while saving order.', 'error');
            setTimeout(() => location.reload(), 700);
        }
    }

    function moveItemInCourseData(sourceSectionIndex, destSectionIndex, sourceIndex, destIndex) {
        const sourceSection = courseData[sourceSectionIndex];
        const destSection = courseData[destSectionIndex];

        if (!sourceSection || !destSection || !Array.isArray(sourceSection.videos) || !Array.isArray(destSection.videos)) {
            return;
        }

        const movedItems = sourceSection.videos.splice(sourceIndex, 1);
        const movedItem = movedItems[0];
        if (!movedItem) return;

        destSection.videos.splice(destIndex, 0, movedItem);

        sourceSection.videos.forEach((item, idx) => {
            item.order = idx;
        });

        if (sourceSectionIndex !== destSectionIndex) {
            destSection.videos.forEach((item, idx) => {
                item.order = idx;
            });
        }
    }

    function refreshLessonIndexes(sectionIndex) {
        const list = document.querySelector(`.lesson-list[data-section-index="${sectionIndex}"]`);
        if (!list) return;

        Array.from(list.querySelectorAll('.lesson-item')).forEach((item, idx) => {
            item.dataset.lessonIndex = String(idx);
            item.dataset.order = String(idx);
        });
    }

    function setReorderStatus(message, state, autoHide) {
        const statusEl = document.getElementById('reorderStatus');
        if (!statusEl) return;

        statusEl.textContent = message;
        statusEl.classList.remove('saving', 'saved', 'error');
        if (state) {
            statusEl.classList.add(state);
        }
        statusEl.classList.add('show');

        if (autoHide) {
            setTimeout(() => {
                statusEl.classList.remove('show');
            }, 1200);
        }
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
        document.querySelectorAll('.section-card').forEach((card, idx) => {
            card.classList.toggle('is-collapsed', idx !== 0);
        });

        const first = document.getElementById('section-content-0');
        if (first) {
            first.style.maxHeight = `${first.scrollHeight + 16}px`;
            const firstIcon = document.getElementById('icon-0');
            if (firstIcon) {
                firstIcon.classList.remove('fa-chevron-right');
                firstIcon.classList.add('fa-chevron-down');
            }
        }

        document.querySelectorAll('.lesson-list[id^="section-content-"]').forEach((list) => {
            if (list.id !== 'section-content-0') {
                list.style.maxHeight = '0px';
            }
        });
    }

    function setActiveLesson(targetLesson) {
        document.querySelectorAll('.lesson-item.is-active').forEach((item) => {
            item.classList.remove('is-active');
        });

        if (targetLesson) {
            targetLesson.classList.add('is-active');
        }
    }

})();
