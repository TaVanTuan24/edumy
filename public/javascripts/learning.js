(function() {
    'use strict';

    const state = {
        course: null,
        sections: [],
        flatLessons: [],
        currentLessonId: null,
        currentSlideIndex: 0,
        currentQuestionIndex: 0,
        score: 0,
        answers: {},
        submittedQuestions: {},
        sectionNotes: []
    };

    const els = {
        progressFill: document.getElementById('lessonProgressFill'),
        progressMeta: document.getElementById('lessonProgressMeta'),
        lessonTitleLive: document.getElementById('lessonTitleLive'),
        sidebarContent: document.getElementById('sidebarContent'),
        contentStage: document.getElementById('contentStage'),
        tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
        tabPanes: Array.from(document.querySelectorAll('.tab-pane')),
        tabOverview: document.getElementById('tab-overview'),
        tabNotes: document.getElementById('tab-notes'),
        tabReviews: document.getElementById('tab-reviews'),
        notesInput: document.getElementById('notesInput'),
        notesSaveBtn: document.getElementById('notesSaveBtn'),
        ratingSelect: document.getElementById('rating'),
        commentInput: document.getElementById('comment'),
        reviewSubmitBtn: document.getElementById('reviewSubmitBtn'),
        reviewList: document.getElementById('review-list'),
        ratingSummary: document.getElementById('ratingSummary')
    };

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        hydrateState();
        bindEvents();
        renderSidebar();
        setupTabs();
        renderOverview();
        loadReviews();

        if (state.flatLessons.length > 0) {
            loadLesson(state.flatLessons[0]._id);
        } else {
            renderEmpty('No lessons available yet.');
        }
    }

    function hydrateState() {
        const payload = document.getElementById('learn-data');
        if (!payload) return;

        let raw = {};
        try {
            raw = JSON.parse(payload.textContent || '{}');
        } catch {
            raw = {};
        }

        state.course = {
            _id: raw._id || '',
            title: raw.title || 'Untitled Course',
            description: raw.description || '',
            topic: raw.topic || ''
        };

        state.sectionNotes = Array.isArray(window.sectionNotes) ? window.sectionNotes : [];

        const driveStructure = Array.isArray(raw.driveStructure) ? raw.driveStructure : [];
        state.sections = driveStructure.map(normalizeSection);
        state.flatLessons = state.sections.flatMap(function(section) { return section.lessons; });
    }

    function normalizeSection(section, index) {
        const lessons = Array.isArray(section && section.videos) ? section.videos : [];
        return {
            id: section && section._id ? String(section._id) : 'section-' + index,
            title: (section && section.section) ? String(section.section) : ('Section ' + (index + 1)),
            lessons: lessons.map(function(item, lessonIndex) {
                return normalizeLesson(item, index, lessonIndex);
            })
        };
    }

    function normalizeLesson(item, sectionIndex, lessonIndex) {
        const originalType = String((item && item.type) || 'lecture').toLowerCase();
        const type = originalType === 'video' ? 'lecture' : (originalType === 'slide' ? 'slide' : originalType === 'quiz' ? 'quiz' : 'lecture');

        const slides = normalizeSlides(item);
        const questions = normalizeQuestions(item);

        return {
            _id: item && item._id ? String(item._id) : ('lesson-' + sectionIndex + '-' + lessonIndex),
            sectionIndex: sectionIndex,
            lessonIndex: lessonIndex,
            title: (item && item.name) ? String(item.name) : 'Untitled Lesson',
            type: type,
            content: {
                videoUrl: (item && item.preview) ? String(item.preview) : '',
                slides: slides,
                questions: questions
            }
        };
    }

    function normalizeSlides(item) {
        if (Array.isArray(item && item.slides) && item.slides.length > 0) {
            return item.slides.map(function(slide, idx) {
                return {
                    title: slide && slide.title ? String(slide.title) : ('Slide ' + (idx + 1)),
                    content: slide && slide.content ? String(slide.content) : '',
                    elements: Array.isArray(slide && slide.elements) ? slide.elements : []
                };
            });
        }

        if (typeof (item && item.content) === 'string' && item.content.trim()) {
            return [{
                title: item.name || 'Slide',
                content: item.content,
                elements: []
            }];
        }

        return [];
    }

    function normalizeQuestions(item) {
        const source = Array.isArray(item && item.questions) ? item.questions : Array.isArray(item && item.quiz) ? item.quiz : [];

        return source.map(function(q) {
            const optionSource = Array.isArray(q && q.options) ? q.options : [];
            const options = optionSource.map(function(opt) {
                return typeof opt === 'string' ? opt : String((opt && opt.text) || '');
            });

            let correctIndex = -1;

            if (typeof (q && q.correctAnswer) === 'number') {
                correctIndex = q.correctAnswer;
            } else if (typeof (q && q.correctAnswer) === 'string') {
                correctIndex = options.findIndex(function(opt) { return opt === q.correctAnswer; });
            } else {
                correctIndex = optionSource.findIndex(function(opt) { return !!(opt && opt.correct); });
            }

            if (correctIndex < 0 && options.length > 0) {
                correctIndex = 0;
            }

            return {
                question: String((q && q.question) || 'Question'),
                options: options,
                correctAnswer: correctIndex
            };
        }).filter(function(q) {
            return q.options.length > 0;
        });
    }

    function bindEvents() {
        document.addEventListener('click', function(e) {
            const sectionHeader = e.target.closest('[data-section-toggle]');
            if (sectionHeader) {
                const sectionId = sectionHeader.dataset.sectionToggle;
                toggleSection(sectionId);
                return;
            }

            const lessonItem = e.target.closest('.lesson-item');
            if (lessonItem) {
                loadLesson(lessonItem.dataset.id);
                return;
            }

            const navBtn = e.target.closest('[data-nav]');
            if (navBtn) {
                navigateLesson(parseInt(navBtn.dataset.nav, 10));
                return;
            }

            const slideNav = e.target.closest('[data-slide-nav]');
            if (slideNav) {
                const dir = slideNav.dataset.slideNav;
                if (dir === 'next') goSlide(1);
                if (dir === 'prev') goSlide(-1);
                return;
            }

            const slideFullscreen = e.target.closest('[data-slide-fullscreen]');
            if (slideFullscreen) {
                openSlideFullscreen();
                return;
            }

            const quizOption = e.target.closest('[data-quiz-option]');
            if (quizOption) {
                selectQuizOption(parseInt(quizOption.dataset.quizOption, 10));
                return;
            }

            const quizSubmit = e.target.closest('[data-quiz-submit]');
            if (quizSubmit) {
                submitQuizAnswer();
                return;
            }

            const quizNext = e.target.closest('[data-quiz-next]');
            if (quizNext) {
                nextQuizQuestion(quizNext.dataset.quizNext);
                return;
            }

            const quizRestart = e.target.closest('[data-quiz-restart]');
            if (quizRestart) {
                restartQuiz();
            }
        });

        if (els.notesSaveBtn) {
            els.notesSaveBtn.addEventListener('click', saveNotes);
        }

        if (els.reviewSubmitBtn) {
            els.reviewSubmitBtn.addEventListener('click', submitReview);
        }
    }

    function setupTabs() {
        if (!els.tabButtons.length) return;
        els.tabButtons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                els.tabButtons.forEach(function(b) { b.classList.remove('active'); });
                els.tabPanes.forEach(function(p) { p.classList.remove('active'); });

                btn.classList.add('active');
                const target = document.getElementById('tab-' + btn.dataset.tab);
                if (target) target.classList.add('active');
            });
        });
    }

    function renderOverview() {
        if (!els.tabOverview) return;

        console.log('Course data:', state.course);

        els.tabOverview.innerHTML = '' +
            '<div class="overview-container">' +
              '<h4 class="course-title">' + escapeHtml(state.course.title || 'Untitled Course') + '</h4>' +
              '<h6>Description</h6>' +
              '<p>' + escapeHtml(state.course.description || 'No description available.') + '</p>' +
              '<h6>Topic</h6>' +
              '<span class="topic-tag">' + escapeHtml(state.course.topic || 'No topic') + '</span>' +
            '</div>';
    }

    function renderNotesPanel() {
        if (!els.notesInput) return;
        const current = getCurrentLesson();
        if (!current) return;

        const note = state.sectionNotes[current.sectionIndex] || '';
        els.notesInput.value = note;
    }

    function saveNotes() {
        const current = getCurrentLesson();
        if (!current || !els.notesInput) return;

        const content = els.notesInput.value || '';
        state.sectionNotes[current.sectionIndex] = content;

        fetch('/courses/' + String(state.course._id) + '/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sectionIndex: current.sectionIndex, content: content })
        }).catch(function(error) {
            console.error('[Notes Save Error]', error);
        });
    }

    function submitReview() {
        if (!els.ratingSelect || !els.commentInput) return;
        const rating = Number(els.ratingSelect.value || 5);
        const comment = els.commentInput.value || '';

        fetch('/courses/' + String(state.course._id) + '/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rating: rating, comment: comment })
        })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (!data.success) return;
                els.commentInput.value = '';
                loadReviews();
            })
            .catch(function(error) {
                console.error('[Review Submit Error]', error);
            });
    }

    function loadReviews() {
        if (!els.reviewList) return;
        fetch('/courses/' + String(state.course._id) + '/reviews')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (!data.success) return;
                renderRatingSummary(data.averageRating, data.reviewCount);
                renderReviewList(data.reviews || []);
            })
            .catch(function(error) {
                console.error('[Review Fetch Error]', error);
            });
    }

    function renderRatingSummary(avg, count) {
        if (!els.ratingSummary) return;
        const safeAvg = Number.isFinite(avg) ? avg : 0;
        const safeCount = Number.isFinite(count) ? count : 0;
        els.ratingSummary.innerHTML = '' +
            '<div class="rating-summary">⭐ ' + safeAvg.toFixed(1) + ' / 5 (' + safeCount + ' reviews)</div>';
    }

    function renderReviewList(reviews) {
        if (!els.reviewList) return;
        if (!reviews.length) {
            els.reviewList.innerHTML = '<p class="text-muted">No reviews yet.</p>';
            return;
        }

        els.reviewList.innerHTML = reviews.map(function(r) {
            const stars = '★'.repeat(Number(r.rating || 0));
            return '' +
                '<div class="review-item">' +
                    '<strong>' + stars + '</strong>' +
                    '<p>' + escapeHtml(r.comment || '') + '</p>' +
                '</div>';
        }).join('');
    }

    function renderSidebar() {
        els.sidebarContent.innerHTML = state.sections.map(function(section, _index) {
            return '' +
                '<section class="learn-section" data-section-id="' + section.id + '">' +
                    '<header class="learn-section-header" data-section-toggle="' + section.id + '">' +
                        '<i class="fa-solid fa-chevron-down chevron"></i>' +
                        '<span class="learn-section-title">' + escapeHtml(section.title) + '</span>' +
                        '<span class="learn-section-meta">' + section.lessons.length + ' lessons</span>' +
                    '</header>' +
                    '<div class="learn-lessons">' +
                        section.lessons.map(function(lesson) {
                            const icon = lesson.type === 'lecture' ? 'fa-circle-play' : lesson.type === 'slide' ? 'fa-file-lines' : 'fa-circle-question';
                            const iconClass = lesson.type;
                            return '' +
                                '<article class="lesson-item" data-id="' + lesson._id + '">' +
                                    '<span class="lesson-icon ' + iconClass + '"><i class="fa-solid ' + icon + '"></i></span>' +
                                    '<div class="lesson-body">' +
                                        '<div class="lesson-name">' + escapeHtml(lesson.title) + '</div>' +
                                        '<div class="lesson-type">' + capitalize(lesson.type) + '</div>' +
                                    '</div>' +
                                '</article>';
                        }).join('') +
                    '</div>' +
                '</section>';
        }).join('');

        if (state.sections.length > 1) {
            const collapsed = els.sidebarContent.querySelectorAll('.learn-section');
            collapsed.forEach(function(sectionEl, idx) {
                if (idx > 0) sectionEl.classList.add('collapsed');
            });
        }
    }

    function toggleSection(sectionId) {
        const section = els.sidebarContent.querySelector('[data-section-id="' + sectionId + '"]');
        if (!section) return;
        section.classList.toggle('collapsed');
    }

    function loadLesson(id) {
        const lesson = state.flatLessons.find(function(entry) { return entry._id === id; });
        if (!lesson) return;

        state.currentLessonId = id;
        state.currentSlideIndex = 0;
        state.currentQuestionIndex = 0;
        state.score = 0;
        state.answers = {};
        state.submittedQuestions = {};

        updateActiveLessonItem(id);
        updateProgress();
        renderNotesPanel();

        if (lesson.type === 'lecture') {
            renderLecture(lesson);
        } else if (lesson.type === 'slide') {
            renderSlideViewer(lesson);
        } else {
            renderQuiz(lesson);
        }
    }

    function updateActiveLessonItem(id) {
        els.sidebarContent.querySelectorAll('.lesson-item.active').forEach(function(item) {
            item.classList.remove('active');
        });

        const current = els.sidebarContent.querySelector('.lesson-item[data-id="' + id + '"]');
        if (current) {
            current.classList.add('active');
            current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function updateProgress() {
        const idx = state.flatLessons.findIndex(function(entry) { return entry._id === state.currentLessonId; });
        const total = state.flatLessons.length || 1;
        const currentNumber = idx >= 0 ? idx + 1 : 1;
        const percent = Math.round((currentNumber / total) * 100);

        els.progressFill.style.width = percent + '%';
        els.progressMeta.textContent = 'Lesson ' + currentNumber + ' / ' + total + ' (' + percent + '%)';

        const lesson = getCurrentLesson();
        els.lessonTitleLive.textContent = lesson ? lesson.title : '';
    }

    function renderLecture(lesson) {
        const hasVideo = !!lesson.content.videoUrl;
        els.contentStage.classList.add('fade-enter');
        els.contentStage.innerHTML = '' +
            '<div class="content-head">' +
                '<h2>' + escapeHtml(lesson.title) + '</h2>' +
                '<span class="content-tag lecture">Lecture</span>' +
            '</div>' +
            '<div class="content-body">' +
                (hasVideo
                    ? '<div class="video-wrap"><div class="ratio ratio-16x9"><iframe src="' + escapeAttribute(lesson.content.videoUrl) + '" allow="autoplay; fullscreen" allowfullscreen></iframe></div></div>'
                    : '<div class="video-empty"><div><i class="fa-solid fa-video fa-3x mb-3"></i><p>No video URL found for this lesson.</p></div></div>') +
                renderLessonNav() +
            '</div>';

        window.setTimeout(function() {
            els.contentStage.classList.remove('fade-enter');
        }, 260);
    }

    function renderSlideViewer(lesson) {
        const slides = lesson.content.slides || [];
        const slide = slides[state.currentSlideIndex];

        els.contentStage.classList.add('fade-enter');

        if (!slide) {
            els.contentStage.innerHTML = '' +
                '<div class="content-head">' +
                    '<h2>' + escapeHtml(lesson.title) + '</h2>' +
                    '<span class="content-tag slide">Slide</span>' +
                '</div>' +
                '<div class="content-body">' +
                    '<div class="slide-empty"><div><i class="fa-solid fa-file-lines fa-3x mb-3"></i><p>No slides available for this lesson.</p></div></div>' +
                    renderLessonNav() +
                '</div>';
            return;
        }

        const counter = (state.currentSlideIndex + 1) + '/' + slides.length;

        els.contentStage.innerHTML = '' +
            '<div class="content-head">' +
                '<h2>' + escapeHtml(lesson.title) + '</h2>' +
                '<span class="content-tag slide">Slide</span>' +
            '</div>' +
            '<div class="content-body">' +
                '<div id="slide-viewer" class="slide-viewer">' +
                    '<div id="slide-canvas" class="slide-canvas"></div>' +
                '</div>' +
                '<div class="slide-controls">' +
                    '<button class="btn btn-outline-secondary btn-sm" data-slide-nav="prev"><i class="fa-solid fa-arrow-left me-1"></i>Previous</button>' +
                    '<span class="slide-counter">Slide ' + counter + '</span>' +
                    '<div class="d-flex gap-2">' +
                        '<button class="btn btn-outline-dark btn-sm" data-slide-fullscreen><i class="fa-solid fa-expand me-1"></i>Fullscreen</button>' +
                        '<button class="btn btn-primary btn-sm" data-slide-nav="next">Next<i class="fa-solid fa-arrow-right ms-1"></i></button>' +
                    '</div>' +
                '</div>' +
                renderLessonNav() +
            '</div>';

        renderSlideCanvas(slide);
        window.setTimeout(function() {
            els.contentStage.classList.remove('fade-enter');
        }, 260);
    }

    function renderSlideCanvas(slide) {
        const canvas = document.getElementById('slide-canvas');
        if (!canvas) return;

        canvas.innerHTML = '';

        if (Array.isArray(slide.elements) && slide.elements.length > 0) {
            slide.elements.forEach(function(element) {
                const node = document.createElement('div');
                node.className = 'slide-element ' + (element.type === 'image' ? 'image' : 'text');
                node.style.left = toNumber(element.x, 0) + 'px';
                node.style.top = toNumber(element.y, 0) + 'px';
                node.style.width = toNumber(element.width, 260) + 'px';
                node.style.height = toNumber(element.height, 70) + 'px';

                if (element.type === 'image') {
                    const img = document.createElement('img');
                    img.src = element.src || '';
                    img.alt = '';
                    node.appendChild(img);
                } else {
                    node.style.fontSize = toNumber(element.styles && element.styles.fontSize, 28) + 'px';
                    node.style.color = (element.styles && element.styles.color) || '#1c1d1f';
                    node.style.fontWeight = String((element.styles && element.styles.fontWeight) || 400);
                    node.style.textAlign = (element.styles && element.styles.textAlign) || 'left';
                    node.textContent = element.content || '';
                }

                canvas.appendChild(node);
            });
            return;
        }

        // Fallback rendering when slide contains text-only structure.
        const fallback = document.createElement('div');
        fallback.className = 'p-4';
        fallback.innerHTML = '' +
            '<h3 class="mb-3">' + escapeHtml(slide.title || 'Slide') + '</h3>' +
            '<p class="text-muted">' + escapeHtml(slide.content || 'No content') + '</p>';
        canvas.appendChild(fallback);
    }

    function goSlide(direction) {
        const lesson = getCurrentLesson();
        if (!lesson) return;

        const slides = lesson.content.slides || [];
        if (!slides.length) return;

        if (direction > 0 && state.currentSlideIndex < slides.length - 1) {
            state.currentSlideIndex += 1;
            renderSlideViewer(lesson);
            return;
        }

        if (direction < 0 && state.currentSlideIndex > 0) {
            state.currentSlideIndex -= 1;
            renderSlideViewer(lesson);
            return;
        }

        if (direction > 0) {
            navigateLesson(1);
        }
    }

    function openSlideFullscreen() {
        const el = document.getElementById('slide-viewer');
        if (!el || !el.requestFullscreen) return;
        el.requestFullscreen().catch(function() {});
    }

    function renderQuiz(lesson) {
        const questions = lesson.content.questions || [];
        const currentQuestion = questions[state.currentQuestionIndex];

        els.contentStage.classList.add('fade-enter');

        if (!questions.length) {
            els.contentStage.innerHTML = '' +
                '<div class="content-head">' +
                    '<h2>' + escapeHtml(lesson.title) + '</h2>' +
                    '<span class="content-tag quiz">Quiz</span>' +
                '</div>' +
                '<div class="content-body">' +
                    '<div class="quiz-empty"><div><i class="fa-solid fa-circle-question fa-3x mb-3"></i><p>No quiz questions yet.</p></div></div>' +
                    renderLessonNav() +
                '</div>';
            return;
        }

        if (!currentQuestion) {
            const total = questions.length;
            els.contentStage.innerHTML = '' +
                '<div class="content-head">' +
                    '<h2>' + escapeHtml(lesson.title) + '</h2>' +
                    '<span class="content-tag quiz">Quiz</span>' +
                '</div>' +
                '<div class="content-body">' +
                    '<div class="quiz-result">' +
                        '<h3>You scored ' + state.score + '/' + total + '</h3>' +
                        '<p class="text-muted mb-3">Great work. You can retry or continue to the next lesson.</p>' +
                        '<div class="d-flex justify-content-center gap-2">' +
                            '<button class="btn btn-outline-secondary" data-quiz-restart>Retry Quiz</button>' +
                            '<button class="btn btn-primary" data-nav="1">Next Lesson</button>' +
                        '</div>' +
                    '</div>' +
                    renderLessonNav() +
                '</div>';
            return;
        }

        const answer = state.answers[state.currentQuestionIndex];
        const answered = !!state.submittedQuestions[state.currentQuestionIndex];

        els.contentStage.innerHTML = '' +
            '<div class="content-head">' +
                '<h2>' + escapeHtml(lesson.title) + '</h2>' +
                '<span class="content-tag quiz">Quiz</span>' +
            '</div>' +
            '<div class="content-body">' +
                '<div class="quiz-progress">Question ' + (state.currentQuestionIndex + 1) + ' of ' + questions.length + '</div>' +
                '<div class="quiz-question">' + escapeHtml(currentQuestion.question) + '</div>' +
                '<div class="quiz-options">' +
                    currentQuestion.options.map(function(option, index) {
                        let className = 'quiz-option';

                        if (answer === index) className += ' selected';
                        if (answered && index === currentQuestion.correctAnswer) className += ' correct';
                        if (answered && answer === index && index !== currentQuestion.correctAnswer) className += ' wrong';

                        return '<button type="button" class="' + className + '" data-quiz-option="' + index + '">' + escapeHtml(option) + '</button>';
                    }).join('') +
                '</div>' +
                '<div class="quiz-controls">' +
                    '<button class="btn btn-outline-secondary" ' + (state.currentQuestionIndex === 0 ? 'disabled' : '') + ' data-quiz-next="prev">Previous</button>' +
                    (answered
                        ? '<button class="btn btn-primary" data-quiz-next="next">' + (state.currentQuestionIndex === questions.length - 1 ? 'See Result' : 'Next Question') + '</button>'
                        : '<button class="btn btn-primary" data-quiz-submit>Submit Answer</button>') +
                '</div>' +
                renderLessonNav() +
            '</div>';

        window.setTimeout(function() {
            els.contentStage.classList.remove('fade-enter');
        }, 260);
    }

    function selectQuizOption(index) {
        if (state.submittedQuestions[state.currentQuestionIndex]) return;

        state.answers[state.currentQuestionIndex] = index;
        renderQuiz(getCurrentLesson());
    }

    function submitQuizAnswer() {
        const lesson = getCurrentLesson();
        if (!lesson) return;

        const questions = lesson.content.questions || [];
        const currentQuestion = questions[state.currentQuestionIndex];
        if (!currentQuestion) return;

        if (state.submittedQuestions[state.currentQuestionIndex]) return;

        const answer = state.answers[state.currentQuestionIndex];
        if (typeof answer !== 'number') return;

        if (answer === currentQuestion.correctAnswer) {
            state.score += 1;
        }

        state.submittedQuestions[state.currentQuestionIndex] = true;
        renderQuiz(lesson);
    }

    function nextQuizQuestion(direction) {
        const lesson = getCurrentLesson();
        if (!lesson) return;

        const questions = lesson.content.questions || [];

        if (direction === 'prev') {
            if (state.currentQuestionIndex > 0) {
                state.currentQuestionIndex -= 1;
                renderQuiz(lesson);
            }
            return;
        }

        if (state.currentQuestionIndex < questions.length - 1) {
            state.currentQuestionIndex += 1;
            renderQuiz(lesson);
            return;
        }

        // Move to result view.
        state.currentQuestionIndex += 1;
        renderQuiz(lesson);
    }

    function restartQuiz() {
        const lesson = getCurrentLesson();
        if (!lesson) return;

        state.currentQuestionIndex = 0;
        state.score = 0;
        state.answers = {};
        state.submittedQuestions = {};
        renderQuiz(lesson);
    }

    function navigateLesson(direction) {
        const currentIndex = state.flatLessons.findIndex(function(entry) {
            return entry._id === state.currentLessonId;
        });

        if (currentIndex < 0) return;

        const nextIndex = currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= state.flatLessons.length) return;

        loadLesson(state.flatLessons[nextIndex]._id);
    }

    function renderLessonNav() {
        const currentIndex = state.flatLessons.findIndex(function(entry) {
            return entry._id === state.currentLessonId;
        });

        const prevDisabled = currentIndex <= 0 ? 'disabled' : '';
        const nextDisabled = currentIndex >= state.flatLessons.length - 1 ? 'disabled' : '';

        return '' +
            '<div class="lesson-nav">' +
                '<button class="btn btn-outline-secondary" data-nav="-1" ' + prevDisabled + '><i class="fa-solid fa-arrow-left me-1"></i>Previous Lesson</button>' +
                '<button class="btn btn-primary" data-nav="1" ' + nextDisabled + '>Next Lesson<i class="fa-solid fa-arrow-right ms-1"></i></button>' +
            '</div>';
    }

    function renderEmpty(message) {
        els.contentStage.innerHTML = '' +
            '<div class="content-head"><h2>Course Learning</h2><span class="content-tag lecture">Lecture</span></div>' +
            '<div class="content-body"><div class="video-empty"><div><p>' + escapeHtml(message) + '</p></div></div></div>';
    }

    function getCurrentLesson() {
        return state.flatLessons.find(function(entry) { return entry._id === state.currentLessonId; }) || null;
    }

    function capitalize(value) {
        if (!value) return '';
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    function toNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
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
})();
