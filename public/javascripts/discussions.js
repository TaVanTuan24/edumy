(function() {
  'use strict';

  function init() {
    renderMarkdownBlocks();
    bindVotes();
    bindAcceptAnswer();
    bindDeleteAnswer();
    bindAiAnswerActions();
  }

  function renderMarkdownToHtml(markdownText) {
    const source = String(markdownText || '');
    if (!window.marked || !window.DOMPurify) {
      return source
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }

    marked.setOptions({
      gfm: true,
      breaks: true,
      headerIds: false,
      mangle: false
    });

    const html = marked.parse(source);
    return DOMPurify.sanitize(html);
  }

  function renderMarkdownBlocks() {
    document.querySelectorAll('[data-markdown]').forEach(function(el) {
      const raw = el.textContent || '';
      el.innerHTML = renderMarkdownToHtml(raw);
    });
  }

  function bindVotes() {
    function getVotePairButton(shell, voteTarget, answerId, type) {
      if (voteTarget === 'question') {
        return shell.querySelector('[data-vote-target="question"][data-vote-type="' + type + '"]');
      }
      return shell.querySelector('[data-vote-target="answer"][data-answer-id="' + answerId + '"][data-vote-type="' + type + '"]');
    }

    function setVoteState(shell, voteTarget, answerId, currentVote) {
      const upBtn = getVotePairButton(shell, voteTarget, answerId, 'up');
      const downBtn = getVotePairButton(shell, voteTarget, answerId, 'down');

      if (upBtn) {
        upBtn.classList.toggle('is-active', currentVote === 'up');
        upBtn.setAttribute('aria-pressed', currentVote === 'up' ? 'true' : 'false');
      }
      if (downBtn) {
        downBtn.classList.toggle('is-active', currentVote === 'down');
        downBtn.setAttribute('aria-pressed', currentVote === 'down' ? 'true' : 'false');
      }
    }

    document.querySelectorAll('[data-vote-target]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const shell = document.querySelector('.discussion-shell');
        if (!shell) return;

        const courseId = shell.dataset.courseId;
        const discussionId = shell.dataset.discussionId;
        const voteTarget = btn.dataset.voteTarget;
        const voteType = btn.dataset.voteType;
        const answerId = btn.dataset.answerId;

        btn.disabled = true;

        let url = '/courses/' + encodeURIComponent(courseId) + '/discussions/' + encodeURIComponent(discussionId) + '/vote';
        if (voteTarget === 'answer') {
          url = '/courses/' + encodeURIComponent(courseId) + '/discussions/' + encodeURIComponent(discussionId) + '/answers/' + encodeURIComponent(answerId) + '/vote';
        }

        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: voteType })
        })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (!data || !data.success) return;
            if (voteTarget === 'question') {
              const questionScore = document.getElementById('questionScore');
              if (questionScore) questionScore.textContent = String(data.score);
            } else {
              const scoreEl = document.getElementById('answerScore-' + answerId);
              if (scoreEl) scoreEl.textContent = String(data.score);
            }

            setVoteState(shell, voteTarget, answerId, data.currentVote || 'none');
          })
          .catch(function(err) {
            console.error('[Discussion Vote Error]', err);
          })
          .finally(function() {
            btn.disabled = false;
          });
      });
    });
  }

  function bindAcceptAnswer() {
    document.querySelectorAll('[data-accept-answer]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const shell = document.querySelector('.discussion-shell');
        if (!shell) return;
        const courseId = shell.dataset.courseId;
        const discussionId = shell.dataset.discussionId;
        const answerId = btn.dataset.acceptAnswer;

        fetch('/courses/' + encodeURIComponent(courseId) + '/discussions/' + encodeURIComponent(discussionId) + '/answers/' + encodeURIComponent(answerId) + '/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (!data || !data.success) return;
            window.location.reload();
          })
          .catch(function(err) {
            console.error('[Accept Answer Error]', err);
          });
      });
    });
  }

  function bindAiAnswerActions() {
    const generateBtn = document.getElementById('generateAiAnswerBtn');
    const postBtn = document.getElementById('postAiAnswerBtn');
    const discardBtn = document.getElementById('discardAiAnswerBtn');
    const editor = document.getElementById('aiAnswerEditor');
    const preview = document.getElementById('aiAnswerPreview');
    const status = document.getElementById('aiAnswerStatus');
    const shell = document.querySelector('.discussion-shell');

    if (!generateBtn || !editor || !status || !shell) return;

    function syncPreview() {
      if (!preview) return;
      const value = String(editor.value || '').trim();
      if (!value) {
        preview.innerHTML = '<p class="text-muted mb-0">No AI answer yet.</p>';
        return;
      }
      preview.innerHTML = renderMarkdownToHtml(value);
    }

    syncPreview();
    editor.addEventListener('input', syncPreview);

    const courseId = shell.dataset.courseId;
    const discussionId = shell.dataset.discussionId;

    generateBtn.addEventListener('click', function() {
      generateBtn.disabled = true;
      status.textContent = 'Generating AI answer...';

      fetch('/courses/' + encodeURIComponent(courseId) + '/discussions/' + encodeURIComponent(discussionId) + '/ai-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (!data || !data.success) {
            status.textContent = (data && data.error) ? data.error : 'Failed to generate AI answer.';
            return;
          }

          editor.value = data.answer || '';
          syncPreview();
          status.textContent = 'AI answer ready. Edit it if needed, then post or discard.';
        })
        .catch(function(err) {
          console.error('[AI Answer Generate Error]', err);
          status.textContent = 'Error generating AI answer.';
        })
        .finally(function() {
          generateBtn.disabled = false;
        });
    });

    if (postBtn) {
      postBtn.addEventListener('click', function() {
        const value = String(editor.value || '').trim();
        if (!value) {
          status.textContent = 'AI answer is empty.';
          return;
        }

        postBtn.disabled = true;
        status.textContent = 'Posting AI answer...';

        fetch('/courses/' + encodeURIComponent(courseId) + '/discussions/' + encodeURIComponent(discussionId) + '/answers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ body: value })
        })
          .then(function(res) {
            return res
              .json()
              .catch(function() { return null; })
              .then(function(data) {
                if (!res.ok || !data || !data.success) {
                  const message = data && data.error ? data.error : 'Failed to post AI answer.';
                  throw new Error(message);
                }
              });
          })
          .then(function() {
            window.location.reload();
          })
          .catch(function(err) {
            console.error('[AI Answer Post Error]', err);
            status.textContent = err && err.message ? err.message : 'Failed to post AI answer.';
          })
          .finally(function() {
            postBtn.disabled = false;
          });
      });
    }

    if (discardBtn) {
      discardBtn.addEventListener('click', function() {
        editor.value = '';
        syncPreview();
        status.textContent = 'AI answer discarded.';
      });
    }
  }

  function bindDeleteAnswer() {
    document.querySelectorAll('[data-delete-answer]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const shell = document.querySelector('.discussion-shell');
        if (!shell) return;

        const confirmed = window.confirm('Are you sure you want to delete this answer? This action cannot be undone.');
        if (!confirmed) return;

        const courseId = shell.dataset.courseId;
        const discussionId = shell.dataset.discussionId;
        const answerId = btn.dataset.deleteAnswer;

        btn.disabled = true;

        fetch('/courses/' + encodeURIComponent(courseId) + '/discussions/' + encodeURIComponent(discussionId) + '/answers/' + encodeURIComponent(answerId), {
          method: 'DELETE',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          }
        })
          .then(function(res) {
            return res
              .json()
              .catch(function() { return null; })
              .then(function(data) {
                if (!res.ok || !data || !data.success) {
                  const message = data && data.error ? data.error : 'Failed to delete answer.';
                  throw new Error(message);
                }
                return data;
              });
          })
          .then(function() {
            const item = document.getElementById('answer-' + answerId);
            if (item) item.remove();

            const answersCount = document.getElementById('answersCount');
            if (answersCount) {
              const nextCount = Math.max(0, Number(answersCount.textContent || '0') - 1);
              answersCount.textContent = String(nextCount);
            }
          })
          .catch(function(err) {
            console.error('[Delete Answer Error]', err);
            window.alert(err && err.message ? err.message : 'Failed to delete answer.');
          })
          .finally(function() {
            btn.disabled = false;
          });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
