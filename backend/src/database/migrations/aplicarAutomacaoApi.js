const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.resolve(__dirname, "../../../config.env") });

async function existe(connection, tabela, tipo, nome) {
  const coluna = tipo === "COLUMN"
    ? "COLUMN_NAME"
    : tipo === "INDEX"
      ? "INDEX_NAME"
      : "CONSTRAINT_NAME";
  const fonte = tipo === "COLUMN"
    ? "COLUMNS"
    : tipo === "INDEX"
      ? "STATISTICS"
      : "TABLE_CONSTRAINTS";
  const [rows] = await connection.query(
    `SELECT 1
       FROM INFORMATION_SCHEMA.${fonte}
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND ${coluna} = ?
      LIMIT 1`,
    [tabela, nome]
  );
  return rows.length > 0;
}

async function garantirColuna(connection, tabela, coluna, definicao) {
  if (!(await existe(connection, tabela, "COLUMN", coluna))) {
    await connection.query(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  }
}

async function garantirIndice(connection, tabela, indice, definicao) {
  if (!(await existe(connection, tabela, "INDEX", indice))) {
    await connection.query(`ALTER TABLE ${tabela} ADD ${definicao}`);
  }
}

async function garantirConstraint(connection, tabela, constraint, definicao) {
  if (!(await existe(connection, tabela, "CONSTRAINT", constraint))) {
    await connection.query(`ALTER TABLE ${tabela} ADD CONSTRAINT ${constraint} ${definicao}`);
  }
}

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
    const [[alvo]] = await connection.query("SELECT DATABASE() AS banco, @@hostname AS servidor");
    if (String(alvo.banco).toLowerCase() !== database.toLowerCase()) {
      throw new Error("O banco conectado não corresponde ao DB_NAME configurado.");
    }

    for (const arquivo of [
      "2026-07-19_automacao_api.sql",
      "2026-07-20_automacao_tarefas_v2.sql",
      "2026-07-21_automacao_deduplicacao.sql",
    ]) {
      const sql = fs
        .readFileSync(path.join(__dirname, arquivo), "utf8")
        .replace(/^USE\s+[^;]+;\s*/i, "");
      await connection.query(sql);
    }

    await garantirColuna(connection, "fila_automacao", "request_id", "VARCHAR(64) NULL AFTER id");
    await garantirColuna(connection, "fila_automacao", "chave_idempotencia", "VARCHAR(160) NULL AFTER request_id");
    await garantirColuna(connection, "fila_automacao", "registro_chamada_id", "INT NULL AFTER tipo_automacao");
    await garantirColuna(connection, "fila_automacao", "versao_api", "SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER payload");
    await garantirColuna(connection, "fila_automacao", "total_destinatarios", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER tentativas");
    await garantirColuna(connection, "fila_automacao", "total_sucessos", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER total_destinatarios");
    await garantirColuna(connection, "fila_automacao", "total_falhas", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER total_sucessos");
    await garantirColuna(connection, "fila_automacao", "identificador_externo", "VARCHAR(100) NULL AFTER total_falhas");
    await garantirColuna(connection, "fila_automacao", "atualizado_em", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER erro");

    await connection.query(`
      ALTER TABLE fila_automacao
      MODIFY status ENUM(
        'pendente',
        'executando',
        'concluido',
        'concluido_parcial',
        'erro',
        'falha_comunicacao',
        'expirado',
        'cancelado'
      ) NOT NULL DEFAULT 'pendente'
    `);

    await connection.query(`
      UPDATE fila_automacao
         SET request_id = COALESCE(request_id, CONCAT('legacy-', id)),
             chave_idempotencia = COALESCE(chave_idempotencia, CONCAT('legacy-task:', id))
    `);
    await connection.query(`
      ALTER TABLE fila_automacao
      MODIFY request_id VARCHAR(64) NOT NULL,
      MODIFY chave_idempotencia VARCHAR(160) NOT NULL,
      MODIFY versao_api SMALLINT UNSIGNED NOT NULL DEFAULT 2
    `);

    await garantirIndice(connection, "fila_automacao", "uk_fila_automacao_request_id", "UNIQUE KEY uk_fila_automacao_request_id (request_id)");
    await garantirIndice(connection, "fila_automacao", "uk_fila_automacao_idempotencia", "UNIQUE KEY uk_fila_automacao_idempotencia (chave_idempotencia)");
    await garantirIndice(connection, "fila_automacao", "idx_fila_maquina_fifo", "KEY idx_fila_maquina_fifo (maquina_destino, status, data_solicitacao, id)");
    await garantirIndice(connection, "fila_automacao", "idx_fila_registro_chamada", "KEY idx_fila_registro_chamada (registro_chamada_id, tipo_automacao)");
    await garantirConstraint(
      connection,
      "fila_automacao",
      "fk_fila_registro_chamada",
      "FOREIGN KEY (registro_chamada_id) REFERENCES registros_chamadas_confirmadas(id) ON DELETE SET NULL ON UPDATE CASCADE"
    );

    await garantirColuna(connection, "automacao_entregas", "destinatario_nome", "VARCHAR(150) NULL AFTER tipo_destino");
    await garantirColuna(connection, "automacao_entregas", "aluno_nome", "VARCHAR(150) NULL AFTER aluno_id");
    await garantirColuna(connection, "automacao_entregas", "grupo_nome", "VARCHAR(150) NULL AFTER grupo_whatsapp_id");
    await garantirColuna(connection, "automacao_entregas", "telefone_destino", "VARCHAR(20) NULL AFTER data_referencia");
    await garantirColuna(connection, "automacao_entregas", "telefone_mascarado", "VARCHAR(24) NULL AFTER telefone_destino");
    await garantirColuna(connection, "automacao_entregas", "mensagem", "TEXT NULL AFTER telefone_mascarado");
    await garantirColuna(connection, "automacao_entregas", "retentavel", "BOOLEAN NOT NULL DEFAULT TRUE AFTER status");
    await garantirColuna(connection, "automacao_entregas", "erro_mensagem", "VARCHAR(255) NULL AFTER erro_codigo");
    await garantirColuna(connection, "automacao_entregas", "identificador_externo", "VARCHAR(100) NULL AFTER erro_mensagem");

    await garantirConstraint(
      connection,
      "automacao_maquinas",
      "fk_automacao_maquinas_tarefa_atual",
      "FOREIGN KEY (tarefa_atual_id) REFERENCES fila_automacao(id) ON DELETE SET NULL ON UPDATE CASCADE"
    );

    await connection.query("DROP TABLE IF EXISTS controle_envios_diarios");

    const [[verificacao]] = await connection.query(`
      SELECT
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'automacao_maquinas') AS maquinas,
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'automacao_eventos') AS eventos,
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'automacao_deduplicacao') AS deduplicacao,
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fila_automacao'
            AND COLUMN_NAME IN ('request_id', 'chave_idempotencia', 'registro_chamada_id', 'versao_api')) AS colunasTarefa,
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'automacao_entregas'
            AND COLUMN_NAME IN ('mensagem', 'telefone_destino', 'retentavel', 'erro_mensagem')) AS colunasEntrega
    `);
    if (
      !verificacao.maquinas
      || !verificacao.eventos
      || !verificacao.deduplicacao
      || Number(verificacao.colunasTarefa) !== 4
      || Number(verificacao.colunasEntrega) !== 4
    ) {
      throw new Error("A estrutura V2 da automação não foi criada por completo.");
    }

    console.log(JSON.stringify({ banco: alvo.banco, servidor: alvo.servidor, verificacao }));
  } finally {
    await connection.end();
  }
}

aplicar().catch((error) => {
  console.error(`Falha ao aplicar migração da API de automação. code=${error.code || "MIGRATION_ERROR"}`);
  process.exitCode = 1;
});
