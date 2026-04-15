(function() {
  'use strict';

  function init() {
    var items = document.querySelectorAll('[data-animate]');
    items.forEach(function(item, index) {
      item.style.opacity = '0';
      item.style.transform = 'translateY(12px)';
      window.setTimeout(function() {
        item.style.transition = 'opacity 0.28s ease, transform 0.28s ease';
        item.style.opacity = '1';
        item.style.transform = 'translateY(0)';
      }, 45 * index);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
