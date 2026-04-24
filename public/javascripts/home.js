(function() {
  'use strict';

  const demoLines = Array.isArray(window.__HOME_DEMO_LINES__) ? window.__HOME_DEMO_LINES__ : [];

  document.addEventListener('DOMContentLoaded', function() {
    initRevealAnimations();
    initCounters();
    initTypingDemo();
  });

  function initRevealAnimations() {
    const revealNodes = Array.from(document.querySelectorAll('[data-reveal]'));
    if (!revealNodes.length) return;

    if (!('IntersectionObserver' in window)) {
      revealNodes.forEach(function(node) {
        node.classList.add('is-visible');
      });
      return;
    }

    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        const delay = Number(entry.target.dataset.revealDelay || 0);
        if (delay > 0) {
          entry.target.style.setProperty('--reveal-delay', delay + 'ms');
        }
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, {
      threshold: 0.18
    });

    revealNodes.forEach(function(node) {
      observer.observe(node);
    });
  }

  function initCounters() {
    const counterSection = document.querySelector('[data-counter-section]');
    const counters = Array.from(document.querySelectorAll('[data-count]'));
    if (!counterSection || !counters.length) return;

    const startCounters = function() {
      counters.forEach(function(counter) {
        animateCount(counter, Number(counter.dataset.count || 0));
      });
    };

    if (!('IntersectionObserver' in window)) {
      startCounters();
      return;
    }

    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        startCounters();
        observer.disconnect();
      });
    }, {
      threshold: 0.35
    });

    observer.observe(counterSection);
  }

  function animateCount(node, target) {
    if (!node || node.dataset.animated === 'true') return;
    node.dataset.animated = 'true';

    const safeTarget = Number.isFinite(target) ? Math.max(0, target) : 0;
    const duration = 1200;
    const startTime = performance.now();

    function frame(now) {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = Math.round(safeTarget * eased).toLocaleString();
      if (progress < 1) {
        window.requestAnimationFrame(frame);
      }
    }

    window.requestAnimationFrame(frame);
  }

  function initTypingDemo() {
    const output = document.querySelector('[data-demo-typing]');
    if (!output || !demoLines.length) return;

    let lineIndex = 0;
    let charIndex = 0;
    let deleting = false;

    function tick() {
      const activeLine = demoLines[lineIndex] || '';

      if (!deleting) {
        charIndex += 1;
        output.textContent = activeLine.slice(0, charIndex);
        if (charIndex >= activeLine.length) {
          deleting = true;
          window.setTimeout(tick, 1500);
          return;
        }
      } else {
        charIndex -= 1;
        output.textContent = activeLine.slice(0, Math.max(0, charIndex));
        if (charIndex <= 0) {
          deleting = false;
          lineIndex = (lineIndex + 1) % demoLines.length;
        }
      }

      const delay = deleting ? 26 : 38;
      window.setTimeout(tick, delay);
    }

    tick();
  }
})();
