(function () {
    const root = document.getElementById('quizEditorPage');
    if (!root) return;

    const courseId = root.dataset.courseId;
    const sectionIndex = Number(root.dataset.sectionIndex);
    const quizIndex = Number(root.dataset.quizIndex);

    let quizData = { name: '', questions: [] };
    let selectedQuestionIndex = -1;

    try {
        quizData = JSON.parse(root.dataset.quiz || '{}');
    } catch {
        showAlert('Failed to load quiz data.', 'danger');
    }

    if (!Array.isArray(quizData.questions)) {
        quizData.questions = [];
    }

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
            question: '',
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
            question: '',
            options: [
                { text: 'Option 1', correct: true },
                { text: 'Option 2', correct: false }
            ]
        };

        quizData.questions.push(createdQuestion);
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
            options: validation.options,
            correctIndex: validation.correctIndex
        };

        const response = await requestJson(endpoints.update, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.success) {
            showAlert(response.error || 'Unable to save question.', 'danger');
            return;
        }

        quizData.questions[selectedQuestionIndex] = {
            question: validation.question,
            options: validation.options.map(function (option, index) {
                return {
                    text: option.text,
                    correct: index === validation.correctIndex
                };
            })
        };

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

        const normalizedOptions = normalizeQuestionOptions(question.options);
        normalizedOptions.forEach(function (option) {
            addOptionRow(option.text, option.correct);
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
            options,
            correctIndex
        };
    }

    function normalizeQuestionOptions(options) {
        const sourceQuestion = quizData.questions[selectedQuestionIndex] || {};
        const rawOptions = Array.isArray(options) && options.length
            ? options
            : Array.isArray(sourceQuestion.answers)
                ? sourceQuestion.answers
                : [];

        const normalized = rawOptions.map(function (opt) {
            if (typeof opt === 'string') return { text: opt, correct: false };
            return {
                text: String((opt && (opt.text || opt.answer || opt.value)) || ''),
                correct: Boolean(opt && (opt.correct || opt.isCorrect))
            };
        });

        let correctIndex = normalized.findIndex(function (opt) {
            return opt.correct;
        });

        if (correctIndex < 0) {
            const numericCorrectIndex = Number(
                sourceQuestion.correctIndex
                ?? sourceQuestion.correctOptionIndex
                ?? sourceQuestion.correctAnswerIndex
            );

            if (Number.isInteger(numericCorrectIndex) && numericCorrectIndex >= 0 && numericCorrectIndex < normalized.length) {
                correctIndex = numericCorrectIndex;
            }
        }

        if (correctIndex < 0 && typeof sourceQuestion.correctAnswer === 'string') {
            const correctAnswerText = sourceQuestion.correctAnswer.trim().toLowerCase();
            const byLabel = ['a', 'b', 'c', 'd'].indexOf(correctAnswerText);
            if (byLabel >= 0 && byLabel < normalized.length) {
                correctIndex = byLabel;
            } else {
                correctIndex = normalized.findIndex(function (opt) {
                    return String(opt.text || '').trim().toLowerCase() === correctAnswerText;
                });
            }
        }

        if (correctIndex >= 0) {
            normalized.forEach(function (opt, index) {
                opt.correct = index === correctIndex;
            });
        }

        if (normalized.length < 2) {
            while (normalized.length < 2) {
                normalized.push({ text: '', correct: false });
            }
        }

        if (!normalized.some(function (o) { return o.correct; })) {
            normalized[0].correct = true;
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
