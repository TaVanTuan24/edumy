# Cleanup Candidates

These files were reviewed during structural cleanup and appear to be unused by current server-side imports and EJS asset references.

They were intentionally left in place because runtime safety was not proven strongly enough for an automatic move.

## Candidate files

- `public/javascripts/learning.js`
- `public/javascripts/show.js`
- `public/javascripts/clusterMap.js`
- `public/javascripts/courseEditor.js`
- `scripts/sample-youtube-links.txt`

## Pre-existing structural debt noted during cleanup

- `routes/admin.js` renders `admin/courseEditorNew`, but `views/admin/courseEditorNew.ejs` is not present.
- `routes/admin.js` renders `quizPlayer`, but `views/quizPlayer.ejs` is not present.
- Naming remains inconsistent in active files such as `models/Transcript.js`, `quizEditor.js`, `slide-editor.js`, and `video-settings.js`.
