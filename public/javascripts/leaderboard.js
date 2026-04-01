(function() {
  'use strict';

  function init() {
    const rows = document.querySelectorAll('.leaderboard-table tbody tr');
    rows.forEach(function(row, index) {
      row.style.opacity = '0';
      row.style.transform = 'translateY(6px)';
      window.setTimeout(function() {
        row.style.transition = 'all 0.2s ease';
        row.style.opacity = '1';
        row.style.transform = 'translateY(0)';
      }, 30 * index);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
