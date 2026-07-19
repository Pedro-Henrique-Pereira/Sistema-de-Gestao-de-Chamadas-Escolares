const db = require("../database/db");
const {
  ALL_MACHINES,
  ATTENDANCE_MACHINES,
  GROUP_MACHINES,
  MESSAGE_TAGS,
  assertMachineAllowed,
  hashPayload,
  hashText,
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

const DUPLICATE_ERROR_CODES = new Set([
  "DUPLICATE_ALREADY_SENT",
  "DUPLICATE_IN_PROGRESS",
]);

function referenceDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function attendanceDeduplicationKey({
  absenceDate,
  studentId,
  guardianId,
  normalizedPhone,
}) {
  const recipient = guardianId
    ? `guardian:${Number(guardianId)}`
    : `phone:${String(normalizedPhone || "")}`;
  return hashText(
    `absence:${referenceDate(absenceDate)}:student:${Number(studentId)}:recipient:${recipient}`
  );
}

function duplicateBlockCode(delivery, cfg = automationConfig()) {
  if (!delivery) return null;
  if (delivery.delivery_status === "enviado") return "DUPLICATE_ALREADY_SENT";
  const taskActive = ["pendente", "executando"].includes(delivery.task_status);
  const deliveryActive = ["pendente", "processando"].includes(delivery.delivery_status)
    || (
      delivery.delivery_status === "erro"
      && Boolean(delivery.retentavel)
      && Number(delivery.tentativas || 0) < cfg.maxAttempts
    );
  return taskActive && deliveryActive ? "DUPLICATE_IN_PROGRESS" : null;
}

function publicDeliveryStatus(delivery, cfg = automationConfig()) {
  if (delivery.erro_codigo === "DUPLICATE_ALREADY_SENT") return "ignored_duplicate";
  if (delivery.erro_codigo === "DUPLICATE_IN_PROGRESS") return "already_queued";
  if (delivery.status === "enviado") return "success";
  if (delivery.status === "processando") return "processing";
  if (delivery.status === "pendente") return "queued";
  if (
    delivery.status === "erro"
    && delivery.retentavel
    && Number(delivery.tentativas) < cfg.maxAttempts
  ) {
    return "retrying";
  }
  return "failed";
}

async function reserveAttendanceDeduplication(connection, metadata, cfg) {
  const key = attendanceDeduplicationKey(metadata);
  const [insert] = await connection.execute(
    `INSERT IGNORE INTO automacao_deduplicacao (
      chave_deduplicacao,
      tipo_notificacao,
      aluno_id,
      responsavel_id,
      data_referencia
    ) VALUES (?, 'absence_notification', ?, ?, ?)`,
    [
      key,
      metadata.studentId,
      metadata.guardianId || null,
      referenceDate(metadata.absenceDate),
    ]
  );
  if (insert.affectedRows === 1) {
    return { key, blockCode: null };
  }

  const [[current]] = await connection.execute(
    `SELECT
       delivery.status AS delivery_status,
       delivery.retentavel,
       delivery.tentativas,
       task.status AS task_status
     FROM automacao_deduplicacao dedup
     LEFT JOIN automacao_entregas delivery
       ON delivery.id = dedup.automacao_entrega_id
     LEFT JOIN fila_automacao task
       ON task.id = delivery.fila_automacao_id
     WHERE dedup.chave_deduplicacao = ?
     LIMIT 1
     FOR UPDATE`,
    [key]
  );
  return { key, blockCode: duplicateBlockCode(current, cfg) };
}

async function bindAttendanceDeduplication(connection, key, deliveryId) {
  await connection.execute(
    `UPDATE automacao_deduplicacao
        SET automacao_entrega_id = ?,
            atualizado_em = CURRENT_TIMESTAMP
      WHERE chave_deduplicacao = ?`,
    [deliveryId, key]
  );
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
      LIMIT 1
      FOR UPDATE`,
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
              status = 'cancelado'
              OR (
                status = 'ignorado'
                AND erro_codigo NOT IN ('DUPLICATE_ALREADY_SENT', 'DUPLICATE_IN_PROGRESS')
              )
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
  const idempotencyKey = `attendance-request:${requestId}`;
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
      const deduplication = await reserveAttendanceDeduplication(connection, {
        absenceDate: student.data_chamada,
        studentId: student.aluno_id,
        guardianId: student.responsavel_id,
        normalizedPhone,
      }, cfg);
      if (deduplication.blockCode) {
        status = "ignorado";
        retryable = false;
        errorCode = deduplication.blockCode;
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
          `attendance-attempt:${hashText(
            `${requestId}:${student.aluno_id}:${student.responsavel_id || normalizedPhone || "unknown"}`
          )}`,
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
      const deliveryId = Number(delivery.insertId);
      if (!deduplication.blockCode) {
        await bindAttendanceDeduplication(connection, deduplication.key, deliveryId);
      }
      await recordEvent(connection, taskId, deduplication.blockCode
        ? "DELIVERY_DUPLICATE_BLOCKED"
        : "DELIVERY_CREATED", {
        deliveryId,
        status,
        errorCode,
      });
    }

    await updateTaskCounters(connection, taskId);
    const [[actionable]] = await connection.execute(
      `SELECT
         SUM(status = 'pendente') AS total,
         SUM(erro_codigo IN ('DUPLICATE_ALREADY_SENT', 'DUPLICATE_IN_PROGRESS')) AS duplicadas,
         COUNT(*) AS entregas
         FROM automacao_entregas
        WHERE fila_automacao_id = ?`,
      [taskId]
    );
    if (Number(actionable.total || 0) === 0) {
      const onlyDuplicates = Number(actionable.duplicadas || 0) === Number(actionable.entregas || 0);
      await connection.execute(
        `UPDATE fila_automacao
            SET status = ?,
                concluido_em = NOW(),
                erro = ?
          WHERE id = ?`,
        [
          onlyDuplicates ? "concluido" : "erro",
          onlyDuplicates ? null : "NO_VALID_RECIPIENTS",
          taskId,
        ]
      );
      await recordEvent(connection, taskId, "TASK_FINISHED", {
        status: onlyDuplicates ? "concluido" : "erro",
        errorCode: onlyDuplicates ? null : "NO_VALID_RECIPIENTS",
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
  const duplicatesAlreadySent = deliveries.filter(
    ({ erro_codigo: errorCode }) => errorCode === "DUPLICATE_ALREADY_SENT"
  ).length;
  const duplicatesInProgress = deliveries.filter(
    ({ erro_codigo: errorCode }) => errorCode === "DUPLICATE_IN_PROGRESS"
  ).length;
  const finalFailures = deliveries.filter((delivery) => (
    (
      ["ignorado", "cancelado"].includes(delivery.status)
      && !DUPLICATE_ERROR_CODES.has(delivery.erro_codigo)
    )
    || (delivery.status === "erro" && (!delivery.retentavel || Number(delivery.tentativas) >= cfg.maxAttempts))
  )).length;
  const successes = deliveries.filter(({ status }) => status === "enviado").length;
  const processed = successes + finalFailures + duplicatesAlreadySent + duplicatesInProgress;

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
    ignoredDuplicateCount: duplicatesAlreadySent,
    alreadyQueuedCount: duplicatesInProgress,
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
      status: publicDeliveryStatus(delivery, cfg),
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

async function clearMachineQueue(machineIdValue, user) {
  const machineId = parseMachineId(machineIdValue);
  const connection = await db.getConnection();
  let transaction = false;
  try {
    await connection.beginTransaction();
    transaction = true;
    const userData = await requester(connection, user);
    const allowedMachines = userData.tipo === "pedagoga"
      ? ATTENDANCE_MACHINES
      : userData.tipo === "administracao"
        ? GROUP_MACHINES
        : [];
    assertMachineAllowed(machineId, allowedMachines);

    const [[machine]] = await connection.execute(
      `SELECT maquina_id
         FROM automacao_maquinas
        WHERE maquina_id = ?
          AND habilitada = TRUE
          AND estado <> 'disabled'
        LIMIT 1
        FOR UPDATE`,
      [machineId]
    );
    if (!machine) {
      throw httpError("Máquina inexistente ou desabilitada.", 409, "MACHINE_UNAVAILABLE");
    }

    const [pendingTasks] = await connection.execute(
      `SELECT id
         FROM fila_automacao
        WHERE maquina_destino = ?
          AND status = 'pendente'
        ORDER BY data_solicitacao ASC, id ASC
        FOR UPDATE`,
      [machineId]
    );
    const [[processing]] = await connection.execute(
      `SELECT COUNT(*) AS total
         FROM fila_automacao
        WHERE maquina_destino = ?
          AND status = 'executando'`,
      [machineId]
    );
    const taskIds = pendingTasks.map(({ id }) => Number(id)).filter(Number.isInteger);

    if (taskIds.length) {
      const placeholders = taskIds.map(() => "?").join(", ");
      await connection.execute(
        `UPDATE automacao_entregas
            SET status = 'cancelado',
                retentavel = FALSE,
                erro_codigo = 'CANCELLED',
                erro_mensagem = ?,
                concluido_em = NOW(),
                lock_owner = NULL,
                lock_adquirido_em = NULL
          WHERE fila_automacao_id IN (${placeholders})
            AND (
              status = 'pendente'
              OR (status = 'erro' AND retentavel = TRUE)
            )`,
        [publicErrorMessage("CANCELLED"), ...taskIds]
      );
      await connection.execute(
        `UPDATE fila_automacao
            SET status = 'cancelado',
                concluido_em = NOW(),
                erro = 'QUEUE_CLEARED',
                lock_owner = NULL,
                lock_adquirido_em = NULL
          WHERE id IN (${placeholders})
            AND status = 'pendente'`,
        taskIds
      );
      for (const taskId of taskIds) {
        await updateTaskCounters(connection, taskId);
        await recordEvent(connection, taskId, "TASK_REMOVED_FROM_QUEUE", {
          status: "cancelado",
          errorCode: "QUEUE_CLEARED",
        });
      }
    }

    const [[clock]] = await connection.execute("SELECT NOW(3) AS executado_em");
    await connection.commit();
    transaction = false;
    return {
      machineId: `machine-${machineId}`,
      machineNumber: machineId,
      removedTasks: taskIds.length,
      preservedProcessingTasks: Number(processing.total || 0),
      executedAt: clock.executado_em,
    };
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
  clearMachineQueue,
  createAttendanceTask,
  createGroupTask,
  getTask,
  ensurePersonalizedTemplate,
  listMachines,
  listQueues,
  listTasks,
  machineState,
  duplicateBlockCode,
  publicDeliveryStatus,
  recordEvent,
  updateTaskCounters,
};
