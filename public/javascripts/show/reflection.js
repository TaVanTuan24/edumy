(function() {
  'use strict';

  console.log('[ReflectionGate] Script loaded');

  var state = {
    courseId: '',
    currentLessonId: '',
    currentSectionIndex: -1,
    currentLessonIndex: -1,
    reflectionCache: {},  // lessonId -> { reflection, submission }
    pendingCheckbox: null,
    pendingLessonId: null
  };

  // ==================== INIT ====================

  function init() {
    var container = document.getElementById('reflection-learner-root');
    if (container) {
      state.courseId = container.dataset.courseId || '';
    }
    if (!state.courseId && window.__COURSE__ && window.__COURSE__._id) {
      state.courseId = String(window.__COURSE__._id);
    }

    console.log('[ReflectionGate] courseId:', state.courseId);

    // Intercept checkbox completion flow
    interceptCompletionCheckbox();

    // Track current lesson
    window.addEventListener('lessonchange', function(e) {
      var detail = e.detail || {};
      state.currentLessonId = detail.lessonId || '';
      var indexes = findLessonIndexes(state.currentLessonId);
      if (indexes) {
        state.currentSectionIndex = indexes.sectionIndex;
        state.currentLessonIndex = indexes.lessonIndex;
      }
    });

    // Also try to detect current lesson on load
    setTimeout(function() {
      if (!state.currentLessonId && window.LearningStore && window.LearningStore.store) {
        var store = window.LearningStore.store;
        if (store.activeLessonId) {
          state.currentLessonId = store.activeLessonId;
          state.currentSectionIndex = store.currentSectionIndex || 0;
          state.currentLessonIndex = store.currentLessonIndex || 0;
        }
      }
    }, 300);
  }

  // ==================== INTERCEPT COMPLETION CHECKBOX ====================

  function interceptCompletionCheckbox() {
    // Use capture phase to intercept before app.js handler
    document.addEventListener('change', function(e) {
      var checkbox = e.target;
      if (!checkbox || !checkbox.classList || !checkbox.classList.contains('lesson-progress-checkbox')) {
        return;
      }

      // Only intercept when checking (completing), not unchecking
      if (!checkbox.checked) {
        return;
      }

      console.log('[ReflectionGate] Checkbox checked, intercepting...');

      var ctx = getLessonContext(checkbox);
      console.log('[ReflectionGate] resolved context:', ctx);

      if (!ctx) {
        console.warn('[ReflectionGate] Missing courseId/sectionIndex/lessonIndex, letting completion proceed');
        return;
      }

      // Prevent default completion, check reflection first
      e.stopImmediatePropagation();
      e.preventDefault();

      // Temporarily uncheck until reflection is resolved
      checkbox.checked = false;

      handleCompletionWithReflection(ctx.lessonId || '', ctx.sectionIndex, ctx.lessonIndex, checkbox);
    }, true); // capture: true to run before app.js handler
  }

  async function handleCompletionWithReflection(lessonId, sectionIndex, lessonIndex, checkbox) {
    try {
      var reflectionData = await loadReflectionData(lessonId, sectionIndex, lessonIndex);

      // Check if reflection exists using hasReflection flag OR reflection.enabled
      var hasReflection = Boolean(
        reflectionData && (
          reflectionData.hasReflection === true ||
          (reflectionData.reflection && reflectionData.reflection.enabled === true) ||
          (reflectionData.reflection && reflectionData.reflection.enabled === 'true') ||
          (reflectionData.reflection && reflectionData.hasReflection !== false && reflectionData.reflection.prompt)
        )
      );

      if (!hasReflection) {
        // No reflection — allow completion
        console.log('[ReflectionGate] No reflection, allowing completion', {
          hasData: !!reflectionData,
          hasReflectionFlag: reflectionData && reflectionData.hasReflection,
          enabled: reflectionData && reflectionData.reflection && reflectionData.reflection.enabled,
          hasPrompt: !!(reflectionData && reflectionData.reflection && reflectionData.reflection.prompt)
        });
        allowCompletion(lessonId, checkbox);
        return;
      }

      var submission = reflectionData.submission;
      if (submission && submission.answer) {
        // Already submitted — allow completion
        console.log('[ReflectionGate] Already submitted, allowing completion');
        allowCompletion(lessonId, checkbox);
        return;
      }

      var reflection = reflectionData.reflection;
      console.log('[ReflectionGate] Reflection enabled, showing modal. required:', reflection.required);

      // Show modal
      showReflectionModal(reflection, lessonId, sectionIndex, lessonIndex, checkbox);
    } catch (err) {
      console.error('[ReflectionGate] Error checking reflection:', err);
      // On error, allow completion to avoid blocking learner
      allowCompletion(lessonId, checkbox);
    }
  }

  // ==================== LOAD REFLECTION DATA ====================

  async function loadReflectionData(lessonId, sectionIndex, lessonIndex) {
    // Check cache first
    if (state.reflectionCache[lessonId]) {
      var cached = state.reflectionCache[lessonId];
      if (cached._fetchedAt && Date.now() - cached._fetchedAt < 30000) {
        return cached;
      }
    }

    var url = '/courses/' + encodeURIComponent(state.courseId) + '/lessons/' + sectionIndex + '/' + lessonIndex + '/reflection/view';
    if (lessonId) {
      url += '?lessonId=' + encodeURIComponent(lessonId);
    }

    try {
      console.log('[ReflectionGate] Loading reflection:', url);
      var res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      var data = await res.json();

      console.log('[ReflectionGate] Reflection API response:', data);

      if (data && data.success) {
        data._fetchedAt = Date.now();
        state.reflectionCache[lessonId] = data;
        return data;
      }
    } catch (err) {
      console.error('[ReflectionGate] Failed to load reflection:', err);
    }

    return null;
  }

  // ==================== COMPLETION HELPERS ====================

  function allowCompletion(lessonId, checkbox) {
    // Set checkbox back to checked
    checkbox.checked = true;

    // Call the original completion handler
    if (typeof window.LearningStore !== 'undefined' && window.LearningStore.store) {
      // Use the store's setLessonProgress
      window.LearningStore.setLessonProgress(lessonId, true);

      // Also trigger the backend sync
      var lesson = window.LearningStore.getLessonById(lessonId);
      if (lesson) {
        var videoUrl = lesson.preview || (lesson.content && lesson.content.videoUrl) || '';
        syncCompletionBackend(videoUrl, true, lessonId);
      }
    }

    // Refresh UI
    if (window.LearningRender && window.LearningRender.renderLessonList) {
      var store = window.LearningStore.store;
      window.LearningRender.renderLessonList(store.currentSectionIndex);
    }
    if (window.LearningRender && window.LearningRender.updateSidebarUI) {
      window.LearningRender.updateSidebarUI({ preserveCollapsedActiveSection: true });
    }

    // Refresh gamification (defined as a global in show/app.js)
    if (typeof window.refreshGamificationUI === 'function') {
      window.refreshGamificationUI();
    }
  }

  function syncCompletionBackend(videoUrl, completed, lessonId) {
    var course = window.__COURSE__ || {};
    var courseId = state.courseId || String(course._id || '');
    var lesson = window.LearningStore ? window.LearningStore.getLessonById(lessonId) : null;

    return fetch('/courses/' + encodeURIComponent(courseId) + '/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video: videoUrl || '',
        completed: !!completed,
        lessonId: lessonId,
        lessonName: lesson && lesson.title || '',
        lessonType: lesson && lesson.type || '',
        sectionIndex: lesson && lesson.sectionIndex,
        lessonIndex: lesson && lesson.lessonIndex
      })
    }).catch(function(err) {
      console.error('[ReflectionGate] Backend sync error:', err);
    });
  }

  function cancelCompletion(checkbox) {
    checkbox.checked = false;
  }

  // ==================== MODAL ====================

  function showReflectionModal(reflection, lessonId, sectionIndex, lessonIndex, checkbox) {
    var modal = document.getElementById('reflectionGateModal');
    if (!modal) {
      console.error('[ReflectionGate] Modal element not found');
      allowCompletion(lessonId, checkbox);
      return;
    }

    var titleEl = document.getElementById('reflectionGateTitle');
    var subtitleEl = document.getElementById('reflectionGateSubtitle');
    var promptEl = document.getElementById('reflectionGatePrompt');
    var purposeEl = document.getElementById('reflectionGatePurpose');
    var textareaEl = document.getElementById('reflectionGateAnswer');
    var minLengthHint = document.getElementById('reflectionGateMinLength');
    var submitBtn = document.getElementById('reflectionGateSubmitBtn');
    var skipBtn = document.getElementById('reflectionGateSkipBtn');
    var cancelBtn = document.getElementById('reflectionGateCancelBtn');
    var closeBtn = document.getElementById('reflectionGateCloseBtn');
    var openNoteBtn = document.getElementById('reflectionGateOpenNoteBtn');
    var errorEl = document.getElementById('reflectionGateError');
    var backdrop = document.getElementById('reflectionGateBackdrop');

    // Populate
    if (titleEl) titleEl.textContent = reflection.title || 'Exit Ticket';
    if (subtitleEl) {
      subtitleEl.textContent = reflection.required
        ? 'Please complete this short reflection before marking the lesson as complete.'
        : 'You can submit a short reflection before completing this lesson, or skip it.';
    }
    if (promptEl) promptEl.textContent = reflection.prompt || '';
    if (purposeEl) {
      purposeEl.textContent = reflection.purpose || '';
      purposeEl.style.display = reflection.purpose ? '' : 'none';
    }
    if (textareaEl) {
      textareaEl.value = '';
      textareaEl.placeholder = 'Write your reflection here...';
    }
    if (minLengthHint) {
      if (reflection.minLength > 0) {
        minLengthHint.textContent = 'Minimum length: ' + reflection.minLength + ' characters';
        minLengthHint.style.display = '';
      } else {
        minLengthHint.style.display = 'none';
      }
    }
    if (skipBtn) {
      if (reflection.required) {
        skipBtn.hidden = true;
      } else {
        skipBtn.hidden = false;
      }
    }
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }

    // Enable/disable submit
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane me-1"></i>Submit Reflection';
    }

    // Bind handlers via cloning to remove old listeners
    function handleSubmit() {
      var answer = textareaEl ? textareaEl.value.trim() : '';
      if (!answer) {
        showGateError('Please enter your reflection.');
        return;
      }
      if (reflection.minLength > 0 && answer.length < reflection.minLength) {
        showGateError('Answer must be at least ' + reflection.minLength + ' characters. Your answer is ' + answer.length + ' characters.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Submitting...';

      submitReflectionAnswer(lessonId, sectionIndex, lessonIndex, answer)
        .then(function(data) {
          if (data && data.success) {
            if (state.reflectionCache[lessonId]) {
              state.reflectionCache[lessonId].submission = data.submission;
            }
            closeModal();
            allowCompletion(lessonId, checkbox);
          } else {
            showGateError(data && data.error || 'Failed to submit.');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane me-1"></i>Submit Reflection';
          }
        })
        .catch(function(err) {
          showGateError('Network error: ' + err.message);
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane me-1"></i>Submit Reflection';
        });
    }

    function handleSkip() {
      closeModal();
      allowCompletion(lessonId, checkbox);
    }

    function handleCancel() {
      closeModal();
      cancelCompletion(checkbox);
    }

    function handleOpenNote() {
      var modal = document.getElementById('reflectionGateModal');
      var notePanel = document.getElementById('reflectionGateNotePanel');
      var noteLabel = document.getElementById('reflectionGateOpenNoteLabel');
      var noteContent = document.getElementById('reflectionGateNoteContent');

      if (!modal || !notePanel) return;

      var isOpen = !notePanel.hidden;

      if (isOpen) {
        // Close note panel
        modal.classList.remove('note-open');
        notePanel.hidden = true;
        if (noteLabel) noteLabel.textContent = 'Open Note';
        return;
      }

      // Open note panel — populate with current section's notes
      if (noteContent) {
        var sectionIndex = state.currentSectionIndex;
        var noteTextarea = document.getElementById('note-section-' + sectionIndex);
        var sectionNotes = window.sectionNotes || [];
        var noteText = (noteTextarea ? noteTextarea.value : '') || sectionNotes[sectionIndex] || '';

        noteContent.innerHTML = ''
          + '<p class="small text-muted mb-2">Notes for Section ' + (sectionIndex + 1) + '</p>'
          + '<textarea class="form-control" id="reflectionNoteMirror" rows="12" '
          + 'placeholder="Write your notes here..." '
          + 'style="width:100%;min-height:300px;resize:vertical;padding:12px;border-radius:10px;border:1px solid #cbd5e1;font-size:14px;line-height:1.5;font-family:inherit">'
          + escapeHtml(noteText)
          + '</textarea>'
          + '<p class="small text-muted mt-2 mb-0" style="font-size:0.75rem">Notes are saved automatically when you leave the textarea.</p>';

        // Sync note changes back to the main note textarea
        var mirror = document.getElementById('reflectionNoteMirror');
        if (mirror) {
          mirror.addEventListener('blur', function() {
            var original = document.getElementById('note-section-' + sectionIndex);
            if (original) {
              original.value = mirror.value;
              // Trigger the save if saveNote exists
              if (typeof window.saveNote === 'function') {
                window.saveNote(sectionIndex);
              } else if (original.onblur) {
                original.onblur();
              }
            }
          });
        }
      }

      modal.classList.add('note-open');
      notePanel.hidden = false;
      if (noteLabel) noteLabel.textContent = 'Close Note';
    }

    // Clone nodes to remove old listeners
    if (submitBtn) {
      var newSubmitBtn = submitBtn.cloneNode(true);
      submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
      newSubmitBtn.addEventListener('click', handleSubmit);
    }

    if (skipBtn) {
      var newSkipBtn = skipBtn.cloneNode(true);
      skipBtn.parentNode.replaceChild(newSkipBtn, skipBtn);
      newSkipBtn.addEventListener('click', handleSkip);
    }

    if (cancelBtn) {
      var newCancelBtn = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
      newCancelBtn.addEventListener('click', handleCancel);
    }

    if (closeBtn) {
      var newCloseBtn = closeBtn.cloneNode(true);
      closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
      newCloseBtn.addEventListener('click', handleCancel);
    }

    if (backdrop) {
      var newBackdrop = backdrop.cloneNode(true);
      backdrop.parentNode.replaceChild(newBackdrop, backdrop);
      newBackdrop.addEventListener('click', handleCancel);
    }

    if (openNoteBtn) {
      var newOpenNoteBtn = openNoteBtn.cloneNode(true);
      openNoteBtn.parentNode.replaceChild(newOpenNoteBtn, openNoteBtn);
      newOpenNoteBtn.addEventListener('click', handleOpenNote);
    }

    var closeNoteBtn = document.getElementById('reflectionGateCloseNoteBtn');
    if (closeNoteBtn) {
      var newCloseNoteBtn = closeNoteBtn.cloneNode(true);
      closeNoteBtn.parentNode.replaceChild(newCloseNoteBtn, closeNoteBtn);
      newCloseNoteBtn.addEventListener('click', function() {
        var mp = document.getElementById('reflectionGateModal');
        var np = document.getElementById('reflectionGateNotePanel');
        var nl = document.getElementById('reflectionGateOpenNoteLabel');
        if (mp) mp.classList.remove('note-open');
        if (np) np.hidden = true;
        if (nl) nl.textContent = 'Open Note';
      });
    }

    // ESC key handler
    function handleEsc(e) {
      if (e.key === 'Escape') {
        handleCancel();
        document.removeEventListener('keydown', handleEsc);
      }
    }
    document.addEventListener('keydown', handleEsc);

    // Show modal
    modal.hidden = false;
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('reflection-modal-open');

    // Focus textarea
    setTimeout(function() {
      var ta = document.getElementById('reflectionGateAnswer');
      if (ta) ta.focus();
    }, 150);
  }

  function closeModal() {
    var modal = document.getElementById('reflectionGateModal');
    if (modal) {
      modal.hidden = true;
      modal.setAttribute('hidden', '');
      modal.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('reflection-modal-open');
  }

  function showGateError(message) {
    var errorEl = document.getElementById('reflectionGateError');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = '';
    }
  }

  // ==================== API ====================

  async function submitReflectionAnswer(lessonId, sectionIndex, lessonIndex, answer) {
    var url = '/courses/' + encodeURIComponent(state.courseId) + '/lessons/' + sectionIndex + '/' + lessonIndex + '/reflection/submit';
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ answer: answer })
    });
    return res.json();
  }

  // ==================== CONTEXT RESOLUTION ====================

  function getLessonContext(checkbox) {
    // 1. Try checkbox dataset directly
    var dataset = checkbox && checkbox.dataset || {};
    var courseId = dataset.courseId || '';
    var sectionIndex = dataset.sectionIndex;
    var lessonIndex = dataset.lessonIndex;
    var lessonId = dataset.lessonId || '';

    // 2. Try parent .lesson-item[data-id] + ancestor .learning-section[data-section-index]
    if (sectionIndex === undefined || lessonIndex === undefined) {
      var itemEl = checkbox ? checkbox.closest('.lesson-item') : null;
      if (itemEl) {
        if (!lessonId) lessonId = itemEl.dataset.id || '';
        // The lesson-item doesn't have data-section-index or data-lesson-index,
        // but we can find the section from the ancestor
        var sectionEl = itemEl.closest('.learning-section');
        if (sectionEl && sectionEl.dataset.sectionIndex !== undefined) {
          sectionIndex = sectionEl.dataset.sectionIndex;
          // Find lesson index by counting .lesson-item siblings
          var items = sectionEl.querySelectorAll('.lesson-item');
          for (var i = 0; i < items.length; i++) {
            if (items[i] === itemEl) {
              lessonIndex = i;
              break;
            }
          }
        }
      }
    }

    // 3. Try window.EdumyLessonContext (set by app.js on lesson select)
    var globalCtx = window.EdumyLessonContext;
    if (globalCtx) {
      courseId = courseId || globalCtx.courseId || '';
      sectionIndex = (sectionIndex !== undefined && sectionIndex !== null) ? sectionIndex : globalCtx.sectionIndex;
      lessonIndex = (lessonIndex !== undefined && lessonIndex !== null) ? lessonIndex : globalCtx.lessonIndex;
      lessonId = lessonId || globalCtx.lessonId || '';
    }

    // 4. Fallback: LearningStore
    if (window.LearningStore && window.LearningStore.store) {
      var store = window.LearningStore.store;
      courseId = courseId || String((store.course && store.course._id) || '');
      if (sectionIndex === undefined || sectionIndex === null) {
        sectionIndex = store.currentSectionIndex;
      }
      if (lessonIndex === undefined || lessonIndex === null) {
        lessonIndex = store.currentLessonIndex;
      }
      if (!lessonId) {
        lessonId = store.activeLessonId || '';
      }
    }

    // 5. Fallback: global courseId from state or __COURSE__
    if (!courseId) {
      courseId = state.courseId || '';
    }
    if (!courseId && window.__COURSE__ && window.__COURSE__._id) {
      courseId = String(window.__COURSE__._id);
    }

    // Validate required fields
    if (!courseId || sectionIndex === undefined || sectionIndex === null || lessonIndex === undefined || lessonIndex === null) {
      console.warn('[ReflectionGate] getLessonContext could not resolve context:', {
        courseId: courseId,
        sectionIndex: sectionIndex,
        lessonIndex: lessonIndex,
        lessonId: lessonId
      });
      return null;
    }

    return {
      courseId: courseId,
      sectionIndex: Number(sectionIndex),
      lessonIndex: Number(lessonIndex),
      lessonId: lessonId || ''
    };
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '\x26amp;')
      .replace(/</g, '\x26lt;')
      .replace(/>/g, '\x26gt;')
      .replace(/"/g, '\x26quot;')
      .replace(/'/g, '\x26#39;');
  }

  // ==================== HELPERS ====================

  function findLessonIndexes(lessonId) {
    var course = window.__COURSE__ || {};
    var sections = course.sections || [];

    for (var si = 0; si < sections.length; si++) {
      var lessons = sections[si].lessons || [];
      for (var li = 0; li < lessons.length; li++) {
        if (String(lessons[li]._id || '') === String(lessonId)) {
          return { sectionIndex: si, lessonIndex: li };
        }
      }
    }

    // Fallback: LearningStore
    if (window.LearningStore && window.LearningStore.store) {
      var store = window.LearningStore.store;
      if (typeof store.currentSectionIndex === 'number' && typeof store.currentLessonIndex === 'number') {
        return {
          sectionIndex: store.currentSectionIndex,
          lessonIndex: store.currentLessonIndex
        };
      }
    }

    return null;
  }

  // ==================== START ====================

  document.addEventListener('DOMContentLoaded', init);
})();