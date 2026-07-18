const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config({ path: "./config.env" });

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "Sistema_Chamada",
  waitForConnections: true,
  connectionLimit: 10,
});

async function resetDatabase() {
  const connection = await pool.getConnection();

  try {
    console.log("⚠️ Iniciando limpeza do banco...");

    await connection.beginTransaction();
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    // Automação WhatsApp
    await connection.query("DELETE FROM fila_automacao");
    await connection.query("DELETE FROM controle_envios_diarios");

    // Dados operacionais
    await connection.query("DELETE FROM justificativas_frequencia");
    await connection.query("DELETE FROM registros_frequencia_alunos");
    await connection.query("DELETE FROM registros_chamadas_confirmadas");
    await connection.query("DELETE FROM chamadas_diarias");

    // Cadastros
    await connection.query("DELETE FROM responsaveis");
    await connection.query("DELETE FROM alunos");
    await connection.query("DELETE FROM turmas");

    // Preserva administradores
    await connection.query(`
      DELETE FROM usuarios
      WHERE tipo <> 'administracao'
    `);

    await connection.query(`
      DELETE u1 FROM usuarios u1
      INNER JOIN usuarios u2
      WHERE 
        u1.id > u2.id
        AND u1.tipo = 'administracao'
        AND u2.tipo = 'administracao'
    `);

    // Mantém config_mensagem_whatsapp e configuracoes_escola
    // para não apagar mensagem personalizada nem configurações globais.

    await connection.query("ALTER TABLE fila_automacao AUTO_INCREMENT = 1");
    await connection.query("ALTER TABLE responsaveis AUTO_INCREMENT = 1");
    await connection.query("ALTER TABLE alunos AUTO_INCREMENT = 1");
    await connection.query("ALTER TABLE turmas AUTO_INCREMENT = 1");
    await connection.query("ALTER TABLE chamadas_diarias AUTO_INCREMENT = 1");
    await connection.query("ALTER TABLE registros_chamadas_confirmadas AUTO_INCREMENT = 1");
    await connection.query("ALTER TABLE registros_frequencia_alunos AUTO_INCREMENT = 1");
    await connection.query("ALTER TABLE justificativas_frequencia AUTO_INCREMENT = 1");

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    await connection.commit();

    console.log("✅ Banco resetado com sucesso!");
    console.log("✅ Admin preservado.");
    console.log("✅ Mensagem personalizada do WhatsApp preservada.");
    console.log("✅ Configurações globais preservadas.");
  } catch (error) {
    await connection.rollback();

    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch (_) {}

    console.error(`Erro ao resetar banco. code=${error.code || "DB_RESET_ERROR"}`);
  } finally {
    connection.release();
    await pool.end();
  }
}

resetDatabase();
