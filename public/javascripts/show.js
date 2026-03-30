let currentSectionIndex = null;
let currentLessonId = null;

const STORAGE_SUFFIX = {
  completed: 'completedLessons',
  lastLesson: 'lastLesson',
  lastSection: 'lastSection',
  videoTimes: 'videoTimes'
};

const state = {
  completedLessonIds: new Set(),
  completedMediaKeys: new Set(),
  lessonById: new Map(),
  allLessons: [],
  lastVideoSaveAt: 0
};

document.addEventListener('DOMContentLoaded', initLearningUX);

function initLearningUX() {
  buildAllLessonsIndex();
  hydrateProgressState();
  ensureLoadingSpinner();
  bindKeyboardShortcuts();
  bindMediaProgressListeners();
  resumeLastLesson();
}

function storageKey(suffix) {
  return 'course:' + course._id + ':' + suffix;
}

function getJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function setJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Ignore storage write errors.
  }
}

function normalizeLessonType(rawType) {
  const type = String(rawType || 'video').toLowerCase();
  if (type === 'video') return 'lecture';
  if (type === 'slide') return 'slide';
  if (type === 'quiz') return 'quiz';
  return 'lecture';
}

function toSafeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeMediaKey(url) {
  return String(url || '').split('?')[0];
}

function createLessonId(seed) {
  let hash = 0;
  const str = String(seed || 'lesson');

  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }

  return 'lesson-' + Math.abs(hash);
}

function getTypeLabel(type) {
  if (type === 'lecture') return 'Lecture';
  if (type === 'slide') return 'Slide';
  if (type === 'quiz') return 'Quiz';
  return 'Lecture';
}

function getSortedVideos(section) {
  const videos = Array.isArray(section && section.videos) ? section.videos : [];
  return videos.slice().sort((a, b) => {
    const getNum = function(str) {
      const match = String(str || '').match(/^\d{1,3}/);
      return match ? parseInt(match[0], 10) : 0;
    };

    const numA = getNum(a && a.name);
    const numB = getNum(b && b.name);
    if (numA !== numB) return numA - numB;
    return String((a && a.name) || '').localeCompare(String((b && b.name) || ''));
  });
}

function buildAllLessonsIndex() {
  state.allLessons = [];

  (course.driveStructure || []).forEach(function(section, sectionIndex) {
    const sorted = getSortedVideos(section);

    sorted.forEach(function(video, index) {
      const videoPreview = String(video.preview || '');
      const lessonId = createLessonId((video._id || '') + '|' + sectionIndex + '|' + index + '|' + videoPreview + '|' + (video.name || ''));

      state.allLessons.push({
        id: lessonId,
        preview: videoPreview,
        sectionIndex: sectionIndex
      });
    });
  });
}

function hydrateProgressState() {
  state.completedMediaKeys = new Set((completedVideos || []).map(normalizeMediaKey));

  const storedCompletedLessons = getJsonStorage(storageKey(STORAGE_SUFFIX.completed), []);
  state.completedLessonIds = new Set(Array.isArray(storedCompletedLessons) ? storedCompletedLessons : []);
}

function saveCompletedLessonsToStorage() {
  setJsonStorage(storageKey(STORAGE_SUFFIX.completed), Array.from(state.completedLessonIds));
}

function saveLastLessonToStorage(lessonId, sectionIndex) {
  try {
    localStorage.setItem(storageKey(STORAGE_SUFFIX.lastLesson), String(lessonId || ''));
    localStorage.setItem(storageKey(STORAGE_SUFFIX.lastSection), String(sectionIndex || 0));
  } catch (error) {
    // Ignore storage write errors.
  }
}

function isLessonCompleted(lessonId, previewUrl) {
  if (lessonId && state.completedLessonIds.has(lessonId)) return true;
  if (previewUrl && state.completedMediaKeys.has(normalizeMediaKey(previewUrl))) return true;
  return false;
}

function markLessonCompleted(lessonId, previewUrl, isCompleted, shouldPersistBackend) {
  const mediaKey = normalizeMediaKey(previewUrl || '');

  if (isCompleted) {
    if (lessonId) state.completedLessonIds.add(lessonId);
    if (mediaKey) state.completedMediaKeys.add(mediaKey);
  } else {
    if (lessonId) state.completedLessonIds.delete(lessonId);
    if (mediaKey) state.completedMediaKeys.delete(mediaKey);
  }

  saveCompletedLessonsToStorage();
  renderCurrentSectionRows();

  if (shouldPersistBackend && previewUrl) {
    toggleProgress(previewUrl, isCompleted);
  } else {
    updateProgressUI();
  }
}

function renderCurrentSectionRows() {
  if (currentSectionIndex === null || currentSectionIndex === undefined) return;

  const activeLesson = currentLessonId;
  const currentContainer = document.getElementById('videoListContainer');
  if (!currentContainer) return;

  showVideos(currentSectionIndex);

  if (activeLesson) {
    const activeEl = currentContainer.querySelector('.lesson-item[data-id="' + activeLesson + '"]');
    if (activeEl) activeEl.classList.add('active');
  }
}

function getLessonIcon(type, completed) {
  if (completed) return 'Completed';
  if (type === 'lecture') return 'Video';
  if (type === 'slide') return 'Slide';
  if (type === 'quiz') return 'Quiz';
  return 'Lesson';
}

function showVideos(sectionIndex) {
  currentSectionIndex = sectionIndex;
  state.lessonById.clear();

  const section = course.driveStructure[sectionIndex];
  const container = document.getElementById('videoListContainer');

  if (!section || !section.videos || section.videos.length === 0) {
    container.innerHTML = `<p class="text-warning">No videos found in this section.</p>`;
    return;
  }

  const sortedVideos = getSortedVideos(section);

  let html = `<h6>Videos in ${section.section || 'Section ' + (sectionIndex + 1)}:</h6><ul class="list-group">`;
  sortedVideos.forEach((video, index) => {
  const videoPreview = String(video.preview || '');
  const lessonId = createLessonId((video._id || '') + '|' + sectionIndex + '|' + index + '|' + videoPreview + '|' + (video.name || ''));
  const lessonType = normalizeLessonType(video.type);
  const lessonSrc = encodeURIComponent(videoPreview);
  const lessonTitle = encodeURIComponent(video.name || 'Untitled Lesson');
  const lessonName = toSafeAttr(video.name || 'Untitled Lesson');
  const isCompleted = isLessonCompleted(lessonId, videoPreview);
  const isChecked = isCompleted ? 'checked' : '';
  const completedBadge = isCompleted ? '<span class="lesson-completed-badge">Completed</span>' : '';
  const newBadge = (!isCompleted && typeof hasCourseUpdate !== 'undefined' && hasCourseUpdate)
    ? '<span class="lesson-new-badge">NEW</span>'
    : '';

  state.lessonById.set(lessonId, {
    id: lessonId,
    type: lessonType,
    src: videoPreview,
    title: video.name || 'Untitled Lesson',
    sectionIndex: sectionIndex
  });

  html += `
    <li class="list-group-item lesson-item d-flex justify-content-between align-items-center"
        data-id="${lessonId}"
        data-type="${lessonType}"
        data-src="${lessonSrc}"
        data-title="${lessonTitle}"
        data-section-index="${sectionIndex}"
        onclick="handleLessonClick(this)">
      <div>
        <span class="lesson-title">${lessonName}</span>
        <small class="text-muted ms-2">${getTypeLabel(lessonType)}</small>
        ${completedBadge}
        ${newBadge}
      </div>
      <div>
        <input type="checkbox"
               class="form-check-input"
               style="transform: scale(1.5);"
               onclick="event.stopPropagation()"
               onchange="handleProgressToggle(this, '${lessonId}', decodeURIComponent('${lessonSrc}'))"
               ${isChecked}>
      </div>
    </li>`;
    });
  html += `</ul>`;
  container.innerHTML = html;

  if (currentLessonId) {
    const activeEl = container.querySelector('.lesson-item[data-id="' + currentLessonId + '"]');
    if (activeEl) activeEl.classList.add('active');
  }

  // Hiện phần ghi chú tương ứng section
  document.getElementById('courseInfo').style.display = 'none';
  document.getElementById('videoNoteSection').style.display = 'block';
  document.querySelectorAll('.section-note').forEach((note, i) => {
    note.style.display = i === currentSectionIndex ? 'block' : 'none';
  });
}

function handleLessonClick(el) {
  if (el.classList.contains('active')) return;

  const type = el.dataset.type;
  const src = decodeURIComponent(el.dataset.src || '');
  const title = decodeURIComponent(el.dataset.title || 'Lesson');
  const lessonId = el.dataset.id || '';
  const sectionIndex = Number(el.dataset.sectionIndex || 0);

  console.log('Clicked:', type, src);
  console.log(type);

  document.querySelectorAll('.lesson-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');

  currentLessonId = lessonId;
  saveLastLessonToStorage(lessonId, sectionIndex);
  showLoading(true);

  withContentFade(function() {
    if (type === 'lecture') {
      playVideo(src);
    }

    if (type === 'slide') {
      renderSlide(src, title);
    }

    if (type === 'quiz') {
      renderQuiz(src, title);
    }

    showLoading(false);
  });

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function withContentFade(renderFn) {
  const container = document.getElementById('content') || document.getElementById('videoPlayerContainer');
  if (!container) {
    renderFn();
    return;
  }

  container.style.transition = 'opacity 0.15s ease';
  container.style.opacity = '0';

  setTimeout(function() {
    renderFn();
    container.style.opacity = '1';
  }, 150);
}


function playVideo(link) {
  if (!link) return;

  // Ẩn phần hình ảnh
  const imageContainer = document.getElementById('imageContainer');
  if (imageContainer) imageContainer.style.display = 'none';

  const fallbackPanel = document.getElementById('lessonFallbackPanel');
  if (fallbackPanel) fallbackPanel.style.display = 'none';

  // Hiện video player
  const player = document.getElementById('videoPlayerContainer');
  const iframe = document.getElementById('videoIframe');
  iframe.src = link;
  player.style.display = 'block';

  restoreVideoTime();
}

function renderSlide(link, title) {
  if (link) {
    playVideo(link);
    return;
  }

  renderLessonFallback('Slide', title || 'Slide', 'No slide source found for this lesson.');
}

function renderQuiz(link, title) {
  if (link) {
    playVideo(link);
    return;
  }

  renderLessonFallback('Quiz', title || 'Quiz', 'No quiz source found for this lesson.', true);
}

function renderLessonFallback(typeLabel, title, message, allowComplete) {
  const imageContainer = document.getElementById('imageContainer');
  if (imageContainer) imageContainer.style.display = 'none';

  const player = document.getElementById('videoPlayerContainer');
  const iframe = document.getElementById('videoIframe');
  if (iframe) iframe.src = '';
  if (player) player.style.display = 'none';

  let panel = document.getElementById('lessonFallbackPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'lessonFallbackPanel';
    panel.className = 'card mb-3';

    if (player && player.parentNode) {
      player.parentNode.insertBefore(panel, player.nextSibling);
    }
  }

  panel.innerHTML = `
    <div class="card-body">
      <h5 class="card-title mb-2">${toSafeAttr(typeLabel)}: ${toSafeAttr(title)}</h5>
      <p class="card-text text-muted mb-0">${toSafeAttr(message)}</p>
      ${allowComplete ? '<button class="btn btn-sm btn-primary mt-3" onclick="markCurrentLessonCompleted()">Mark as Completed</button>' : ''}
    </div>`;
  panel.style.display = 'block';
}

function goNextLesson() {
  const current = document.querySelector('.lesson-item.active');
  if (!current) return;

  const next = current.nextElementSibling;
  if (next && next.classList.contains('lesson-item')) {
    handleLessonClick(next);
  }
}

function goPrevLesson() {
  const current = document.querySelector('.lesson-item.active');
  if (!current) return;

  const prev = current.previousElementSibling;
  if (prev && prev.classList.contains('lesson-item')) {
    handleLessonClick(prev);
  }
}

function markCurrentLessonCompleted() {
  const current = document.querySelector('.lesson-item.active');
  if (!current) return;

  const lessonId = current.dataset.id || '';
  const src = decodeURIComponent(current.dataset.src || '');

  markLessonCompleted(lessonId, src, true, !!src);
}

function handleProgressToggle(checkbox, lessonId, videoUrl) {
  const checked = !!checkbox.checked;
  markLessonCompleted(lessonId, videoUrl, checked, true);
}

function resumeLastLesson() {
  const storedSection = Number(localStorage.getItem(storageKey(STORAGE_SUFFIX.lastSection)) || 0);
  const storedLesson = localStorage.getItem(storageKey(STORAGE_SUFFIX.lastLesson));

  if (!Number.isNaN(storedSection) && course.driveStructure[storedSection]) {
    showVideos(storedSection);
  }

  if (storedLesson) {
    const el = document.querySelector('.lesson-item[data-id="' + storedLesson + '"]');
    if (el) {
      handleLessonClick(el);
      return;
    }
  }

  const firstSectionIndex = !Number.isNaN(storedSection) && course.driveStructure[storedSection] ? storedSection : 0;
  if (course.driveStructure[firstSectionIndex]) {
    showVideos(firstSectionIndex);
  }
}

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', function(e) {
    const tag = String((e.target && e.target.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    if (e.key === 'ArrowRight') {
      goNextLesson();
    }

    if (e.key === 'ArrowLeft') {
      goPrevLesson();
    }
  });
}

function ensureLoadingSpinner() {
  if (document.getElementById('loadingSpinner')) return;

  const player = document.getElementById('videoPlayerContainer');
  if (!player || !player.parentNode) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'loadingSpinner';
  wrapper.className = 'loading-spinner d-none';
  wrapper.innerHTML = '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div>';
  player.parentNode.insertBefore(wrapper, player);
}

function showLoading(isVisible) {
  const spinner = document.getElementById('loadingSpinner');
  if (!spinner) return;

  spinner.classList.toggle('d-none', !isVisible);
}

function bindMediaProgressListeners() {
  const iframe = document.getElementById('videoIframe');
  if (!iframe) return;

  iframe.addEventListener('load', function() {
    showLoading(false);
  });

  // For iframe providers we cannot access native time/ended events directly.
  // This gracefully supports HTMLVideoElement if swapped in later.
  if (iframe.tagName === 'VIDEO') {
    iframe.addEventListener('timeupdate', function() {
      const now = Date.now();
      if (now - state.lastVideoSaveAt < 2000) return;
      state.lastVideoSaveAt = now;
      saveCurrentVideoTime(iframe.currentTime || 0);
    });

    iframe.addEventListener('ended', function() {
      markCurrentLessonCompleted();
      goNextLesson();
    });
  }
}

function saveCurrentVideoTime(seconds) {
  if (!currentLessonId) return;

  const videoTimes = getJsonStorage(storageKey(STORAGE_SUFFIX.videoTimes), {});
  videoTimes[currentLessonId] = Number(seconds || 0);
  setJsonStorage(storageKey(STORAGE_SUFFIX.videoTimes), videoTimes);
}

function restoreVideoTime() {
  const iframe = document.getElementById('videoIframe');
  if (!iframe || iframe.tagName !== 'VIDEO' || !currentLessonId) return;

  const videoTimes = getJsonStorage(storageKey(STORAGE_SUFFIX.videoTimes), {});
  const savedTime = Number(videoTimes[currentLessonId] || 0);
  if (savedTime > 0) {
    iframe.currentTime = savedTime;
  }
}


function toggleProgress(videoUrl, isCompleted) {
  fetch(`/courses/${course._id}/progress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ video: videoUrl, completed: isCompleted })
  })
    .then(async res => {
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Lỗi ${res.status}: ${errorText}`);
      }
      return res.json();
    })
    .then(data => {
      if (!data.success) {
        console.warn('[Lỗi lưu tiến độ]', data.error);
        alert('Không thể lưu tiến độ học. Vui lòng thử lại.');
      } else {
        // ✅ Cập nhật danh sách completedVideos trên client
        const normalized = videoUrl.split('?')[0];

        if (isCompleted && !completedVideos.includes(normalized)) {
          completedVideos.push(normalized);
        } else if (!isCompleted) {
          const idx = completedVideos.findIndex(v => v.split('?')[0] === normalized);
          if (idx !== -1) completedVideos.splice(idx, 1);
        }

        updateProgressUI();
      }
    })
    .catch(err => {
      console.error('[Lỗi JS khi cập nhật tiến độ]', err);
      alert('Có lỗi xảy ra khi lưu tiến độ.');
    });
}


function saveNote(index) {
  const content = document.getElementById(`note-section-${index}`).value;

  fetch(`/courses/${course._id}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionIndex: index, content })
  })
    .then(res => res.json())
    .then(data => {
      if (!data.success) alert('Lưu ghi chú thất bại');
    })
    .catch(err => console.error('[Lỗi lưu ghi chú]', err));
}
function updateProgressUI() {
  const total = state.allLessons.length || 1;
  const checkedCount = state.allLessons.reduce((count, lesson) => {
    return count + (isLessonCompleted(lesson.id, lesson.preview) ? 1 : 0);
  }, 0);
  const percent = Math.round((checkedCount / total) * 100);

  const bar = document.querySelector('.progress-bar');
  const label = document.querySelector('.text-success');

  if (!bar || !label) return;

  bar.style.width = `${percent}%`;
  bar.setAttribute('aria-valuenow', checkedCount);
  label.innerText = `Tiến độ học: ${checkedCount} / ${total} video (${percent}%)`;
}
