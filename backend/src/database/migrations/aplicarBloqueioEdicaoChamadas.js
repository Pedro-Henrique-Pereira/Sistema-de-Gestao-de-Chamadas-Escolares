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
    const arquivo = path.join(__dirname, "2026-07-18_bloqueio_edicao_chamadas.sql");
    const sql = fs.readFileSync(arquivo, "utf8").replace(/^USE\s+[^;]+;\s*/i, "");
    const [[alvo]] = await connection.query("SELECT DATABASE() AS banco, @@hostname AS servidor");

    if (alvo.banco !== database) {
      throw new Error("O banco conectado não corresponde ao DB_NAME configurado.");
    }

    await connection.query(sql);

    const [[verificacao]] = await connection.query(`
      SELECT
        c.COLUMN_DEFAULT AS valorPadrao,
        c.IS_NULLABLE AS aceitaNulo,
        (SELECT COUNT(*) FROM configuracoes_escola_auditoria) AS auditorias
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA = DATABASE()
        AND c.TABLE_NAME = 'configuracoes_escola'
        AND c.COLUMN_NAME = 'bloquear_edicao_chamadas_apos_horario'
      LIMIT 1
    `);

    if (!verificacao || String(verificacao.valorPadrao) !== "1" || verificacao.aceitaNulo !== "NO") {
      throw new Error("A coluna de bloqueio não foi criada com o padrão seguro ativado.");
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
