require("dotenv").config({ path: "config.env" });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "Sistema_Chamada",
    multipleStatements: true,
  });
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, "2026-07-19_automacao_api.sql"),
      "utf8"
    );
    await connection.query(sql);
    console.log("Migração da API de automação aplicada com sucesso.");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Falha ao aplicar migração da API de automação. code=${error.code || "MIGRATION_ERROR"}`);
  process.exitCode = 1;
});
