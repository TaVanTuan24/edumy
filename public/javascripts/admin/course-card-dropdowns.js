document.addEventListener('DOMContentLoaded', function () {
  if (!window.bootstrap) {
    return;
  }

  var dropdownRoots = Array.prototype.slice.call(
    document.querySelectorAll('[data-course-card-dropdown]')
  );

  if (!dropdownRoots.length) {
    return;
  }

  var ACTIVE_COLUMN_CLASS = 'course-card-column-active';
  var ACTIVE_CARD_CLASS = 'course-card-active';
  var DROPUP_CLASS = 'dropup';
  var VIEWPORT_PADDING = 16;

  function getToggle(root) {
    return root.querySelector('[data-course-card-menu-toggle]');
  }

  function getMenu(root) {
    return root.querySelector('.course-card-menu');
  }

  function getColumn(root) {
    return root.closest('.course-card-column');
  }

  function getCard(root) {
    return root.closest('.course-card');
  }

  function setExpanded(root, expanded) {
    var toggle = getToggle(root);

    if (toggle) {
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
  }

  function setActiveState(root, isActive) {
    var column = getColumn(root);
    var card = getCard(root);

    if (column) {
      column.classList.toggle(ACTIVE_COLUMN_CLASS, isActive);
    }

    if (card) {
      card.classList.toggle(ACTIVE_CARD_CLASS, isActive);
    }

    setExpanded(root, isActive);
  }

  function measureMenuHeight(menu) {
    var previousDisplay = menu.style.display;
    var previousVisibility = menu.style.visibility;
    var previousLeft = menu.style.left;
    var previousTop = menu.style.top;

    menu.style.display = 'block';
    menu.style.visibility = 'hidden';
    menu.style.left = '0';
    menu.style.top = '0';

    var height = menu.getBoundingClientRect().height;

    menu.style.display = previousDisplay;
    menu.style.visibility = previousVisibility;
    menu.style.left = previousLeft;
    menu.style.top = previousTop;

    return height;
  }

  function updatePlacement(root) {
    var toggle = getToggle(root);
    var menu = getMenu(root);

    if (!toggle || !menu) {
      return;
    }

    root.classList.remove(DROPUP_CLASS);

    var toggleRect = toggle.getBoundingClientRect();
    var menuHeight = measureMenuHeight(menu);
    var spaceBelow = window.innerHeight - toggleRect.bottom - VIEWPORT_PADDING;
    var spaceAbove = toggleRect.top - VIEWPORT_PADDING;
    var shouldOpenUpward = menuHeight > spaceBelow && spaceAbove > spaceBelow;

    root.classList.toggle(DROPUP_CLASS, shouldOpenUpward);
  }

  function hideDropdown(root) {
    var toggle = getToggle(root);
    var instance = toggle && bootstrap.Dropdown.getInstance(toggle);

    if (instance) {
      instance.hide();
    } else {
      setActiveState(root, false);
      root.classList.remove(DROPUP_CLASS);
    }
  }

  function hideOtherDropdowns(currentRoot) {
    dropdownRoots.forEach(function (root) {
      if (root !== currentRoot) {
        hideDropdown(root);
      }
    });
  }

  dropdownRoots.forEach(function (root) {
    var toggle = getToggle(root);

    if (!toggle) {
      return;
    }

    root.addEventListener('show.bs.dropdown', function () {
      hideOtherDropdowns(root);
      updatePlacement(root);
      setActiveState(root, true);
    });

    root.addEventListener('shown.bs.dropdown', function () {
      var instance = bootstrap.Dropdown.getInstance(toggle);

      if (instance && typeof instance.update === 'function') {
        instance.update();
      }
    });

    root.addEventListener('hide.bs.dropdown', function () {
      setActiveState(root, false);
    });

    root.addEventListener('hidden.bs.dropdown', function () {
      setActiveState(root, false);
      root.classList.remove(DROPUP_CLASS);
    });
  });

  window.addEventListener('resize', function () {
    dropdownRoots.forEach(function (root) {
      var toggle = getToggle(root);

      if (!toggle || toggle.getAttribute('aria-expanded') !== 'true') {
        return;
      }

      updatePlacement(root);

      var instance = bootstrap.Dropdown.getInstance(toggle);

      if (instance && typeof instance.update === 'function') {
        instance.update();
      }
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') {
      return;
    }

    dropdownRoots.forEach(function (root) {
      var toggle = getToggle(root);

      if (toggle && toggle.getAttribute('aria-expanded') === 'true') {
        hideDropdown(root);
      }
    });
  });
});
