(function () {
    'use strict';

    const root = document.getElementById('quizEditorPage');
    if (!root) return;

    const courseId = root.dataset.courseId;
    const sectionIndex = Number(root.dataset.sectionIndex);
    const quizIndex = Number(root.dataset.quizIndex);
    const quizDataNode = document.getElementById('quiz-editor-data');

    let quizData = { name: '', questions: [] };

    try {
        quizData = JSON.parse(quizDataNode ? (quizDataNode.textContent || '{}') : '{}');
    } catch {
        quizData = { name: '', questions: [] };
    }

    if (!Array.isArray(quizData.questions)) {
        quizData.questions = [];
    }

    const state = {
        questions: quizData.questions.map(normalizeQuestionRecord),
        selectedQuestionId: '',
        searchTerm: '',
        dirty: false,
        saving: false,
        sortable: null
    };

    const els = {
        quizTitleInput: document.getElementById('quizTitleInput'),
        questionCount: document.getElementById('questionCount'),
        quizValidationSummary: document.getElementById('quizValidationSummary'),
        questionSearchInput: document.getElementById('questionSearchInput'),
        questionList: document.getElementById('questionList'),
        addQuestionBtn: document.getElementById('addQuestionBtn'),
        toolbarSaveBtn: document.getElementById('toolbarSaveBtn'),
        saveState: document.getElementById('quizSaveState'),
        emptyState: document.getElementById('emptyState'),
        editorCard: document.getElementById('editorCard'),
        editorForm: document.getElementById('editorForm'),
        editorQuestionHeading: document.getElementById('editorQuestionHeading'),
        editorQuestionMeta: document.getElementById('editorQuestionMeta'),
        optionList: document.getElementById('optionList'),
        optionCounter: document.getElementById('optionCounter'),
        addOptionBtn: document.getElementById('addOptionBtn'),
        saveQuestionBtn: document.getElementById('saveQuestionBtn'),
        deleteQuestionBtn: document.getElementById('deleteQuestionBtn'),
        questionText: document.getElementById('questionText'),
        questionTextValidation: document.getElementById('questionTextValidation'),
        optionValidation: document.getElementById('optionValidation'),
        inspectorQuestionCount: document.getElementById('inspectorQuestionCount'),
        inspectorWarningCount: document.getElementById('inspectorWarningCount'),
        inspectorEstimatedTime: document.getElementById('inspectorEstimatedTime'),
        inspectorWarnings: document.getElementById('inspectorWarnings')
    };

    const endpoints = {
        add: `/admin/course/${courseId}/quiz/question/add`,
        update: `/admin/course/${courseId}/quiz/question/update`,
        delete: `/admin/course/${courseId}/quiz/question/delete`,
        reorder: `/admin/course/${courseId}/quiz/question/reorder`
    };

    init();

    function init() {
        if (els.quizTitleInput) {
            els.quizTitleInput.value = getQuizDisplayName();
            els.quizTitleInput.readOnly = true;
        }

        bindEvents();
        renderQuestionList();
        toggleEditorState();
        updateInspector();
        initSortable();

        if (state.questions.length > 0) {
            selectQuestion(state.questions[0].questionId);
        } else {
            setSaveState('saved', 'Saved');
        }
    }

    function getQuizDisplayName() {
        const candidates = [
            quizData.name,
            quizData.title,
            quizData.displayTitle,
            quizData.lessonTitle
        ];

        const title = candidates
            .map(function (value) { return String(value || '').trim(); })
            .find(Boolean);

        return title || 'Untitled Quiz';
    }

    function bindEvents() {
        if (els.addQuestionBtn) {
            els.addQuestionBtn.addEventListener('click', onAddQuestion);
        }

        if (els.toolbarSaveBtn) {
            els.toolbarSaveBtn.addEventListener('click', onSaveQuestion);
        }

        if (els.saveQuestionBtn) {
            els.saveQuestionBtn.addEventListener('click', onSaveQuestion);
        }

        if (els.deleteQuestionBtn) {
            els.deleteQuestionBtn.addEventListener('click', onDeleteQuestion);
        }

        if (els.questionSearchInput) {
            els.questionSearchInput.addEventListener('input', function () {
                state.searchTerm = String(els.questionSearchInput.value || '').trim().toLowerCase();
                renderQuestionList();
            });
        }

        if (els.questionList) {
            els.questionList.addEventListener('click', function (event) {
                const deleteBtn = event.target.closest('[data-question-delete]');
                if (deleteBtn) {
                    event.preventDefault();
                    const questionId = String(deleteBtn.dataset.questionDelete || '');
                    onDeleteQuestionById(questionId);
                    return;
                }

                const row = event.target.closest('.question-row-card');
                if (!row) return;
                const questionId = String(row.dataset.questionId || '');
                if (!questionId) return;
                selectQuestion(questionId);
            });
        }

        if (els.addOptionBtn) {
            els.addOptionBtn.addEventListener('click', function () {
                addOptionRow('', false);
                markDirty(true);
                syncOptionCounter();
                updateInspector();
            });
        }

        if (els.optionList) {
            els.optionList.addEventListener('click', function (event) {
                const actionBtn = event.target.closest('[data-action]');
                if (!actionBtn) return;

                if (actionBtn.dataset.action === 'delete-option') {
                    event.preventDefault();
                    removeOption(actionBtn.closest('.option-row'));
                }
            });

            els.optionList.addEventListener('input', function () {
                markDirty(true);
                clearValidationState();
                updateInspector();
            });

            els.optionList.addEventListener('change', function (event) {
                if (event.target && event.target.classList.contains('option-correct')) {
                    markDirty(true);
                    clearValidationState();
                    updateInspector();
                }
            });
        }

        if (els.questionText) {
            els.questionText.addEventListener('input', function () {
                markDirty(true);
                clearValidationState();
                syncEditorMeta();
                updateInspector();
            });
        }

        window.addEventListener('beforeunload', function (event) {
            if (!state.dirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
    }

    function initSortable() {
        if (!els.questionList || typeof Sortable === 'undefined') {
            window.setTimeout(initSortable, 150);
            return;
        }

        if (state.sortable && typeof state.sortable.destroy === 'function') {
            state.sortable.destroy();
        }

        state.sortable = Sortable.create(els.questionList, {
            handle: '.quiz-question-drag-handle',
            animation: 150,
            ghostClass: 'question-item-ghost',
            dragClass: 'question-item-drag',
            onEnd: onReorderQuestions
        });
    }

    async function onAddQuestion() {
        if (state.saving) return;

        const payload = {
            sectionIndex,
            quizIndex,
            question: 'Untitled question',
            answers: [
                { id: 'answer-1', text: 'Option 1', isCorrect: true },
                { id: 'answer-2', text: 'Option 2', isCorrect: false }
            ],
            correctIndex: 0
        };

        setSaveState('saving', 'Adding question...');
        const response = await requestJson(endpoints.add, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.success) {
            setSaveState('error', 'Add failed');
            notify(response.error || 'Unable to add question.', 'error', 'Add failed');
            return;
        }

        state.questions.push(normalizeQuestionRecord(response.question || payload));
        renderQuestionList();
        selectQuestion(getQuestionIdentity(state.questions[state.questions.length - 1]));
        markDirty(false);
        setSaveState('saved', 'Saved');
        notify('Question added.', 'success', 'Question added');
    }

    async function onSaveQuestion() {
        if (state.saving) return;

        const question = getSelectedQuestion();
        if (!question) {
            notify('Select a question first.', 'warning', 'No selection');
            return;
        }

        const validation = collectAndValidateEditorData();
        if (!validation.valid) {
            applyValidationState(validation);
            notify(validation.error, 'warning', 'Validation');
            return;
        }

        clearValidationState();
        setSaveState('saving', 'Saving...');

        const questionIndex = findQuestionIndexById(question.questionId);
        const payload = {
            sectionIndex,
            quizIndex,
            questionIndex,
            questionId: question.questionId,
            question: validation.question,
            answers: validation.answers,
            correctIndex: validation.correctIndex
        };

        const response = await requestJson(endpoints.update, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.success) {
            setSaveState('error', 'Save failed');
            notify(response.error || 'Unable to save question.', 'error', 'Save failed');
            return;
        }

        state.questions[questionIndex] = normalizeQuestionRecord({
            ...(state.questions[questionIndex] || {}),
            question: validation.question,
            answers: validation.answers
        });

        renderQuestionList();
        selectQuestion(question.questionId);
        markDirty(false);
        setSaveState('saved', 'Saved');
        notify('Question saved.', 'success', 'Saved');
    }

    async function onDeleteQuestion() {
        const question = getSelectedQuestion();
        if (!question) {
            notify('Select a question first.', 'warning', 'No selection');
            return;
        }

        await onDeleteQuestionById(question.questionId);
    }

    async function onDeleteQuestionById(questionId) {
        const question = findQuestionById(questionId);
        if (!question) return;

        const questionTitle = String(question.question || 'Untitled question').trim() || 'Untitled question';
        const confirmed = await window.showConfirmModal({
            title: 'Delete Question',
            message: `Delete "${questionTitle}"?`,
            warning: 'This action cannot be undone.',
            confirmText: 'Delete Question',
            confirmingText: 'Deleting...',
            variant: 'danger',
            onConfirm: async function () {
                const response = await requestJson(endpoints.delete, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sectionIndex,
                        quizIndex,
                        questionIndex: findQuestionIndexById(questionId),
                        questionId
                    })
                });
                if (!response.success) {
                    throw new Error(response.error || 'Unable to delete question.');
                }
            }
        });

        if (!confirmed) return;

        const deletedIndex = findQuestionIndexById(questionId);
        if (deletedIndex < 0) return;

        state.questions.splice(deletedIndex, 1);

        if (!state.questions.length) {
            state.selectedQuestionId = '';
            renderQuestionList();
            toggleEditorState();
            updateInspector();
            markDirty(false);
            setSaveState('saved', 'Saved');
            notify('Question deleted.', 'success', 'Deleted');
            return;
        }

        const nextQuestion = state.questions[Math.min(deletedIndex, state.questions.length - 1)];
        renderQuestionList();
        selectQuestion(nextQuestion ? nextQuestion.questionId : '');
        markDirty(false);
        setSaveState('saved', 'Saved');
        notify('Question deleted.', 'success', 'Deleted');
    }

    async function onReorderQuestions() {
        const domIds = Array.from(els.questionList.querySelectorAll('.question-list-item'))
            .map(function (item) {
                return String(item.dataset.questionId || '');
            })
            .filter(Boolean);

        const visibleIds = getVisibleQuestions().map(function (question) {
            return question.questionId;
        });

        if (!domIds.length || domIds.length !== visibleIds.length) {
            renderQuestionList();
            return;
        }

        const previousOrder = state.questions.slice();
        const previousSelectedId = state.selectedQuestionId;
        const hiddenQuestions = state.questions.filter(function (question) {
            return visibleIds.indexOf(question.questionId) === -1;
        });
        const reorderedVisible = domIds.map(function (id) {
            return findQuestionById(id);
        }).filter(Boolean);

        state.questions = reorderedVisible.concat(hiddenQuestions);
        renderQuestionList();
        if (previousSelectedId) {
            selectQuestion(previousSelectedId);
        }
        markDirty(true);
        setSaveState('saving', 'Saving order...');

        const response = await requestJson(endpoints.reorder, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sectionIndex,
                quizIndex,
                order: state.questions.map(function (_question, index) { return index; }),
                orderedIds: state.questions.map(function (question) { return question.questionId; })
            })
        });

        if (!response.success) {
            state.questions = previousOrder;
            renderQuestionList();
            if (previousSelectedId) {
                selectQuestion(previousSelectedId);
            }
            markDirty(false);
            setSaveState('error', 'Reorder failed');
            notify(response.error || 'Unable to reorder questions.', 'error', 'Reorder failed');
            return;
        }

        markDirty(false);
        setSaveState('saved', 'Saved');
        notify('Question order updated.', 'success', 'Order saved');
    }

    function renderQuestionList() {
        if (!els.questionList) return;

        const visibleQuestions = getVisibleQuestions();

        if (!visibleQuestions.length) {
            els.questionList.innerHTML = '<li class="question-list-empty">No matching questions.</li>';
            updateQuestionCount();
            initSortable();
            return;
        }

        els.questionList.innerHTML = visibleQuestions.map(function (question) {
            const globalIndex = state.questions.findIndex(function (entry) {
                return entry.questionId === question.questionId;
            });
            const rowClass = question.questionId === state.selectedQuestionId
                ? 'question-row-card is-active'
                : 'question-row-card';
            const warningCount = inspectQuestion(question).length;
            const shortQuestion = question.question || 'Untitled question';

            return '' +
                '<li class="question-list-item">' +
                    `<article class="${rowClass}" data-question-id="${escapeHtml(question.questionId)}">` +
                        `<button type="button" class="quiz-question-drag-handle drag-handle" title="Drag to reorder" aria-label="Drag to reorder"><i class="fa-solid fa-grip-lines"></i></button>` +
                        `<span class="question-number">Q${globalIndex + 1}</span>` +
                        '<div class="question-row-copy">' +
                            `<div class="question-label">${escapeHtml(shortQuestion)}</div>` +
                            '<div class="question-meta-row">' +
                                '<span class="question-type-badge">Multiple choice</span>' +
                                (warningCount
                                    ? `<span class="question-warning-badge">${warningCount} warning${warningCount === 1 ? '' : 's'}</span>`
                                    : '<span class="question-ok-badge">Ready</span>') +
                            '</div>' +
                        '</div>' +
                        `<div class="question-row-actions"><button type="button" class="question-row-delete" data-question-delete="${escapeHtml(question.questionId)}" aria-label="Delete question" title="Delete question"><i class="fa-solid fa-trash"></i></button></div>` +
                    '</article>' +
                '</li>';
        }).join('');

        updateQuestionCount();
        initSortable();
    }

    function selectQuestion(questionId) {
        const question = findQuestionById(questionId);
        if (!question) return;

        state.selectedQuestionId = question.questionId;

        Array.from(els.questionList.querySelectorAll('.question-row-card')).forEach(function (row) {
            row.classList.toggle('is-active', String(row.dataset.questionId || '') === question.questionId);
        });

        populateEditor(question);
        toggleEditorState();
        syncEditorMeta();
        clearValidationState();
    }

    function populateEditor(question) {
        if (!els.questionText || !els.optionList) return;

        els.questionText.value = question.question || '';
        els.optionList.innerHTML = '';

        normalizeQuestionAnswers(question.answers, question).forEach(function (answer) {
            addOptionRow(answer.text, answer.isCorrect);
        });

        syncOptionCounter();
    }

    function addOptionRow(text, isCorrect) {
        const row = document.createElement('div');
        row.className = 'option-row';

        row.innerHTML = `
            <div class="form-check option-correct-wrap">
                <input class="form-check-input option-correct" type="radio" name="correctOption" ${isCorrect ? 'checked' : ''}>
            </div>
            <input type="text" class="form-control option-text" placeholder="Option text" value="${escapeHtml(text || '')}">
            <button type="button" class="btn btn-outline-danger option-delete-btn" data-action="delete-option" aria-label="Delete option" title="Delete option">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;

        els.optionList.appendChild(row);
    }

    function removeOption(optionRow) {
        const rows = els.optionList.querySelectorAll('.option-row');
        if (rows.length <= 2) {
            notify('At least 2 options are required.', 'warning', 'Validation');
            return;
        }

        if (optionRow) {
            optionRow.remove();
        }
        markDirty(true);
        syncOptionCounter();
        updateInspector();
    }

    function collectAndValidateEditorData() {
        const question = String(els.questionText && els.questionText.value || '').trim();
        if (!question) {
            return { valid: false, field: 'question', error: 'Question text cannot be empty.' };
        }

        const optionRows = Array.from(els.optionList.querySelectorAll('.option-row'));
        if (optionRows.length < 2) {
            return { valid: false, field: 'options', error: 'Please add at least 2 options.' };
        }

        const answers = optionRows.map(function (row, index) {
            return {
                id: 'answer-' + (index + 1),
                text: String(row.querySelector('.option-text').value || '').trim(),
                isCorrect: Boolean(row.querySelector('.option-correct').checked)
            };
        });

        if (answers.some(function (answer) { return !answer.text; })) {
            return { valid: false, field: 'options', error: 'Option text cannot be empty.' };
        }

        const correctIndex = answers.findIndex(function (answer) {
            return answer.isCorrect;
        });

        if (correctIndex < 0) {
            return { valid: false, field: 'options', error: 'Please select the correct answer.' };
        }

        return {
            valid: true,
            question,
            answers,
            correctIndex
        };
    }

    function normalizeQuestionRecord(question) {
        const answers = normalizeQuestionAnswers(
            question && (question.answers || question.options || question.choices),
            question
        );

        return {
            questionId: getQuestionIdentity(question),
            _id: question && question._id ? String(question._id) : '',
            question: String(question && question.question || '').trim(),
            answers: answers,
            options: answers
        };
    }

    function normalizeQuestionAnswers(answers, sourceQuestion) {
        const question = sourceQuestion || {};
        const rawAnswers = Array.isArray(answers) && answers.length ? answers : [];

        const normalized = rawAnswers.map(function (answer, index) {
            if (typeof answer === 'string') {
                return {
                    id: 'answer-' + (index + 1),
                    text: answer,
                    isCorrect: false
                };
            }

            return {
                id: String((answer && (answer.id || answer._id)) || ('answer-' + (index + 1))),
                text: String((answer && (answer.text || answer.answer || answer.value)) || ''),
                isCorrect: Boolean(answer && (answer.isCorrect || answer.correct))
            };
        });

        let correctIndex = normalized.findIndex(function (answer) {
            return answer.isCorrect;
        });

        if (correctIndex < 0) {
            const numericCorrectIndex = Number(
                question.correctIndex
                ?? question.correctOptionIndex
                ?? question.correctAnswerIndex
            );

            if (Number.isInteger(numericCorrectIndex) && numericCorrectIndex >= 0 && numericCorrectIndex < normalized.length) {
                correctIndex = numericCorrectIndex;
            }
        }

        if (correctIndex < 0 && typeof question.correctAnswer === 'string') {
            const correctAnswerText = question.correctAnswer.trim().toLowerCase();
            const byLabel = ['a', 'b', 'c', 'd'].indexOf(correctAnswerText);
            if (byLabel >= 0 && byLabel < normalized.length) {
                correctIndex = byLabel;
            } else {
                correctIndex = normalized.findIndex(function (answer) {
                    return String(answer.text || '').trim().toLowerCase() === correctAnswerText;
                });
            }
        }

        if (correctIndex >= 0) {
            normalized.forEach(function (answer, index) {
                answer.isCorrect = index === correctIndex;
            });
        }

        if (!normalized.length) {
            normalized.push({
                id: 'answer-1',
                text: 'Option 1',
                isCorrect: true
            });
            normalized.push({
                id: 'answer-2',
                text: 'Option 2',
                isCorrect: false
            });
        }

        while (normalized.length < 2) {
            normalized.push({
                id: 'answer-' + (normalized.length + 1),
                text: 'Option ' + (normalized.length + 1),
                isCorrect: false
            });
        }

        if (!normalized.some(function (answer) { return answer.isCorrect; }) && normalized[0]) {
            normalized[0].isCorrect = true;
        }

        return normalized;
    }

    function toggleEditorState() {
        const hasSelection = Boolean(getSelectedQuestion());

        if (els.emptyState) {
            els.emptyState.classList.toggle('d-none', hasSelection);
        }
        if (els.editorCard) {
            els.editorCard.classList.toggle('d-none', !hasSelection);
        }
        if (els.editorForm) {
            els.editorForm.classList.toggle('d-none', !hasSelection);
        }
    }

    function syncOptionCounter() {
        if (!els.optionCounter) return;
        const count = els.optionList.querySelectorAll('.option-row').length;
        els.optionCounter.textContent = `${count} options`;
    }

    function syncEditorMeta() {
        const question = getSelectedQuestion();
        if (!question) return;

        const currentIndex = findQuestionIndexById(question.questionId);
        const draftTitle = String(els.questionText && els.questionText.value || '').trim() || question.question || 'Untitled question';
        const warnings = inspectQuestion({
            question: draftTitle,
            answers: collectDraftAnswers()
        });

        if (els.editorQuestionHeading) {
            els.editorQuestionHeading.textContent = `Question ${currentIndex + 1}`;
        }

        if (els.editorQuestionMeta) {
            els.editorQuestionMeta.textContent = warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : 'Ready';
        }
    }

    function updateQuestionCount() {
        if (els.questionCount) {
            els.questionCount.textContent = `${state.questions.length} questions`;
        }
    }

    function updateInspector() {
        const questionsForInspector = getQuestionsForInspector();
        const warnings = questionsForInspector.flatMap(function (question, index) {
            return inspectQuestion(question).map(function (message) {
                return `Q${index + 1}: ${message}`;
            });
        });

        if (els.inspectorQuestionCount) {
            els.inspectorQuestionCount.textContent = String(questionsForInspector.length);
        }
        if (els.inspectorWarningCount) {
            els.inspectorWarningCount.textContent = String(warnings.length);
        }
        if (els.inspectorEstimatedTime) {
            const minutes = Math.max(1, Math.ceil(questionsForInspector.length * 0.75));
            els.inspectorEstimatedTime.textContent = `${minutes} min`;
        }
        if (els.quizValidationSummary) {
            els.quizValidationSummary.textContent = warnings.length
                ? `${warnings.length} validation warning${warnings.length === 1 ? '' : 's'}`
                : 'No validation issues';
        }
        if (els.inspectorWarnings) {
            els.inspectorWarnings.innerHTML = warnings.length
                ? `<ul>${warnings.map(function (warning) { return `<li>${escapeHtml(warning)}</li>`; }).join('')}</ul>`
                : '<div class="text-muted small">No validation warnings.</div>';
        }
    }

    function getQuestionsForInspector() {
        const snapshot = state.questions.map(function (question) {
            return {
                questionId: question.questionId,
                question: question.question,
                answers: Array.isArray(question.answers) ? question.answers.map(function (answer) {
                    return { ...answer };
                }) : []
            };
        });

        const selectedIndex = findQuestionIndexById(state.selectedQuestionId);
        if (selectedIndex >= 0 && els.questionText && els.optionList) {
            snapshot[selectedIndex] = {
                ...snapshot[selectedIndex],
                question: String(els.questionText.value || '').trim(),
                answers: collectDraftAnswers()
            };
        }

        return snapshot;
    }

    function inspectQuestion(question) {
        const warnings = [];
        const text = String(question && question.question || '').trim();
        const answers = Array.isArray(question && question.answers) ? question.answers : [];
        const nonEmptyAnswers = answers.filter(function (answer) {
            return String(answer && answer.text || '').trim();
        });
        const hasCorrect = answers.some(function (answer) {
            return Boolean(answer && answer.isCorrect);
        });

        if (!text) warnings.push('Question text is missing.');
        if (nonEmptyAnswers.length < 2) warnings.push('Needs at least 2 answer options.');
        if (!hasCorrect) warnings.push('No correct answer selected.');
        if (nonEmptyAnswers.length !== answers.length) warnings.push('Some answer options are empty.');
        return warnings;
    }

    function collectDraftAnswers() {
        return Array.from(els.optionList.querySelectorAll('.option-row')).map(function (row, index) {
            return {
                id: 'answer-' + (index + 1),
                text: String(row.querySelector('.option-text').value || '').trim(),
                isCorrect: Boolean(row.querySelector('.option-correct').checked)
            };
        });
    }

    function applyValidationState(validation) {
        clearValidationState();
        if (!validation || validation.valid) return;

        if (validation.field === 'question' && els.questionTextValidation) {
            els.questionTextValidation.hidden = false;
            els.questionTextValidation.textContent = validation.error;
        }

        if (validation.field === 'options' && els.optionValidation) {
            els.optionValidation.hidden = false;
            els.optionValidation.textContent = validation.error;
        }
    }

    function clearValidationState() {
        if (els.questionTextValidation) {
            els.questionTextValidation.hidden = true;
        }
        if (els.optionValidation) {
            els.optionValidation.hidden = true;
        }
    }

    function setSaveState(kind, label) {
        if (!els.saveState) return;
        els.saveState.textContent = label;
        els.saveState.dataset.state = kind;
    }

    function markDirty(isDirty) {
        state.dirty = Boolean(isDirty);
        if (state.saving) return;
        setSaveState(state.dirty ? 'dirty' : 'saved', state.dirty ? 'Unsaved changes' : 'Saved');
    }

    function getVisibleQuestions() {
        if (!state.searchTerm) return state.questions.slice();
        return state.questions.filter(function (question) {
            return String(question.question || '').toLowerCase().includes(state.searchTerm);
        });
    }

    function getSelectedQuestion() {
        return findQuestionById(state.selectedQuestionId);
    }

    function findQuestionById(questionId) {
        return state.questions.find(function (question) {
            return question.questionId === questionId;
        }) || null;
    }

    function findQuestionIndexById(questionId) {
        return state.questions.findIndex(function (question) {
            return question.questionId === questionId;
        });
    }

    function getQuestionIdentity(question) {
        const rawId = question && (question._id || question.id || question.questionId || question.localId);
        return String(rawId || ('local-question-' + Date.now() + '-' + Math.random().toString(16).slice(2)));
    }

    function notify(message, type, title) {
        const safeTitle = String(title || '').trim() || (type === 'success' ? 'Saved' : type === 'warning' ? 'Warning' : 'Error');
        if (typeof window.showToast === 'function') {
            window.showToast({
                type: type || 'info',
                title: safeTitle,
                message: String(message || '')
            });
            return;
        }

        if (typeof window.showAppToast === 'function') {
            const variant = type === 'error' ? 'danger' : (type || 'info');
            window.showAppToast(String(message || ''), variant, { title: safeTitle });
        }
    }

    async function requestJson(url, config) {
        try {
            state.saving = true;
            const response = await fetch(url, config);
            const data = await response.json();
            state.saving = false;
            if (!response.ok) {
                return {
                    success: false,
                    error: data.error || 'Request failed.'
                };
            }
            return data;
        } catch (error) {
            state.saving = false;
            return {
                success: false,
                error: error.message || 'Network error.'
            };
        }
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
})();
