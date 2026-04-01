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

  document.addEventListener('DOMContentLoaded', initNotificationRead);
})();
