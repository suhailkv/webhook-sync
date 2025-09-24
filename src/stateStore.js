const fs = require('fs');
const cfg = require('./config');
const logger = require('./logger');

function loadState() {
  if (!fs.existsSync(cfg.stateFile)) {
    logger.info('No state file found, starting fresh');
    return { lastId: 0 };
  }
  try {
    const state = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf-8'));
    return state;
  } catch (err) {
    logger.error('Failed to read state file, resetting', { error: err.message });
    return { lastId: 0 };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(cfg.stateFile, JSON.stringify(state, null, 2));
    logger.debug('State saved', state);
  } catch (err) {
    logger.error('Failed to save state', { error: err.message });
  }
}

module.exports = { loadState, saveState };
