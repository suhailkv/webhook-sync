const cfg = require('./config');
const logger = require('./logger');

let mysql, sql;
let pool;

async function connect() {
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

async function fetchNewRows(lastId, limit) {
  await connect();

  if (cfg.dbType === 'mysql') {
    const [rows] = await pool.query(
      `SELECT * FROM \`${cfg.table}\` WHERE \`${cfg.pk}\` > ? ORDER BY \`${cfg.pk}\` ASC LIMIT ?`,
      [lastId, limit]
    );
    return rows;
  } else {
    const query = `
      SELECT TOP (${limit}) *
      FROM [${cfg.table}]
      WHERE [${cfg.pk}] > @lastId
      ORDER BY [${cfg.pk}] ASC
    `;
    const result = await pool.request()
      .input('lastId', sql.BigInt, lastId)
      .query(query);
    return result.recordset;
  }
}

async function getMaxId() {
  await connect();
  if (cfg.dbType === 'mysql') {
    const [rows] = await pool.query(`SELECT MAX(\`${cfg.pk}\`) as maxId FROM \`${cfg.table}\``);
    return rows[0].maxId || 0;
  } else {
    const result = await pool.request().query(`SELECT MAX([${cfg.pk}]) as maxId FROM [${cfg.table}]`);
    return result.recordset[0].maxId || 0;
  }
}

module.exports = { fetchNewRows, getMaxId };
