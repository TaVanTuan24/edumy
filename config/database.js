const mongoose = require('mongoose');
const logger = require('../utils/logger');

function getNumericEnv(name, fallback) {
  const parsed = Number(String(process.env[name] || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildConnectionOptions() {
  // autoIndex defaults to enabled to preserve current behavior (schemas rely on it to create
  // indexes, including unique constraints). Set MONGO_AUTO_INDEX=false in production only if
  // indexes are provisioned out-of-band.
  const autoIndex = String(process.env.MONGO_AUTO_INDEX || '').trim().toLowerCase() !== 'false';

  return {
    maxPoolSize: getNumericEnv('MONGO_MAX_POOL_SIZE', 10),
    minPoolSize: getNumericEnv('MONGO_MIN_POOL_SIZE', 0),
    serverSelectionTimeoutMS: getNumericEnv('MONGO_SERVER_SELECTION_TIMEOUT_MS', 10000),
    socketTimeoutMS: getNumericEnv('MONGO_SOCKET_TIMEOUT_MS', 45000),
    autoIndex
  };
}

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const mongoUri = String(process.env.MONGO_URI || '').trim();
  if (!mongoUri) {
    throw new Error('MONGO_URI is required. Please set it in .env or Render environment variables.');
  }

  try {
    const connection = await mongoose.connect(mongoUri, buildConnectionOptions());
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
