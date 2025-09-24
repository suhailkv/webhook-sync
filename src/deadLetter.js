const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const dlqFile = path.resolve('./failed.jsonl');

function addFailedBatch(rows, reason) {
  const entry = {
    failedAt: new Date().toISOString(),
    reason,
    rows
  };
  fs.appendFileSync(dlqFile, JSON.stringify(entry) + '\n');
  logger.error('Added batch to dead-letter queue', { reason, rows: rows.length });
}

function loadFailedBatches() {
  if (!fs.existsSync(dlqFile)) return [];
  const lines = fs.readFileSync(dlqFile, 'utf-8').split('\n').filter(Boolean);
  return lines.map(l => JSON.parse(l));
}

function clearDLQ() {
  if (fs.existsSync(dlqFile)) fs.writeFileSync(dlqFile, '');
}

module.exports = { addFailedBatch, loadFailedBatches, clearDLQ };
