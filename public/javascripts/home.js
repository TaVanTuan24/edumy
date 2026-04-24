(function() {
  'use strict';

  const demos = Array.isArray(window.__HOME_DEMO_LINES__) ? window.__HOME_DEMO_LINES__ : [];
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('DOMContentLoaded', function() {
    initRevealAnimations();
    initCounters();
    initStreamingDemo();
    initPointerPolish();
    bindVisibilityRefresh();
  });

  function initRevealAnimations() {
    const revealNodes = Array.from(document.querySelectorAll('[data-reveal]'));
    if (!revealNodes.length) return;

    if (!('IntersectionObserver' in window) || prefersReducedMotion) {
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

    if (!('IntersectionObserver' in window) || prefersReducedMotion) {
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

  function initStreamingDemo() {
    const userNode = document.querySelector('[data-demo-user]');
    const streamNode = document.querySelector('[data-demo-stream]');
    const modelNode = document.querySelector('[data-demo-model]');
    const followupNode = document.querySelector('[data-demo-followup]');
    if (!userNode || !streamNode || !modelNode || !followupNode || !demos.length) return;

    if (prefersReducedMotion) {
      renderStaticDemo(userNode, streamNode, modelNode, followupNode);
      return;
    }

    let demoIndex = 0;
    let timeoutId = null;
    let paused = document.hidden;

    function schedule(step, delay) {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(function() {
        if (!paused) step();
      }, delay);
    }

    function runDemo() {
      const demo = demos[demoIndex % demos.length];
      const nextDemo = demos[(demoIndex + 1) % demos.length];
      demoIndex += 1;

      userNode.textContent = demo.prompt;
      modelNode.textContent = demo.model + ' • Grok/GPT/Gemini-ready';
      followupNode.textContent = 'Thinking...';
      streamNode.innerHTML = '<span class="home-demo-cursor">|</span>';

      schedule(function() {
        followupNode.textContent = 'Streaming response';
        streamMarkdown(streamNode, demo.response, function() {
          followupNode.textContent = nextDemo.prompt;
          schedule(runDemo, 2200);
        });
      }, 850);
    }

    function handleVisibility() {
      paused = document.hidden;
      if (!paused && !timeoutId) {
        runDemo();
      }
    }

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        paused = true;
        window.clearTimeout(timeoutId);
        timeoutId = null;
      } else {
        paused = false;
        runDemo();
      }
    });

    runDemo();
    handleVisibility();
  }

  function renderStaticDemo(userNode, streamNode, modelNode, followupNode) {
    const demo = demos[0];
    if (!demo) return;
    userNode.textContent = demo.prompt;
    modelNode.textContent = demo.model + ' • Grok/GPT/Gemini-ready';
    followupNode.textContent = 'Static preview';
    streamNode.innerHTML = renderSimpleMarkdown(demo.response);
  }

  function streamMarkdown(node, sourceText, onDone) {
    const tokens = tokenizeForStream(sourceText);
    let index = 0;
    let rendered = '';

    function tick() {
      rendered += tokens[index] || '';
      node.innerHTML = renderSimpleMarkdown(rendered) + '<span class="home-demo-cursor">|</span>';
      index += 1;

      if (index < tokens.length) {
        const delay = /\s/.test(tokens[index - 1]) ? 26 : 34;
        window.setTimeout(tick, delay);
        return;
      }

      node.innerHTML = renderSimpleMarkdown(rendered);
      if (typeof onDone === 'function') onDone();
    }

    tick();
  }

  function tokenizeForStream(text) {
    return String(text || '').match(/```[\s\S]*?```|\*\*[^*]+\*\*|`[^`]+`|\n|[^\s]+\s*/g) || [];
  }

  function renderSimpleMarkdown(text) {
    let html = escapeHtml(String(text || ''));
    html = html.replace(/```([\s\S]*?)```/g, function(_match, code) {
      return '<span class="home-demo-code">' + escapeHtml(String(code || '').trim()) + '</span>';
    });
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^- /gm, '&bull; ');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initPointerPolish() {
    if (prefersReducedMotion) return;

    const tiltTargets = document.querySelectorAll('.home-feature-card, .home-course-card, .hero-panel');
    tiltTargets.forEach(function(node) {
      node.addEventListener('pointermove', function(event) {
        const rect = node.getBoundingClientRect();
        const offsetX = (event.clientX - rect.left) / rect.width - 0.5;
        const offsetY = (event.clientY - rect.top) / rect.height - 0.5;
        node.style.setProperty('--card-tilt-y', (offsetX * 6).toFixed(2) + 'deg');
        node.style.setProperty('--card-tilt-x', (offsetY * -6).toFixed(2) + 'deg');
      });

      node.addEventListener('pointerleave', function() {
        node.style.removeProperty('--card-tilt-x');
        node.style.removeProperty('--card-tilt-y');
      });
    });

    const depthLayers = document.querySelectorAll('[data-depth-layer]');
    if (depthLayers.length) {
      window.addEventListener('scroll', function() {
        const scrollY = window.scrollY || 0;
        depthLayers.forEach(function(node, index) {
          const drift = Math.min(24, scrollY * 0.03 * (index + 1));
          node.style.setProperty('--depth-y', (-drift).toFixed(2) + 'px');
        });
      }, { passive: true });

      depthLayers.forEach(function(node) {
        node.addEventListener('pointermove', function(event) {
          const rect = node.getBoundingClientRect();
          const offsetX = (event.clientX - rect.left) / rect.width - 0.5;
          const offsetY = (event.clientY - rect.top) / rect.height - 0.5;
          node.style.setProperty('--depth-x', (offsetX * 12).toFixed(2) + 'px');
          node.style.setProperty('--depth-tilt-y', (offsetX * 4).toFixed(2) + 'deg');
          node.style.setProperty('--depth-tilt-x', (offsetY * -4).toFixed(2) + 'deg');
        });

        node.addEventListener('pointerleave', function() {
          node.style.removeProperty('--depth-x');
          node.style.removeProperty('--depth-tilt-x');
          node.style.removeProperty('--depth-tilt-y');
        });
      });
    }
  }

  function bindVisibilityRefresh() {
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        document.querySelectorAll('[data-depth-layer]').forEach(function(node) {
          node.style.removeProperty('--depth-x');
          node.style.removeProperty('--depth-tilt-x');
          node.style.removeProperty('--depth-tilt-y');
        });
      }
    });
  }
})();
