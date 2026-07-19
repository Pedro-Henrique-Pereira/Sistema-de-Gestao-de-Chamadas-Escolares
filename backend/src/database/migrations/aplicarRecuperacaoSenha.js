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
    const arquivo = path.join(__dirname, "2026-07-18_recuperacao_senha.sql");
    const sql = fs.readFileSync(arquivo, "utf8");
    const [[alvo]] = await connection.query(
      "SELECT DATABASE() AS banco, @@hostname AS servidor"
    );

    if (alvo.banco !== database) {
      throw new Error("O banco conectado não corresponde ao DB_NAME configurado.");
    }

    await connection.query(sql);

    const [[tabela]] = await connection.query(
      `SELECT COUNT(*) AS existe
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'recuperacoes_senha'`
    );

    if (Number(tabela.existe) !== 1) {
      throw new Error("A tabela de recuperação de senha não foi criada.");
    }

    console.log(JSON.stringify({
      banco: alvo.banco,
      servidor: alvo.servidor,
      recuperacoesSenha: "ok",
    }));
  } finally {
    await connection.end();
  }
}

aplicar().catch((error) => {
  console.error(`Falha ao aplicar migração de recuperação de senha: ${error.message}`);
  process.exitCode = 1;
});
