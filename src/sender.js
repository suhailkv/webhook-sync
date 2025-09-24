const axios = require('axios');
const cfg = require('./config');
const logger = require('./logger');
const { addFailedBatch } = require('./deadLetter');

async function sendChunk(rows) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiAuth) headers['Authorization'] = cfg.apiAuth;

  try {
    const res = await axios.post(cfg.apiUrl, rows, { headers, timeout: 20000 });
    if (res.status >= 200 && res.status < 300) {
      logger.info(`Sent ${rows.length} rows`);
      return true;
    }
    throw new Error(`API returned ${res.status}`);
  } catch (err) {
    addFailedBatch(rows, err.message);
    return false;
  }
}

async function sendWithConcurrency(rows) {
  if (!rows.length) return true;

  const chunkSize = 50;
  const chunks = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }

  const results = await Promise.allSettled(chunks.map(sendChunk));
  const allSuccess = results.every(r => r.status === 'fulfilled' && r.value);
  return allSuccess;
}

module.exports = { sendWithConcurrency };
