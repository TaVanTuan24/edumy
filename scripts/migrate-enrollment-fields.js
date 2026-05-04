#!/usr/bin/env node
/**
 * Migration Script: Consolidate enrolledCourseIds into enrolledCourses
 *
 * The User model has two fields tracking enrollment:
 * - enrolledCourses: canonical field (Mixed array of objects or legacy IDs)
 * - enrolledCourseIds: legacy field (ObjectId array, no write points)
 *
 * This script reads enrolledCourseIds and ensures each course ID exists in
 * enrolledCourses with the standard object format.
 *
 * Usage:
 *   node scripts/migrate-enrollment-fields.js              # dry-run (default)
 *   node scripts/migrate-enrollment-fields.js --apply       # apply changes
 *
 * Idempotent: Running multiple times produces the same result.
 * Safe: Only adds to enrolledCourses, never deletes enrolledCourseIds.
 */

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGO_URI || '';

if (!MONGO_URI) {
  console.error('MONGO_URI is required.');
  process.exit(1);
}

const args = process.argv.slice(2);
const isDryRun = !args.includes('--apply');

// Minimal User schema to avoid importing the full model with side-effects
const userSchema = new mongoose.Schema({
  email: String,
  username: String,
  enrolledCourses: { type: [mongoose.Schema.Types.Mixed], default: [] },
  enrolledCourseIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Course', default: [] }
}, { timestamps: true });

const User = mongoose.model('User', userSchema, 'users');

function extractCourseIdsFromEnrolledCourses(enrolledCourses) {
  const ids = new Set();
  if (!Array.isArray(enrolledCourses)) return ids;

  for (const entry of enrolledCourses) {
    if (!entry) continue;
    if (entry.courseId) {
      ids.add(String(entry.courseId));
    } else if (typeof entry === 'string') {
      ids.add(entry);
    } else if (entry._bsontype === 'ObjectId' || entry instanceof mongoose.Types.ObjectId) {
      ids.add(String(entry));
    }
  }

  return ids;
}

async function run() {
  console.log(`[migrate-enrollment] Mode: ${isDryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`[migrate-enrollment] Connecting to MongoDB...`);

  await mongoose.connect(MONGO_URI);
  console.log('[migrate-enrollment] Connected.\n');

  const users = await User.find({
    enrolledCourseIds: { $exists: true, $not: { $size: 0 } }
  }).lean();

  console.log(`[migrate-enrollment] Found ${users.length} users with enrolledCourseIds.`);

  let needsBackfill = 0;
  let alreadyUpToDate = 0;
  let courseEntriesToAdd = 0;
  let usersUpdated = 0;
  let errors = 0;

  for (const user of users) {
    const userId = String(user._id);
    const legacyIds = Array.isArray(user.enrolledCourseIds) ? user.enrolledCourseIds.map(String) : [];
    const existingIds = extractCourseIdsFromEnrolledCourses(user.enrolledCourses);

    const missingIds = legacyIds.filter((id) => !existingIds.has(id));

    if (missingIds.length === 0) {
      alreadyUpToDate += 1;
      continue;
    }

    needsBackfill += 1;
    courseEntriesToAdd += missingIds.length;

    const newEntries = missingIds.map((courseId) => ({
      courseId: new mongoose.Types.ObjectId(courseId),
      progress: { completedCount: 0, lastLessonId: '' },
      lastSeenUpdatedAt: null,
      enrolledAt: user.createdAt || new Date()
    }));

    console.log(`  [${isDryRun ? 'DRY-RUN' : 'UPDATE'}] user=${userId} missing_courses=${missingIds.length} legacy_total=${legacyIds.length}`);

    if (!isDryRun) {
      try {
        await User.updateOne(
          { _id: user._id },
          { $push: { enrolledCourses: { $each: newEntries } } }
        );
        usersUpdated += 1;
      } catch (err) {
        console.error(`  [ERROR] user=${userId}: ${err.message}`);
        errors += 1;
      }
    } else {
      usersUpdated += 1;
    }
  }

  console.log(`\n[migrate-enrollment] Summary:`);
  console.log(`  Total users scanned: ${users.length}`);
  console.log(`  Users with legacy enrolledCourseIds: ${users.length}`);
  console.log(`  Users needing backfill: ${needsBackfill}`);
  console.log(`  Course entries to add: ${courseEntriesToAdd}`);
  console.log(`  Users updated: ${usersUpdated}`);
  console.log(`  Skipped (already up-to-date): ${alreadyUpToDate}`);
  console.log(`  Errors: ${errors}`);

  if (isDryRun) {
    console.log(`\n  This was a DRY-RUN. Run with --apply to write changes.`);
  }

  await mongoose.disconnect();
  console.log('[migrate-enrollment] Done.');
}

run().catch((err) => {
  console.error('[migrate-enrollment] Fatal error:', err);
  process.exit(1);
});