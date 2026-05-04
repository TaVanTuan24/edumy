# Migration Guide

Safe migration procedures for Edumy database changes.

> **⚠️ WARNING:** Never run `--apply` on production without a verified backup.
> Always run dry-run first. Always verify on staging before production.

---

## 1. Progress Merge (legacy Progress → UserCourseProgress)

### Background

The app has two progress models:
- `Progress` — legacy model storing `completedVideos` (URL strings)
- `UserCourseProgress` — modern model storing `completedLessons` (lesson IDs), quiz results, watch time, etc.

This migration ensures data from `Progress` exists in `UserCourseProgress`.

### Pre-migration checks

```bash
# Count legacy Progress records
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const Progress = mongoose.model('Progress', new mongoose.Schema({ user: Object, course: Object, completedVideos: [String] }), 'progresses');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const total = await Progress.countDocuments();
  const withVideos = await Progress.countDocuments({ completedVideos: { $not: { $size: 0 } } });
  console.log('Total Progress records:', total);
  console.log('With completedVideos:', withVideos);
  process.exit(0);
});
"

# Count UserCourseProgress records
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const UCP = mongoose.model('UCP', new mongoose.Schema({ user: Object, course: Object, completedLessons: [String] }), 'usercourseprogresses');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const total = await UCP.countDocuments();
  console.log('Total UserCourseProgress records:', total);
  process.exit(0);
});
"
```

### Dry-run

```bash
node scripts/migrate-progress-merge.js
```

Expected output:
```
[migrate-progress-merge] Mode: DRY-RUN
[migrate-progress-merge] Found X legacy Progress documents.
  [DRY-RUN] user=... course=... lessons=N
  ...
[migrate-progress-merge] Summary:
  Total legacy Progress documents: X
  Would create new UserCourseProgress: N (M lessons)
  Would update/merge existing: K (L lessons to add)
  Skipped (empty): ...
  Skipped (already up-to-date): ...
  Errors: 0
```

### Apply (only after backup)

```bash
# Backup first
mongodump --uri="$MONGO_URI" --out=./backup-$(date +%Y%m%d)

# Apply migration
node scripts/migrate-progress-merge.js --apply
```

### Post-migration verification

```bash
# Re-run dry-run — should show 0 creates, 0 merges, all skipped
node scripts/migrate-progress-merge.js
```

### Rollback

1. Restore from backup: `mongorestore --uri="$MONGO_URI" ./backup-YYYYMMDD`
2. Do NOT delete `Progress` model until at least one release cycle after migration

---

## 2. Enrollment Field Consolidation (enrolledCourseIds → enrolledCourses)

### Background

The User model has two enrollment fields:
- `enrolledCourses` — canonical field (Mixed array of objects)
- `enrolledCourseIds` — legacy field (ObjectId array, no write points)

This migration copies course IDs from `enrolledCourseIds` into `enrolledCourses`.

### Pre-migration checks

```bash
# Count users with legacy enrolledCourseIds
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const User = mongoose.model('User', new mongoose.Schema({ enrolledCourses: [mongoose.Schema.Types.Mixed], enrolledCourseIds: [mongoose.Schema.Types.ObjectId] }), 'users');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const withLegacy = await User.countDocuments({ enrolledCourseIds: { $exists: true, $not: { $size: 0 } } });
  const total = await User.countDocuments({});
  console.log('Total users:', total);
  console.log('Users with enrolledCourseIds:', withLegacy);
  process.exit(0);
});
"
```

### Dry-run

```bash
node scripts/migrate-enrollment-fields.js
```

Expected output:
```
[migrate-enrollment] Mode: DRY-RUN
[migrate-enrollment] Found X users with enrolledCourseIds.
  [DRY-RUN] user=... missing_courses=N legacy_total=M
  ...
[migrate-enrollment] Summary:
  Total users scanned: X
  Users with legacy enrolledCourseIds: X
  Users needing backfill: N
  Course entries to add: M
  Users updated: N
  Skipped (already up-to-date): ...
  Errors: 0
```

### Apply (only after backup)

```bash
# Backup first
mongodump --uri="$MONGO_URI" --out=./backup-$(date +%Y%m%d)

# Apply migration
node scripts/migrate-enrollment-fields.js --apply
```

### Post-migration verification

```bash
# Re-run dry-run — should show 0 backfills, all skipped
node scripts/migrate-enrollment-fields.js
```

### Rollback

1. Restore from backup: `mongorestore --uri="$MONGO_URI" ./backup-YYYYMMDD`
2. `enrolledCourseIds` field is NOT deleted by this migration, so no field rollback needed

---

## General Safety Rules

1. **Always backup before `--apply`**
2. **Always dry-run first** — review output before applying
3. **Run on staging before production** when possible
4. **Idempotent** — safe to run multiple times
5. **No deletions** — migration only adds data, never removes
6. **One release cycle** — keep legacy fields/models for at least one release after migration
7. **Verify counts** — compare pre/post migration counts