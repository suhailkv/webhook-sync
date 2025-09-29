require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mssql = require('mssql');
const pLimit = require('p-limit');
const { createLogger, format, transports } = require('winston');

/* ---------------- CONFIG ---------------- */
const cfg = {
    mssql: {
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    server: process.env.MSSQL_SERVER,
    port: Number(process.env.MSSQL_PORT || 1433),
    database: process.env.MSSQL_DATABASE,
    options: { encrypt: false }
  },
  db: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE,
    port : parseInt(process.env.DB_PORT || '1433', 10),
    options: { trustServerCertificate: process.env.DB_TRUSTSERVERCERTIFICATE === 'true' },
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      min: parseInt(process.env.DB_POOL_MIN || '0', 10),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10)
    }
  },
  essl: {
    table: process.env.SOURCE_TABLE || 'ESSL_BiometricLogs',
    idColumn: process.env.PRIMARY_KEY_COLUMN || 'id'
  },
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),
  pageSize: parseInt(process.env.PAGE_SIZE || '200', 10),
  batchSize: parseInt(process.env.BATCH_SIZE || '50', 10),
  concurrency: parseInt(process.env.CONCURRENCY || '4', 10),
  api: {
    url: process.env.API_URL,
    authToken: process.env.API_AUTH_TOKEN,
    timeoutMs: parseInt(process.env.API_TIMEOUT_MS || '15000', 10)
  },
  maxRetries: parseInt(process.env.MAX_RETRIES || '8', 10),
  initialBackoffMs: parseInt(process.env.INITIAL_BACKOFF_MS || '1000', 10),
  stateFile: process.env.STATE_FILE || path.resolve(__dirname, 'state.json'),
  deadLetterFile: process.env.DEAD_LETTERS_FILE || path.resolve(__dirname, 'dead_letters.log'),
  logFile: process.env.LOG_FILE || path.resolve(__dirname, 'worker.log'),
  logLevel: process.env.LOG_LEVEL || 'info'
};

/* ---------------- LOGGER ---------------- */
const logger = createLogger({
  level: cfg.logLevel,
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, ...rest }) =>
      `${timestamp} ${level.toUpperCase()} ${message} ${Object.keys(rest).length ? JSON.stringify(rest) : ''}`)
  ),
  transports: [
    new transports.File({ filename: cfg.logFile, maxsize: 10 * 1024 * 1024 }),
    new transports.Console()
  ]
});

/* ---------------- STATE ---------------- */
function loadState() {
  try {
    if (fs.existsSync(cfg.stateFile)) {
      const raw = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'));
      return { lastProcessedId: BigInt(raw.lastProcessedId || 0) };
    }
  } catch (err) {
    logger.error('Failed to load state', { message: err.message });
  }
  return { lastProcessedId: BigInt(0) };
}

function saveState(state) {
  try {
    fs.writeFileSync(cfg.stateFile, JSON.stringify({ lastProcessedId: state.lastProcessedId.toString() }));
  } catch (err) {
    logger.error('Failed to save state', { message: err.message });
  }
}

let state = loadState();

/* ---------------- DEAD LETTERS ---------------- */
function writeDeadLetter(payload, error) {
  const entry = {
    timestamp: new Date().toISOString(),
    payload,
    error: error?.message || JSON.stringify(error)
  };
  fs.appendFileSync(cfg.deadLetterFile, JSON.stringify(entry) + '\n');
  logger.error('Moved to dead_letters', { id: payload[cfg.essl.idColumn] });
}

/* ---------------- DB ---------------- */
let pool;
// async function connectDb() {
//   if (pool && pool.connected) return pool;
//   try {
//     pool = new mssql.ConnectionPool(cfg.db);
//     await pool.connect();
//     logger.info('Connected to MSSQL');
//     pool.on('error', async err => {
//       logger.error('DB error', { message: err.message });
//       pool = null;
//     });
//     return pool;
//   } catch (err) {
//     logger.error('DB connect failed', { message: err.message });
//     pool = null;
//     throw err;
//   }
// }
async function connectDb() {
  if (pool) return pool;

  if (cfg.dbType === 'mysql') {
    mysql = require('mysql2/promise');
    logger.info('Connecting to MySQL...');
    pool = await mysql.createPool(cfg.mysql);
    logger.info('Connected to MySQL');
    return pool;
  } else {
    sql = require('mssql');
    logger.info('Connecting to MSSQL...');
    pool = await sql.connect(cfg.mssql);
    logger.info('Connected to MSSQL');
    return pool;
  }
}
async function fetchNewRows(sinceId, limit) {
  const db = await connectDb();
  const sql = `
    SELECT TOP (${limit}) *
    FROM ${cfg.essl.table}
    WHERE ${cfg.essl.idColumn} > @sinceId
    ORDER BY ${cfg.essl.idColumn} ASC
  `;
  const request = db.request();
  request.input('sinceId', mssql.BigInt, sinceId.toString());
  const result = await request.query(sql);
  return result.recordset || [];
}

/* ---------------- API ---------------- */
async function sendBatch(payloads) {
  const headers = {};
  if (cfg.api.authToken) headers['Authorization'] = `Bearer ${cfg.api.authToken}`;
  try {
    const res = await axios.post(cfg.api.url, payloads, {
      timeout: cfg.api.timeoutMs,
      headers
    });
    logger.info('API response', JSON.stringify({ status: res.status, payloads: payloads }));
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/* ---------------- RETRY QUEUE ---------------- */
const retryQueue = [];
function scheduleRetry(item) {
  if (item.retries >= cfg.maxRetries) {
    writeDeadLetter(item.payload, item.error);
    return;
  }
  const backoff = cfg.initialBackoffMs * Math.pow(2, item.retries);
  const jitter = Math.random() * backoff * 0.2;
  item.retries++;
  item.nextAttemptAt = Date.now() + backoff + jitter;
  retryQueue.push(item);
  logger.warn('Scheduled retry', { id: item.payload[cfg.essl.idColumn], retries: item.retries });
}

function getDueRetries() {
  const now = Date.now();
  const due = [];
  for (let i = retryQueue.length - 1; i >= 0; i--) {
    if (retryQueue[i].nextAttemptAt <= now) {
      due.push(retryQueue.splice(i, 1)[0]);
    }
  }
  return due;
}

/* ---------------- PROCESS LOOP ---------------- */
const limit = pLimit(cfg.concurrency);

async function processBatch(batch) {
  const res = await sendBatch(batch);
  if (res.ok) {
    const maxId = batch.reduce((m, p) => {
      const v = BigInt(p[cfg.essl.idColumn]);
      return v > m ? v : m;
    }, state.lastProcessedId);
    state.lastProcessedId = maxId;
    saveState(state);
    logger.info('Batch delivered', { count: batch.length, highestId: maxId.toString() });
  } else {
    batch.forEach(payload => scheduleRetry({ payload, retries: 0, error: res.error }));
  }
}

async function processQueue() {
  const due = getDueRetries();
  if (due.length) {
    const chunks = chunk(due.map(i => i.payload), cfg.batchSize);
    await Promise.all(chunks.map(c => limit(() => processBatch(c))));
  }
}

async function pollDb() {
  try {
    const rows = await fetchNewRows(state.lastProcessedId, cfg.pageSize);
    if (rows.length) {
      const chunks = chunk(rows, cfg.batchSize);
    //   await Promise.all(chunks.map(c => limit(() => processBatch(c))));
      await Promise.all(chunks.map(c => processBatch(c)));

    }
  } catch (err) {
    logger.error('Polling failed', { message: err.message });
  }
}

function chunk(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

/* ---------------- MAIN ---------------- */
async function mainLoop() {
  logger.info('Worker started', { lastProcessedId: state.lastProcessedId.toString() });
  while (true) {
    await processQueue();
    await pollDb();
    await sleep(cfg.pollIntervalMs);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException', err => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', err => {
  logger.error('Unhandled rejection', { message: err.message });
  process.exit(1);
});

mainLoop();
