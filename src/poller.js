const { fetchNewRows, getMaxId } = require('./db');
const { sendWithConcurrency } = require('./sender');
const { loadState, saveState } = require('./stateStore');
const { loadFailedBatches, clearDLQ } = require('./deadLetter');
const cfg = require('./config');
const logger = require('./logger');

async function processFailedBatches() {
  const batches = loadFailedBatches();
  if (!batches.length) return;
  logger.warn(`Retrying ${batches.length} failed batches`);
  const results = await Promise.allSettled(
    batches.map(b => sendWithConcurrency(b.rows))
  );
  const allOk = results.every(r => r.status === 'fulfilled' && r.value);
  if (allOk) {
    clearDLQ();
    logger.info('All failed batches resent successfully');
  }
}

async function pollOnce() {
  await processFailedBatches();

  const state = loadState();
  const lastId = state.lastId || 0;

  const maxId = await getMaxId();
  if (maxId <= lastId) {
    logger.debug('No new rows since last sync');
    return;
  }

  const rows = await fetchNewRows(lastId, cfg.batchSize);
  logger.info(`Fetched ${rows.length} new rows`);

  const success = await sendWithConcurrency(rows);
  if (success) {
    const newLastId = rows[rows.length - 1][cfg.pk];
    saveState({ lastId: newLastId });
    logger.info(`Updated lastId to ${newLastId}`);
  } else {
    logger.error('Some rows failed, added to DLQ');
  }
}

async function start() {
  logger.info('Poller started');
  while (true) {
    try {
      await pollOnce();
    } catch (err) {
      logger.error('Poll failed', { error: err.message });
    }
    await new Promise(r => setTimeout(r, cfg.pollInterval));
  }
}

module.exports = { start };
