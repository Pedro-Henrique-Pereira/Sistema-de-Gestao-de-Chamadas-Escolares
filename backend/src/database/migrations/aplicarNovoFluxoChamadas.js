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
    const arquivo = path.join(__dirname, "2026-07-16_novo_fluxo_chamadas.sql");
    const sql = fs.readFileSync(arquivo, "utf8").replace(/^USE\s+[^;]+;\s*/i, "");
    const [[alvo]] = await connection.query("SELECT DATABASE() AS banco, @@hostname AS servidor");

    if (alvo.banco !== database) {
      throw new Error("O banco conectado não corresponde ao DB_NAME configurado.");
    }

    await connection.query(sql);

    const [colunas] = await connection.query(`
      SELECT TABLE_NAME, COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (
          (TABLE_NAME = 'chamadas_diarias' AND COLUMN_NAME IN ('versao', 'confirmada_por_id'))
          OR (TABLE_NAME = 'registros_frequencia_alunos' AND COLUMN_NAME = 'atraso_minutos')
        )
      ORDER BY TABLE_NAME, COLUMN_NAME
    `);

    console.log(JSON.stringify({ banco: alvo.banco, servidor: alvo.servidor, colunasVerificadas: colunas }));
  } finally {
    await connection.end();
  }
}

aplicar().catch((error) => {
  console.error(`Falha ao aplicar migração: ${error.message}`);
  process.exitCode = 1;
});
