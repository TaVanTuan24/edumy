const mongoose = require('mongoose');

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const connStr = process.env.MONGODB_URL || 'mongodb://localhost:27017/edumy';
  const connection = await mongoose.connect(connStr);
  console.log('MongoDB connected');
  return connection;
};

const closeDB = async () => {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.connection.close();
  console.log('MongoDB disconnected');
};

module.exports = { connectDB, closeDB };
