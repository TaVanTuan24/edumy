(function() {
  'use strict';

  let quizData = [];
  let isGenerating = false;

  document.addEventListener('DOMContentLoaded', function() {
    const generateBtn = document.getElementById('generateQuizBtn');
    const generateMoreBtn = document.getElementById('generateMoreBtn');
    const addQuestionBtn = document.getElementById('addQuestionBtn');
    const saveBtn = document.getElementById('saveQuizBtn');

    if (generateBtn) generateBtn.addEventListener('click', function() { generateQuiz(false); });
    if (generateMoreBtn) generateMoreBtn.addEventListener('click', function() { generateQuiz(true); });
    if (addQuestionBtn) addQuestionBtn.addEventListener('click', addQuestion);
    if (saveBtn) saveBtn.addEventListener('click', saveQuiz);

    renderQuizEditor();
  });

  function setStatus(text, isError) {
    const status = document.getElementById('aiStatus');
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? '#b91c1c' : '#475569';
  }

  function getPrompt() {
    return String(document.getElementById('aiPrompt')?.value || '').trim();
  }

  function getTitle() {
    return String(document.getElementById('quizTitle')?.value || '').trim() || 'AI Generated Quiz';
  }

  function getDifficulty() {
    return String(document.getElementById('aiDifficulty')?.value || 'medium');
  }

  function getCount() {
    const raw = parseInt(document.getElementById('aiCount')?.value, 10) || 5;
    return Math.min(Math.max(raw, 1), 10);
  }

  function generateQuiz(append) {
    if (isGenerating) return;
    const prompt = getPrompt();
    if (!prompt) {
      setStatus('Please enter a topic or prompt.', true);
      return;
    }

    isGenerating = true;
    setStatus('Generating quiz...', false);

    fetch('/ai/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        difficulty: getDifficulty(),
        count: getCount()
      })
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.success) {
          throw new Error(data && data.error ? data.error : 'Generation failed');
        }

        const normalized = normalizeQuestions(data.questions || []);
        if (append) {
          quizData = quizData.concat(normalized);
        } else {
          quizData = normalized;
        }

        setStatus('Quiz generated. You can edit the questions below.', false);
        renderQuizEditor();
      })
      .catch(function(err) {
        console.error('[AI Quiz]', err);
        setStatus('Failed to generate quiz. Please try again.', true);
      })
      .finally(function() {
        isGenerating = false;
      });
  }

  function renderQuizEditor() {
    const container = document.getElementById('quizEditor');
    if (!container) return;

    if (!quizData.length) {
      container.innerHTML = '<p class="text-muted">No questions yet. Generate a quiz or add a question.</p>';
      return;
    }

    container.innerHTML = quizData.map(function(q, i) {
      return (
        '<div class="quiz-item" data-index="' + i + '">'
          + '<h6>Question ' + (i + 1) + '</h6>'
          + '<input class="form-control" data-role="question" value="' + escapeHtml(q.question) + '" />'
          + (q.answers || []).map(function(a, j) {
            return (
              '<div class="answer-row">'
                + '<input type="radio" name="q' + i + '" data-role="correct" data-qindex="' + i + '" data-aindex="' + j + '" ' + (a.correct ? 'checked' : '') + ' />'
                + '<input type="text" class="form-control" data-role="answer" data-qindex="' + i + '" data-aindex="' + j + '" value="' + escapeHtml(a.text) + '" />'
                + '<button class="btn btn-sm btn-outline-danger" data-role="delete-answer" data-qindex="' + i + '" data-aindex="' + j + '">Delete</button>'
              + '</div>'
            );
          }).join('')
          + '<div class="quiz-actions">'
            + '<button class="btn btn-sm btn-outline-secondary" data-role="add-answer" data-qindex="' + i + '">Add answer</button>'
            + '<button class="btn btn-sm btn-outline-danger" data-role="delete-question" data-qindex="' + i + '">Delete question</button>'
          + '</div>'
        + '</div>'
      );
    }).join('');

    bindEditorEvents(container);
  }

  function normalizeQuestions(questions) {
    return (questions || []).map(function(q) {
      const answers = Array.isArray(q.answers) ? q.answers.slice() : [];
      while (answers.length < 4) {
        answers.push({ text: 'Placeholder answer', correct: false });
      }
      if (answers.length > 4) answers.length = 4;

      let correctIndex = answers.findIndex(function(a) { return a.correct; });
      if (correctIndex < 0) correctIndex = 0;
      answers.forEach(function(a, idx) { a.correct = idx === correctIndex; });

      return {
        question: String(q.question || '').trim() || 'Untitled question',
        answers: answers
      };
    });
  }

  function bindEditorEvents(container) {
    container.querySelectorAll('[data-role="question"]').forEach(function(input) {
      input.addEventListener('input', function() {
        const idx = getItemIndex(input);
        if (quizData[idx]) quizData[idx].question = String(input.value || '').trim();
      });
    });

    container.querySelectorAll('[data-role="answer"]').forEach(function(input) {
      input.addEventListener('input', function() {
        const qIndex = Number(input.dataset.qindex);
        const aIndex = Number(input.dataset.aindex);
        if (quizData[qIndex] && quizData[qIndex].answers[aIndex]) {
          quizData[qIndex].answers[aIndex].text = String(input.value || '').trim();
        }
      });
    });

    container.querySelectorAll('[data-role="correct"]').forEach(function(input) {
      input.addEventListener('change', function() {
        const qIndex = Number(input.dataset.qindex);
        const aIndex = Number(input.dataset.aindex);
        setCorrect(qIndex, aIndex);
      });
    });

    container.querySelectorAll('[data-role="add-answer"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const qIndex = Number(btn.dataset.qindex);
        addAnswer(qIndex);
      });
    });

    container.querySelectorAll('[data-role="delete-answer"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const qIndex = Number(btn.dataset.qindex);
        const aIndex = Number(btn.dataset.aindex);
        deleteAnswer(qIndex, aIndex);
      });
    });

    container.querySelectorAll('[data-role="delete-question"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const qIndex = Number(btn.dataset.qindex);
        deleteQuestion(qIndex);
      });
    });
  }

  function getItemIndex(node) {
    const wrapper = node.closest('.quiz-item');
    return wrapper ? Number(wrapper.dataset.index) : -1;
  }

  function addQuestion() {
    quizData.push({
      question: 'New question',
      answers: [
        { text: 'Option 1', correct: true },
        { text: 'Option 2', correct: false }
      ]
    });
    renderQuizEditor();
  }

  function addAnswer(qIndex) {
    if (!quizData[qIndex]) return;
    quizData[qIndex].answers.push({ text: 'New option', correct: false });
    renderQuizEditor();
  }

  function deleteAnswer(qIndex, aIndex) {
    if (!quizData[qIndex]) return;
    quizData[qIndex].answers.splice(aIndex, 1);
    if (!quizData[qIndex].answers.some(function(a) { return a.correct; })) {
      if (quizData[qIndex].answers[0]) quizData[qIndex].answers[0].correct = true;
    }
    renderQuizEditor();
  }

  function deleteQuestion(qIndex) {
    quizData.splice(qIndex, 1);
    renderQuizEditor();
  }

  function setCorrect(qIndex, aIndex) {
    if (!quizData[qIndex]) return;
    quizData[qIndex].answers.forEach(function(answer, idx) {
      answer.correct = idx === aIndex;
    });
    renderQuizEditor();
  }

  function saveQuiz() {
    if (!quizData.length) {
      setStatus('Add at least one question before saving.', true);
      return;
    }

    const payload = {
      type: 'quiz',
      title: getTitle(),
      data: { quiz: quizData }
    };

    setStatus('Saving quiz to library...', false);

    fetch('/api/admin/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.success) {
          throw new Error(data && data.error ? data.error : 'Save failed');
        }
        setStatus('Quiz saved to Content Library.', false);
      })
      .catch(function(err) {
        console.error('[AI Quiz Save]', err);
        setStatus('Failed to save quiz. Please try again.', true);
      });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
