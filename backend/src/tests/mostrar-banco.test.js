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

function safeJson(value) {
  if (!value) return value;

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  return value;
}

async function showTable(connection, table) {
  printTitle(`TABELA: ${table}`);

  try {
    const [countRows] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
    console.log(`Total de registros: ${countRows[0].total}`);

    const [rows] = await connection.query(`SELECT * FROM \`${table}\` ORDER BY id DESC LIMIT 100`);

    if (rows.length === 0) {
      console.log("Nenhum dado encontrado.");
      return;
    }

    const formattedRows = rows.map((row) => {
      const formatted = {};

      for (const [key, value] of Object.entries(row)) {
        if (key === "senha_hash") {
          formatted[key] = "[OCULTO POR SEGURANÇA]";
        } else if (key === "alunos" || key === "anexos") {
          formatted[key] = safeJson(value);
        } else {
          formatted[key] = value;
        }
      }

      return formatted;
    });

    console.table(formattedRows);
  } catch (error) {
    console.error(`Erro ao consultar tabela ${table}:`, error.message);
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

    printTitle("VISUALIZAÇÃO ORGANIZADA DO BANCO DE DADOS");
    console.log(`Banco: ${process.env.DB_NAME || "Sistema_Chamada"}`);

    for (const table of TABLES) {
      await showTable(connection, table);
    }

    printTitle("CONSULTAS RELACIONADAS");

    const [alunosComTurma] = await connection.query(`
      SELECT 
        a.id,
        a.nome AS aluno,
        a.idade,
        COALESCE(t.nome, 'Sem turma') AS turma,
        a.criado_em
      FROM alunos a
      LEFT JOIN turmas t ON t.id = a.turma_id
      ORDER BY t.nome, a.nome
      LIMIT 200
    `);

    console.log("\nAlunos com suas turmas:");
    console.table(alunosComTurma);

    const [responsaveisAlunos] = await connection.query(`
      SELECT
        r.id,
        a.nome AS aluno,
        r.nome AS responsavel,
        r.parentesco,
        r.contato
      FROM responsaveis r
      INNER JOIN alunos a ON a.id = r.aluno_id
      ORDER BY a.nome, r.nome
      LIMIT 200
    `);

    console.log("\nResponsáveis por aluno:");
    console.table(responsaveisAlunos);

    const [frequenciaDetalhada] = await connection.query(`
      SELECT
        f.id,
        f.data_chamada,
        f.aluno_nome,
        f.turma_nome,
        f.materia,
        f.status,
        f.atrasado,
        f.horario_registro_atraso,
        f.atraso_registrado_em
      FROM registros_frequencia_alunos f
      ORDER BY f.data_chamada DESC, f.turma_nome, f.aluno_nome
      LIMIT 200
    `);

    console.log("\nFrequência detalhada dos alunos:");
    console.table(frequenciaDetalhada);

    printTitle("FIM DA CONSULTA");
  } catch (error) {
    console.error("Erro geral ao conectar ou consultar o banco:");
    console.error(error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main();