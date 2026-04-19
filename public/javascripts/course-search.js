(function () {
  const BOUND_FLAG = "courseSearchBound";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function debounce(fn, delay) {
    let timeoutId;
    return function debounced(...args) {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function readDataset(dataElementId) {
    const dataElement = document.getElementById(dataElementId);
    if (!dataElement) {
      return [];
    }

    try {
      const parsed = JSON.parse(dataElement.textContent || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("[course-search] Failed to parse search dataset:", error);
      return [];
    }
  }

  function highlightText(text, query) {
    const rawText = String(text || "");
    const normalizedQuery = normalize(query);

    if (!normalizedQuery) {
      return escapeHtml(rawText);
    }

    const parts = rawText.split(new RegExp("(" + escapeRegExp(normalizedQuery) + ")", "ig"));
    return parts
      .map((part, index) => {
        if (index % 2 === 1) {
          return '<mark class="course-search-highlight">' + escapeHtml(part) + "</mark>";
        }
        return escapeHtml(part);
      })
      .join("");
  }

  function createSuggestionMarkup(item, query, index, isActive) {
    const thumbnailUrl = item.thumbnailUrl || "/default.png";
    const meta = item.topic ? '<span class="course-search-meta">' + escapeHtml(item.topic) + "</span>" : "";

    return (
      '<button type="button" class="course-search-suggestion' +
      (isActive ? " is-active" : "") +
      '" data-suggestion-index="' +
      index +
      '" data-suggestion-url="' +
      escapeHtml(item.url) +
      '">' +
      '<span class="course-search-thumb"><img src="' +
      escapeHtml(thumbnailUrl) +
      '" alt="" loading="lazy"></span>' +
      '<span class="course-search-copy">' +
      '<span class="course-search-title">' +
      highlightText(item.title, query) +
      "</span>" +
      meta +
      "</span>" +
      "</button>"
    );
  }

  function initCourseSearch(root) {
    if (!root || root.dataset[BOUND_FLAG] === "true") {
      return;
    }

    const input = root.querySelector("[data-course-search-input]");
    const dropdown = root.querySelector("[data-course-search-dropdown]");
    const dataElementId = root.dataset.searchDataId;
    const cardSelector = root.dataset.searchCardSelector || "[data-course-card]";
    const sectionSelector = root.dataset.searchSectionSelector || "";
    const emptySelector = root.dataset.searchEmptySelector || "";
    const noResultsText = root.dataset.searchNoResults || "No matching courses";
    const dataset = readDataset(dataElementId).map((item) => ({
      title: item.title || "",
      url: item.url || "#",
      thumbnailUrl: item.thumbnailUrl || "/default.png",
      topic: item.topic || "",
      searchText: normalize(item.title || "")
    }));

    if (!input || !dropdown) {
      console.warn("[course-search] Missing input or dropdown for search root:", root);
      return;
    }

    const cards = Array.from(document.querySelectorAll(cardSelector));
    const sections = sectionSelector ? Array.from(document.querySelectorAll(sectionSelector)) : [];
    const emptyState = emptySelector ? document.querySelector(emptySelector) : null;
    const state = {
      query: "",
      results: [],
      activeIndex: -1
    };

    root.dataset[BOUND_FLAG] = "true";

    function openUrl(url) {
      if (!url || url === "#") {
        return;
      }
      window.location.assign(url);
    }

    function hideDropdown() {
      dropdown.hidden = true;
      dropdown.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      state.activeIndex = -1;
    }

    function renderDropdown() {
      if (!state.query) {
        hideDropdown();
        return;
      }

      if (!state.results.length) {
        dropdown.innerHTML =
          '<div class="course-search-empty-item" aria-live="polite">' + escapeHtml(noResultsText) + "</div>";
        dropdown.hidden = false;
        input.setAttribute("aria-expanded", "true");
        state.activeIndex = -1;
        return;
      }

      if (state.activeIndex >= state.results.length) {
        state.activeIndex = state.results.length - 1;
      }

      dropdown.innerHTML = state.results
        .map((item, index) => createSuggestionMarkup(item, state.query, index, index === state.activeIndex))
        .join("");
      dropdown.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function filterCards() {
      let visibleCount = 0;

      cards.forEach((card) => {
        const title = normalize(card.dataset.searchTitle);
        const matches = !state.query || title.includes(state.query);

        card.hidden = !matches;
        if (matches) {
          visibleCount += 1;
        }
      });

      sections.forEach((section) => {
        const visibleCards = section.querySelectorAll(cardSelector + ":not([hidden])");
        section.hidden = visibleCards.length === 0;
      });

      if (emptyState) {
        emptyState.hidden = visibleCount !== 0;
      }
    }

    function applyResults() {
      state.results = !state.query
        ? []
        : dataset.filter((item) => item.searchText.includes(state.query)).slice(0, 8);
      state.activeIndex = state.results.length ? 0 : -1;
      filterCards();
      renderDropdown();
    }

    function refreshResults() {
      state.query = normalize(input.value);
      applyResults();
    }

    const refreshResultsDebounced = debounce(refreshResults, 120);

    input.addEventListener("input", refreshResultsDebounced);

    input.addEventListener("focus", function () {
      if (state.query) {
        renderDropdown();
      }
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
        refreshResults();
      }

      if (event.key === "Escape") {
        hideDropdown();
        return;
      }

      if (!state.query || !state.results.length) {
        if (event.key === "Enter") {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        state.activeIndex = Math.min(state.activeIndex + 1, state.results.length - 1);
        renderDropdown();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        state.activeIndex = state.activeIndex <= 0 ? 0 : state.activeIndex - 1;
        renderDropdown();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const nextIndex = state.activeIndex >= 0 ? state.activeIndex : 0;
        const nextResult = state.results[nextIndex];
        if (nextResult) {
          openUrl(nextResult.url);
        }
      }
    });

    dropdown.addEventListener("mousemove", function (event) {
      const button = event.target.closest("[data-suggestion-index]");
      if (!button) {
        return;
      }

      const nextIndex = Number(button.dataset.suggestionIndex);
      if (!Number.isNaN(nextIndex) && nextIndex !== state.activeIndex) {
        state.activeIndex = nextIndex;
        renderDropdown();
      }
    });

    dropdown.addEventListener("click", function (event) {
      const button = event.target.closest("[data-suggestion-url]");
      if (!button) {
        return;
      }

      openUrl(button.dataset.suggestionUrl);
    });

    document.addEventListener("click", function (event) {
      if (!root.contains(event.target)) {
        hideDropdown();
      }
    });

    filterCards();
  }

  function boot() {
    document.querySelectorAll("[data-course-search-root]").forEach(initCourseSearch);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
