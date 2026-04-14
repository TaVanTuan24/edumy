(function() {
  'use strict';

  const TEMPLATE_OPTIONS = [
    'title-center',
    'title-content',
    'bullet-list',
    'two-column',
    'section-divider',
    'title-left-content-right',
    'summary-slide'
  ];

  const state = {
    draftSlides: [],
    isLoading: false,
    dragIndex: null
  };

  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindElements();
    bindEvents();
    renderDraftSlides();
  }

  function bindElements() {
    els.prompt = document.getElementById('aiSlidePrompt');
    els.count = document.getElementById('aiSlideCount');
    els.style = document.getElementById('aiSlideStyle');
    els.language = document.getElementById('aiSlideLanguage');
    els.courseId = document.getElementById('aiCourseId');
    els.spinner = document.getElementById('aiSlideSpinner');
    els.status = document.getElementById('aiSlideStatus');
    els.generateDraftBtn = document.getElementById('generateDraftBtn');
    els.appendDraftBtn = document.getElementById('appendDraftBtn');
    els.addDraftSlideBtn = document.getElementById('addDraftSlideBtn');
    els.confirmDraftBtn = document.getElementById('confirmDraftBtn');
    els.draftSlidesList = document.getElementById('draftSlidesList');
    els.previewEmptyState = document.getElementById('previewEmptyState');
    els.draftMeta = document.getElementById('draftMeta');
    els.cardTemplate = document.getElementById('draftSlideCardTemplate');
  }

  function bindEvents() {
    els.generateDraftBtn.addEventListener('click', function() { generateDraft(false); });
    els.appendDraftBtn.addEventListener('click', function() { generateDraft(true); });
    els.addDraftSlideBtn.addEventListener('click', addDraftSlide);
    els.confirmDraftBtn.addEventListener('click', confirmDraft);
    els.draftSlidesList.addEventListener('input', onDraftInput);
    els.draftSlidesList.addEventListener('click', onDraftClick);
    els.draftSlidesList.addEventListener('dragstart', onDragStart);
    els.draftSlidesList.addEventListener('dragover', onDragOver);
    els.draftSlidesList.addEventListener('dragleave', onDragLeave);
    els.draftSlidesList.addEventListener('drop', onDrop);
    els.draftSlidesList.addEventListener('dragend', clearDragState);
  }

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.style.color = isError ? '#b91c1c' : '#64748b';
  }

  function setLoading(isLoading) {
    state.isLoading = isLoading;
    els.spinner.classList.toggle('d-none', !isLoading);
    [els.generateDraftBtn, els.appendDraftBtn, els.addDraftSlideBtn, els.confirmDraftBtn].forEach(function(button) {
      button.disabled = isLoading;
    });
  }

  function getOptions() {
    return {
      prompt: String(els.prompt.value || '').trim(),
      count: Number(els.count.value || 5),
      style: String(els.style.value || 'modern'),
      language: String(els.language.value || 'English')
    };
  }

  function getCourseId() {
    return String(els.courseId && els.courseId.value || '').trim();
  }

  async function generateDraft(append) {
    if (state.isLoading) return;

    const options = getOptions();
    if (!options.prompt) {
      setStatus('Please enter a topic or prompt.', true);
      return;
    }

    setLoading(true);
    setStatus('Generating draft slides...', false);

    try {
      const response = await fetch('/ai/generate-slide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
      });
      const data = await response.json();

      if (!data || !data.success) {
        throw new Error(data && data.error ? data.error : 'Draft generation failed');
      }

      const incoming = sanitizeSlides(data.draftSlides || data.semanticSlides || []);
      if (!incoming.length) {
        throw new Error('No draft slides generated');
      }

      state.draftSlides = append ? state.draftSlides.concat(incoming) : incoming;
      renderDraftSlides();
      setStatus('Draft ready. Review and edit slides before confirming.', false);
    } catch (error) {
      console.error('[AI Slide Draft]', error);
      setStatus('Failed to generate draft slides. Please try again.', true);
    } finally {
      setLoading(false);
    }
  }

  function addDraftSlide() {
    state.draftSlides.push(createBlankSlide());
    renderDraftSlides();
    setStatus('Added a new draft slide.', false);
  }

  async function confirmDraft() {
    if (state.isLoading) return;

    const options = getOptions();
    if (!state.draftSlides.length) {
      setStatus('Generate or add at least one draft slide first.', true);
      return;
    }

    setLoading(true);
    setStatus('Resolving draft slides into final editor format...', false);

    try {
      const response = await fetch('/ai/resolve-slide-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: options.prompt,
          style: options.style,
          language: options.language,
          slides: state.draftSlides
        })
      });
      const data = await response.json();

      if (!data || !data.success) {
        throw new Error(data && data.error ? data.error : 'Failed to resolve draft slides');
      }

      localStorage.setItem('AI_SLIDE_DATA', JSON.stringify({
        slides: Array.isArray(data.slides) ? data.slides : [],
        semanticSlides: sanitizeSlides(data.draftSlides || data.semanticSlides || []),
        examples: Array.isArray(data.examples) ? data.examples : []
      }));
      localStorage.setItem('AI_SLIDE_TITLE', options.prompt.slice(0, 120));
      redirectToEditor();
    } catch (error) {
      console.error('[AI Slide Confirm]', error);
      setStatus('Failed to confirm draft slides.', true);
    } finally {
      setLoading(false);
    }
  }

  async function refineSlide(index, action) {
    const slide = state.draftSlides[index];
    const options = getOptions();
    if (!slide || !options.prompt || state.isLoading) return;

    setLoading(true);
    setStatus(action === 'improve' ? 'Improving selected slide...' : 'Regenerating selected slide...', false);

    try {
      const response = await fetch('/ai/generate-slide-refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: options.prompt,
          style: options.style,
          language: options.language,
          action: action,
          slide: slide
        })
      });
      const data = await response.json();

      if (!data || !data.success || !data.slide) {
        throw new Error(data && data.error ? data.error : 'Failed to refine slide');
      }

      state.draftSlides[index] = sanitizeSlide(data.slide, index);
      renderDraftSlides();
      setStatus(action === 'improve' ? 'Slide improved.' : 'Slide regenerated.', false);
    } catch (error) {
      console.error('[AI Slide Refine]', error);
      setStatus('Unable to update that slide right now.', true);
    } finally {
      setLoading(false);
    }
  }

  function onDraftInput(event) {
    const card = event.target.closest('.draft-slide-card');
    if (!card) return;

    const index = Number(card.dataset.index);
    const slide = state.draftSlides[index];
    if (!slide) return;

    const field = event.target.dataset.field;
    if (!field) return;

    if (field === 'template') {
      slide.template = normalizeTemplate(event.target.value);
      ensureTemplateFields(slide);
      renderDraftSlides();
      return;
    }

    if (field === 'title') {
      slide.title = safeText(event.target.value);
      return;
    }

    if (field === 'subtitle') {
      applySubtitleLikeField(slide, event.target.value);
      return;
    }

    if (field === 'body') {
      applyBodyLikeField(slide, event.target.value);
      return;
    }

    if (field === 'left-heading') {
      slide.leftColumn = slide.leftColumn || { heading: '', items: [''] };
      slide.leftColumn.heading = safeText(event.target.value);
      return;
    }

    if (field === 'right-heading') {
      slide.rightColumn = slide.rightColumn || { heading: '', items: [''] };
      slide.rightColumn.heading = safeText(event.target.value);
      return;
    }

    if (event.target.dataset.bulletIndex != null) {
      updateListItem(slide.bullets, Number(event.target.dataset.bulletIndex), event.target.value);
      return;
    }

    if (event.target.dataset.leftItemIndex != null) {
      slide.leftColumn = slide.leftColumn || { heading: '', items: [''] };
      updateListItem(slide.leftColumn.items, Number(event.target.dataset.leftItemIndex), event.target.value);
      return;
    }

    if (event.target.dataset.rightItemIndex != null) {
      slide.rightColumn = slide.rightColumn || { heading: '', items: [''] };
      updateListItem(slide.rightColumn.items, Number(event.target.dataset.rightItemIndex), event.target.value);
    }
  }

  function onDraftClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const card = button.closest('.draft-slide-card');
    const index = Number(card && card.dataset.index);
    const action = button.dataset.action;

    if (action === 'delete') {
      state.draftSlides.splice(index, 1);
      renderDraftSlides();
      return;
    }

    if (action === 'duplicate') {
      const copy = sanitizeSlide(JSON.parse(JSON.stringify(state.draftSlides[index] || createBlankSlide())), index);
      state.draftSlides.splice(index + 1, 0, copy);
      renderDraftSlides();
      return;
    }

    if (action === 'add-bullet') {
      state.draftSlides[index].bullets.push('');
      renderDraftSlides();
      return;
    }

    if (action === 'remove-bullet') {
      state.draftSlides[index].bullets.splice(Number(button.dataset.bulletIndex), 1);
      if (!state.draftSlides[index].bullets.length) state.draftSlides[index].bullets.push('');
      renderDraftSlides();
      return;
    }

    if (action === 'add-left-item') {
      const slide = state.draftSlides[index];
      slide.leftColumn = slide.leftColumn || { heading: '', items: [] };
      slide.leftColumn.items.push('');
      renderDraftSlides();
      return;
    }

    if (action === 'remove-left-item') {
      const slide = state.draftSlides[index];
      slide.leftColumn.items.splice(Number(button.dataset.itemIndex), 1);
      if (!slide.leftColumn.items.length) slide.leftColumn.items.push('');
      renderDraftSlides();
      return;
    }

    if (action === 'add-right-item') {
      const slide = state.draftSlides[index];
      slide.rightColumn = slide.rightColumn || { heading: '', items: [] };
      slide.rightColumn.items.push('');
      renderDraftSlides();
      return;
    }

    if (action === 'remove-right-item') {
      const slide = state.draftSlides[index];
      slide.rightColumn.items.splice(Number(button.dataset.itemIndex), 1);
      if (!slide.rightColumn.items.length) slide.rightColumn.items.push('');
      renderDraftSlides();
      return;
    }

    if (action === 'regenerate' || action === 'improve') {
      refineSlide(index, action);
    }
  }

  function onDragStart(event) {
    const card = event.target.closest('.draft-slide-card');
    if (!card) return;
    state.dragIndex = Number(card.dataset.index);
    card.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(event) {
    const card = event.target.closest('.draft-slide-card');
    if (!card) return;
    event.preventDefault();
    card.classList.add('drag-over');
  }

  function onDragLeave(event) {
    const card = event.target.closest('.draft-slide-card');
    if (!card) return;
    card.classList.remove('drag-over');
  }

  function onDrop(event) {
    const card = event.target.closest('.draft-slide-card');
    if (!card || state.dragIndex == null) return;
    event.preventDefault();

    const targetIndex = Number(card.dataset.index);
    if (Number.isNaN(targetIndex) || targetIndex === state.dragIndex) {
      clearDragState();
      return;
    }

    const moved = state.draftSlides.splice(state.dragIndex, 1)[0];
    state.draftSlides.splice(targetIndex, 0, moved);
    clearDragState();
    renderDraftSlides();
  }

  function clearDragState() {
    state.dragIndex = null;
    Array.prototype.forEach.call(document.querySelectorAll('.draft-slide-card'), function(card) {
      card.classList.remove('dragging', 'drag-over');
    });
  }

  function renderDraftSlides() {
    els.draftSlidesList.innerHTML = '';

    if (!state.draftSlides.length) {
      els.previewEmptyState.hidden = false;
      els.draftMeta.textContent = '0 slides';
      return;
    }

    els.previewEmptyState.hidden = true;
    els.draftMeta.textContent = state.draftSlides.length + (state.draftSlides.length === 1 ? ' slide' : ' slides');

    state.draftSlides.forEach(function(slide, index) {
      const fragment = els.cardTemplate.content.cloneNode(true);
      const card = fragment.querySelector('.draft-slide-card');
      const templateSelect = fragment.querySelector('[data-field="template"]');
      const bulletsContainer = fragment.querySelector('[data-bullets-container]');
      const leftItemsContainer = fragment.querySelector('[data-left-items-container]');
      const rightItemsContainer = fragment.querySelector('[data-right-items-container]');

      card.dataset.index = String(index);
      fragment.querySelector('.draft-slide-index').textContent = 'Slide ' + (index + 1);
      fragment.querySelector('.draft-slide-template-badge').textContent = slide.template;
      fragment.querySelector('[data-field="title"]').value = slide.title || '';
      fragment.querySelector('[data-field="subtitle"]').value = getSubtitleLikeField(slide);
      fragment.querySelector('[data-field="body"]').value = getBodyLikeField(slide);
      fragment.querySelector('[data-field="left-heading"]').value = slide.leftColumn && slide.leftColumn.heading || '';
      fragment.querySelector('[data-field="right-heading"]').value = slide.rightColumn && slide.rightColumn.heading || '';

      TEMPLATE_OPTIONS.forEach(function(option) {
        const optionNode = document.createElement('option');
        optionNode.value = option;
        optionNode.textContent = option;
        if (slide.template === option) optionNode.selected = true;
        templateSelect.appendChild(optionNode);
      });

      renderListEditor(bulletsContainer, slide.bullets, 'remove-bullet', 'bulletIndex');
      renderListEditor(leftItemsContainer, slide.leftColumn && slide.leftColumn.items || [], 'remove-left-item', 'itemIndex', 'leftItemIndex');
      renderListEditor(rightItemsContainer, slide.rightColumn && slide.rightColumn.items || [], 'remove-right-item', 'itemIndex', 'rightItemIndex');

      toggleSections(fragment, slide.template);
      els.draftSlidesList.appendChild(fragment);
    });
  }

  function renderListEditor(container, list, removeAction, removeIndexKey, inputIndexKey) {
    container.innerHTML = '';
    (Array.isArray(list) && list.length ? list : ['']).forEach(function(value, index) {
      const row = document.createElement('div');
      const input = document.createElement('textarea');
      const removeButton = document.createElement('button');

      row.className = 'draft-bullet-row';
      input.className = 'form-control';
      input.rows = 2;
      input.value = safeText(value);
      input.dataset[inputIndexKey || removeIndexKey] = String(index);

      removeButton.type = 'button';
      removeButton.className = 'btn btn-sm btn-outline-danger';
      removeButton.dataset.action = removeAction;
      removeButton.dataset[removeIndexKey] = String(index);
      removeButton.textContent = 'Remove';

      row.appendChild(input);
      row.appendChild(removeButton);
      container.appendChild(row);
    });
  }

  function toggleSections(fragment, template) {
    const subtitleField = fragment.querySelector('[data-role="subtitle-field"]');
    const bodyField = fragment.querySelector('[data-role="body-field"]');
    const bulletsField = fragment.querySelector('[data-role="bullets-field"]');
    const columnsField = fragment.querySelector('[data-role="columns-field"]');

    const usesColumns = template === 'two-column';
    const usesBullets = ['bullet-list', 'title-left-content-right', 'summary-slide'].includes(template);
    const usesBody = ['title-content', 'section-divider'].includes(template);
    const usesSubtitle = ['title-center', 'title-content', 'bullet-list', 'two-column', 'section-divider', 'title-left-content-right', 'summary-slide'].includes(template);

    subtitleField.hidden = !usesSubtitle;
    bodyField.hidden = !usesBody;
    bulletsField.hidden = !usesBullets;
    columnsField.hidden = !usesColumns;
  }

  function sanitizeSlides(slides) {
    return (Array.isArray(slides) ? slides : []).map(sanitizeSlide);
  }

  function sanitizeSlide(slide, index) {
    const safeSlide = slide && typeof slide === 'object' ? slide : {};
    const template = normalizeTemplate(safeSlide.template);
    const sanitized = {
      id: String(safeSlide.id || 'draft-slide-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
      template: template,
      title: safeText(safeSlide.title || safeSlide.heading || ('Slide ' + ((index || 0) + 1))),
      subtitle: safeText(safeSlide.subtitle || safeSlide.summary || ''),
      body: safeText(safeSlide.body || ''),
      summary: safeText(safeSlide.summary || ''),
      callout: safeText(safeSlide.callout || ''),
      bullets: coerceStringArray(safeSlide.bullets || safeSlide.points || safeSlide.items),
      leftColumn: sanitizeColumn(safeSlide.leftColumn),
      rightColumn: sanitizeColumn(safeSlide.rightColumn)
    };

    ensureTemplateFields(sanitized);
    return sanitized;
  }

  function sanitizeColumn(column) {
    const source = column && typeof column === 'object' ? column : {};
    return {
      heading: safeText(source.heading || source.title || ''),
      items: coerceStringArray(source.items || source.bullets)
    };
  }

  function coerceStringArray(value) {
    const source = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/\n|(?<=[.!?])\s+/)
        : [];

    return source
      .map(function(entry) { return safeText(entry); })
      .filter(Boolean)
      .slice(0, 6);
  }

  function safeText(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value).replace(/\s+/g, ' ').trim();
    }

    if (Array.isArray(value)) {
      return value.map(safeText).filter(Boolean).join(' ').trim();
    }

    if (typeof value === 'object') {
      const keys = ['text', 'title', 'heading', 'label', 'name', 'value', 'content', 'summary', 'description'];
      for (let i = 0; i < keys.length; i += 1) {
        if (value[keys[i]]) return safeText(value[keys[i]]);
      }
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    }

    return '';
  }

  function normalizeTemplate(value) {
    const template = String(value || '').trim();
    return TEMPLATE_OPTIONS.indexOf(template) >= 0 ? template : 'bullet-list';
  }

  function ensureTemplateFields(slide) {
    if (slide.template === 'two-column') {
      slide.leftColumn = slide.leftColumn || { heading: '', items: [''] };
      slide.rightColumn = slide.rightColumn || { heading: '', items: [''] };
      slide.bullets = [];
      return;
    }

    if (slide.template === 'title-content' || slide.template === 'section-divider') {
      slide.bullets = [];
      return;
    }

    slide.bullets = Array.isArray(slide.bullets) && slide.bullets.length ? slide.bullets : ['', '', ''];
  }

  function createBlankSlide() {
    return {
      id: 'draft-slide-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      template: 'bullet-list',
      title: 'New Slide',
      subtitle: '',
      body: '',
      summary: '',
      callout: '',
      bullets: ['', '', ''],
      leftColumn: { heading: '', items: [''] },
      rightColumn: { heading: '', items: [''] }
    };
  }

  function applyBodyLikeField(slide, value) {
    const text = safeText(value);
    if (slide.template === 'section-divider') {
      slide.callout = text;
      return;
    }
    if (slide.template === 'summary-slide') {
      slide.summary = text;
      return;
    }
    slide.body = text;
  }

  function applySubtitleLikeField(slide, value) {
    const text = safeText(value);
    if (slide.template === 'summary-slide') {
      slide.summary = text;
      return;
    }
    slide.subtitle = text;
  }

  function getBodyLikeField(slide) {
    if (slide.template === 'section-divider') return slide.callout || '';
    if (slide.template === 'summary-slide') return slide.summary || '';
    return slide.body || '';
  }

  function getSubtitleLikeField(slide) {
    if (slide.template === 'summary-slide') return slide.summary || slide.subtitle || '';
    return slide.subtitle || '';
  }

  function updateListItem(list, index, value) {
    if (!Array.isArray(list)) return;
    list[index] = safeText(value);
  }

  function redirectToEditor() {
    const courseId = getCourseId();
    if (!courseId) {
      window.location.href = '/admin';
      return;
    }

    window.location.href = '/admin/courses/' + encodeURIComponent(courseId) + '/slide-editor?ai=1';
  }
})();
