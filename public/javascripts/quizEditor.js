(function () {
    const root = document.getElementById('quizEditorPage');
    if (!root) return;

    const courseId = root.dataset.courseId;
    const sectionIndex = Number(root.dataset.sectionIndex);
    const quizIndex = Number(root.dataset.quizIndex);
    const quizDataNode = document.getElementById('quiz-editor-data');

    let quizData = { name: '', questions: [] };
    let selectedQuestionIndex = -1;

    try {
        quizData = JSON.parse(quizDataNode ? (quizDataNode.textContent || '{}') : '{}');
    } catch {
        showAlert('Failed to load quiz data.', 'danger');
    }

    if (!Array.isArray(quizData.questions)) {
        quizData.questions = [];
    }
    quizData.questions = quizData.questions.map(normalizeQuestionRecord);
    console.log('[QuizEditor] quiz payload loaded into editor:', {
        title: quizData.name || quizData.title || '',
        questionCount: quizData.questions.length,
        optionsPerQuestion: quizData.questions.map(function(question) {
            return Array.isArray(question.options) ? question.options.length : 0;
        })
    });

    const els = {
        quizTitleInput: document.getElementById('quizTitleInput'),
        questionCount: document.getElementById('questionCount'),
        questionList: document.getElementById('questionList'),
        addQuestionBtn: document.getElementById('addQuestionBtn'),
        emptyState: document.getElementById('emptyState'),
        editorCard: document.getElementById('editorCard'),
        editorForm: document.getElementById('editorForm'),
        optionList: document.getElementById('optionList'),
        optionCounter: document.getElementById('optionCounter'),
        addOptionBtn: document.getElementById('addOptionBtn'),
        saveQuestionBtn: document.getElementById('saveQuestionBtn'),
        deleteQuestionBtn: document.getElementById('deleteQuestionBtn'),
        questionText: document.getElementById('questionText'),
        alertContainer: document.getElementById('quizAlertContainer')
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
            els.quizTitleInput.value = quizData.name || quizData.title || 'Untitled Quiz';
            els.quizTitleInput.readOnly = true;
        }

        renderQuestionList();
        toggleEditorState();
        bindEvents();
        initSortable();

        if (quizData.questions.length > 0) {
            selectQuestion(0);
        }
    }

    function bindEvents() {
        els.addQuestionBtn.addEventListener('click', onAddQuestion);

        els.questionList.addEventListener('click', function (event) {
            const row = event.target.closest('.question-list-item');
            if (!row) return;

            const index = Number(row.dataset.questionIndex);
            if (!Number.isInteger(index)) return;

            selectQuestion(index);
        });

        els.optionList.addEventListener('click', function (event) {
            const actionBtn = event.target.closest('[data-action]');
            if (!actionBtn) return;

            const action = actionBtn.dataset.action;
            const optionRow = actionBtn.closest('.option-row');
            if (!optionRow) return;

            if (action === 'delete-option') {
                event.preventDefault();
                removeOption(optionRow);
            }
        });

        els.addOptionBtn.addEventListener('click', function () {
            addOptionRow('', false);
            syncOptionCounter();
        });

        els.saveQuestionBtn.addEventListener('click', onSaveQuestion);
        els.deleteQuestionBtn.addEventListener('click', onDeleteQuestion);
    }

    function initSortable() {
        if (typeof Sortable === 'undefined') return;

        new Sortable(els.questionList, {
            animation: 160,
            handle: '.drag-handle',
            ghostClass: 'question-item-ghost',
            dragClass: 'question-item-drag',
            onEnd: onReorderQuestions
        });
    }

    async function onAddQuestion() {
        const payload = {
            sectionIndex,
            quizIndex,
            question: 'Untitled question',
            answers: [
                { id: 'answer-1', text: 'Option 1', isCorrect: true },
                { id: 'answer-2', text: 'Option 2', isCorrect: false }
            ],
            options: ['Option 1', 'Option 2'],
            correctIndex: 0
        };

        const response = await requestJson(endpoints.add, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.success) {
            showAlert(response.error || 'Unable to add question.', 'danger');
            return;
        }

        const createdQuestion = response.question || {
            question: 'Untitled question',
            answers: [
                { text: 'Option 1', isCorrect: true },
                { text: 'Option 2', isCorrect: false }
            ]
        };

        quizData.questions.push(normalizeQuestionRecord(createdQuestion));
        renderQuestionList();
        selectQuestion(quizData.questions.length - 1);
        showAlert('Question added.', 'success');
    }

    async function onSaveQuestion() {
        if (selectedQuestionIndex < 0) {
            showAlert('Select a question first.', 'warning');
            return;
        }

        const validation = collectAndValidateEditorData();
        if (!validation.valid) {
            showAlert(validation.error, 'danger');
            return;
        }

        const payload = {
            sectionIndex,
            quizIndex,
            questionIndex: selectedQuestionIndex,
            question: validation.question,
            answers: validation.answers,
            options: validation.options,
            correctIndex: validation.correctIndex
        };
        console.log('[QuizEditor] quiz payload before save:', payload);

        const response = await requestJson(endpoints.update, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.success) {
            showAlert(response.error || 'Unable to save question.', 'danger');
            return;
        }

        quizData.questions[selectedQuestionIndex] = normalizeQuestionRecord({
            _id: quizData.questions[selectedQuestionIndex] && quizData.questions[selectedQuestionIndex]._id,
            question: validation.question,
            answers: validation.answers
        });

        renderQuestionList();
        selectQuestion(selectedQuestionIndex);
        showAlert('Question saved.', 'success');
    }

    async function onDeleteQuestion() {
        if (selectedQuestionIndex < 0) {
            showAlert('Select a question first.', 'warning');
            return;
        }

        const shouldDelete = window.confirm('Delete this question? This action cannot be undone.');
        if (!shouldDelete) return;

        const response = await requestJson(endpoints.delete, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sectionIndex,
                quizIndex,
                questionIndex: selectedQuestionIndex
            })
        });

        if (!response.success) {
            showAlert(response.error || 'Unable to delete question.', 'danger');
            return;
        }

        quizData.questions.splice(selectedQuestionIndex, 1);

        if (quizData.questions.length === 0) {
            selectedQuestionIndex = -1;
            renderQuestionList();
            toggleEditorState();
            showAlert('Question deleted.', 'success');
            return;
        }

        const nextIndex = Math.min(selectedQuestionIndex, quizData.questions.length - 1);
        renderQuestionList();
        selectQuestion(nextIndex);
        showAlert('Question deleted.', 'success');
    }

    async function onReorderQuestions() {
        const orderedIndexes = Array.from(els.questionList.querySelectorAll('.question-list-item'))
            .map(function (item) {
                return Number(item.dataset.questionIndex);
            })
            .filter(function (index) {
                return Number.isInteger(index);
            });

        if (orderedIndexes.length !== quizData.questions.length) return;

        const reordered = orderedIndexes.map(function (oldIndex) {
            return quizData.questions[oldIndex];
        });

        const previousSelected = selectedQuestionIndex;
        const newSelectedIndex = orderedIndexes.indexOf(previousSelected);

        const response = await requestJson(endpoints.reorder, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sectionIndex,
                quizIndex,
                order: orderedIndexes
            })
        });

        if (!response.success) {
            showAlert(response.error || 'Unable to reorder questions.', 'danger');
            renderQuestionList();
            selectQuestion(previousSelected);
            return;
        }

        quizData.questions = reordered;
        selectedQuestionIndex = newSelectedIndex >= 0 ? newSelectedIndex : 0;

        renderQuestionList();
        selectQuestion(selectedQuestionIndex);
        showAlert('Question order updated.', 'success');
    }

    function renderQuestionList() {
        els.questionList.innerHTML = '';

        quizData.questions.forEach(function (question, index) {
            const li = document.createElement('li');
            li.className = 'question-list-item';
            li.dataset.questionIndex = String(index);

        const shortQuestion = question.question && question.question.trim()
                ? question.question.trim()
                : 'Untitled question';

            li.innerHTML = `
                <button type="button" class="question-row-btn">
                    <span class="drag-handle" aria-hidden="true">\u2261</span>
                    <span class="question-number">${index + 1}.</span>
                    <span class="question-label">${escapeHtml(shortQuestion)}</span>
                </button>
            `;

            els.questionList.appendChild(li);
        });

        els.questionCount.textContent = `${quizData.questions.length} questions`;
    }

    function selectQuestion(index) {
        if (!Number.isInteger(index) || index < 0 || index >= quizData.questions.length) {
            return;
        }

        selectedQuestionIndex = index;

        Array.from(els.questionList.querySelectorAll('.question-list-item')).forEach(function (row) {
            const rowIndex = Number(row.dataset.questionIndex);
            row.classList.toggle('active', rowIndex === index);
        });

        populateEditor(quizData.questions[index]);
        toggleEditorState();
    }

    function populateEditor(question) {
        els.questionText.value = question.question || '';
        els.optionList.innerHTML = '';

        const normalizedOptions = normalizeQuestionAnswers(question.answers);
        normalizedOptions.forEach(function (answer) {
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
            <button type="button" class="btn btn-outline-danger option-delete-btn" data-action="delete-option">Delete</button>
        `;

        els.optionList.appendChild(row);
    }

    function removeOption(optionRow) {
        const rows = els.optionList.querySelectorAll('.option-row');
        if (rows.length <= 2) {
            showAlert('At least 2 options are required.', 'warning');
            return;
        }

        optionRow.remove();
        syncOptionCounter();
    }

    function collectAndValidateEditorData() {
        const question = els.questionText.value.trim();
        if (!question) {
            return { valid: false, error: 'Question text cannot be empty.' };
        }

        const optionRows = Array.from(els.optionList.querySelectorAll('.option-row'));
        if (optionRows.length < 2) {
            return { valid: false, error: 'Please add at least 2 options.' };
        }

        const options = optionRows.map(function (row) {
            return {
                text: row.querySelector('.option-text').value.trim()
            };
        }).filter(function (option) {
            return option.text.length > 0;
        });

        if (options.length < 2) {
            return { valid: false, error: 'At least 2 non-empty options are required.' };
        }

        if (options.length !== optionRows.length) {
            return { valid: false, error: 'Option text cannot be empty.' };
        }

        const correctIndex = optionRows.findIndex(function (row) {
            return row.querySelector('.option-correct').checked;
        });

        if (correctIndex < 0) {
            return { valid: false, error: 'Please select the correct answer.' };
        }

        return {
            valid: true,
            question,
            answers: options.map(function(option, index) {
                return {
                    id: option.id || ('answer-' + (index + 1)),
                    text: option.text,
                    isCorrect: index === correctIndex
                };
            }),
            options,
            correctIndex
        };
    }

    function normalizeQuestionRecord(question) {
        const sourceAnswers = question && Array.isArray(question.answers) && question.answers.length
            ? question.answers
            : question && Array.isArray(question.options) && question.options.length
                ? question.options
                : question && Array.isArray(question.choices) && question.choices.length
                    ? question.choices
                    : [];
        const answers = normalizeQuestionAnswers(sourceAnswers, question);

        return {
            ...(question && question._id ? { _id: question._id } : {}),
            question: String(question && question.question || '').trim(),
            answers: answers,
            options: answers
        };
    }

    function normalizeQuestionAnswers(answers, sourceQuestion) {
        const question = sourceQuestion || {};
        const rawAnswers = Array.isArray(answers) && answers.length
            ? answers
            : [];

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
                text: typeof question.correctAnswer === 'string' && question.correctAnswer.trim() ? question.correctAnswer.trim() : 'Option 1',
                isCorrect: true
            });
        }

        while (normalized.length < 2) {
            normalized.push({
                id: 'answer-' + (normalized.length + 1),
                text: 'Option ' + (normalized.length + 1),
                isCorrect: normalized.length === 0
            });
        }

        if (!normalized.some(function (answer) { return answer.isCorrect; }) && normalized[0]) {
            normalized[0].isCorrect = true;
        }

        return normalized;
    }

    function toggleEditorState() {
        const hasSelection = selectedQuestionIndex >= 0 && quizData.questions.length > 0;

        els.emptyState.classList.toggle('d-none', hasSelection);
        els.editorCard.classList.toggle('d-none', !hasSelection);
        els.editorForm.classList.toggle('d-none', !hasSelection);
    }

    function syncOptionCounter() {
        const count = els.optionList.querySelectorAll('.option-row').length;
        els.optionCounter.textContent = `${count} options`;
    }

    function showAlert(message, type) {
        els.alertContainer.innerHTML = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${escapeHtml(message)}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
    }

    async function requestJson(url, config) {
        try {
            const response = await fetch(url, config);
            const data = await response.json();
            if (!response.ok) {
                return {
                    success: false,
                    error: data.error || 'Request failed.'
                };
            }
            return data;
        } catch (error) {
            return {
                success: false,
                error: error.message || 'Network error.'
            };
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
})();
