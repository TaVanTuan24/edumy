(function() {
  'use strict';

  console.log('[ReflectionEditor] Script loaded');

  var state = {
    courseId: '',
    sectionIndex: 0,
    lessonIndex: 0,
    reflection: null,
    aiSuggestions: [],
    selectedSuggestion: null,
    submissions: [],
    aiSummary: null,
    isLoading: false,
    isSaving: false,
    isGenerating: false,
    isSummaryLoading: false,
    hasInit: false
  };

  // HTML template for the reflection editor form
  function buildFormHTML() {
    return ''
      + '<div class="d-flex align-items-center justify-content-between mb-2">'
      + '  <h6 class="mb-0"><i class="fa-solid fa-pen-to-square me-1"></i>Reflection / Exit Ticket</h6>'
      + '  <div class="form-check form-switch mb-0">'
      + '    <input class="form-check-input" type="checkbox" id="reflectionEnabled">'
      + '    <label class="form-check-label small" for="reflectionEnabled">Enable</label>'
      + '  </div>'
      + '</div>'
      + '<div id="reflectionFormBody" style="display: none;">'
      + '  <div class="mb-3 p-2 bg-light rounded">'
      + '    <div class="d-flex align-items-center gap-2 mb-2">'
      + '      <button id="reflectionAiGenerateBtn" class="btn btn-sm btn-warning" type="button">'
      + '        <i class="fa-solid fa-robot me-1"></i>Generate with AI'
      + '      </button>'
      + '      <span id="reflectionAiStatus" class="small text-muted"></span>'
      + '    </div>'
      + '    <div id="reflectionSuggestionsList" style="display: none;"></div>'
      + '  </div>'
      + '  <div class="mb-2">'
      + '    <label class="form-label small mb-1">Title</label>'
      + '    <input id="reflectionTitle" class="form-control form-control-sm" type="text" value="Exit Ticket" placeholder="Exit Ticket">'
      + '  </div>'
      + '  <div class="mb-2">'
      + '    <label class="form-label small mb-1">Prompt *</label>'
      + '    <textarea id="reflectionPrompt" class="form-control form-control-sm" rows="3" placeholder="Enter the reflection prompt for learners..."></textarea>'
      + '  </div>'
      + '  <div class="mb-2">'
      + '    <label class="form-label small mb-1">Purpose</label>'
      + '    <input id="reflectionPurpose" class="form-control form-control-sm" type="text" placeholder="e.g. Check ability to summarize key concepts">'
      + '  </div>'
      + '  <div class="row g-2 mb-2">'
      + '    <div class="col-6">'
      + '      <label class="form-label small mb-1">Min Length (chars)</label>'
      + '      <input id="reflectionMinLength" class="form-control form-control-sm" type="number" min="0" value="0">'
      + '    </div>'
      + '    <div class="col-6 d-flex align-items-end">'
      + '      <div class="form-check mb-1">'
      + '        <input class="form-check-input" type="checkbox" id="reflectionRequired">'
      + '        <label class="form-check-label small" for="reflectionRequired">Required for completion</label>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="mb-2">'
      + '    <label class="form-label small mb-1 fw-semibold">Rubric (optional)</label>'
      + '    <div class="mb-1">'
      + '      <label class="form-label small mb-0 text-success">Good answer</label>'
      + '      <input id="rubricGood" class="form-control form-control-sm" type="text" placeholder="Criteria for a good answer">'
      + '    </div>'
      + '    <div class="mb-1">'
      + '      <label class="form-label small mb-0 text-warning">Partial answer</label>'
      + '      <input id="rubricPartial" class="form-control form-control-sm" type="text" placeholder="Criteria for a partial answer">'
      + '    </div>'
      + '    <div class="mb-1">'
      + '      <label class="form-label small mb-0 text-danger">Weak answer</label>'
      + '      <input id="rubricWeak" class="form-control form-control-sm" type="text" placeholder="Criteria for a weak answer">'
      + '    </div>'
      + '  </div>'
      + '  <div class="d-flex gap-2 align-items-center mb-2">'
      + '    <button id="reflectionSaveBtn" class="btn btn-sm btn-primary" type="button">'
      + '      <i class="fa-solid fa-save me-1"></i>Save Reflection'
      + '    </button>'
      + '    <span id="reflectionStatus" class="small text-muted"></span>'
      + '  </div>'
      + '</div>';
  }

  function init() {
    var el = document.getElementById('reflection-editor-root');
    console.log('[ReflectionEditor] init called, root element:', el);
    if (!el) return;

    var newCourseId = el.dataset.courseId || '';
    var newSectionIndex = parseInt(el.dataset.sectionIndex, 10) || 0;
    var newLessonIndex = parseInt(el.dataset.lessonIndex, 10) || 0;

    console.log('[ReflectionEditor] Initializing for course:', newCourseId, 'section:', newSectionIndex, 'lesson:', newLessonIndex);

    // Skip reinit if same lesson
    if (
      state.courseId === newCourseId &&
      state.sectionIndex === newSectionIndex &&
      state.lessonIndex === newLessonIndex &&
      state.hasInit
    ) {
      console.log('[ReflectionEditor] Skipping reinit - same lesson');
      return;
    }

    state.courseId = newCourseId;
    state.sectionIndex = newSectionIndex;
    state.lessonIndex = newLessonIndex;
    state.reflection = null;
    state.aiSuggestions = [];
    state.selectedSuggestion = null;
    state.submissions = [];
    state.aiSummary = null;
    state.hasInit = true;

    // Inject the form HTML into the root div
    el.innerHTML = buildFormHTML();
    console.log('[ReflectionEditor] Form HTML injected');

    bindToggle();
    bindSave();
    bindGenerateAi();
    bindSubmissions();
    bindAiSummary();

    loadReflectionConfig();
    console.log('[ReflectionEditor] Init complete');
  }

  // Watch for dynamic insertion of #reflection-editor-root
  function observeReflectionRoot() {
    if (typeof MutationObserver === 'undefined') return;

    console.log('[ReflectionEditor] Setting up MutationObserver');

    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.id === 'reflection-editor-root' || (node.querySelector && node.querySelector('#reflection-editor-root'))) {
            console.log('[ReflectionEditor] MutationObserver detected root element');
            // Use setTimeout to ensure DOM is fully settled
            setTimeout(init, 50);
            return;
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Also expose init globally for manual triggering
  window.ReflectionEditorInit = init;

  // ---- Data Loading ----

  function loadReflectionConfig() {
    if (!state.courseId) return;

    fetch('/courses/' + encodeURIComponent(state.courseId) + '/lessons/' + state.sectionIndex + '/' + state.lessonIndex + '/reflection', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.success && data.reflection) {
        state.reflection = data.reflection;
        fillForm(data.reflection);
        updateEnabledUI();
      }
    })
    .catch(function(err) {
      console.error('[Reflection Editor] Load error:', err);
    });
  }

  function fillForm(ref) {
    setVal('reflectionEnabled', ref.enabled ? 'on' : '');
    var toggleEl = document.getElementById('reflectionEnabled');
    if (toggleEl) toggleEl.checked = Boolean(ref.enabled);

    setVal('reflectionTitle', ref.title || 'Exit Ticket');
    setVal('reflectionPrompt', ref.prompt || '');
    setVal('reflectionPurpose', ref.purpose || '');
    setVal('reflectionMinLength', ref.minLength || 0);

    var reqEl = document.getElementById('reflectionRequired');
    if (reqEl) reqEl.checked = Boolean(ref.required);

    setVal('rubricGood', ref.rubric && ref.rubric.good || '');
    setVal('rubricPartial', ref.rubric && ref.rubric.partial || '');
    setVal('rubricWeak', ref.rubric && ref.rubric.weak || '');
  }

  function updateEnabledUI() {
    var toggleEl = document.getElementById('reflectionEnabled');
    var formEl = document.getElementById('reflectionFormBody');
    if (!toggleEl || !formEl) return;

    formEl.style.display = toggleEl.checked ? '' : 'none';
  }

  // ---- Event Bindings ----

  function bindToggle() {
    var toggleEl = document.getElementById('reflectionEnabled');
    if (!toggleEl) return;

    toggleEl.addEventListener('change', function() {
      updateEnabledUI();
    });
  }

  function bindSave() {
    var saveBtn = document.getElementById('reflectionSaveBtn');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', function() {
      saveReflectionConfig();
    });
  }

  function bindGenerateAi() {
    var aiBtn = document.getElementById('reflectionAiGenerateBtn');
    if (!aiBtn) return;

    aiBtn.addEventListener('click', function() {
      generateAiSuggestions();
    });
  }

  function bindSubmissions() {
    var viewBtn = document.getElementById('reflectionViewSubmissionsBtn');
    if (!viewBtn) return;

    viewBtn.addEventListener('click', function() {
      loadSubmissions();
    });
  }

  function bindAiSummary() {
    var summaryBtn = document.getElementById('reflectionAiSummaryBtn');
    if (!summaryBtn) return;

    summaryBtn.addEventListener('click', function() {
      generateAiSummary();
    });
  }

  // ---- Save ----

  function saveReflectionConfig() {
    if (state.isSaving) return;

    var toggleEl = document.getElementById('reflectionEnabled');
    var requiredEl = document.getElementById('reflectionRequired');

    var body = {
      enabled: toggleEl ? toggleEl.checked : false,
      title: getVal('reflectionTitle'),
      prompt: getVal('reflectionPrompt'),
      purpose: getVal('reflectionPurpose'),
      required: requiredEl ? requiredEl.checked : false,
      minLength: parseInt(getVal('reflectionMinLength'), 10) || 0,
      rubric: {
        good: getVal('rubricGood'),
        partial: getVal('rubricPartial'),
        weak: getVal('rubricWeak')
      },
      webOnly: true,
      createdByAI: state.selectedSuggestion ? true : false
    };

    if (body.enabled && !body.prompt) {
      showStatus('reflectionStatus', 'Prompt is required when reflection is enabled.', true);
      return;
    }

    state.isSaving = true;
    showStatus('reflectionStatus', 'Saving...');

    var csrfFetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
    csrfFetcher('/courses/' + encodeURIComponent(state.courseId) + '/lessons/' + state.sectionIndex + '/' + state.lessonIndex + '/reflection', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.success) {
        state.reflection = data.reflection;
        showStatus('reflectionStatus', 'Reflection saved successfully.', false, 'success');
      } else {
        showStatus('reflectionStatus', data && data.error || 'Failed to save.', true);
      }
    })
    .catch(function(err) {
      showStatus('reflectionStatus', 'Network error: ' + err.message, true);
    })
    .finally(function() {
      state.isSaving = false;
    });
  }

  // ---- AI Suggestions ----

  function generateAiSuggestions() {
    if (state.isGenerating) return;

    state.isGenerating = true;
    state.aiSuggestions = [];
    hideElement('reflectionSuggestionsList');
    showStatus('reflectionAiStatus', 'Generating AI suggestions...');

    var aiBtn = document.getElementById('reflectionAiGenerateBtn');
    if (aiBtn) aiBtn.disabled = true;

    var csrfFetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
    csrfFetcher('/courses/' + encodeURIComponent(state.courseId) + '/lessons/' + state.sectionIndex + '/' + state.lessonIndex + '/reflection/generate-ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({})
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.success && Array.isArray(data.suggestions) && data.suggestions.length) {
        state.aiSuggestions = data.suggestions;
        renderSuggestionsList();
        showStatus('reflectionAiStatus', data.suggestions.length + ' suggestions generated. Select one to fill the form.', false, 'success');
      } else {
        showStatus('reflectionAiStatus', data && data.error || 'AI returned no suggestions.', true);
      }
    })
    .catch(function(err) {
      showStatus('reflectionAiStatus', 'AI generation failed: ' + err.message, true);
    })
    .finally(function() {
      state.isGenerating = false;
      if (aiBtn) aiBtn.disabled = false;
    });
  }

  function renderSuggestionsList() {
    var container = document.getElementById('reflectionSuggestionsList');
    if (!container) return;

    if (!state.aiSuggestions.length) {
      container.innerHTML = '';
      hideElement('reflectionSuggestionsList');
      return;
    }

    var html = '';
    for (var i = 0; i < state.aiSuggestions.length; i++) {
      var s = state.aiSuggestions[i];
      html += '<div class="card mb-2 reflection-suggestion-card" data-suggestion-index="' + i + '">'
        + '<div class="card-body p-2">'
        + '<p class="mb-1 small fw-bold">' + escapeHtml(s.title || 'Exit Ticket') + '</p>'
        + '<p class="mb-1 small">' + escapeHtml(s.prompt || '') + '</p>'
        + '<p class="mb-1 small text-muted">' + escapeHtml(s.purpose || '') + '</p>'
        + '<button type="button" class="btn btn-sm btn-outline-primary reflection-select-btn" data-suggestion-index="' + i + '">Use This</button>'
        + '</div></div>';
    }

    container.innerHTML = html;
    showElement('reflectionSuggestionsList');

    // Bind select buttons
    var buttons = container.querySelectorAll('.reflection-select-btn');
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].addEventListener('click', function(e) {
        var idx = parseInt(e.target.dataset.suggestionIndex, 10);
        selectSuggestion(idx);
      });
    }
  }

  function selectSuggestion(index) {
    var s = state.aiSuggestions[index];
    if (!s) return;

    state.selectedSuggestion = s;

    setVal('reflectionTitle', s.title || 'Exit Ticket');
    setVal('reflectionPrompt', s.prompt || '');
    setVal('reflectionPurpose', s.purpose || '');
    setVal('reflectionMinLength', s.suggestedMinLength || 50);

    var reqEl = document.getElementById('reflectionRequired');
    if (reqEl) reqEl.checked = s.required !== false;

    setVal('rubricGood', s.rubric && s.rubric.good || '');
    setVal('rubricPartial', s.rubric && s.rubric.partial || '');
    setVal('rubricWeak', s.rubric && s.rubric.weak || '');

    showStatus('reflectionAiStatus', 'Suggestion applied. Review and save.', false, 'success');

    // Enable toggle and show form
    var toggleEl = document.getElementById('reflectionEnabled');
    if (toggleEl) toggleEl.checked = true;
    updateEnabledUI();
  }

  // ---- Submissions ----

  function loadSubmissions() {
    showStatus('reflectionSubmissionsStatus', 'Loading submissions...');

    var csrfFetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
    csrfFetcher('/courses/' + encodeURIComponent(state.courseId) + '/lessons/' + state.sectionIndex + '/' + state.lessonIndex + '/reflection/submissions', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.success) {
        state.submissions = Array.isArray(data.submissions) ? data.submissions : [];
        renderSubmissions();
        showStatus('reflectionSubmissionsStatus', state.submissions.length + ' submissions found.', false, 'success');
      } else {
        showStatus('reflectionSubmissionsStatus', data && data.error || 'Failed to load.', true);
      }
    })
    .catch(function(err) {
      showStatus('reflectionSubmissionsStatus', 'Error: ' + err.message, true);
    });
  }

  function renderSubmissions() {
    var container = document.getElementById('reflectionSubmissionsList');
    if (!container) return;

    if (!state.submissions.length) {
      container.innerHTML = '<p class="text-muted small">No submissions yet.</p>';
      showElement('reflectionSubmissionsPanel');
      return;
    }

    var html = '<div class="small text-muted mb-2">' + state.submissions.length + ' submission(s)</div>';
    for (var i = 0; i < state.submissions.length; i++) {
      var s = state.submissions[i];
      var userName = s.user && (s.user.username || s.user.email) || 'Learner';
      var date = s.createdAt ? new Date(s.createdAt).toLocaleString() : '';

      html += '<div class="card mb-2">'
        + '<div class="card-body p-2">'
        + '<div class="d-flex justify-content-between align-items-center mb-1">'
        + '<strong class="small">' + escapeHtml(userName) + '</strong>'
        + '<span class="text-muted" style="font-size:0.72rem">' + date + '</span>'
        + '</div>'
        + '<p class="mb-0 small">' + escapeHtml(s.answer || '') + '</p>'
        + '<span class="text-muted" style="font-size:0.7rem">' + (s.wordCount || 0) + ' words</span>'
        + '</div></div>';
    }

    container.innerHTML = html;
    showElement('reflectionSubmissionsPanel');
  }

  // ---- AI Summary ----

  function generateAiSummary() {
    if (state.isSummaryLoading) return;

    state.isSummaryLoading = true;
    hideElement('reflectionSummaryResult');
    showStatus('reflectionSubmissionsStatus', 'Generating AI summary...');

    var btn = document.getElementById('reflectionAiSummaryBtn');
    if (btn) btn.disabled = true;

    var csrfFetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
    csrfFetcher('/courses/' + encodeURIComponent(state.courseId) + '/lessons/' + state.sectionIndex + '/' + state.lessonIndex + '/reflection/ai-summary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({})
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.success && data.summary) {
        state.aiSummary = data.summary;
        renderAiSummary(data.summary, data.submissionCount);
        showStatus('reflectionSubmissionsStatus', 'AI summary generated from ' + (data.submissionCount || 0) + ' submissions.', false, 'success');
      } else {
        showStatus('reflectionSubmissionsStatus', data && data.error || 'AI summary failed.', true);
      }
    })
    .catch(function(err) {
      showStatus('reflectionSubmissionsStatus', 'Error: ' + err.message, true);
    })
    .finally(function() {
      state.isSummaryLoading = false;
      if (btn) btn.disabled = false;
    });
  }

  function renderAiSummary(summary, count) {
    var container = document.getElementById('reflectionSummaryResult');
    if (!container) return;

    var html = '<div class="card border-primary">'
      + '<div class="card-body p-2">'
      + '<h6 class="card-title small">AI Summary (' + (count || 0) + ' submissions)</h6>';

    if (summary.commonUnderstandings && summary.commonUnderstandings.length) {
      html += '<div class="mb-2"><strong class="small">Common Understandings:</strong><ul class="mb-0 small">';
      for (let i = 0; i < summary.commonUnderstandings.length; i++) {
        html += '<li>' + escapeHtml(summary.commonUnderstandings[i]) + '</li>';
      }
      html += '</ul></div>';
    }

    if (summary.commonConfusions && summary.commonConfusions.length) {
      html += '<div class="mb-2"><strong class="small">Common Confusions:</strong><ul class="mb-0 small">';
      for (let i = 0; i < summary.commonConfusions.length; i++) {
        html += '<li>' + escapeHtml(summary.commonConfusions[i]) + '</li>';
      }
      html += '</ul></div>';
    }

    if (summary.representativeResponses && summary.representativeResponses.length) {
      html += '<div class="mb-2"><strong class="small">Representative Responses:</strong><ul class="mb-0 small">';
      for (let i = 0; i < summary.representativeResponses.length; i++) {
        html += '<li><em>' + escapeHtml(summary.representativeResponses[i]) + '</em></li>';
      }
      html += '</ul></div>';
    }

    if (summary.improvementSuggestions && summary.improvementSuggestions.length) {
      html += '<div class="mb-2"><strong class="small">Improvement Suggestions:</strong><ul class="mb-0 small">';
      for (let i = 0; i < summary.improvementSuggestions.length; i++) {
        html += '<li>' + escapeHtml(summary.improvementSuggestions[i]) + '</li>';
      }
      html += '</ul></div>';
    }

    if (summary.overallInsight) {
      html += '<div><strong class="small">Overall Insight:</strong><p class="mb-0 small">' + escapeHtml(summary.overallInsight) + '</p></div>';
    }

    html += '</div></div>';

    container.innerHTML = html;
    showElement('reflectionSummaryResult');
  }

  // ---- Helpers ----

  function getVal(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function setVal(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value || '';
  }

  function showStatus(elementId, message, isError, variant) {
    var el = document.getElementById(elementId);
    if (!el) return;

    el.textContent = message || '';
    el.className = 'small mt-1';

    if (isError) {
      el.classList.add('text-danger');
    } else if (variant === 'success') {
      el.classList.add('text-success');
    } else {
      el.classList.add('text-muted');
    }

    el.style.display = '';
  }

  function showElement(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = '';
  }

  function hideElement(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '\x26amp;')
      .replace(/</g, '\x26lt;')
      .replace(/>/g, '\x26gt;')
      .replace(/"/g, '\x26quot;')
      .replace(/'/g, '\x26#39;');
  }

  document.addEventListener('DOMContentLoaded', function() {
    init();
    observeReflectionRoot();
  });
})();
