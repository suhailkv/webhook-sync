const { start } = require('./poller');
const logger = require('./logger');

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down');
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down');
  process.exit(0);
});

start().catch(err => {
  logger.error('Fatal error', { error: err.message });
  process.exit(1);
});
