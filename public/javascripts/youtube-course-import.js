(function() {
  'use strict';

  function notify(message, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(message, variant || 'danger');
      return;
    }
    window.alert(message);
  }

  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('[data-youtube-import-root]').forEach(initYoutubeImport);
    bindNewCourseFormSubmission();
  });

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? String(meta.getAttribute('content') || '') : '';
  }

  function ensureFormCsrf(form) {
    if (!(form instanceof HTMLFormElement)) return false;

    const token = getCsrfToken();
    if (!token) return false;

    let input = form.querySelector('input[name="_csrf"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      form.appendChild(input);
    }

    input.value = token;
    return true;
  }

  function buildJsonHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };
    const token = getCsrfToken();
    if (token) {
      headers['CSRF-Token'] = token;
    }
    return headers;
  }

  function csrfJsonFetch(url, options) {
    const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
    return fetcher(url, {
      ...options,
      headers: {
        ...buildJsonHeaders(),
        ...(options && options.headers ? options.headers : {})
      }
    });
  }

  async function readJsonResponse(response, fallbackMessage) {
    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (!payload) {
      throw new Error(fallbackMessage || 'Request failed.');
    }

    return payload;
  }

  function bindNewCourseFormSubmission() {
    const form = document.querySelector('form.validated-form[action="/courses"][method="POST"]');
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.csrfBound === 'true') return;

    form.dataset.csrfBound = 'true';
    ensureFormCsrf(form);

    form.addEventListener('submit', function(event) {
      if (!form.checkValidity()) return;

      if (!ensureFormCsrf(form)) {
        event.preventDefault();
        notify('Security token missing. Please refresh the page and try again.', 'danger');
        return;
      }

      const importSourceInput = form.querySelector('input[name="course[importSource]"]:checked');
      const importSource = String(importSourceInput && importSourceInput.value || 'drive').trim().toLowerCase();
      const sectionsField = form.querySelector('input[name="course[sectionsJson]"]');

      if (importSource === 'youtube' && !(sectionsField instanceof HTMLInputElement)) {
        event.preventDefault();
        notify('Imported course data is missing. Please import the playlist again.', 'danger');
        return;
      }

      event.preventDefault();
      submitCreateCourseForm(form, event.submitter);
    });
  }

  async function submitCreateCourseForm(form, submitter) {
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.submitting === 'true') return;

    form.dataset.submitting = 'true';
    const submitButton = submitter instanceof HTMLElement
      ? submitter
      : form.querySelector('button[type="submit"], input[type="submit"]');

    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      const formData = new FormData(form);
      const token = getCsrfToken();
      if (!formData.get('_csrf') && token) {
        formData.append('_csrf', token);
      }

      const fetcher = typeof window.csrfFetch === 'function' ? window.csrfFetch : window.fetch.bind(window);
      const response = await fetcher(form.action, {
        method: String(form.method || 'POST').toUpperCase(),
        body: formData,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();

      if (response.redirected && response.url) {
        window.location.assign(response.url);
        return;
      }

      if (contentType.includes('application/json')) {
        const payload = await readJsonResponse(response, 'Failed to create course.');
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Failed to create course.');
        }

        if (payload.redirectUrl) {
          window.location.assign(payload.redirectUrl);
          return;
        }

        window.location.reload();
        return;
      }

      const html = await response.text();
      if (!response.ok || (html && html.trim())) {
        document.open();
        document.write(html);
        document.close();
      }
    } catch (error) {
      notify(error.message || 'Failed to create course.', 'danger');
    } finally {
      form.dataset.submitting = 'false';
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  }

  function initYoutubeImport(root) {
    if (!root) return;

    const mode = root.dataset.importMode || 'create';
    const courseId = root.dataset.courseId || '';
    const urlInput = root.querySelector('[data-youtube-playlist-url]');
    const previewBtn = root.querySelector('[data-youtube-preview-btn]');
    const previewEl = root.querySelector('[data-youtube-preview]');
    const statusEl = root.querySelector('[data-youtube-import-status]');
    const sectionsJsonInput = document.getElementById('youtubeSectionsJson');
    const sourceInputs = root.querySelectorAll('[data-import-source-input]');
    const drivePanel = root.querySelector('[data-import-panel="drive"]');
    const youtubePanel = root.querySelector('[data-import-panel="youtube"]');
    const driveLinkInput = document.getElementById('driveLink');
    const titleInput = document.getElementById('title');
    const hostForm = root.closest('form');

    let previewState = null;

    ensureFormCsrf(hostForm);

    if (sourceInputs.length && drivePanel && youtubePanel) {
      sourceInputs.forEach(function(input) {
        input.addEventListener('change', function() {
          const selected = input.value === 'youtube' ? 'youtube' : 'drive';
          drivePanel.classList.toggle('d-none', selected !== 'drive');
          youtubePanel.classList.toggle('d-none', selected !== 'youtube');
          if (driveLinkInput) {
            driveLinkInput.required = selected === 'drive';
          }
          if (selected !== 'youtube') {
            previewState = null;
            if (sectionsJsonInput) sectionsJsonInput.value = '';
            if (previewEl) previewEl.classList.add('d-none');
          }
          ensureFormCsrf(hostForm);
        });
      });
    }

    if (!previewBtn || !urlInput || !previewEl || !statusEl) return;

    previewBtn.addEventListener('click', function() {
      importPreview();
    });

    function setStatus(message, kind) {
      statusEl.textContent = message || '';
      statusEl.classList.remove('text-danger', 'text-success');
      if (kind === 'error') statusEl.classList.add('text-danger');
      if (kind === 'success') statusEl.classList.add('text-success');
    }

    async function importPreview() {
      const playlistUrl = String(urlInput.value || '').trim();
      if (!playlistUrl) {
        setStatus('Playlist URL is required.', 'error');
        return;
      }

      previewBtn.disabled = true;
      setStatus('Fetching playlist videos and organizing sections with AI...', '');
      previewEl.classList.remove('d-none');
      previewEl.innerHTML = buildLoadingPreview();

      try {
        const response = await csrfJsonFetch('/admin/youtube/import/preview', {
          method: 'POST',
          body: JSON.stringify({
            playlistUrl,
            courseTitle: titleInput ? titleInput.value : '',
            topic: document.getElementById('topic') ? document.getElementById('topic').value : ''
          })
        });

        const payload = await readJsonResponse(response, 'Failed to import playlist.');
        if (!response.ok || !payload.success || !payload.preview) {
          throw new Error(payload.error || 'Failed to import playlist.');
        }

        previewState = normalizePreview(payload.preview);
        if (titleInput && !String(titleInput.value || '').trim()) {
          titleInput.value = previewState.playlistTitle || '';
        }
        renderPreview();
        syncHiddenSections();
        ensureFormCsrf(hostForm);
        setStatus(buildPreviewReadyMessage(previewState), 'success');
      } catch (error) {
        previewState = null;
        previewEl.innerHTML = '<div class="alert alert-danger mb-0">' + escapeHtml(error.message || 'Failed to import playlist.') + '</div>';
        setStatus(error.message || 'Failed to import playlist.', 'error');
        ensureFormCsrf(hostForm);
      } finally {
        previewBtn.disabled = false;
      }
    }

    function normalizePreview(preview) {
      return {
        playlistTitle: String(preview && preview.playlistTitle || '').trim(),
        totalVideos: Number(preview && preview.totalVideos) || 0,
        warnings: Array.isArray(preview && preview.warnings) ? preview.warnings : [],
        groupingStrategy: String(preview && preview.groupingStrategy || '').trim(),
        groupingModel: String(preview && preview.groupingModel || '').trim(),
        sections: (Array.isArray(preview && preview.sections) ? preview.sections : []).map(function(section, sectionIndex) {
          return {
            id: String(section && section.id || ('section-' + (sectionIndex + 1))),
            title: String(section && section.title || `Section ${sectionIndex + 1}`),
            description: String(section && section.description || ''),
            videos: (Array.isArray(section && section.videos) ? section.videos : []).map(function(video) {
              return {
                title: String(video && video.title || '').trim(),
                videoId: String(video && video.videoId || '').trim(),
                url: String(video && video.url || '').trim(),
                thumbnail: String(video && video.thumbnail || '').trim(),
                durationSeconds: Number.isFinite(Number(video && video.durationSeconds)) ? Number(video.durationSeconds) : null,
                durationFormatted: String(video && video.durationFormatted || '').trim()
              };
            }).filter(function(video) {
              return video.title && video.videoId && video.url;
            })
          };
        }).filter(function(section) {
          return section.videos.length > 0;
        })
      };
    }

    function buildPreviewReadyMessage(preview) {
      const strategy = String(preview && preview.groupingStrategy || '').trim().toLowerCase();
      const model = String(preview && preview.groupingModel || '').trim();

      if (strategy === 'ai') {
        return 'Preview ready' + (model ? ` - grouped with ${model}` : ' - grouped with AI');
      }

      if (strategy === 'fallback') {
        return 'Preview ready - AI grouping failed, using deterministic fallback';
      }

      if (strategy === 'deterministic') {
        return 'Preview ready - AI settings are not configured, using deterministic fallback';
      }

      return 'Preview ready';
    }

    function buildLoadingPreview() {
      return (
        '<div class="course-grid-skeleton" style="display:grid;grid-template-columns:1fr;gap:12px;">' +
          '<div class="course-skeleton-card"><div class="course-skeleton-body"><div class="skeleton-block course-skeleton-line is-medium"></div><div class="skeleton-block course-skeleton-line"></div><div class="skeleton-block course-skeleton-line"></div></div></div>' +
          '<div class="course-skeleton-card"><div class="course-skeleton-body"><div class="skeleton-block course-skeleton-line is-medium"></div><div class="skeleton-block course-skeleton-line"></div><div class="skeleton-block course-skeleton-line"></div></div></div>' +
        '</div>'
      );
    }

    function renderPreview() {
      if (!previewState) return;

      previewEl.classList.remove('d-none');
      previewEl.innerHTML = [
        '<div class="youtube-import-panel">',
        '<div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">',
        '<div><h3 class="h5 mb-1">' + escapeHtml(previewState.playlistTitle || 'Imported Playlist') + '</h3><div class="small text-muted">' + previewState.totalVideos + ' videos</div></div>',
        mode === 'apply' ? '<button type="button" class="btn btn-primary" data-youtube-apply-btn>Save to Course</button>' : '',
        '</div>',
        previewState.warnings.length ? '<div class="alert alert-warning small">' + previewState.warnings.map(escapeHtml).join('<br>') + '</div>' : '',
        '<div class="youtube-import-sections">',
        previewState.sections.map(function(section, sectionIndex) {
          return [
            '<section class="card border mb-3 youtube-import-section" data-section-index="' + sectionIndex + '">',
            '<div class="card-body">',
            '<div class="youtube-import-section-head mb-2">',
            '<input type="text" class="form-control" data-section-title value="' + escapeAttribute(section.title) + '">',
            '<button type="button" class="btn btn-outline-secondary btn-sm youtube-import-add-section-btn" data-add-section-before="' + sectionIndex + '">+ Section</button>',
            '</div>',
            '<div class="small text-muted mb-3">' + (section.description ? escapeHtml(section.description) : 'AI grouped section') + '</div>',
            '<div class="d-grid gap-2">',
            section.videos.map(function(video, videoIndex) {
              return [
                '<article class="youtube-import-video-row border rounded p-2" data-video-index="' + videoIndex + '">',
                '<div class="youtube-import-video-grid">',
                '<div class="youtube-import-video-thumb">',
                video.thumbnail ? '<img src="' + escapeAttribute(video.thumbnail) + '" alt="" class="img-fluid rounded">' : '',
                '</div>',
                '<div class="youtube-import-video-main">',
                '<input type="text" class="form-control" data-video-title value="' + escapeAttribute(video.title) + '">',
                '<div class="small text-muted mt-1">' + escapeHtml(video.durationFormatted || 'Duration unavailable') + '</div>',
                '</div>',
                '<div class="youtube-import-video-target">',
                '<select class="form-select" data-video-section>',
                previewState.sections.map(function(targetSection, targetIndex) {
                  return '<option value="' + targetIndex + '"' + (targetIndex === sectionIndex ? ' selected' : '') + '>' + escapeHtml(targetSection.title) + '</option>';
                }).join(''),
                '</select>',
                '</div>',
                '<div class="youtube-import-video-actions">',
                '<button type="button" class="btn btn-outline-danger btn-sm youtube-import-remove-btn" data-remove-video>Remove</button>',
                '</div>',
                '</div>',
                '</article>'
              ].join('');
            }).join(''),
            '</div>',
            '</div>',
            '</section>'
          ].join('');
        }).join(''),
        '</div>',
        '</div>'
      ].join('');

      previewEl.querySelectorAll('[data-section-title]').forEach(function(input) {
        input.addEventListener('input', syncSectionTitles);
      });

      previewEl.querySelectorAll('[data-video-title]').forEach(function(input) {
        input.addEventListener('input', function() {
          const sectionEl = input.closest('.youtube-import-section');
          const sectionIndex = Number(sectionEl && sectionEl.dataset.sectionIndex);
          const videoRow = input.closest('.youtube-import-video-row');
          const videoIndex = Number(videoRow && videoRow.dataset.videoIndex);
          if (!Number.isInteger(sectionIndex) || !Number.isInteger(videoIndex) || !previewState.sections[sectionIndex] || !previewState.sections[sectionIndex].videos[videoIndex]) return;
          previewState.sections[sectionIndex].videos[videoIndex].title = String(input.value || '').trim();
          syncHiddenSections();
        });
      });

      previewEl.querySelectorAll('[data-video-section]').forEach(function(select) {
        select.addEventListener('change', function() {
          const sectionEl = select.closest('.youtube-import-section');
          const sourceSectionIndex = Number(sectionEl && sectionEl.dataset.sectionIndex);
          const videoRow = select.closest('.youtube-import-video-row');
          const videoIndex = Number(videoRow && videoRow.dataset.videoIndex);
          const targetSectionIndex = Number(select.value);
          moveVideo(sourceSectionIndex, videoIndex, targetSectionIndex);
        });
      });

      previewEl.querySelectorAll('[data-remove-video]').forEach(function(button) {
        button.addEventListener('click', function() {
          const sectionEl = button.closest('.youtube-import-section');
          const sectionIndex = Number(sectionEl && sectionEl.dataset.sectionIndex);
          const videoRow = button.closest('.youtube-import-video-row');
          const videoIndex = Number(videoRow && videoRow.dataset.videoIndex);
          if (!Number.isInteger(sectionIndex) || !Number.isInteger(videoIndex) || !previewState.sections[sectionIndex]) return;
          previewState.sections[sectionIndex].videos.splice(videoIndex, 1);
          previewState.sections = previewState.sections.filter(function(section) { return section.videos.length > 0; });
          renderPreview();
          syncHiddenSections();
        });
      });

      previewEl.querySelectorAll('[data-add-section-before]').forEach(function(button) {
        button.addEventListener('click', function() {
          const sectionIndex = Number(button.dataset.addSectionBefore);
          previewState.sections.splice(sectionIndex, 0, {
            id: 'section-' + Date.now(),
            title: 'New Section',
            description: '',
            videos: []
          });
          renderPreview();
          syncHiddenSections();
        });
      });

      const applyBtn = previewEl.querySelector('[data-youtube-apply-btn]');
      if (applyBtn) {
        applyBtn.addEventListener('click', applyImport);
      }
    }

    function syncSectionTitles() {
      previewEl.querySelectorAll('.youtube-import-section').forEach(function(sectionEl, sectionIndex) {
        const titleInput = sectionEl.querySelector('[data-section-title]');
        if (!previewState.sections[sectionIndex]) return;
        previewState.sections[sectionIndex].title = String(titleInput && titleInput.value || '').trim() || `Section ${sectionIndex + 1}`;
      });
      renderPreview();
      syncHiddenSections();
    }

    function moveVideo(sourceSectionIndex, videoIndex, targetSectionIndex) {
      if (
        !Number.isInteger(sourceSectionIndex) ||
        !Number.isInteger(videoIndex) ||
        !Number.isInteger(targetSectionIndex) ||
        !previewState.sections[sourceSectionIndex] ||
        !previewState.sections[targetSectionIndex]
      ) {
        return;
      }

      const moved = previewState.sections[sourceSectionIndex].videos.splice(videoIndex, 1)[0];
      if (!moved) return;
      previewState.sections[targetSectionIndex].videos.push(moved);
      previewState.sections = previewState.sections.filter(function(section) { return section.videos.length > 0; });
      renderPreview();
      syncHiddenSections();
    }

    function syncHiddenSections() {
      if (sectionsJsonInput && mode === 'create') {
        ensureFormCsrf(hostForm);
        sectionsJsonInput.value = JSON.stringify(serializeSections());
      }
    }

    function serializeSections() {
      return (previewState && Array.isArray(previewState.sections) ? previewState.sections : [])
        .map(function(section) {
          return {
            title: String(section.title || '').trim(),
            videos: (Array.isArray(section.videos) ? section.videos : []).map(function(video) {
              return {
                title: String(video.title || '').trim(),
                videoId: String(video.videoId || '').trim(),
                url: String(video.url || '').trim(),
                thumbnail: String(video.thumbnail || '').trim(),
                durationSeconds: Number.isFinite(Number(video.durationSeconds)) ? Number(video.durationSeconds) : null,
                durationFormatted: String(video.durationFormatted || '').trim()
              };
            }).filter(function(video) {
              return video.title && video.videoId && video.url;
            })
          };
        })
        .filter(function(section) {
          return section.title && section.videos.length;
        });
    }

    async function applyImport() {
      if (mode !== 'apply' || !courseId) return;
      const sections = serializeSections();
      if (!sections.length) {
        setStatus('No importable videos remain in the preview.', 'error');
        return;
      }

      setStatus('Saving imported sections to the course...', '');
      try {
        const response = await csrfJsonFetch('/admin/youtube/import/apply', {
          method: 'POST',
          body: JSON.stringify({
            courseId,
            playlistTitle: previewState && previewState.playlistTitle,
            sections
          })
        });
        const payload = await readJsonResponse(response, 'Failed to save imported sections.');
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Failed to save imported sections.');
        }
        setStatus('Playlist imported successfully.', 'success');
        window.location.reload();
      } catch (error) {
        setStatus(error.message || 'Failed to save imported sections.', 'error');
      }
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
      return escapeHtml(value).replace(/"/g, '&quot;');
    }
  }
})();
