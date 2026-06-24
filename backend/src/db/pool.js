const { Pool } = require("pg");
const env = require("../config/env");

const sslConfig = env.database.ssl
  ? {
      rejectUnauthorized: env.database.sslRejectUnauthorized,
    }
  : false;

const pool = new Pool({
  host: env.database.host,
  port: env.database.port,
  database: env.database.database,
  user: env.database.user,
  password: env.database.password,
  ssl: sslConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

async function checkDatabaseConnection() {
  const result = await pool.query(
    "SELECT NOW() AS database_time, current_database() AS database_name"
  );

  return result.rows[0];
}

module.exports = {
  pool,
  checkDatabaseConnection,
};