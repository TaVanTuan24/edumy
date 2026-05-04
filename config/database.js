const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const mongoUri = String(process.env.MONGO_URI || '').trim();
  if (!mongoUri) {
    throw new Error('MONGO_URI is required. Please set it in .env or Render environment variables.');
  }

  try {
    const connection = await mongoose.connect(mongoUri);
    logger.info('[db] Connected to MongoDB');
    return connection;
  } catch (error) {
    logger.error({ err: error }, '[db] MongoDB connection failed');
    throw error;
  }
};

const closeDB = async () => {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.connection.close();
  logger.info('[db] MongoDB disconnected');
};

module.exports = { connectDB, closeDB };
