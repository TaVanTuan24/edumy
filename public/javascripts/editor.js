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
        sectionId: null,
        sectionIndex: null,
        submitting: false
    };
    let interactiveQuizDraft = [];

    // ==================== INITIALIZATION ====================
    document.addEventListener('DOMContentLoaded', function() {
        initEditor();
    });

    function initEditor() {
        console.log('[CourseEditor] initEditor start');

        // Get course ID from data attribute
        const pageRoot = document.querySelector('.course-editor-page[data-course-id]');
        const courseElement = document.body.dataset.courseId || (pageRoot && pageRoot.dataset ? pageRoot.dataset.courseId : '');
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

        // Keep expanded section heights in sync with dynamic content.
        window.addEventListener('resize', refreshExpandedSectionHeights);

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
                const raw = (dataEl.textContent || '').trim();
                courseData = normalizeEditorSections(raw ? JSON.parse(raw) : []);
                console.log('[CourseEditor] Parsed course data sections:', Array.isArray(courseData) ? courseData.length : 0);
            } catch(e) {
                courseData = [];
                console.error('[CourseEditor] Failed to parse course data:', e);
            }
        }
    }

    function normalizeEditorSections(rawSections) {
        const source = Array.isArray(rawSections) ? rawSections : [];
        return source.map(function(section, sectionIndex) {
            const rawLessons = Array.isArray(section && section.lessons)
                ? section.lessons
                : [];

            return {
                _id: section && section._id ? String(section._id) : ('section-' + sectionIndex),
                title: String((section && section.title) || 'Untitled Section'),
                order: Number.isFinite(Number(section && section.order)) ? Number(section.order) : sectionIndex,
                lessons: rawLessons.map(function(lesson, lessonIndex) {
                    return normalizeEditorLesson(lesson, lessonIndex);
                })
            };
        });
    }

    function normalizeEditorLesson(lesson, lessonIndex) {
        const type = normalizeLessonType(lesson && lesson.type);
        const content = lesson && lesson.content && typeof lesson.content === 'object' ? lesson.content : {};
        const quiz = Array.isArray(lesson && lesson.quiz)
            ? lesson.quiz
            : Array.isArray(lesson && lesson.questions)
                ? lesson.questions
                : Array.isArray(content.questions)
                    ? content.questions
                    : [];

        return {
            _id: lesson && lesson._id ? String(lesson._id) : ('lesson-' + Date.now() + '-' + lessonIndex),
            title: String((lesson && lesson.title) || 'Untitled'),
            type: type,
            videoUrl: String((lesson && (lesson.videoUrl || lesson.preview)) || (content && content.videoUrl) || ''),
            preview: String((lesson && lesson.preview) || (lesson && lesson.videoUrl) || (content && content.videoUrl) || ''),
            refId: String((lesson && lesson.refId) || ''),
            content: content,
            pdf: lesson && lesson.pdf ? lesson.pdf : null,
            quiz: quiz,
            interactiveQuizzes: Array.isArray(lesson && lesson.interactiveQuizzes)
                ? lesson.interactiveQuizzes
                : Array.isArray(content && content.interactiveQuizzes)
                    ? content.interactiveQuizzes
                    : [],
            order: Number.isFinite(Number(lesson && lesson.order)) ? Number(lesson.order) : lessonIndex
        };
    }

    function normalizeLessonType(rawType) {
        const value = String(rawType || 'video').toLowerCase();
        return value === 'lecture' ? 'video' : value;
    }

    function hasSlideLessonSlides(lesson) {
        const content = lesson && lesson.content && typeof lesson.content === 'object' ? lesson.content : {};
        const slides = Array.isArray(content.slides)
            ? content.slides
            : Array.isArray(lesson && lesson.slides)
                ? lesson.slides
                : [];
        return slides.length > 0;
    }

    function hasSlideLessonPdf(lesson) {
        const content = lesson && lesson.content && typeof lesson.content === 'object' ? lesson.content : {};
        const pdf = content.pdf || (lesson && lesson.pdf);
        if (typeof pdf === 'string') return Boolean(pdf.trim());
        return Boolean(pdf && typeof pdf === 'object' && String(pdf.url || '').trim());
    }

    function getSlideLessonContentMode(lesson) {
        const hasSlides = hasSlideLessonSlides(lesson);
        const hasPdf = hasSlideLessonPdf(lesson);
        if (hasSlides && hasPdf) return 'hybrid';
        if (hasPdf) return 'pdf';
        if (hasSlides) return 'slides';
        return 'empty';
    }

    function getSlideLessonBadgeLabel(lesson) {
        const mode = getSlideLessonContentMode(lesson);
        if (mode === 'hybrid') return 'Slides + PDF';
        if (mode === 'pdf') return 'PDF';
        if (mode === 'slides') return 'Slides';
        return 'Empty';
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
        console.log('[CourseEditor] Clicked:', e.target);

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
        if (e.target.closest('#saveCourseBtn')) {
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
            const sectionCtx = resolveSectionContext(editSectionBtn);
            console.log('[CourseEditor] Editing section:', sectionCtx?.sectionCard);
            if (sectionCtx) {
                startInlineSectionRename(sectionCtx);
            }
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
            const sectionIndex = editItemBtn.dataset.sectionIndex;
            const lessonIndex = editItemBtn.dataset.lessonIndex;
            if (id && type) {
                editItem(type, id, sectionIndex, lessonIndex);
            }
            return;
        }

        // Handle delete item (trash icon)
        const deleteItemBtn = e.target.closest('.delete-item-btn, .lesson-item .fa-trash');
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
            const sectionCtx = resolveSectionContext(sectionTitle);
            console.log('[CourseEditor] Editing section:', sectionCtx?.sectionCard);
            if (sectionCtx) {
                startInlineSectionRename(sectionCtx);
            }
            return;
        }

        // Handle add buttons for redesigned and legacy markup.
        const addVideoBtn = e.target.closest('.add-video-btn, .add-item-btn[data-item-type="video"]');
        if (addVideoBtn) {
            const sectionCtx = resolveSectionContext(addVideoBtn);
            console.log('[CourseEditor] Add video clicked:', { sectionIndex: sectionCtx?.sectionIndex, sectionId: sectionCtx?.sectionId, button: addVideoBtn });
            if (sectionCtx) addVideo(sectionCtx);
            return;
        }

        const addSlideBtn = e.target.closest('.add-slide-btn, .add-item-btn[data-item-type="slide"]');
        if (addSlideBtn) {
            const sectionCtx = resolveSectionContext(addSlideBtn);
            console.log('[CourseEditor] Add slide clicked:', { sectionIndex: sectionCtx?.sectionIndex, sectionId: sectionCtx?.sectionId, button: addSlideBtn });
            if (sectionCtx) addSlide(sectionCtx);
            return;
        }

        const addQuizBtn = e.target.closest('.add-quiz-btn, .add-item-btn[data-item-type="quiz"]');
        if (addQuizBtn) {
            const sectionCtx = resolveSectionContext(addQuizBtn);
            console.log('[CourseEditor] Add quiz clicked:', { sectionIndex: sectionCtx?.sectionIndex, sectionId: sectionCtx?.sectionId, button: addQuizBtn });
            if (sectionCtx) addQuiz(sectionCtx);
            return;
        }

        // Handle library toggle button
        if (e.target.closest('.library-add-btn') || e.target.closest('.library-popup-header .close-btn') || e.target.closest('.library-drawer-backdrop')) {
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
        if (!header ||
            e.target.closest('.edit-section-btn') ||
            e.target.closest('.delete-section-btn') ||
            e.target.closest('.section-title') ||
            e.target.closest('.section-title-input')) {
            return;
        }

        const sectionCard = header.closest('.section-card');
        if (!sectionCard) return;

        const content = sectionCard.querySelector('.section-content');
        const icon = sectionCard.querySelector('.section-icon');

        console.log('[CourseEditor] Section toggle clicked:', { target: e.target, section: sectionCard });

        if (!content) return;

        const isOpen = !sectionCard.classList.contains('is-collapsed');
        sectionCard.classList.toggle('is-collapsed', isOpen);

        updateSectionContentHeight(sectionCard, !isOpen);

        if (icon) {
            icon.classList.toggle('fa-chevron-down', !isOpen);
            icon.classList.toggle('fa-chevron-right', isOpen);
        }
    }

    function resolveSectionContext(triggerEl) {
        const sectionCard = triggerEl?.closest('.section-card');
        if (!sectionCard) return null;

        const sectionId = (sectionCard.dataset.sectionId || '').trim() || null;
        const cards = Array.from(document.querySelectorAll('.section-card'));
        const domIndex = cards.indexOf(sectionCard);

        let sectionIndex = domIndex;

        if (sectionId) {
            const stateIndex = courseData.findIndex((section) => String(section._id) === String(sectionId));
            if (stateIndex !== -1) {
                sectionIndex = stateIndex;
            }
        }

        if (sectionIndex < 0 || sectionIndex >= courseData.length) {
            const dataIndex = parseInt(sectionCard.dataset.sectionIndex || '', 10);
            if (!Number.isNaN(dataIndex)) {
                sectionIndex = dataIndex;
            }
        }

        if (sectionIndex < 0) {
            console.warn('[CourseEditor] Could not resolve section context:', { triggerEl, sectionCard, sectionId, sectionIndex });
            return null;
        }

        const fallbackStateId = courseData[sectionIndex]?._id ? String(courseData[sectionIndex]._id) : null;
        const resolvedSectionId = sectionId || fallbackStateId;

        if (!resolvedSectionId) {
            console.warn('[CourseEditor] Could not resolve section context:', { triggerEl, sectionCard, sectionId, sectionIndex });
        }

        return {
            sectionCard,
            sectionId: resolvedSectionId,
            sectionIndex
        };
    }

    // ==================== SECTION FUNCTIONS ====================
    async function addSection() {
        const modalEl = document.getElementById('addSectionModal');
        if (!modalEl || !window.bootstrap) {
            showToast('Modal environment not loaded. Please refresh.', 'danger');
            return;
        }

        const modal = window.bootstrap.Modal.getInstance(modalEl) || new window.bootstrap.Modal(modalEl, { keyboard: true });
        const form = document.getElementById('addSectionForm');
        const input = document.getElementById('addSectionTitle');
        const submitBtn = document.getElementById('addSectionSubmitBtn');

        input.value = '';
        input.classList.remove('is-invalid');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Create Section';
        
        modal.show();

        const handleSubmit = async () => {
            const title = input.value.trim();
            if (!title) {
                input.classList.add('is-invalid');
                return;
            }

            input.classList.remove('is-invalid');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Creating...';

            try {
                const res = await fetch('/api/admin/section', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ courseId, title })
                });
                const data = await res.json();
                if (!res.ok || !data.success || !data.section) throw new Error(data.error || 'Failed to add section');
                
                modal.hide();
                location.reload();
            } catch (err) {
                showToast(err.message || 'Failed to add section', 'danger');
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Create Section';
            }
        };

        submitBtn.onclick = handleSubmit;
        form.onsubmit = (e) => {
            e.preventDefault();
            handleSubmit();
        };

        modalEl.addEventListener('shown.bs.modal', () => input.focus(), { once: true });
    }

    async function editSection(sectionCtx, newTitle) {
        const trimmedTitle = String(newTitle || '').trim();
        if (!trimmedTitle) return;

        const { sectionIndex, sectionId, sectionCard } = sectionCtx;

        try {
            const res = await fetch(`/api/admin/section/${courseId}/${sectionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: trimmedTitle
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to update section title');
            }

            if (courseData[sectionIndex]) {
                courseData[sectionIndex].title = trimmedTitle;
            }

            const titleEl = sectionCard?.querySelector('.section-title') || document.getElementById('title-' + sectionId);
            if (titleEl) titleEl.textContent = trimmedTitle;
        } catch {
            showToast('Failed to update section title', 'danger');
        }
    }

    function startInlineSectionRename(sectionCtx) {
        const titleEl = sectionCtx.sectionCard?.querySelector('.section-title');
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
                await editSection(sectionCtx, nextTitle);
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
        const section = getSectionState(sectionId);
        const sectionTitle = getSectionDisplayTitle(section);
        const lessonCount = Array.isArray(section && section.lessons) ? section.lessons.length : 0;
        const confirmed = await window.showConfirmModal({
            title: 'Delete Section',
            message: `Delete section "${sectionTitle}"? This will remove ${lessonCount} lesson${lessonCount === 1 ? '' : 's'}.`,
            warning: 'This action cannot be undone.',
            confirmText: 'Delete Section',
            confirmingText: 'Deleting...',
            variant: 'danger',
            onConfirm: async function() {
                const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
                const res = await fetcher(`/api/admin/section/${courseId}/${sectionId}`, {
                    method: 'DELETE'
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete section');
            }
        });
        if (!confirmed) return;
        showToast('Section deleted.', 'success');
        window.setTimeout(function() {
            location.reload();
        }, 220);
    }

    async function _saveCourseOrder(sections) {
        try {
            const res = await fetch('/api/admin/section/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId,
                    sectionOrder: sections.map(function(section) { return section._id; })
                })
            });
            const data = await res.json();
            if (data.success) {
                location.reload();
            }
        } catch {
            showToast('Failed to save', 'danger');
        }
    }

    // ==================== ITEM FUNCTIONS ====================
    async function addVideo(sectionCtx) {
        openAddItemModal('video', sectionCtx);
    }

    async function addSlide(sectionCtx) {
        openAddItemModal('slide', sectionCtx);
    }

    async function addQuiz(sectionCtx) {
        openAddItemModal('quiz', sectionCtx);
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

    function openAddItemModal(type, sectionCtx) {
        if (!addItemModal) return;

        addItemState.type = type;
        addItemState.sectionId = sectionCtx?.sectionId || null;
        addItemState.sectionIndex = parseInt(sectionCtx?.sectionIndex, 10);

        console.log('[CourseEditor] Section ID:', addItemState.sectionId);

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
                endpoint: '/api/admin/lesson',
                method: 'POST',
                payload: {
                    courseId,
                    sectionId: addItemState.sectionId,
                    title: name,
                    videoUrl: url,
                    preview: url,
                    description: document.getElementById('addItemDescription') ? document.getElementById('addItemDescription').value.trim() : '',
                    type: 'video'
                }
            },
            slide: {
                endpoint: '/api/admin/lesson',
                method: 'POST',
                payload: {
                    courseId,
                    sectionId: addItemState.sectionId,
                    title: name,
                    description: document.getElementById('addItemDescription') ? document.getElementById('addItemDescription').value.trim() : '',
                    type: 'slide'
                }
            },
            quiz: {
                endpoint: '/api/admin/lesson',
                method: 'POST',
                payload: {
                    courseId,
                    sectionId: addItemState.sectionId,
                    title: name,
                    description: document.getElementById('addItemDescription') ? document.getElementById('addItemDescription').value.trim() : '',
                    type: 'quiz'
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

            if (!res.ok || !data.success || !data.lesson) {
                showAddItemError(data.error || `Unable to create ${addItemState.type}. Please try again.`);
                return;
            }

            const section = getSectionState(addItemState.sectionId, addItemState.sectionIndex);
            if (section && Array.isArray(section.lessons)) {
                const localItem = normalizeEditorLesson({
                    ...(data.lesson || {}),
                    videoUrl: addItemState.type === 'video' ? url : '',
                    preview: addItemState.type === 'video' ? url : '',
                    content: addItemState.type === 'video'
                        ? { ...((data.lesson && data.lesson.content) || {}), videoUrl: url }
                        : (data.lesson && data.lesson.content) || {}
                }, section.lessons.length);

                section.lessons.push(localItem);
                addItemState.sectionIndex = courseData.findIndex((s) => s === section);
                console.log('[CourseEditor] canonical section after add:', section);
                renderSections();
                refreshExpandedSectionHeights();
            } else {
                showAddItemError('Unable to resolve section state for this item. Please refresh and try again.');
                return;
            }

            addItemModal.hide();
        } catch {
            showAddItemError('Network error while creating item. Please try again.');
        } finally {
            setAddItemLoading(false);
        }
    }

    function renderSections() {
        const sectionCards = Array.from(document.querySelectorAll('.section-card'));

        sectionCards.forEach((card) => {
            const sectionCtx = resolveSectionContext(card);
            if (!sectionCtx) return;

            const section = courseData[sectionCtx.sectionIndex];
            if (!section) return;

            card.dataset.sectionIndex = String(sectionCtx.sectionIndex);

            const titleEl = card.querySelector('.section-title');
            if (titleEl) {
                titleEl.textContent = section.title || 'Untitled Section';
                titleEl.dataset.sectionIndex = String(sectionCtx.sectionIndex);
            }

            renderSectionItems(sectionCtx.sectionIndex, section, card);

            if (!card.classList.contains('is-collapsed')) {
                updateSectionContentHeight(card, true);
            }
        });

        initSortable();
    }

    function getSectionState(sectionId, sectionIndex) {
        if (sectionId) {
            const byId = courseData.find((section) => String(section._id) === String(sectionId));
            if (byId) return byId;
        }

        if (Number.isInteger(sectionIndex) && sectionIndex >= 0 && sectionIndex < courseData.length) {
            return courseData[sectionIndex];
        }

        return null;
    }

    function getSectionDisplayTitle(section) {
        return formatLessonTitle(section && section.title ? section.title : 'Untitled Section') || 'Untitled Section';
    }

    function getLessonTypeLabel(type) {
        const normalized = String(type || 'video').toLowerCase();
        if (normalized === 'quiz') return 'Quiz';
        if (normalized === 'slide') return 'Slide';
        return 'Lesson';
    }

    function getLessonDisplayTitle(lesson) {
        return formatLessonTitle(lesson && lesson.title ? lesson.title : 'Untitled Lesson') || 'Untitled Lesson';
    }

    function renderSectionItems(sectionIndex, section, sectionCard) {
        const list = sectionCard.querySelector('.lesson-list');
        if (!list) return;

        list.dataset.sectionIndex = String(sectionIndex);
        list.dataset.sectionId = String(section._id || '');
        list.innerHTML = (section.lessons || []).map((video, vIndex) => buildLessonItemMarkup(video, section, sectionIndex, vIndex)).join('');
    }

    function buildLessonItemMarkup(video, section, sectionIndex, lessonIndex) {
        const rawType = String(video.type || 'video').toLowerCase();
        const type = rawType === 'lecture' ? 'video' : rawType;
        const icon = type === 'video' ? 'fa-play' : type === 'slide' ? 'fa-file-alt' : type === 'quiz' ? 'fa-question' : 'fa-play';
        const itemLabel = type === 'video' ? 'Lecture' : type === 'quiz' ? 'Quiz' : type === 'slide' ? 'Slide' : 'Lecture';
        const displayTitle = formatLessonTitle(video.title || 'Untitled');
        const slideBadge = type === 'slide' ? getSlideLessonBadgeLabel(video) : '';

        return `
            <div class="lesson-item"
                 data-item-id="${video._id || ''}"
                 data-section-id="${section._id || ''}"
                 data-section-index="${sectionIndex}"
                 data-lesson-index="${lessonIndex}"
                 data-order="${lessonIndex}"
                 data-type="${type}"
                 data-name="${escapeAttribute(video.title || '')}"
                 data-url="${escapeAttribute(video.preview || video.videoUrl || video.refId || '')}"
                 data-ref-id="${escapeAttribute(video.refId || '')}">
                <span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
                <div class="item-icon ${type}">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="item-info">
                    <div class="item-title">${escapeHtml(displayTitle || 'Untitled')}</div>
                    <div class="item-meta">${itemLabel}${slideBadge ? ' - ' + escapeHtml(slideBadge) : ''}</div>
                </div>
                <div class="item-actions">
                    <button class="edit-btn editor-inline-action" type="button" data-id="${escapeAttribute(video._id || '')}" data-type="${type}" data-section-index="${sectionIndex}" data-lesson-index="${lessonIndex}" title="Edit ${itemLabel}">
                        <i class="fa-solid fa-pen-to-square"></i>
                        <span>Edit</span>
                    </button>
                    <button class="delete-item-btn editor-inline-action editor-inline-action-danger" type="button" title="Delete ${itemLabel}">
                        <i class="fa-solid fa-trash"></i>
                        <span>Delete</span>
                    </button>
                </div>
            </div>
        `;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function formatLessonTitle(value) {
        if (typeof window.stripLessonFileExtension === 'function') {
            return window.stripLessonFileExtension(value);
        }
        return String(value || '').trim();
    }

    function editItem(type, id, sectionIndex, lessonIndex) {
        if (sectionIndex === undefined || lessonIndex === undefined) {
            showToast('Item not found. Please reload.', 'warning');
            return;
        }
        
        if (type === 'video') {
            window.location.href = `/admin/courses/${courseId}/video-settings?section=${sectionIndex}&lesson=${lessonIndex}`;
        } else if (type === 'slide') {
            window.location.href = `/admin/courses/${courseId}/slide-editor?section=${sectionIndex}&lesson=${lessonIndex}`;
        } else if (type === 'quiz') {
            window.location.href = `/admin/course/${courseId}/quiz/${sectionIndex}/${lessonIndex}`;
        }
    }

    async function deleteItem(sectionId, itemId) {
        const section = getSectionState(sectionId);
        const lesson = Array.isArray(section && section.lessons)
            ? section.lessons.find(function(entry) { return String(entry && entry._id) === String(itemId); })
            : null;
        const itemLabel = getLessonTypeLabel(lesson && lesson.type);
        const itemTitle = getLessonDisplayTitle(lesson);
        const confirmed = await window.showConfirmModal({
            title: 'Delete ' + itemLabel,
            message: `Delete ${itemLabel.toLowerCase()} "${itemTitle}"?`,
            warning: 'This action cannot be undone.',
            confirmText: 'Delete ' + itemLabel,
            confirmingText: 'Deleting...',
            variant: 'danger',
            onConfirm: async function() {
                const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
                const res = await fetcher(`/api/admin/lesson/${courseId}/${sectionId}/${itemId}`, {
                    method: 'DELETE'
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
            }
        });
        if (!confirmed) return;

        courseData = courseData.map(function(sectionEntry) {
            if (String(sectionEntry._id) !== String(sectionId)) return sectionEntry;
            return {
                ...sectionEntry,
                lessons: (sectionEntry.lessons || []).filter(function(entry) { return String(entry._id) !== String(itemId); })
            };
        });
        renderSections();
        showToast(itemLabel + ' deleted.', 'success');
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
            fetchSlideData(sectionIndex, lessonIndex);
            setupSaveLessonHandler();
        } else if (type === 'quiz') {
            editorContent.innerHTML = buildQuizEditorHTML(sectionIndex, lessonIndex, itemId, itemName);
            setupSaveLessonHandler();
        }
    }

    function buildVideoEditorHTML(sectionIndex, lessonIndex, itemId, itemName) {
        return `
            <div class="card editor-card-shell">
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
                    <div class="editor-card-actions">
                        <button class="btn btn-primary save-lesson-btn" type="button">
                            <i class="fas fa-save"></i> Save Changes
                        </button>
                        <a href="/admin/courses/${courseId}/video-settings?section=${sectionIndex}&lesson=${lessonIndex}" class="btn btn-outline-primary">
                            <i class="fa-solid fa-clock me-1"></i> Advanced Video Settings
                        </a>
                    </div>
                </div>
            </div>
        `;
    }

    function buildSlideEditorHTML(sectionIndex, lessonIndex, itemId, itemName) {
        return `
            <div class="card editor-card-shell">
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
                        <div class="small text-muted mb-2">Upload a PDF to use it as a lesson document. Learners will view it directly in the course player.</div>
                        <div class="border rounded-3 p-3" id="slide-pdf-meta-card">
                            <div class="d-flex justify-content-between align-items-start gap-3">
                                <div class="min-w-0">
                                    <div class="fw-semibold">Lesson document</div>
                                    <div class="small text-truncate" id="slide-pdf-name">No PDF uploaded</div>
                                </div>
                                <span class="badge text-bg-secondary" id="slide-pdf-badge">No PDF</span>
                            </div>
                            <div class="small text-muted mt-2" id="slide-pdf-details">Upload a PDF to attach a learner-facing document.</div>
                            <div class="d-flex flex-wrap gap-2 mt-3">
                                <button class="btn btn-outline-danger import-pdf-btn" type="button" data-section-index="${sectionIndex}" data-lesson-index="${lessonIndex}">
                                    <i class="fa-regular fa-file-pdf"></i> Import PDF
                                </button>
                                <a class="btn btn-outline-secondary d-none" id="slide-view-pdf-btn" href="#" target="_blank" rel="noopener">
                                    <i class="fa-regular fa-eye"></i> View PDF
                                </a>
                                <button class="btn btn-outline-secondary d-none" id="slide-remove-pdf-btn" type="button" data-section-index="${sectionIndex}" data-lesson-index="${lessonIndex}">
                                    <i class="fa-regular fa-trash-can"></i> Remove PDF
                                </button>
                            </div>
                            <div class="small mt-2" id="slide-pdf-status" aria-live="polite"></div>
                        </div>
                        <input type="file" id="slide-pdf-upload-input" class="d-none" accept="application/pdf,.pdf">
                    </div>
                    <div class="editor-card-actions">
                        <button class="btn btn-primary save-lesson-btn" type="button">
                            <i class="fas fa-save"></i> Save Changes
                        </button>
                        <a href="/admin/courses/${courseId}/slide-editor?section=${sectionIndex}&lesson=${lessonIndex}" class="btn btn-outline-secondary">
                            <i class="fas fa-edit"></i> Advanced Edit
                        </a>
                    </div>
                </div>
            </div>
        `;
    }

    function buildQuizEditorHTML(sectionIndex, lessonIndex, itemId, itemName) {
        return `
            <div class="card editor-card-shell">
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
                    <div class="editor-card-actions">
                        <button class="btn btn-primary save-lesson-btn" type="button">
                            <i class="fas fa-save"></i> Save Changes
                        </button>
                        
                        <a href="/admin/course/${courseId}/quiz/${sectionIndex}/${lessonIndex}" class="btn btn-outline-primary">
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

        const importPdfBtn = document.querySelector('.import-pdf-btn');
        const pdfInput = document.getElementById('slide-pdf-upload-input');
        const removePdfBtn = document.getElementById('slide-remove-pdf-btn');
        if (importPdfBtn && pdfInput) {
            importPdfBtn.addEventListener('click', function() {
                pdfInput.value = '';
                pdfInput.click();
            });
            pdfInput.addEventListener('change', handleSlidePdfSelection);
        }
        if (removePdfBtn) {
            removePdfBtn.addEventListener('click', removeSlidePdf);
        }

        const addQuizBtn = document.getElementById('interactiveQuizAddBtn');
        if (addQuizBtn) {
            addQuizBtn.addEventListener('click', upsertInteractiveQuizFromForm);
        }

        const resetQuizBtn = document.getElementById('interactiveQuizResetBtn');
        if (resetQuizBtn) {
            resetQuizBtn.addEventListener('click', resetInteractiveQuizForm);
        }

        const quizList = document.getElementById('interactiveQuizList');
        if (quizList) {
            quizList.addEventListener('click', handleInteractiveQuizListAction);
        }
    }

    function parseTimestampToSeconds(rawValue) {
        const value = String(rawValue || '').trim();
        if (!value) return 0;

        if (/^\d+$/.test(value)) {
            return Math.max(0, parseInt(value, 10));
        }

        const parts = value.split(':').map((part) => part.trim());
        if (parts.length === 2) {
            const minutes = parseInt(parts[0], 10);
            const seconds = parseInt(parts[1], 10);
            if (!Number.isNaN(minutes) && !Number.isNaN(seconds)) {
                return Math.max(0, (minutes * 60) + seconds);
            }
        }

        return 0;
    }

    function formatSeconds(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }

    function normalizeInteractiveQuizDraft(quizzes) {
        const source = Array.isArray(quizzes) ? quizzes : [];
        return source
            .map((entry, index) => {
                const rawOptions = Array.isArray(entry && entry.options) ? entry.options : [];
                const options = rawOptions.map((opt) => String(opt || '').trim()).slice(0, 4);
                while (options.length < 4) options.push('');

                const normalized = {
                    triggerTimeSec: parseTimestampToSeconds(entry && entry.triggerTimeSec),
                    question: String(entry && entry.question || '').trim(),
                    options,
                    correctOptionIndex: Math.min(3, Math.max(0, Number(entry && entry.correctOptionIndex) || 0)),
                    explanation: String(entry && entry.explanation || '').trim(),
                    pauseOnShow: entry && entry.pauseOnShow === false ? false : true,
                    order: Number.isFinite(Number(entry && entry.order)) ? Number(entry.order) : index
                };

                const rawId = String((entry && entry._id) || '').trim();
                if (/^[a-fA-F0-9]{24}$/.test(rawId)) {
                    normalized._id = rawId;
                }

                return normalized;
            })
            .filter((entry) => entry.question)
            .sort((a, b) => {
                if (a.triggerTimeSec !== b.triggerTimeSec) return a.triggerTimeSec - b.triggerTimeSec;
                return a.order - b.order;
            })
            .map((entry, index) => ({ ...entry, order: index }));
    }

    function renderInteractiveQuizList() {
        const container = document.getElementById('interactiveQuizList');
        const countEl = document.getElementById('interactiveQuizCount');
        if (!container) return;

        interactiveQuizDraft = normalizeInteractiveQuizDraft(interactiveQuizDraft);
        if (countEl) countEl.textContent = String(interactiveQuizDraft.length);

        if (!interactiveQuizDraft.length) {
            container.innerHTML = '<div class="text-muted small">No timed quizzes yet.</div>';
            return;
        }

        container.innerHTML = interactiveQuizDraft.map((entry, idx) => {
            const correctText = entry.options[entry.correctOptionIndex] || ('Option ' + (entry.correctOptionIndex + 1));
            return '' +
                '<div class="interactive-quiz-item" data-quiz-index="' + idx + '">' +
                    '<div class="interactive-quiz-item-head">' +
                        '<div>' +
                            '<strong>' + escapeHtml(formatSeconds(entry.triggerTimeSec)) + '</strong>' +
                            '<span class="badge bg-light text-dark ms-2">Correct: ' + escapeHtml(correctText) + '</span>' +
                        '</div>' +
                        '<div class="d-flex gap-1">' +
                            '<button type="button" class="btn btn-sm btn-outline-secondary" data-iq-action="up" data-iq-index="' + idx + '">↑</button>' +
                            '<button type="button" class="btn btn-sm btn-outline-secondary" data-iq-action="down" data-iq-index="' + idx + '">↓</button>' +
                            '<button type="button" class="btn btn-sm btn-outline-primary" data-iq-action="edit" data-iq-index="' + idx + '">Edit</button>' +
                            '<button type="button" class="btn btn-sm btn-outline-danger" data-iq-action="delete" data-iq-index="' + idx + '">Delete</button>' +
                        '</div>' +
                    '</div>' +
                    '<p class="mb-1 mt-2"><strong>Q:</strong> ' + escapeHtml(entry.question) + '</p>' +
                    '<div class="small text-muted">' + escapeHtml(entry.explanation || 'No explanation') + '</div>' +
                '</div>';
        }).join('');
    }

    function resetInteractiveQuizForm() {
        const editIndexEl = document.getElementById('interactiveQuizEditIndex');
        const tsEl = document.getElementById('interactiveQuizTimestamp');
        const questionEl = document.getElementById('interactiveQuizQuestion');
        const correctEl = document.getElementById('interactiveQuizCorrectIndex');
        const explanationEl = document.getElementById('interactiveQuizExplanation');
        const pauseEl = document.getElementById('interactiveQuizPauseOnShow');
        const addBtn = document.getElementById('interactiveQuizAddBtn');

        if (editIndexEl) editIndexEl.value = '-1';
        if (tsEl) tsEl.value = '';
        if (questionEl) questionEl.value = '';
        if (correctEl) correctEl.value = '0';
        if (explanationEl) explanationEl.value = '';
        if (pauseEl) pauseEl.checked = true;
        if (addBtn) addBtn.textContent = 'Add Quiz';

        document.querySelectorAll('.interactiveQuizOption').forEach((input) => {
            input.value = '';
        });
    }

    function upsertInteractiveQuizFromForm() {
        const editIndexEl = document.getElementById('interactiveQuizEditIndex');
        const tsEl = document.getElementById('interactiveQuizTimestamp');
        const questionEl = document.getElementById('interactiveQuizQuestion');
        const correctEl = document.getElementById('interactiveQuizCorrectIndex');
        const explanationEl = document.getElementById('interactiveQuizExplanation');
        const pauseEl = document.getElementById('interactiveQuizPauseOnShow');

        const triggerTimeSec = parseTimestampToSeconds(tsEl && tsEl.value);
        const question = String(questionEl && questionEl.value || '').trim();
        const correctOptionIndex = Math.min(3, Math.max(0, Number(correctEl && correctEl.value) || 0));
        const explanation = String(explanationEl && explanationEl.value || '').trim();
        const pauseOnShow = Boolean(pauseEl && pauseEl.checked);
        const options = Array.from(document.querySelectorAll('.interactiveQuizOption')).map((input) => String(input.value || '').trim());

        if (!question) {
            showToast('Please enter a question for the timed quiz.', 'warning');
            return;
        }

        if (options.filter(Boolean).length < 4) {
            showToast('Please fill all 4 answer options.', 'warning');
            return;
        }

        const editIndex = Number(editIndexEl && editIndexEl.value);
        const entry = {
            _id: editIndex >= 0 && interactiveQuizDraft[editIndex]
                ? interactiveQuizDraft[editIndex]._id
                : ('draft-' + Date.now()),
            triggerTimeSec,
            question,
            options: options.slice(0, 4),
            correctOptionIndex,
            explanation,
            pauseOnShow,
            order: editIndex >= 0 ? editIndex : interactiveQuizDraft.length
        };

        if (editIndex >= 0 && interactiveQuizDraft[editIndex]) {
            interactiveQuizDraft[editIndex] = entry;
        } else {
            interactiveQuizDraft.push(entry);
        }

        renderInteractiveQuizList();
        resetInteractiveQuizForm();
    }

    function loadInteractiveQuizIntoForm(index) {
        const entry = interactiveQuizDraft[index];
        if (!entry) return;

        const editIndexEl = document.getElementById('interactiveQuizEditIndex');
        const tsEl = document.getElementById('interactiveQuizTimestamp');
        const questionEl = document.getElementById('interactiveQuizQuestion');
        const correctEl = document.getElementById('interactiveQuizCorrectIndex');
        const explanationEl = document.getElementById('interactiveQuizExplanation');
        const pauseEl = document.getElementById('interactiveQuizPauseOnShow');
        const addBtn = document.getElementById('interactiveQuizAddBtn');

        if (editIndexEl) editIndexEl.value = String(index);
        if (tsEl) tsEl.value = formatSeconds(entry.triggerTimeSec);
        if (questionEl) questionEl.value = entry.question;
        if (correctEl) correctEl.value = String(entry.correctOptionIndex);
        if (explanationEl) explanationEl.value = entry.explanation || '';
        if (pauseEl) pauseEl.checked = entry.pauseOnShow !== false;
        if (addBtn) addBtn.textContent = 'Update Quiz';

        document.querySelectorAll('.interactiveQuizOption').forEach((input, idx) => {
            input.value = entry.options[idx] || '';
        });
    }

    function handleInteractiveQuizListAction(e) {
        const actionBtn = e.target.closest('[data-iq-action]');
        if (!actionBtn) return;

        const action = actionBtn.dataset.iqAction;
        const index = Number(actionBtn.dataset.iqIndex);
        if (!Number.isFinite(index) || !interactiveQuizDraft[index]) return;

        if (action === 'edit') {
            loadInteractiveQuizIntoForm(index);
            return;
        }

        if (action === 'delete') {
            interactiveQuizDraft.splice(index, 1);
            renderInteractiveQuizList();
            resetInteractiveQuizForm();
            return;
        }

        if (action === 'up' && index > 0) {
            const moved = interactiveQuizDraft.splice(index, 1)[0];
            interactiveQuizDraft.splice(index - 1, 0, moved);
            renderInteractiveQuizList();
            return;
        }

        if (action === 'down' && index < interactiveQuizDraft.length - 1) {
            const moved = interactiveQuizDraft.splice(index, 1)[0];
            interactiveQuizDraft.splice(index + 1, 0, moved);
            renderInteractiveQuizList();
        }
    }

    async function fetchVideoData(sectionIndex, lessonIndex) {
        try {
            const res = await fetch(`/admin/course/${courseId}/lesson/${sectionIndex}/${lessonIndex}`);
            const data = await res.json();

            const lesson = data && (data.lesson || data.video) ? (data.lesson || data.video) : null;
            const resolvedUrl = lesson
                ? String(
                    lesson.preview ||
                    (lesson.content && lesson.content.videoUrl) ||
                    lesson.videoUrl ||
                    lesson.refId ||
                    ''
                )
                : '';

            const urlInput = document.getElementById('lesson-url');
            if (urlInput) {
                urlInput.value = resolvedUrl;
            }

            const lessonForInteractive = data.lesson || data.video || {};
            const contentInteractive = Array.isArray(lessonForInteractive && lessonForInteractive.content && lessonForInteractive.content.interactiveQuizzes)
                ? lessonForInteractive.content.interactiveQuizzes
                : [];
            const rootInteractive = Array.isArray(lessonForInteractive && lessonForInteractive.interactiveQuizzes)
                ? lessonForInteractive.interactiveQuizzes
                : [];

            interactiveQuizDraft = normalizeInteractiveQuizDraft(contentInteractive.length ? contentInteractive : rootInteractive);
            renderInteractiveQuizList();
            resetInteractiveQuizForm();
        } catch {
            // Silently fail - user can still enter URL manually
            interactiveQuizDraft = [];
            renderInteractiveQuizList();
            resetInteractiveQuizForm();
        }
    }

    function normalizePdfMeta(pdf) {
        if (!pdf || typeof pdf !== 'object') return null;
        const url = String(pdf.url || '').trim();
        if (!url) return null;
        return {
            url: url,
            filename: String(pdf.filename || '').trim(),
            originalName: String(pdf.originalName || '').trim(),
            size: Number(pdf.size) || 0,
            mimeType: String(pdf.mimeType || '').trim() || 'application/pdf',
            uploadedAt: pdf.uploadedAt || null
        };
    }

    function formatPdfSize(bytes) {
        const size = Number(bytes) || 0;
        if (!size) return '';
        if (size < 1024 * 1024) return Math.round(size / 1024) + ' KB';
        return (size / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function getCurrentEditorLesson() {
        const sectionIndex = parseInt(document.getElementById('lesson-section-index')?.value, 10);
        const lessonIndex = parseInt(document.getElementById('lesson-index')?.value, 10);
        if (Number.isNaN(sectionIndex) || Number.isNaN(lessonIndex)) return null;
        return courseData[sectionIndex] && courseData[sectionIndex].lessons
            ? courseData[sectionIndex].lessons[lessonIndex]
            : null;
    }

    function setSlidePdfStatus(message, tone) {
        const statusEl = document.getElementById('slide-pdf-status');
        if (!statusEl) return;
        statusEl.textContent = String(message || '');
        statusEl.className = 'small mt-2';
        if (tone === 'error') statusEl.classList.add('text-danger');
        if (tone === 'success') statusEl.classList.add('text-success');
        if (tone === 'loading') statusEl.classList.add('text-muted');
    }

    function renderSlidePdfMeta(pdf) {
        const normalized = normalizePdfMeta(pdf);
        const lesson = getCurrentEditorLesson();
        const mode = lesson && normalizeLessonType(lesson.type) === 'slide' ? getSlideLessonContentMode(lesson) : (normalized ? 'pdf' : 'empty');
        const nameEl = document.getElementById('slide-pdf-name');
        const badgeEl = document.getElementById('slide-pdf-badge');
        const detailsEl = document.getElementById('slide-pdf-details');
        const viewBtn = document.getElementById('slide-view-pdf-btn');
        const removeBtn = document.getElementById('slide-remove-pdf-btn');
        const importBtn = document.querySelector('.import-pdf-btn');

        if (nameEl) nameEl.textContent = normalized ? (normalized.originalName || 'PDF document') : 'No PDF uploaded';
        if (badgeEl) {
            badgeEl.textContent = mode === 'hybrid' ? 'Slides + PDF' : normalized ? 'PDF' : 'No PDF';
            badgeEl.className = normalized ? 'badge text-bg-danger' : 'badge text-bg-secondary';
        }
        if (detailsEl) {
            const parts = [];
            if (normalized && normalized.mimeType) parts.push(normalized.mimeType);
            if (normalized && normalized.size) parts.push(formatPdfSize(normalized.size));
            detailsEl.textContent = normalized
                ? ((mode === 'hybrid' ? 'Learners can view both Slides and PDF. ' : '') + (parts.join(' - ') || 'PDF attached to this lesson.'))
                : 'Upload a PDF to attach a learner-facing document.';
        }
        if (viewBtn) {
            viewBtn.classList.toggle('d-none', !normalized);
            viewBtn.href = normalized ? normalized.url : '#';
        }
        if (removeBtn) removeBtn.classList.toggle('d-none', !normalized);
        if (importBtn) {
            importBtn.innerHTML = normalized
                ? '<i class="fa-regular fa-file-pdf"></i> Replace PDF'
                : '<i class="fa-regular fa-file-pdf"></i> Import PDF';
        }
    }

    async function fetchSlideData(sectionIndex, lessonIndex) {
        try {
            const res = await fetch(`/admin/course/${courseId}/lesson/${sectionIndex}/${lessonIndex}`);
            const data = await res.json();
            const pdf = normalizePdfMeta(data && data.lesson && data.lesson.content ? data.lesson.content.pdf : null);
            const lesson = courseData[sectionIndex] && courseData[sectionIndex].lessons
                ? courseData[sectionIndex].lessons[lessonIndex]
                : null;
            if (lesson) {
                lesson.content = lesson.content || {};
                if (pdf) lesson.content.pdf = pdf;
                else delete lesson.content.pdf;
            }
            renderSlidePdfMeta(pdf);
            setSlidePdfStatus('', '');
        } catch {
            renderSlidePdfMeta(null);
        }
    }

    async function handleSlidePdfSelection(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (String(file.type || '').toLowerCase() !== 'application/pdf') {
            setSlidePdfStatus('Only PDF files are allowed.', 'error');
            return;
        }

        const sectionIndex = document.getElementById('lesson-section-index')?.value;
        const lessonIndex = document.getElementById('lesson-index')?.value;
        const importBtn = document.querySelector('.import-pdf-btn');
        if (importBtn) importBtn.disabled = true;
        setSlidePdfStatus('Uploading PDF...', 'loading');

        const formData = new FormData();
        formData.append('pdf', file);

        try {
            const csrfFetch = typeof window.csrfFetch === 'function' ? window.csrfFetch.bind(window) : window.fetch.bind(window);
            const response = await csrfFetch(`/admin/slides/${encodeURIComponent(courseId)}/${encodeURIComponent(sectionIndex)}/${encodeURIComponent(lessonIndex)}/import-pdf`, {
                method: 'POST',
                body: formData,
                credentials: 'same-origin',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            const data = await response.json();
            if (!response.ok || !data.success || !data.pdf) {
                throw new Error(data && data.error ? data.error : 'Failed to import PDF.');
            }

            const lesson = getCurrentEditorLesson();
            if (lesson) {
                lesson.content = lesson.content || {};
                lesson.content.pdf = normalizePdfMeta(data.pdf);
            }
            renderSlidePdfMeta(data.pdf);
            setSlidePdfStatus('PDF imported successfully. Save Changes keeps the lesson title in sync.', 'success');
        } catch (error) {
            setSlidePdfStatus(error.message || 'Failed to import PDF.', 'error');
        } finally {
            if (importBtn) importBtn.disabled = false;
        }
    }

    async function removeSlidePdf() {
        const sectionIndex = document.getElementById('lesson-section-index')?.value;
        const lessonIndex = document.getElementById('lesson-index')?.value;
        const removeBtn = document.getElementById('slide-remove-pdf-btn');
        const lesson = getCurrentEditorLesson();
        if (lesson && !hasSlideLessonSlides(lesson)) {
            setSlidePdfStatus('Add at least one slide before removing the PDF.', 'error');
            return;
        }
        if (removeBtn) removeBtn.disabled = true;
        setSlidePdfStatus('Removing PDF...', 'loading');

        try {
            const csrfFetch = typeof window.csrfFetch === 'function' ? window.csrfFetch.bind(window) : window.fetch.bind(window);
            const response = await csrfFetch(`/admin/slides/${encodeURIComponent(courseId)}/${encodeURIComponent(sectionIndex)}/${encodeURIComponent(lessonIndex)}/pdf`, {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data && data.error ? data.error : 'Failed to remove PDF.');
            }
            const lesson = getCurrentEditorLesson();
            if (lesson && lesson.content) delete lesson.content.pdf;
            renderSlidePdfMeta(null);
            setSlidePdfStatus('PDF removed.', 'success');
        } catch (error) {
            setSlidePdfStatus(error.message || 'Failed to remove PDF.', 'error');
        } finally {
            if (removeBtn) removeBtn.disabled = false;
        }
    }

    async function saveLesson() {
        const sectionIndex = document.getElementById('lesson-section-index')?.value;
        const lessonIndex = document.getElementById('lesson-index')?.value;
        const name = document.getElementById('lesson-name')?.value;
        const url = document.getElementById('lesson-url')?.value;
        
        try {
            const csrfFetch = typeof window.csrfFetch === 'function' ? window.csrfFetch.bind(window) : window.fetch.bind(window);
            const res = await csrfFetch(`/admin/course/${courseId}/lesson/edit`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    sectionIndex: parseInt(sectionIndex),
                    lessonIndex: parseInt(lessonIndex),
                    name: name,
                    url: url,
                    interactiveQuizzes: normalizeInteractiveQuizDraft(interactiveQuizDraft)
                })
            });
            
            if (res.ok) {
                showToast('Saved successfully!', 'success');
                location.reload();
            } else {
                showToast('Failed to save', 'danger');
            }
        } catch (err) {
            showToast('Error occurred: ' + err.message, 'danger');
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

        const sectionId = lessonList.dataset.sectionId;
        let itemId = e.dataTransfer.getData('id');
        let itemType = e.dataTransfer.getData('type');

        const data = e.dataTransfer.getData('application/json');
        if ((!itemId || !itemType) && data) {
            const item = JSON.parse(data);
            if (item && item.fromLibrary) {
                itemId = item.id;
                itemType = item.type;
            }
        }

        if (!itemId || !itemType) {
            showToast('Invalid library item data.', 'danger');
            return;
        }

        await addItemToSection(sectionId, itemType, itemId);
    }

    function hasLibraryPayload(e) {
        if (!e || !e.dataTransfer || !e.dataTransfer.types) return false;
        const types = Array.from(e.dataTransfer.types);
        return types.includes('application/json') || (types.includes('id') && types.includes('type'));
    }

    async function addItemToSection(sectionId, type, refId) {
        try {
            const normalizedType = type === 'lesson' ? 'video' : type;
            const res = await fetch('/api/admin/course/add-item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId,
                    sectionId,
                    type: normalizedType,
                    refId
                })
            });
            const data = await res.json();
            if (!data.success) {
                console.error('[CourseEditor] Failed to add library item', data);
                showToast('Failed to add item', 'danger');
                return;
            }
            location.reload();
        } catch {
            showToast('Failed to add item', 'danger');
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
            const sourceSectionId = evt.from?.dataset?.sectionId || '';
            const destSectionId = evt.to?.dataset?.sectionId || '';

            const res = await fetch('/api/admin/lesson/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId,
                    sourceSectionId,
                    destSectionId,
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

            if (Array.isArray(data.sections)) {
                courseData = normalizeEditorSections(data.sections);
                renderSections();
                initSortable();
            }

            setReorderStatus('Order saved', 'saved', true);
        } catch {
            setReorderStatus('Network error while saving order.', 'error');
            setTimeout(() => location.reload(), 700);
        }
    }

    function moveItemInCourseData(sourceSectionIndex, destSectionIndex, sourceIndex, destIndex) {
        const sourceSection = courseData[sourceSectionIndex];
        const destSection = courseData[destSectionIndex];

        if (!sourceSection || !destSection || !Array.isArray(sourceSection.lessons) || !Array.isArray(destSection.lessons)) {
            return;
        }

        const movedItems = sourceSection.lessons.splice(sourceIndex, 1);
        const movedItem = movedItems[0];
        if (!movedItem) return;

        destSection.lessons.splice(destIndex, 0, movedItem);

        sourceSection.lessons.forEach((item, idx) => {
            item.order = idx;
        });

        if (sourceSectionIndex !== destSectionIndex) {
            destSection.lessons.forEach((item, idx) => {
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
        const backdrop = document.getElementById('libraryDrawerBackdrop');
        const nextOpen = !popup.classList.contains('show');
        popup.classList.toggle('show', nextOpen);
        if (backdrop) {
            backdrop.classList.toggle('show', nextOpen);
        }
        document.body.classList.toggle('library-open', nextOpen);
        if (nextOpen) {
            loadLibraryItems();
        }
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

            content.innerHTML = data.items.map(item => `
                <div class="library-item" 
                     draggable="true" 
                     data-id="${item._id}"
                     data-type="${item.type}">
                    <div class="lib-icon ${item.type}">
                        <i class="fas ${icons[item.type]}"></i>
                    </div>
                    <span class="lib-title">${escapeHtml(formatLessonTitle(item.title))}</span>
                    <button class="delete-btn" type="button" data-id="${item._id}" aria-label="Delete">
                        Delete
                    </button>
                </div>
            `).join('');

            // Attach drag handlers to library items
            content.querySelectorAll('.library-item').forEach(item => {
                item.addEventListener('dragstart', handleLibraryDrag);
            });

            content.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', function(event) {
                    event.stopPropagation();
                    event.preventDefault();
                    deleteLibraryItem(btn.dataset.id, btn.closest('.library-item'));
                });
            });

        } catch {
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
        if (item.id) {
            e.dataTransfer.setData('id', item.id);
        }
        if (item.type) {
            e.dataTransfer.setData('type', item.type);
        }
    }

    async function deleteLibraryItem(id, itemEl) {
        if (!id) return;
        const titleNode = itemEl ? itemEl.querySelector('.lib-title') : null;
        const itemTitle = titleNode ? titleNode.textContent.trim() : 'this library item';
        const confirmed = await window.showConfirmModal({
            title: 'Delete Library Item',
            message: `Delete "${itemTitle}" from the content library?`,
            warning: 'This action cannot be undone.',
            confirmText: 'Delete Item',
            confirmingText: 'Deleting...',
            variant: 'danger',
            onConfirm: async function() {
                const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
                const res = await fetcher('/library/' + encodeURIComponent(id), {
                    method: 'DELETE'
                });
                const data = await res.json();
                if (!data.success) {
                    throw new Error(data.error || 'Delete failed');
                }
            }
        });
        if (!confirmed) return;

        if (itemEl) {
            itemEl.remove();
        }
        showToast('Library item deleted.', 'success');
    }

    // ==================== SAVE COURSE ====================
    function saveCourse() {
        showToast('Course saved!', 'success');
    }

    // ==================== UTILITY ====================
    function openFirstSection() {
        document.querySelectorAll('.section-card').forEach((card, idx) => {
            card.classList.toggle('is-collapsed', idx !== 0);

            const icon = card.querySelector('.section-icon');

            updateSectionContentHeight(card, idx === 0);

            if (icon) {
                icon.classList.toggle('fa-chevron-down', idx === 0);
                icon.classList.toggle('fa-chevron-right', idx !== 0);
            }
        });

        refreshExpandedSectionHeights();
    }

    function updateSectionContentHeight(sectionCard, isExpanded) {
        const content = sectionCard?.querySelector('.section-content');
        if (!content) return;

        if (!isExpanded) {
            content.style.maxHeight = '0px';
            return;
        }

        // scrollHeight must be read after layout updates to avoid clipped lesson rows.
        window.requestAnimationFrame(() => {
            content.style.maxHeight = `${content.scrollHeight + 24}px`;
        });
    }

    function refreshExpandedSectionHeights() {
        document.querySelectorAll('.section-card').forEach((card) => {
            const isExpanded = !card.classList.contains('is-collapsed');
            updateSectionContentHeight(card, isExpanded);
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


    // UI Notification System
    function showToast(msg, type = 'success') {
        if (typeof window.showAppToast === 'function') {
            window.showAppToast(msg, type === 'warning' ? 'warning' : type === 'danger' ? 'danger' : 'success');
            return;
        }
        window.alert(String(msg || ''));
    }

})();
