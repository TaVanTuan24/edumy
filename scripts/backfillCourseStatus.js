if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { connectDB, closeDB } = require('../config/database');
const Course = require('../models/course');

async function main() {
  await connectDB();

  const result = await Course.updateMany(
    { status: { $exists: false } },
    {
      $set: {
        status: 'published',
        lastEditedAt: new Date()
      }
    }
  );

  console.log(`Backfilled ${result.modifiedCount || 0} courses with published status.`);
}

main()
  .catch((error) => {
    console.error('Failed to backfill course status:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDB();
  });
