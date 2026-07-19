const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.resolve(__dirname, "../../../config.env") });

async function aplicar() {
  const database = process.env.DB_NAME || "Sistema_Chamada";
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database,
    multipleStatements: true,
  });

  try {
    const arquivo = path.join(__dirname, "2026-07-19_logs_auditoria.sql");
    const sql = fs.readFileSync(arquivo, "utf8").replace(/^USE\s+[^;]+;\s*/i, "");
    const [[alvo]] = await connection.query("SELECT DATABASE() AS banco, @@hostname AS servidor");
    if (alvo.banco !== database) throw new Error("O banco conectado não corresponde ao DB_NAME configurado.");

    await connection.query(sql);
    const [[verificacao]] = await connection.query(`
      SELECT
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs_auditoria') AS tabelaLogs,
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auditoria_limpeza_estado') AS tabelaEstado,
        (SELECT COUNT(*) FROM auditoria_limpeza_estado WHERE id = 1) AS estadoInicial
    `);
    if (!verificacao.tabelaLogs || !verificacao.tabelaEstado || !verificacao.estadoInicial) {
      throw new Error("A estrutura de auditoria não foi criada por completo.");
    }
    console.log(JSON.stringify({ banco: alvo.banco, servidor: alvo.servidor, verificacao }));
  } finally {
    await connection.end();
  }
}

aplicar().catch((error) => {
  console.error(`Falha ao aplicar migração: ${error.message}`);
  process.exitCode = 1;
});
