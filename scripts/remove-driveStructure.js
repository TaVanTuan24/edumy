if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const Course = require('../models/course');

const MONGO_URI = String(process.env.MONGO_URI || '').trim();
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

async function run() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  await mongoose.connect(MONGO_URI);
  console.log('[cleanup:driveStructure] connected');
  console.log(`[cleanup:driveStructure] mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const filter = { driveStructure: { $exists: true } };
  const affectedCourses = await Course.find(filter).select('_id title').lean();

  console.log(`[cleanup:driveStructure] courses with legacy field: ${affectedCourses.length}`);

  if (VERBOSE) {
    affectedCourses.forEach((course) => {
      console.log(`[cleanup:driveStructure] ${course._id} ${course.title || ''}`.trim());
    });
  }

  if (APPLY && affectedCourses.length > 0) {
    const result = await Course.updateMany(filter, {
      $unset: { driveStructure: '' }
    });

    console.log(`[cleanup:driveStructure] modified: ${result.modifiedCount || 0}`);
  }

  if (!APPLY) {
    console.log('[cleanup:driveStructure] dry-run complete; rerun with --apply to unset the field');
  } else {
    console.log('[cleanup:driveStructure] apply complete');
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('[cleanup:driveStructure] failed:', error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect error
  }
  process.exit(1);
});
