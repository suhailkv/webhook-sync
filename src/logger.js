const fs = require('fs');
const path = require('path');
const cfg = require('./config');

function rotateIfNeeded() {
  const file = path.resolve(cfg.logFile);
  if (!fs.existsSync(file)) return;

  const stats = fs.statSync(file);
  const maxSize = 10 * 1024 * 1024; // 10 MB
  if (stats.size >= maxSize) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const newFile = file.replace(/\.log$/, `-${ts}.log`);
    fs.renameSync(file, newFile);
  }
}

function log(level, message, meta = {}) {
  rotateIfNeeded();
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  const line = JSON.stringify(entry);
  fs.appendFileSync(cfg.logFile, line + '\n');
  console.log(`[${level.toUpperCase()}] ${message}`, Object.keys(meta).length ? meta : '');
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta)
};
