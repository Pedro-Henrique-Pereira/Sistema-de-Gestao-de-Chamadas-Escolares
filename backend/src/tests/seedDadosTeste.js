const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config({ path: "./config.env" });

const turmas = ["6ºA", "7ºA", "8ºA", "9ºA"];
const alunosPorTurma = {
  "6ºA": ["Ana Clara Teste", "Bruno Henrique Teste", "Carla Vitória Teste", "Diego Rafael Teste"],
  "7ºA": ["Eduarda Lima Teste", "Felipe Augusto Teste", "Gabriela Souza Teste", "Henrique Costa Teste"],
  "8ºA": ["Isabela Martins Teste", "João Pedro Teste", "Larissa Gomes Teste", "Mateus Rocha Teste"],
  "9ºA": ["Nicolas Almeida Teste", "Olívia Ferreira Teste", "Pedro Lucas Teste", "Rafaela Dias Teste"],
};

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "Sistema_Chamada",
  waitForConnections: true,
  connectionLimit: 10,
});

async function seedDadosTeste() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    console.log("🌱 Inserindo turmas e alunos fictícios...");

    for (const nomeTurma of turmas) {
      await connection.execute(
        `INSERT INTO turmas (nome) VALUES (?)
         ON DUPLICATE KEY UPDATE nome = VALUES(nome)`,
        [nomeTurma]
      );

      const [[turma]] = await connection.execute(
        "SELECT id, nome FROM turmas WHERE nome = ? LIMIT 1",
        [nomeTurma]
      );

      for (const nomeAluno of alunosPorTurma[nomeTurma]) {
        await connection.execute(
          `INSERT INTO alunos (nome, idade, turma_id)
           SELECT ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM alunos WHERE nome = ? AND turma_id = ?
           )`,
          [nomeAluno.toUpperCase(), 12, turma.id, nomeAluno.toUpperCase(), turma.id]
        );
      }

      console.log(`✅ ${nomeTurma}: 4 alunos vinculados`);
    }

    await connection.commit();
    console.log("✅ Seed finalizado: 4 turmas e 16 alunos disponíveis para testes.");
  } catch (error) {
    await connection.rollback();
    console.error("❌ Erro ao inserir dados fictícios:", error);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

seedDadosTeste();
