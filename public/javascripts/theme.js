(function() {
  'use strict';

  const STORAGE_KEY = 'edumy-theme';

  document.addEventListener('DOMContentLoaded', initThemeToggle);

  function initThemeToggle() {
    syncThemeToggle();

    document.querySelectorAll('[data-theme-toggle]').forEach(function(button) {
      button.addEventListener('click', function() {
        const nextTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme, { persist: true, announce: true });
      });
    });

    if (window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', handleSystemThemeChange);
      } else if (typeof media.addListener === 'function') {
        media.addListener(handleSystemThemeChange);
      }
    }
  }

  function handleSystemThemeChange(event) {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return;
    } catch (_error) {
      // Ignore storage access issues and continue with system theme.
    }

    applyTheme(event.matches ? 'dark' : 'light', { persist: false, announce: true });
  }

  function getCurrentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme, options) {
    const settings = options || {};
    const normalized = theme === 'dark' ? 'dark' : 'light';
    const root = document.documentElement;

    root.dataset.theme = normalized;
    root.style.colorScheme = normalized;

    if (settings.persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, normalized);
      } catch (_error) {
        // Ignore storage failures.
      }
    }

    syncThemeToggle();

    if (settings.announce) {
      window.dispatchEvent(new CustomEvent('themechange', {
        detail: { theme: normalized }
      }));
    }
  }

  function syncThemeToggle() {
    const theme = getCurrentTheme();
    const isDark = theme === 'dark';

    document.querySelectorAll('[data-theme-toggle]').forEach(function(button) {
      const icon = button.querySelector('[data-theme-icon]');
      const label = button.querySelector('[data-theme-label]');
      button.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      button.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');

      if (icon) {
        icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      }

      if (label) {
        label.textContent = isDark ? 'Light' : 'Dark';
      }
    });
  }
})();
