(() => {
  function debounce(fn, waitMs) {
    let timeoutId = null;
    return (...args) => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        fn(...args);
      }, waitMs);
    };
  }

  function parseSafeImageUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return { ok: false, reason: 'empty', value: '' };
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { ok: false, reason: 'invalid', value: '' };
    }

    const protocol = String(parsed.protocol || '').toLowerCase();
    if (!['http:', 'https:'].includes(protocol)) {
      return { ok: false, reason: 'unsafe-scheme', value: '' };
    }

    return { ok: true, reason: '', value: parsed.toString() };
  }

  function initThumbnailField(root) {
    if (!root) return;

    const modeInputs = root.querySelectorAll('[data-thumbnail-mode-input]');
    const fileInput = root.querySelector('[data-thumbnail-file-input]');
    const urlInput = root.querySelector('[data-thumbnail-url-input]');
    const previewImage = root.querySelector('[data-thumbnail-preview-image]');
    const previewCaption = root.querySelector('[data-thumbnail-preview-caption]');
    const previewError = root.querySelector('[data-thumbnail-preview-error]');
    const uploadPanel = root.querySelector('[data-thumbnail-panel="upload"]');
    const urlPanel = root.querySelector('[data-thumbnail-panel="url"]');

    let filePreviewUrl = '';
    let activeUrlToken = 0;

    function getCurrentMode() {
      const selected = Array.from(modeInputs).find((input) => input.checked);
      return selected ? selected.value : 'upload';
    }

    function setCaption(message) {
      if (previewCaption) {
        previewCaption.textContent = message;
      }
    }

    function clearPreviewError() {
      if (previewError) {
        previewError.textContent = '';
        previewError.classList.add('d-none');
      }
      if (urlInput) {
        urlInput.classList.remove('is-invalid');
      }
    }

    function showPreviewError(message) {
      if (previewError) {
        previewError.textContent = message;
        previewError.classList.remove('d-none');
      }
      if (urlInput) {
        urlInput.classList.add('is-invalid');
      }
    }

    function setPlaceholder(caption) {
      if (!previewImage) return;
      previewImage.dataset.previewState = 'placeholder';
      previewImage.src = '/default.png';
      previewImage.classList.add('is-placeholder');
      setCaption(caption);
    }

    function showUrlLoading(candidate) {
      if (!previewImage) return;
      previewImage.dataset.previewState = 'url-loading';
      previewImage.dataset.previewTarget = candidate;
      previewImage.classList.remove('is-placeholder');
      previewImage.src = candidate;
      setCaption('Loading image preview...');
    }

    function showLoadedPreview(candidate, caption) {
      if (!previewImage) return;
      previewImage.dataset.previewState = 'loaded';
      previewImage.dataset.previewTarget = candidate;
      previewImage.classList.remove('is-placeholder');
      previewImage.src = candidate;
      setCaption(caption);
    }

    function syncPanels() {
      const mode = getCurrentMode();
      if (uploadPanel) uploadPanel.classList.toggle('d-none', mode !== 'upload');
      if (urlPanel) urlPanel.classList.toggle('d-none', mode !== 'url');

      clearPreviewError();

      if (mode === 'upload') {
        activeUrlToken += 1;
        if (filePreviewUrl) {
          showLoadedPreview(filePreviewUrl, 'Loaded from device');
        } else {
          setPlaceholder('No thumbnail selected yet');
        }
        return;
      }

      const parsed = parseSafeImageUrl(urlInput ? urlInput.value : '');
      if (!parsed.ok) {
        activeUrlToken += 1;

        if (parsed.reason === 'empty') {
          setPlaceholder('Paste an image URL to preview it');
          return;
        }

        setPlaceholder('Waiting for a valid image URL');
        showPreviewError('Enter a valid http or https image URL.');
        return;
      }

      clearPreviewError();
      activeUrlToken += 1;
      previewImage.dataset.previewToken = String(activeUrlToken);
      showUrlLoading(parsed.value);
    }

    const debouncedSyncPanels = debounce(syncPanels, 350);

    if (previewImage) {
      previewImage.addEventListener('load', () => {
        if (getCurrentMode() !== 'url') return;
        if (previewImage.dataset.previewState !== 'url-loading') return;

        const currentToken = String(activeUrlToken);
        if (previewImage.dataset.previewToken !== currentToken) return;

        clearPreviewError();
        showLoadedPreview(previewImage.dataset.previewTarget || previewImage.src, 'Loaded from image URL');
      });

      previewImage.addEventListener('error', () => {
        if (getCurrentMode() !== 'url') return;
        if (previewImage.dataset.previewState !== 'url-loading') return;

        const currentToken = String(activeUrlToken);
        if (previewImage.dataset.previewToken !== currentToken) return;

        setPlaceholder('Could not load the image URL');
        showPreviewError('The image URL could not be loaded. Check the link and try again.');
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', () => {
        clearPreviewError();

        if (filePreviewUrl) {
          URL.revokeObjectURL(filePreviewUrl);
          filePreviewUrl = '';
        }

        const file = fileInput.files && fileInput.files[0];
        if (!file) {
          syncPanels();
          return;
        }

        filePreviewUrl = URL.createObjectURL(file);
        if (getCurrentMode() === 'upload') {
          showLoadedPreview(filePreviewUrl, 'Loaded from device');
        }
      });
    }

    if (urlInput) {
      urlInput.addEventListener('input', () => {
        clearPreviewError();
        if (getCurrentMode() === 'url') {
          debouncedSyncPanels();
        }
      });
    }

    modeInputs.forEach((input) => {
      input.addEventListener('change', syncPanels);
    });

    syncPanels();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-course-thumbnail-field]').forEach(initThumbnailField);
  });
})();
