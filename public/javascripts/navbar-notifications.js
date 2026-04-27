(function() {
  'use strict';

  function hideBadge(badge) {
    if (!badge) return;
    badge.classList.add('is-hidden');
    window.setTimeout(function() {
      if (badge && badge.parentNode) {
        badge.remove();
      }
    }, 180);
  }

  function initNotificationRead() {
    var dropdown = document.querySelector('[data-notification-dropdown]');
    if (!dropdown) return;

    var trigger = dropdown.querySelector('[data-notification-trigger]');
    var badge = dropdown.querySelector('[data-notification-badge]');
    var hasMarkedRead = false;

    if (!trigger || !badge) return;

    trigger.addEventListener('show.bs.dropdown', function() {
      if (hasMarkedRead) return;

      hideBadge(badge);
      hasMarkedRead = true;

      fetch('/api/notifications/read', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }).catch(function(err) {
        console.error('[Notification Read Error]', err);
      });
    });
  }

  function initMobileNavbar() {
    var navbar = document.getElementById('appNavbar');
    var toggle = document.getElementById('navbarToggle');
    var menu = document.getElementById('navbarNav');
    if (!navbar || !toggle || !menu || !window.bootstrap || !window.bootstrap.Collapse) return;

    var collapse = window.bootstrap.Collapse.getOrCreateInstance(menu, { toggle: false });
    var mobileQuery = window.matchMedia('(max-width: 991.98px)');

    function isMobile() {
      return mobileQuery.matches;
    }

    function isOpen() {
      return menu.classList.contains('show');
    }

    function closeMenu() {
      if (!isMobile() || !isOpen()) return;
      collapse.hide();
    }

    menu.querySelectorAll('a[href], button[data-theme-toggle], form').forEach(function(node) {
      node.addEventListener('click', function() {
        window.setTimeout(closeMenu, 0);
      });
    });

    document.addEventListener('click', function(event) {
      if (!isMobile() || !isOpen()) return;
      if (navbar.contains(event.target)) return;
      closeMenu();
    });

    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        closeMenu();
      }
    });

    menu.addEventListener('shown.bs.collapse', function() {
      toggle.setAttribute('aria-expanded', 'true');
    });

    menu.addEventListener('hidden.bs.collapse', function() {
      toggle.setAttribute('aria-expanded', 'false');
    });

    mobileQuery.addEventListener('change', function(event) {
      if (!event.matches) {
        collapse.hide();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    initNotificationRead();
    initMobileNavbar();
  });
})();
