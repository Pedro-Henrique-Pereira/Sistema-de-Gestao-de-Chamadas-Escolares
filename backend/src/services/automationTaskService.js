const db = require("../database/db");
const {
  ALL_MACHINES,
  ATTENDANCE_MACHINES,
  GROUP_MACHINES,
  MESSAGE_TAGS,
  assertMachineAllowed,
  hashPayload,
  httpError,
  maskPhone,
  normalizeMessage,
  normalizePhone,
  normalizeRequestId,
  parseMachineId,
  publicErrorMessage,
  publicTaskStatus,
  renderAttendanceMessage,
} = require("./automationDomain");

const DEFAULT_ATTENDANCE_MESSAGE = "Prezado(a) {nome_responsavel}, informamos que o(a) estudante {nome_aluno} foi registrado(a) como ausente em {data}. Solicitamos contato com a escola para informar o motivo da ausência.";

function ensurePersonalizedTemplate(value) {
  const configured = normalizeMessage(value || DEFAULT_ATTENDANCE_MESSAGE, 1000);
  if (MESSAGE_TAGS.some((tag) => configured.includes(tag))) return configured;
  return normalizeMessage(
    `Olá, {nome_responsavel}. Informamos que o aluno {nome_aluno} foi registrado como ausente em {data}. ${configured.slice(0, 800)}`,
    1000
  );
}

function automationConfig() {
  const heartbeat = Number(process.env.AUTOMATION_HEARTBEAT_TIMEOUT_SECONDS || 60);
  const attempts = Number(process.env.AUTOMATION_DELIVERY_MAX_ATTEMPTS || 3);
  return {
    heartbeatTimeoutSeconds: Number.isInteger(heartbeat) ? Math.min(Math.max(heartbeat, 30), 300) : 60,
    maxAttempts: Number.isInteger(attempts) ? Math.min(Math.max(attempts, 1), 5) : 3,
    countryCode: String(process.env.AUTOMATION_DEFAULT_COUNTRY_CODE || "55").replace(/\D/g, "") || "55",
  };
}

async function recordEvent(executor, taskId, eventType, {
  deliveryId = null,
  status = null,
  errorCode = null,
} = {}) {
  await executor.execute(
    `INSERT INTO automacao_eventos
      (fila_automacao_id, automacao_entrega_id, evento_tipo, status, erro_codigo)
     VALUES (?, ?, ?, ?, ?)`,
    [taskId, deliveryId, eventType, status, errorCode]
  );
}

async function requester(executor, user) {
  const [rows] = await executor.execute(
    "SELECT id, nome, tipo FROM usuarios WHERE id = ? AND ativo = TRUE LIMIT 1",
    [user?.id]
  );
  if (!rows[0]) throw httpError("Usuário não encontrado ou inativo.", 401, "INVALID_USER");
  return rows[0];
}

async function assertMachineRegistered(executor, machineId) {
  const [rows] = await executor.execute(
    `SELECT maquina_id
       FROM automacao_maquinas
      WHERE maquina_id = ?
        AND habilitada = TRUE
        AND estado <> 'disabled'
      LIMIT 1`,
    [machineId]
  );
  if (!rows[0]) {
    throw httpError("Máquina inexistente ou desabilitada.", 409, "MACHINE_UNAVAILABLE");
  }
}

async function findExistingTask(executor, requestId, idempotencyKey) {
  const [rows] = await executor.execute(
    `SELECT id
       FROM fila_automacao
      WHERE request_id = ? OR chave_idempotencia = ?
      ORDER BY id ASC
      LIMIT 1`,
    [requestId, idempotencyKey]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function insertTask(executor, {
  requestId,
  idempotencyKey,
  requestedBy,
  machineId,
  type,
  attendanceId = null,
  message = null,
  payload = {},
}) {
  const [result] = await executor.execute(
    `INSERT INTO fila_automacao (
      request_id,
      chave_idempotencia,
      usuario_solicitante_id,
      usuario_solicitante_nome,
      maquina_destino,
      tipo_automacao,
      registro_chamada_id,
      mensagem,
      payload,
      versao_api,
      status,
      data_solicitacao
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, 'pendente', NOW())`,
    [
      requestId,
      idempotencyKey,
      requestedBy.id,
      requestedBy.nome,
      machineId,
      type,
      attendanceId,
      message,
      JSON.stringify(payload),
    ]
  );
  return Number(result.insertId);
}

async function updateTaskCounters(executor, taskId) {
  await executor.execute(
    `UPDATE fila_automacao fa
        JOIN (
          SELECT
            fila_automacao_id,
            COUNT(*) AS total,
            SUM(status = 'enviado') AS sucessos,
            SUM(
              status IN ('ignorado', 'cancelado')
              OR (status = 'erro' AND retentavel = FALSE)
            ) AS falhas
          FROM automacao_entregas
          WHERE fila_automacao_id = ?
          GROUP BY fila_automacao_id
        ) resumo ON resumo.fila_automacao_id = fa.id
       SET fa.total_destinatarios = resumo.total,
           fa.total_sucessos = resumo.sucessos,
           fa.total_falhas = resumo.falhas
     WHERE fa.id = ?`,
    [taskId, taskId]
  );
}

async function createAttendanceTask({
  requestId: rawRequestId,
  machineId: rawMachineId,
  attendanceId: rawAttendanceId,
  user,
}) {
  const requestId = normalizeRequestId(rawRequestId);
  const machineId = assertMachineAllowed(parseMachineId(rawMachineId), ATTENDANCE_MACHINES);
  const attendanceId = Number(rawAttendanceId);
  if (!Number.isInteger(attendanceId) || attendanceId <= 0) {
    throw httpError("Chamada confirmada inválida.", 400, "INVALID_ATTENDANCE");
  }
  const idempotencyKey = `attendance:${attendanceId}:absence-notification`;
  const cfg = automationConfig();
  const connection = await db.getConnection();
  let transaction = false;

  try {
    await connection.beginTransaction();
    transaction = true;
    const userData = await requester(connection, user);
    if (!["pedagoga", "administracao"].includes(userData.tipo)) {
      throw httpError("Perfil sem permissão para notificar responsáveis.", 403, "FORBIDDEN");
    }
    await assertMachineRegistered(connection, machineId);

    const existingId = await findExistingTask(connection, requestId, idempotencyKey);
    if (existingId) {
      await connection.commit();
      transaction = false;
      return { task: await getTask(existingId, user), reused: true };
    }

    const [[attendance]] = await connection.execute(
      `SELECT id, data_chamada
         FROM registros_chamadas_confirmadas
        WHERE id = ?
        LIMIT 1
        FOR UPDATE`,
      [attendanceId]
    );
    if (!attendance) {
      throw httpError(
        "A automação só pode ser criada para uma chamada confirmada.",
        409,
        "ATTENDANCE_NOT_CONFIRMED"
      );
    }

    const [absentStudents] = await connection.execute(
      `SELECT
         f.id AS frequencia_id,
         f.aluno_id,
         f.aluno_nome,
         f.data_chamada,
         r.id AS responsavel_id,
         r.nome AS responsavel_nome,
         r.contato AS responsavel_contato
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
       WHERE f.registro_chamada_id = ?
         AND LOWER(COALESCE(f.status, '')) = 'ausente'
         AND COALESCE(f.atrasado, FALSE) = FALSE
       ORDER BY f.id ASC`,
      [attendanceId]
    );
    if (!absentStudents.length) {
      throw httpError(
        "Esta chamada não possui alunos ausentes para notificar.",
        409,
        "NO_ABSENT_STUDENTS"
      );
    }

    const [[templateRow]] = await connection.execute(
      "SELECT texto FROM config_mensagem_whatsapp WHERE id = 1 LIMIT 1"
    );
    const template = ensurePersonalizedTemplate(templateRow?.texto);
    const taskId = await insertTask(connection, {
      requestId,
      idempotencyKey,
      requestedBy: userData,
      machineId,
      type: "faltas",
      attendanceId,
      message: template,
      payload: { attendance_id: attendanceId, source: "web_v2" },
    });

    for (const student of absentStudents) {
      const normalizedPhone = normalizePhone(student.responsavel_contato, cfg.countryCode);
      let status = "pendente";
      let retryable = true;
      let errorCode = null;
      if (!student.responsavel_id) {
        status = "erro";
        retryable = false;
        errorCode = "NO_GUARDIAN";
      } else if (!student.responsavel_contato) {
        status = "erro";
        retryable = false;
        errorCode = "NO_PHONE";
      } else if (!normalizedPhone) {
        status = "erro";
        retryable = false;
        errorCode = "INVALID_PHONE";
      }
      const message = renderAttendanceMessage(template, {
        guardianName: student.responsavel_nome || "responsável",
        studentName: student.aluno_nome,
        absenceDate: student.data_chamada,
      });
      const [delivery] = await connection.execute(
        `INSERT INTO automacao_entregas (
          fila_automacao_id,
          chave_idempotencia,
          tipo_destino,
          destinatario_nome,
          aluno_id,
          aluno_nome,
          frequencia_aluno_id,
          responsavel_id,
          data_referencia,
          telefone_destino,
          telefone_mascarado,
          mensagem,
          status,
          retentavel,
          erro_codigo,
          erro_mensagem,
          concluido_em
        ) VALUES (?, ?, 'responsavel', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          taskId,
          `attendance:${attendanceId}:student:${student.aluno_id}:absence`,
          student.responsavel_nome || null,
          student.aluno_id,
          student.aluno_nome,
          student.frequencia_id,
          student.responsavel_id || null,
          student.data_chamada,
          normalizedPhone || null,
          maskPhone(normalizedPhone || student.responsavel_contato),
          message,
          status,
          retryable,
          errorCode,
          errorCode ? publicErrorMessage(errorCode) : null,
          errorCode ? new Date() : null,
        ]
      );
      await recordEvent(connection, taskId, "DELIVERY_CREATED", {
        deliveryId: Number(delivery.insertId),
        status,
        errorCode,
      });
    }

    await updateTaskCounters(connection, taskId);
    const [[actionable]] = await connection.execute(
      `SELECT COUNT(*) AS total
         FROM automacao_entregas
        WHERE fila_automacao_id = ?
          AND status = 'pendente'`,
      [taskId]
    );
    if (Number(actionable.total || 0) === 0) {
      await connection.execute(
        `UPDATE fila_automacao
            SET status = 'erro',
                concluido_em = NOW(),
                erro = 'NO_VALID_RECIPIENTS'
          WHERE id = ?`,
        [taskId]
      );
      await recordEvent(connection, taskId, "TASK_FINISHED", {
        status: "erro",
        errorCode: "NO_VALID_RECIPIENTS",
      });
    } else {
      await recordEvent(connection, taskId, "TASK_QUEUED", { status: "pendente" });
    }
    await connection.commit();
    transaction = false;
    return { task: await getTask(taskId, user), reused: false };
  } catch (error) {
    if (transaction) await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      const existingId = await findExistingTask(db, requestId, idempotencyKey);
      if (existingId) return { task: await getTask(existingId, user), reused: true };
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function createGroupTask({
  requestId: rawRequestId,
  machineId: rawMachineId,
  groupIds,
  allGroups = false,
  message: rawMessage,
  user,
}) {
  const requestId = normalizeRequestId(rawRequestId);
  const machineId = assertMachineAllowed(parseMachineId(rawMachineId), GROUP_MACHINES);
  const message = normalizeMessage(rawMessage, 4000);
  const normalizedIds = Array.from(new Set(
    (Array.isArray(groupIds) ? groupIds : [])
      .map((item) => Number(
        item && typeof item === "object"
          ? item.groupId ?? item.id
          : item
      ))
      .filter((id) => Number.isInteger(id) && id > 0)
  ));
  const idempotencyKey = `groups:${requestId}`;
  const connection = await db.getConnection();
  let transaction = false;

  try {
    await connection.beginTransaction();
    transaction = true;
    const userData = await requester(connection, user);
    if (userData.tipo !== "administracao") {
      throw httpError("Somente administradores podem enviar mensagens para grupos.", 403, "FORBIDDEN");
    }
    await assertMachineRegistered(connection, machineId);

    const existingId = await findExistingTask(connection, requestId, idempotencyKey);
    if (existingId) {
      await connection.commit();
      transaction = false;
      return { task: await getTask(existingId, user), reused: true };
    }

    let groups;
    if (allGroups) {
      [groups] = await connection.execute(
        "SELECT id, nome_grupo FROM grupos_whatsapp WHERE ativo = TRUE ORDER BY id ASC"
      );
    } else {
      if (!normalizedIds.length) {
        throw httpError("Selecione pelo menos um grupo.", 400, "NO_GROUPS");
      }
      const placeholders = normalizedIds.map(() => "?").join(", ");
      [groups] = await connection.execute(
        `SELECT id, nome_grupo
           FROM grupos_whatsapp
          WHERE ativo = TRUE
            AND id IN (${placeholders})
          ORDER BY id ASC`,
        normalizedIds
      );
      if (groups.length !== normalizedIds.length) {
        throw httpError("Um ou mais grupos são inválidos ou estão inativos.", 400, "INVALID_GROUP");
      }
    }
    if (!groups.length) throw httpError("Nenhum grupo ativo está disponível.", 409, "NO_GROUPS");

    const taskId = await insertTask(connection, {
      requestId,
      idempotencyKey,
      requestedBy: userData,
      machineId,
      type: "mensagem_grupo",
      message,
      payload: {
        source: "web_v2",
        groups_hash: hashPayload(groups.map(({ id }) => Number(id))),
      },
    });

    for (const group of groups) {
      const [delivery] = await connection.execute(
        `INSERT INTO automacao_entregas (
          fila_automacao_id,
          chave_idempotencia,
          tipo_destino,
          destinatario_nome,
          grupo_whatsapp_id,
          grupo_nome,
          mensagem,
          status,
          retentavel
        ) VALUES (?, ?, 'grupo', ?, ?, ?, ?, 'pendente', TRUE)`,
        [
          taskId,
          `group:${requestId}:${group.id}`,
          group.nome_grupo,
          group.id,
          group.nome_grupo,
          message,
        ]
      );
      await recordEvent(connection, taskId, "DELIVERY_CREATED", {
        deliveryId: Number(delivery.insertId),
        status: "pendente",
      });
    }

    await updateTaskCounters(connection, taskId);
    await recordEvent(connection, taskId, "TASK_QUEUED", { status: "pendente" });
    await connection.commit();
    transaction = false;
    return { task: await getTask(taskId, user), reused: false };
  } catch (error) {
    if (transaction) await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      const existingId = await findExistingTask(db, requestId, idempotencyKey);
      if (existingId) return { task: await getTask(existingId, user), reused: true };
    }
    throw error;
  } finally {
    connection.release();
  }
}

function machineState(row, cfg = automationConfig()) {
  if (!row?.habilitada) return "disabled";
  if (!row.ultima_comunicacao_em) return "offline";
  const last = new Date(row.ultima_comunicacao_em).getTime();
  if (!Number.isFinite(last) || Date.now() - last > cfg.heartbeatTimeoutSeconds * 1000) {
    return "offline";
  }
  return row.estado || "online_available";
}

async function listMachines(user) {
  const userData = await requester(db, user);
  const allowed = userData.tipo === "pedagoga"
    ? ATTENDANCE_MACHINES
    : userData.tipo === "administracao"
      ? ALL_MACHINES
      : [];
  if (!allowed.length) throw httpError("Perfil sem acesso às máquinas.", 403, "FORBIDDEN");

  const [rows] = await db.execute(
    `SELECT
       m.*,
       (SELECT COUNT(*)
          FROM fila_automacao f
         WHERE f.maquina_destino = m.maquina_id
           AND f.status = 'pendente') AS tarefas_aguardando
     FROM automacao_maquinas m
     WHERE m.maquina_id IN (${allowed.map(() => "?").join(", ")})
     ORDER BY m.maquina_id ASC`,
    allowed
  );
  return rows.map((row) => ({
    machineId: `machine-${row.maquina_id}`,
    machineNumber: Number(row.maquina_id),
    name: row.nome_exibicao,
    state: machineState(row),
    online: machineState(row) !== "offline" && machineState(row) !== "disabled",
    available: machineState(row) === "online_available",
    queueDepth: Number(row.tarefas_aguardando || 0),
    currentTaskId: row.tarefa_atual_id ? Number(row.tarefa_atual_id) : null,
    lastHeartbeatAt: row.ultima_comunicacao_em || null,
    appVersion: row.versao_aplicativo || null,
    minimumVersion: row.versao_minima,
  }));
}

async function getTask(taskIdValue, user) {
  const taskId = Number(taskIdValue);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw httpError("ID da tarefa inválido.", 400, "INVALID_TASK");
  }
  const userData = await requester(db, user);
  const [rows] = await db.execute(
    `SELECT f.*, m.estado AS maquina_estado, m.habilitada, m.ultima_comunicacao_em
       FROM fila_automacao f
       LEFT JOIN automacao_maquinas m ON m.maquina_id = f.maquina_destino
      WHERE f.id = ?
        AND (f.usuario_solicitante_id = ? OR ? = 'administracao')
      LIMIT 1`,
    [taskId, userData.id, userData.tipo]
  );
  const task = rows[0];
  if (!task) throw httpError("Tarefa não encontrada.", 404, "TASK_NOT_FOUND");

  const cfg = automationConfig();
  const [deliveries] = await db.execute(
    `SELECT
       id,
       tipo_destino,
       destinatario_nome,
       aluno_id,
       aluno_nome,
       grupo_whatsapp_id,
       grupo_nome,
       telefone_mascarado,
       status,
       tentativas,
       retentavel,
       erro_codigo,
       erro_mensagem,
       identificador_externo,
       iniciado_em,
       concluido_em
     FROM automacao_entregas
     WHERE fila_automacao_id = ?
     ORDER BY id ASC`,
    [taskId]
  );
  const [[position]] = await db.execute(
    `SELECT COUNT(*) + 1 AS posicao
       FROM fila_automacao anterior
      WHERE anterior.maquina_destino = ?
        AND anterior.status = 'pendente'
        AND (
          anterior.data_solicitacao < ?
          OR (anterior.data_solicitacao = ? AND anterior.id < ?)
        )`,
    [task.maquina_destino, task.data_solicitacao, task.data_solicitacao, task.id]
  );
  const state = machineState(task, cfg);
  const finalFailures = deliveries.filter((delivery) => (
    ["ignorado", "cancelado"].includes(delivery.status)
    || (delivery.status === "erro" && (!delivery.retentavel || Number(delivery.tentativas) >= cfg.maxAttempts))
  )).length;
  const successes = deliveries.filter(({ status }) => status === "enviado").length;
  const processed = successes + finalFailures;

  return {
    taskId: Number(task.id),
    requestId: task.request_id,
    type: task.tipo_automacao === "faltas" ? "attendance_notification" : "group_message",
    status: publicTaskStatus(task, state),
    machineId: `machine-${task.maquina_destino}`,
    machineNumber: Number(task.maquina_destino),
    machineState: state,
    queuePosition: task.status === "pendente" ? Number(position.posicao || 1) : null,
    attendanceId: task.registro_chamada_id ? Number(task.registro_chamada_id) : null,
    total: deliveries.length || Number(task.total_destinatarios || 0),
    processed,
    successCount: successes,
    failureCount: finalFailures,
    remaining: Math.max((deliveries.length || Number(task.total_destinatarios || 0)) - processed, 0),
    createdAt: task.data_solicitacao,
    startedAt: task.iniciado_em,
    completedAt: task.concluido_em,
    externalId: task.identificador_externo || null,
    results: deliveries.map((delivery) => ({
      deliveryId: Number(delivery.id),
      recipientType: delivery.tipo_destino,
      recipientName: delivery.destinatario_nome || delivery.grupo_nome || null,
      studentId: delivery.aluno_id ? Number(delivery.aluno_id) : null,
      studentName: delivery.aluno_nome || null,
      groupId: delivery.grupo_whatsapp_id ? Number(delivery.grupo_whatsapp_id) : null,
      groupName: delivery.grupo_nome || null,
      maskedPhone: delivery.telefone_mascarado || null,
      status: delivery.status === "enviado"
        ? "success"
        : delivery.status === "processando"
          ? "processing"
          : delivery.status === "pendente"
            ? "queued"
            : delivery.status === "erro" && delivery.retentavel && Number(delivery.tentativas) < cfg.maxAttempts
              ? "retrying"
              : "failed",
      attempts: Number(delivery.tentativas || 0),
      errorCode: delivery.erro_codigo || null,
      errorMessage: delivery.erro_mensagem || (delivery.erro_codigo ? publicErrorMessage(delivery.erro_codigo) : null),
      externalId: delivery.identificador_externo || null,
      startedAt: delivery.iniciado_em || null,
      completedAt: delivery.concluido_em || null,
    })),
  };
}

async function listQueues(user) {
  const userData = await requester(db, user);
  if (userData.tipo !== "administracao") {
    throw httpError("Somente administradores podem consultar todas as filas.", 403, "FORBIDDEN");
  }
  const machines = await listMachines(user);
  const [rows] = await db.execute(
    `SELECT maquina_destino, status, COUNT(*) AS total
       FROM fila_automacao
      WHERE status IN ('pendente', 'executando')
      GROUP BY maquina_destino, status
      ORDER BY maquina_destino, status`
  );
  return machines.map((machine) => ({
    ...machine,
    queuedTasks: Number(rows.find(
      (row) => Number(row.maquina_destino) === machine.machineNumber && row.status === "pendente"
    )?.total || 0),
    processingTasks: Number(rows.find(
      (row) => Number(row.maquina_destino) === machine.machineNumber && row.status === "executando"
    )?.total || 0),
  }));
}

async function listTasks(user, { limit = 20, type = "" } = {}) {
  const userData = await requester(db, user);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const filters = ["(usuario_solicitante_id = ? OR ? = 'administracao')"];
  const params = [userData.id, userData.tipo];
  if (type === "attendance_notification") {
    filters.push("tipo_automacao = 'faltas'");
  } else if (type === "group_message") {
    filters.push("tipo_automacao = 'mensagem_grupo'");
  }
  const [rows] = await db.execute(
    `SELECT id
       FROM fila_automacao
      WHERE ${filters.join(" AND ")}
      ORDER BY data_solicitacao DESC, id DESC
      LIMIT ${safeLimit}`,
    params
  );
  return Promise.all(rows.map(({ id }) => getTask(id, user)));
}

async function cancelTask(taskIdValue, user) {
  const taskId = Number(taskIdValue);
  const userData = await requester(db, user);
  if (userData.tipo !== "administracao") {
    throw httpError("Somente administradores podem cancelar tarefas.", 403, "FORBIDDEN");
  }
  const connection = await db.getConnection();
  let transaction = false;
  try {
    await connection.beginTransaction();
    transaction = true;
    const [result] = await connection.execute(
      `UPDATE fila_automacao
          SET status = 'cancelado',
              concluido_em = NOW(),
              erro = 'CANCELLED',
              lock_owner = NULL,
              lock_adquirido_em = NULL
        WHERE id = ?
          AND status = 'pendente'`,
      [taskId]
    );
    if (result.affectedRows !== 1) {
      throw httpError(
        "A tarefa não existe ou já iniciou e não pode mais ser cancelada.",
        409,
        "TASK_NOT_CANCELLABLE"
      );
    }
    await connection.execute(
      `UPDATE automacao_entregas
          SET status = 'cancelado',
              retentavel = FALSE,
              erro_codigo = 'CANCELLED',
              erro_mensagem = ?,
              concluido_em = NOW()
        WHERE fila_automacao_id = ?
          AND status IN ('pendente', 'erro')`,
      [publicErrorMessage("CANCELLED"), taskId]
    );
    await updateTaskCounters(connection, taskId);
    await recordEvent(connection, taskId, "TASK_CANCELLED", { status: "cancelado" });
    await connection.commit();
    transaction = false;
    return getTask(taskId, user);
  } catch (error) {
    if (transaction) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  DEFAULT_ATTENDANCE_MESSAGE,
  automationConfig,
  cancelTask,
  createAttendanceTask,
  createGroupTask,
  getTask,
  ensurePersonalizedTemplate,
  listMachines,
  listQueues,
  listTasks,
  machineState,
  recordEvent,
  updateTaskCounters,
};
