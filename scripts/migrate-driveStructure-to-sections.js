if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const Course = require('../models/course');
const {
  convertDriveStructureToSections,
  normalizeCourseContent
} = require('../utils/courseContentAdapter');

const MONGO_URL = process.env.MONGODB_URL || process.env.DB_URL || 'mongodb://localhost:27017/edumy';
const APPLY = process.argv.includes('--apply');
const REMOVE_LEGACY = process.argv.includes('--remove-legacy');
const VERBOSE = process.argv.includes('--verbose');

function hasStructuredSections(course) {
  return Array.isArray(course && course.sections) && course.sections.length > 0;
}

function hasLegacyDriveStructure(course) {
  return Array.isArray(course && course.driveStructure) && course.driveStructure.length > 0;
}

async function run() {
  await mongoose.connect(MONGO_URL);
  console.log(`[migration:sections] connected: ${MONGO_URL}`);
  console.log(`[migration:sections] mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[migration:sections] remove legacy: ${REMOVE_LEGACY ? 'yes' : 'no'}`);

  const courses = await Course.find({});

  let scanned = 0;
  let skipped = 0;
  let migrated = 0;
  let alreadyCanonical = 0;
  let failed = 0;

  for (const course of courses) {
    scanned += 1;

    try {
      const hasSections = hasStructuredSections(course);
      const hasDriveStructure = hasLegacyDriveStructure(course);

      if (!hasDriveStructure && !hasSections) {
        skipped += 1;
        if (VERBOSE) {
          console.log(`[migration:sections] skip empty: ${course._id} ${course.title}`);
        }
        continue;
      }

      if (hasSections && !hasDriveStructure) {
        alreadyCanonical += 1;
        if (VERBOSE) {
          console.log(`[migration:sections] already canonical: ${course._id} ${course.title}`);
        }
        continue;
      }

      const beforeSectionsCount = Array.isArray(course.sections) ? course.sections.length : 0;
      const convertedSections = hasSections
        ? normalizeCourseContent(course).sections
        : convertDriveStructureToSections(course.driveStructure);

      if (!convertedSections.length && hasDriveStructure) {
        skipped += 1;
        console.log(`[migration:sections] skip malformed legacy content: ${course._id} ${course.title}`);
        continue;
      }

      if (VERBOSE) {
        console.log(
          `[migration:sections] ${hasSections ? 'refresh canonical' : 'migrate'} ${course._id} ${course.title} `
          + `(sections ${beforeSectionsCount} -> ${convertedSections.length})`
        );
      }

      if (APPLY) {
        course.sections = convertedSections;
        if (REMOVE_LEGACY) {
          course.driveStructure = [];
        }
        await course.save();
      }

      migrated += 1;
    } catch (error) {
      failed += 1;
      console.error(`[migration:sections] failed ${course._id} ${course.title}: ${error.message}`);
    }
  }

  console.log(`[migration:sections] scanned: ${scanned}`);
  console.log(`[migration:sections] migrated: ${migrated}`);
  console.log(`[migration:sections] already canonical: ${alreadyCanonical}`);
  console.log(`[migration:sections] skipped: ${skipped}`);
  console.log(`[migration:sections] failed: ${failed}`);

  await mongoose.disconnect();
  console.log('[migration:sections] completed');
}

run().catch(async (error) => {
  console.error('[migration:sections] fatal:', error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect error
  }
  process.exit(1);
});
