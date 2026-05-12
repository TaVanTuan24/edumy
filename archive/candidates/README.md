# Cleanup Candidates

These files were reviewed during structural cleanup and appear to be unused by current server-side imports and EJS asset references.

They were intentionally left in place because runtime safety was not proven strongly enough for an automatic move.

## Candidate files (all removed)

- `public/javascripts/learning.js` — removed (not referenced in any EJS view)
- `public/javascripts/show.js` — removed (replaced by `public/javascripts/show/` directory)
- `public/javascripts/courseEditor.js` — removed (not referenced in any EJS view)
- `1778467863359-player-script.js` — removed (orphaned YouTube player cache file)
- `1778467863367-player-script.js` — removed (orphaned YouTube player cache file)
- `services/ai/providerRegistry.js` — removed (not required by any file)
- `services/ai/modelCatalog.js` — removed (not required by any file)
- `services/ai/grokSetupService.js` — removed (not required by any file)
- `public/stylesheets/apple.css` — removed (not referenced in any EJS view)

## Pre-existing structural debt noted during cleanup

- `routes/admin.js` renders `admin/courseEditorNew`, but `views/admin/courseEditorNew.ejs` is not present.
- `routes/admin.js` renders `quizPlayer`, but `views/quizPlayer.ejs` is not present.
- Naming remains inconsistent in active files such as `models/Transcript.js`, `quizEditor.js`, `slide-editor.js`, and `video-settings.js`.
