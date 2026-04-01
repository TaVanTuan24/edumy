const axios = require('axios');

const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

const ollama = axios.create({
  baseURL: ollamaUrl,
  timeout: 120000
});

module.exports = ollama;