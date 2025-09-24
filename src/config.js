const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  dbType: process.env.DB_TYPE || 'mssql',

  mssql: {
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    server: process.env.MSSQL_SERVER,
    port: Number(process.env.MSSQL_PORT || 1433),
    database: process.env.MSSQL_DATABASE,
    options: { encrypt: false }
  },

  mysql: {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  },

  table: process.env.SOURCE_TABLE,
  pk: process.env.PRIMARY_KEY_COLUMN,
  apiUrl: process.env.DEST_API_URL,
  apiAuth: process.env.API_AUTHORIZATION_HEADER || null,
  pollInterval: Number(process.env.POLL_INTERVAL_MS || 5000),
  stateFile: process.env.STATE_FILE || './state.json',
  batchSize: Number(process.env.BATCH_SIZE || 200),
  maxRetries: Number(process.env.MAX_RETRIES || 5),
  logFile: process.env.LOG_FILE || './sync.log'
};
