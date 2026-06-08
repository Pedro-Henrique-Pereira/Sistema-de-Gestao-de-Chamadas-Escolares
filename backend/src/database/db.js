const mysql = require("mysql2/promise");

const DB_TIMEZONE = process.env.DB_TIMEZONE || "-03:00";

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
  timezone: DB_TIMEZONE,
});

pool.on("connection", (connection) => {
  connection.query(`SET time_zone = '${DB_TIMEZONE}'`, (error) => {
    if (error) console.error("Falha ao configurar fuso horário da conexão MySQL:", error.message);
  });
});

module.exports = pool;
