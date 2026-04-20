const mongoose = require('mongoose');
const User = require('../models/user');
require('dotenv').config();

async function runMigration() {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URL || 'mongodb://localhost:27017/edumy');
    console.log("Connected.");
    
    // Find all users missing the createdAt field or that have it empty
    const users = await User.find({ createdAt: { $exists: false } });
    console.log(`Found ${users.length} users missing createdAt timestamp.`);

    let updatedCount = 0;
    for (const user of users) {
        try {
            const creationDate = user._id.getTimestamp();
            user.createdAt = creationDate;
            user.updatedAt = creationDate; // set updatedAt to the same initial value
            await user.save({ timestamps: false, validateBeforeSave: false }); // bypass validation to just force the fields
            updatedCount++;
        } catch (err) {
            console.error(`Failed to migrate user ${user._id}:`, err.message);
        }
    }

    console.log(`Migration completed! Successfully updated ${updatedCount} users.`);
    process.exit();
}

runMigration();
