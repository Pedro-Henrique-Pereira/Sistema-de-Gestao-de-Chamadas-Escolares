const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "Sistema_Chamada",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 15),
  queueLimit: Number(process.env.DB_QUEUE_LIMIT || 0),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  decimalNumbers: true,
});

module.exports = pool;
