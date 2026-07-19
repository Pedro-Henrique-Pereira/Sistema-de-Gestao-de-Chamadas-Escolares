const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../../config.env"),
  quiet: true,
});
const db = require("../../database/db");
const taskService = require("../../services/automationTaskService");

async function verificar() {
  const [[tasks]] = await db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(status = 'pendente') AS pendentes,
      SUM(versao_api = 1) AS legadas_preservadas
    FROM fila_automacao
  `);
  const [machines] = await db.query(`
    SELECT maquina_id, identidade, estado, versao_minima
    FROM automacao_maquinas
    ORDER BY maquina_id
  `);
  const [[legacy]] = await db.query(`
    SELECT COUNT(*) AS total
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'controle_envios_diarios'
  `);
  const [indexes] = await db.query(`
    SELECT DISTINCT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fila_automacao'
      AND INDEX_NAME IN (
        'uk_fila_automacao_request_id',
        'uk_fila_automacao_idempotencia',
        'idx_fila_maquina_fifo'
      )
    ORDER BY INDEX_NAME
  `);
  const [users] = await db.query(`
    SELECT id, tipo
    FROM usuarios
    WHERE ativo = TRUE
      AND tipo IN ('pedagoga', 'administracao')
    ORDER BY tipo DESC, id ASC
  `);
  const roleChecks = {};
  for (const user of users.filter(
    (item, index, all) => all.findIndex(({ tipo }) => tipo === item.tipo) === index
  )) {
    const visibleMachines = await taskService.listMachines(user);
    roleChecks[user.tipo] = visibleMachines.map(({ machineNumber }) => machineNumber);
  }
  const admin = users.find(({ tipo }) => tipo === "administracao");
  const recentTaskCheck = admin
    ? (await taskService.listTasks(admin, { limit: 1 })).map((task) => ({
        taskId: task.taskId,
        status: task.status,
        total: task.total,
      }))
    : [];
  const [[attendanceQueryCheck]] = await db.query(`
    SELECT COUNT(*) AS total
    FROM registros_frequencia_alunos f
    LEFT JOIN responsaveis r
      ON r.id = (
        SELECT r2.id
        FROM responsaveis r2
        WHERE r2.aluno_id = f.aluno_id
          AND r2.ativo = TRUE
        ORDER BY r2.id ASC
        LIMIT 1
      )
    INNER JOIN registros_chamadas_confirmadas rc
      ON rc.id = f.registro_chamada_id
    WHERE LOWER(COALESCE(f.status, '')) = 'ausente'
      AND COALESCE(f.atrasado, FALSE) = FALSE
  `);

  console.log(JSON.stringify({
    tasks,
    machines,
    legacyControlTableExists: Boolean(legacy.total),
    indexes: indexes.map((item) => item.INDEX_NAME),
    roleChecks,
    recentTaskCheck,
    eligibleAttendanceRows: Number(attendanceQueryCheck.total || 0),
  }));
}

verificar()
  .catch((error) => {
    console.error(`Falha ao verificar API de automacao. code=${error.code || "VERIFY_ERROR"}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
