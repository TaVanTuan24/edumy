#!/usr/bin/env node
/**
 * Migration Script: Merge legacy Progress into UserCourseProgress
 *
 * This script reads from the legacy Progress model (completedVideos) and
 * ensures equivalent data exists in UserCourseProgress. It does NOT delete
 * the legacy Progress model or its data.
 *
 * Usage:
 *   node scripts/migrate-progress-merge.js              # dry-run (default)
 *   node scripts/migrate-progress-merge.js --apply       # apply changes
 *
 * Idempotent: Running multiple times produces the same result.
 * Safe: Only adds data to UserCourseProgress, never deletes from Progress.
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

// Schemas (inline to avoid import issues with model side-effects)
const progressSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  completedVideos: [String]
});

const userCourseSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  completedLessons: { type: [String], default: [] },
  watchTime: { type: Number, default: 0 },
  completionRate: { type: Number, default: 0 }
}, { timestamps: true });

const Progress = mongoose.model('Progress', progressSchema, 'progresses');
const UserCourseProgress = mongoose.model('UserCourseProgress', userCourseSchema, 'usercourseprogresses');

async function run() {
  console.log(`[migrate-progress-merge] Mode: ${isDryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`[migrate-progress-merge] Connecting to MongoDB...`);

  await mongoose.connect(MONGO_URI);
  console.log('[migrate-progress-merge] Connected.\n');

  const legacyDocs = await Progress.find({}).lean();
  console.log(`[migrate-progress-merge] Found ${legacyDocs.length} legacy Progress documents.`);

  let wouldCreate = 0;
  let wouldUpdate = 0;
  let skippedEmpty = 0;
  let skippedUpToDate = 0;
  let lessonsToCreate = 0;
  let lessonsToMerge = 0;
  let errors = 0;

  for (const doc of legacyDocs) {
    const userId = String(doc.user);
    const courseId = String(doc.course);
    const completedVideos = Array.isArray(doc.completedVideos) ? doc.completedVideos : [];

    if (!completedVideos.length) {
      skippedEmpty += 1;
      continue;
    }

    const existing = await UserCourseProgress.findOne({ user: doc.user, course: doc.course }).lean();

    if (!existing) {
      // No existing UserCourseProgress — would create new document
      wouldCreate += 1;
      lessonsToCreate += completedVideos.length;
      console.log(`  [${isDryRun ? 'DRY-RUN' : 'CREATE'}] user=${userId} course=${courseId} lessons=${completedVideos.length}`);

      if (!isDryRun) {
        try {
          await UserCourseProgress.create({
            user: doc.user,
            course: doc.course,
            completedLessons: completedVideos,
            watchTime: 0,
            completionRate: 0
          });
        } catch (err) {
          console.error(`  [ERROR] user=${userId} course=${courseId}: ${err.message}`);
          errors += 1;
        }
      }
    } else {
      // UserCourseProgress exists — check if any lessons are missing
      const existingLessons = new Set(
        Array.isArray(existing.completedLessons) ? existing.completedLessons.map(String) : []
      );
      const missingLessons = completedVideos.filter((v) => !existingLessons.has(String(v)));

      if (missingLessons.length === 0) {
        skippedUpToDate += 1;
        continue;
      }

      // Would merge missing lessons into existing document
      wouldUpdate += 1;
      lessonsToMerge += missingLessons.length;
      console.log(`  [${isDryRun ? 'DRY-RUN' : 'MERGE'}] user=${userId} course=${courseId} missing_lessons=${missingLessons.length} total_legacy=${completedVideos.length} total_existing=${existingLessons.size}`);

      if (!isDryRun) {
        try {
          await UserCourseProgress.updateOne(
            { _id: existing._id },
            { $addToSet: { completedLessons: { $each: missingLessons } } }
          );
        } catch (err) {
          console.error(`  [ERROR] merge user=${userId} course=${courseId}: ${err.message}`);
          errors += 1;
        }
      }
    }
  }

  console.log(`\n[migrate-progress-merge] Summary:`);
  console.log(`  Total legacy Progress documents: ${legacyDocs.length}`);
  console.log(`  Would create new UserCourseProgress: ${wouldCreate} (${lessonsToCreate} lessons)`);
  console.log(`  Would update/merge existing: ${wouldUpdate} (${lessonsToMerge} lessons to add)`);
  console.log(`  Skipped (empty): ${skippedEmpty}`);
  console.log(`  Skipped (already up-to-date): ${skippedUpToDate}`);
  console.log(`  Errors: ${errors}`);

  if (isDryRun) {
    console.log(`\n  This was a DRY-RUN. Run with --apply to write changes.`);
  }

  await mongoose.disconnect();
  console.log('[migrate-progress-merge] Done.');
}

run().catch((err) => {
  console.error('[migrate-progress-merge] Fatal error:', err);
  process.exit(1);
});