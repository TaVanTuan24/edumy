const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const connStr = process.env.MONGODB_URL || 'mongodb://localhost:27017/edumy';
    await mongoose.connect(connStr, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('DB connection error:', err);
    process.exit(1);
  }
};

const closeDB = async () => {
  await mongoose.connection.close();
  console.log('MongoDB disconnected');
};

module.exports = { connectDB, closeDB };