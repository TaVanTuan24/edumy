(function() {
  'use strict';

  let isGenerating = false;

  document.addEventListener('DOMContentLoaded', function() {
    const generateBtn = document.getElementById('generateSlideBtn');
    const regenerateBtn = document.getElementById('regenerateSlideBtn');
    const addMoreBtn = document.getElementById('addMoreSlidesBtn');

    if (generateBtn) generateBtn.addEventListener('click', function() { generateSlides(false); });
    if (regenerateBtn) regenerateBtn.addEventListener('click', function() { generateSlides(false); });
    if (addMoreBtn) addMoreBtn.addEventListener('click', function() { generateSlides(true); });
  });

  function setStatus(text, isError) {
    const status = document.getElementById('aiSlideStatus');
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? '#b91c1c' : '#475569';
  }

  function setLoading(isLoading) {
    const spinner = document.getElementById('aiSlideSpinner');
    const generateBtn = document.getElementById('generateSlideBtn');
    const regenerateBtn = document.getElementById('regenerateSlideBtn');
    const addMoreBtn = document.getElementById('addMoreSlidesBtn');

    if (spinner) spinner.classList.toggle('d-none', !isLoading);
    [generateBtn, regenerateBtn, addMoreBtn].forEach(function(btn) {
      if (btn) btn.disabled = isLoading;
    });
  }

  function getPrompt() {
    return String(document.getElementById('aiSlidePrompt')?.value || '').trim();
  }

  function getCourseId() {
    return String(document.getElementById('aiCourseId')?.value || '').trim();
  }

  function generateSlides(append) {
    if (isGenerating) return;
    const prompt = getPrompt();
    if (!prompt) {
      setStatus('Please enter a topic or prompt.', true);
      return;
    }

    isGenerating = true;
    setLoading(true);
    setStatus('Generating slides...', false);

    fetch('/ai/generate-slide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt })
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.success) {
          throw new Error(data && data.error ? data.error : 'Generation failed');
        }

        const newSlides = Array.isArray(data.slides) ? data.slides : [];
        const existing = append ? readStoredSlides() : [];
        const combined = existing.concat(newSlides);
        if (!combined.length) {
          throw new Error('No slides generated');
        }

        localStorage.setItem('AI_SLIDE_DATA', JSON.stringify({ slides: combined }));
        localStorage.setItem('AI_SLIDE_TITLE', prompt.slice(0, 120));
        redirectToEditor();
      })
      .catch(function(err) {
        console.error('[AI Slide]', err);
        setStatus('Failed to generate slides. Please try again.', true);
      })
      .finally(function() {
        isGenerating = false;
        setLoading(false);
      });
  }
  function readStoredSlides() {
    try {
      const stored = localStorage.getItem('AI_SLIDE_DATA');
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed && parsed.slides) ? parsed.slides : [];
    } catch {
      return [];
    }
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
