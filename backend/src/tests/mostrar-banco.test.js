const mysql = require("mysql2/promise");
require("dotenv").config({ path: "config.env" });

const TABLES = [
  "usuarios",
  "turmas",
  "alunos",
  "responsaveis",
  "chamadas_diarias",
  "registros_chamadas_confirmadas",
  "registros_frequencia_alunos",
  "justificativas_frequencia",
  "configuracoes_escola",
];

function printTitle(title) {
  console.log("\n" + "=".repeat(80));
  console.log(` ${title}`);
  console.log("=".repeat(80));
}

async function showTable(connection, table) {
  printTitle(`TABELA: ${table}`);

  try {
    const [countRows] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
    console.log(`Total de registros: ${countRows[0].total}`);

  } catch (error) {
    console.error(`Erro ao contar tabela ${table}. code=${error.code || "DB_COUNT_ERROR"}`);
  }
}

async function main() {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "Sistema_Chamada",
      port: Number(process.env.DB_PORT || 3306),
    });

    printTitle("RESUMO SANITIZADO DO BANCO DE DADOS");

    for (const table of TABLES) {
      await showTable(connection, table);
    }

    printTitle("FIM DA CONSULTA");
  } catch (error) {
    console.error(`Erro ao gerar resumo do banco. code=${error.code || "DB_SUMMARY_ERROR"}`);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main();
