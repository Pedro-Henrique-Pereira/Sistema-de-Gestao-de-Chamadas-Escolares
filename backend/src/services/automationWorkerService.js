const db = require("../database/db");
const {
  compareVersions,
  maskPhone,
  normalizePhone,
  publicErrorMessage,
  renderAttendanceMessage,
  safeErrorCode,
} = require("./automationDomain");
const {
  recordEvent,
  updateTaskCounters,
} = require("./automationTaskService");

const DELIVERY_RESULTS = new Set(["enviado", "erro", "ignorado"]);
const MACHINE_STATES = new Set([
  "online_available",
  "online_busy",
  "online_error",
  "updating",
]);
const TEMPORARY_ERROR_CODES = new Set([
  "TEMPORARY_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "WHATSAPP_UNAVAILABLE",
  "WEBDRIVER_ERROR",
  "LEASE_EXPIRED",
]);
const WORKER_ID_PATTERN = /^[a-zA-Z0-9._:-]{3,80}$/;

function integerEnv(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function configuracao() {
  return {
    maxTentativas: integerEnv("AUTOMATION_DELIVERY_MAX_ATTEMPTS", 3, 1, 5),
    leaseSeconds: integerEnv("AUTOMATION_DELIVERY_LEASE_SECONDS", 300, 60, 1800),
    batchSize: integerEnv("AUTOMATION_DELIVERY_BATCH_SIZE", 25, 1, 100),
    heartbeatTimeoutSeconds: integerEnv("AUTOMATION_HEARTBEAT_TIMEOUT_SECONDS", 60, 30, 300),
    countryCode: String(process.env.AUTOMATION_DEFAULT_COUNTRY_CODE || "55").replace(/\D/g, "") || "55",
  };
}

function validarWorkerId(value) {
  const workerId = String(value || "").trim();
  if (!WORKER_ID_PATTERN.test(workerId)) {
    const error = new Error("Identificador do worker inválido.");
    error.status = 400;
    error.code = "INVALID_WORKER";
    throw error;
  }
  return workerId;
}

function validarVersao(value) {
  const version = String(value || "").trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) {
    const error = new Error("Versão do aplicativo inválida.");
    error.status = 400;
    error.code = "INVALID_APP_VERSION";
    throw error;
  }
  return version;
}

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function lockOwner(machineId, workerId) {
  return `machine-${machineId}:${workerId}`.slice(0, 100);
}

async function prepareLegacyAttendanceDeliveries(connection, task, cfg) {
  const payload = parsePayload(task.payload);
  const date = String(payload.data || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error("Tarefa legada sem data válida.");
    error.code = "INVALID_REFERENCE_DATE";
    throw error;
  }
  const [rows] = await connection.execute(
    `SELECT
       MIN(f.id) AS frequencia_id,
       f.aluno_id,
       MAX(f.aluno_nome) AS aluno_nome,
       r.id AS responsavel_id,
       r.nome AS responsavel_nome,
       r.contato AS responsavel_contato
     FROM registros_frequencia_alunos f
     INNER JOIN responsaveis r
       ON r.id = (
         SELECT r2.id
           FROM responsaveis r2
          WHERE r2.aluno_id = f.aluno_id
            AND r2.ativo = TRUE
          ORDER BY r2.id ASC
          LIMIT 1
       )
     WHERE f.data_chamada = ?
       AND LOWER(COALESCE(f.status, '')) = 'ausente'
       AND COALESCE(f.atrasado, FALSE) = FALSE
     GROUP BY f.aluno_id, r.id, r.nome, r.contato
     ORDER BY MIN(f.id) ASC`,
    [date]
  );
  for (const row of rows) {
    const phone = normalizePhone(row.responsavel_contato, cfg.countryCode);
    const code = phone ? null : "INVALID_PHONE";
    await connection.execute(
      `INSERT IGNORE INTO automacao_entregas (
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
        task.id,
        `legacy-attendance:${date}:${row.aluno_id}`,
        row.responsavel_nome,
        row.aluno_id,
        row.aluno_nome,
        row.frequencia_id,
        row.responsavel_id,
        date,
        phone || null,
        maskPhone(phone || row.responsavel_contato),
        renderAttendanceMessage(task.mensagem, {
          guardianName: row.responsavel_nome,
          studentName: row.aluno_nome,
          absenceDate: date,
        }),
        code ? "erro" : "pendente",
        !code,
        code,
        code ? publicErrorMessage(code) : null,
        code ? new Date() : null,
      ]
    );
  }
}

async function prepareLegacyGroupDelivery(connection, task) {
  const payload = parsePayload(task.payload);
  const groupId = Number(payload.grupo_whatsapp_id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    const error = new Error("Tarefa legada de grupo inválida.");
    error.code = "INVALID_GROUP";
    throw error;
  }
  const [[group]] = await connection.execute(
    "SELECT id, nome_grupo FROM grupos_whatsapp WHERE id = ? AND ativo = TRUE LIMIT 1",
    [groupId]
  );
  if (!group) {
    const error = new Error("Grupo legado indisponível.");
    error.code = "GROUP_NOT_FOUND";
    throw error;
  }
  await connection.execute(
    `INSERT IGNORE INTO automacao_entregas (
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
      task.id,
      `legacy-group:${task.id}:${groupId}`,
      group.nome_grupo,
      groupId,
      group.nome_grupo,
      String(task.mensagem || "").trim(),
    ]
  );
}

async function prepareLegacyDeliveries(connection, task, cfg) {
  const [[count]] = await connection.execute(
    "SELECT COUNT(*) AS total FROM automacao_entregas WHERE fila_automacao_id = ?",
    [task.id]
  );
  if (Number(count.total) > 0 || Number(task.versao_api || 1) >= 2) return;
  if (task.tipo_automacao === "mensagem_grupo") {
    await prepareLegacyGroupDelivery(connection, task);
  } else {
    await prepareLegacyAttendanceDeliveries(connection, task, cfg);
  }
  await updateTaskCounters(connection, task.id);
  await recordEvent(connection, task.id, "LEGACY_TASK_MATERIALIZED", { status: "pendente" });
}

async function invalidateChangedAttendance(connection, taskId) {
  await connection.execute(
    `UPDATE automacao_entregas delivery
        LEFT JOIN registros_frequencia_alunos frequency
          ON frequency.id = delivery.frequencia_aluno_id
       SET delivery.status = 'ignorado',
           delivery.retentavel = FALSE,
           delivery.erro_codigo = 'ATTENDANCE_NOT_ELIGIBLE',
           delivery.erro_mensagem = ?,
           delivery.concluido_em = NOW(),
           delivery.lock_owner = NULL,
           delivery.lock_adquirido_em = NULL
     WHERE delivery.fila_automacao_id = ?
       AND delivery.tipo_destino = 'responsavel'
       AND delivery.status IN ('pendente', 'erro')
       AND (
         frequency.id IS NULL
         OR LOWER(COALESCE(frequency.status, '')) <> 'ausente'
         OR COALESCE(frequency.atrasado, FALSE) = TRUE
       )`,
    [publicErrorMessage("ATTENDANCE_NOT_ELIGIBLE"), taskId]
  );
}

async function reserveBatch(connection, taskId, owner, cfg) {
  await connection.execute(
    `UPDATE automacao_entregas
        SET status = 'erro',
            retentavel = TRUE,
            lock_owner = NULL,
            lock_adquirido_em = NULL,
            erro_codigo = 'LEASE_EXPIRED',
            erro_mensagem = ?
      WHERE fila_automacao_id = ?
        AND status = 'processando'
        AND lock_adquirido_em < TIMESTAMPADD(SECOND, -?, NOW())`,
    [publicErrorMessage("LEASE_EXPIRED"), taskId, cfg.leaseSeconds]
  );
  await invalidateChangedAttendance(connection, taskId);

  const [candidates] = await connection.execute(
    `SELECT id
       FROM automacao_entregas
      WHERE fila_automacao_id = ?
        AND (
          status = 'pendente'
          OR (
            status = 'erro'
            AND retentavel = TRUE
            AND tentativas < ?
          )
        )
      ORDER BY id ASC
      LIMIT ?
      FOR UPDATE SKIP LOCKED`,
    [taskId, cfg.maxTentativas, cfg.batchSize]
  );
  const ids = candidates.map(({ id }) => Number(id)).filter(Number.isInteger);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  await connection.execute(
    `UPDATE automacao_entregas
        SET status = 'processando',
            tentativas = tentativas + 1,
            lock_owner = ?,
            lock_adquirido_em = NOW(),
            iniciado_em = COALESCE(iniciado_em, NOW()),
            erro_codigo = NULL,
            erro_mensagem = NULL
      WHERE id IN (${placeholders})`,
    [owner, ...ids]
  );
  return ids;
}

async function existingBatchForOwner(connection, taskId, owner) {
  const [rows] = await connection.execute(
    `SELECT id
       FROM automacao_entregas
      WHERE fila_automacao_id = ?
        AND status = 'processando'
        AND lock_owner = ?
      ORDER BY id ASC
      FOR UPDATE`,
    [taskId, owner]
  );
  const ids = rows.map(({ id }) => Number(id)).filter(Number.isInteger);
  if (ids.length) {
    await connection.execute(
      `UPDATE automacao_entregas
          SET lock_adquirido_em = NOW()
        WHERE fila_automacao_id = ?
          AND status = 'processando'
          AND lock_owner = ?`,
      [taskId, owner]
    );
  }
  return ids;
}

async function buildDeliveries(connection, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await connection.execute(
    `SELECT
       id,
       tipo_destino,
       telefone_destino,
       grupo_nome,
       mensagem,
       tentativas
     FROM automacao_entregas
     WHERE id IN (${placeholders})
     ORDER BY id ASC`,
    ids
  );
  return rows.map((row) => ({
    id: Number(row.id),
    canal: row.tipo_destino === "grupo" ? "grupo" : "responsavel",
    telefone: row.tipo_destino === "responsavel" ? row.telefone_destino : undefined,
    nome_grupo: row.tipo_destino === "grupo" ? row.grupo_nome : undefined,
    mensagem: row.mensagem,
    tentativa: Number(row.tentativas),
  }));
}

async function deliverySummary(connection, taskId, cfg) {
  const [[row]] = await connection.execute(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'processando') AS processando,
       SUM(status = 'pendente') AS pendentes,
       SUM(status = 'erro' AND retentavel = TRUE AND tentativas < ?) AS retentativas,
       SUM(
         status IN ('ignorado', 'cancelado')
         OR (status = 'erro' AND (retentavel = FALSE OR tentativas >= ?))
       ) AS falhas_finais,
       SUM(status = 'enviado') AS enviados
     FROM automacao_entregas
     WHERE fila_automacao_id = ?`,
    [cfg.maxTentativas, cfg.maxTentativas, taskId]
  );
  return {
    total: Number(row?.total || 0),
    processing: Number(row?.processando || 0),
    pending: Number(row?.pendentes || 0),
    retries: Number(row?.retentativas || 0),
    failures: Number(row?.falhas_finais || 0),
    sent: Number(row?.enviados || 0),
  };
}

async function finalizeTaskIfPossible(connection, taskId, machineId, cfg) {
  const summary = await deliverySummary(connection, taskId, cfg);
  const active = summary.processing + summary.pending + summary.retries;
  if (active > 0) {
    await connection.execute(
      `UPDATE fila_automacao
          SET total_destinatarios = ?,
              total_sucessos = ?,
              total_falhas = ?
        WHERE id = ?`,
      [summary.total, summary.sent, summary.failures, taskId]
    );
    return { status: "executando", summary };
  }

  let status = "erro";
  if (summary.total > 0 && summary.sent === summary.total) status = "concluido";
  else if (summary.sent > 0) status = "concluido_parcial";

  await connection.execute(
    `UPDATE fila_automacao
        SET status = ?,
            total_destinatarios = ?,
            total_sucessos = ?,
            total_falhas = ?,
            identificador_externo = COALESCE(
              identificador_externo,
              (
                SELECT MIN(delivery.identificador_externo)
                FROM automacao_entregas delivery
                WHERE delivery.fila_automacao_id = fila_automacao.id
                  AND delivery.identificador_externo IS NOT NULL
              )
            ),
            concluido_em = NOW(),
            erro = ?,
            lock_owner = NULL,
            lock_adquirido_em = NULL
      WHERE id = ?`,
    [
      status,
      summary.total,
      summary.sent,
      summary.failures,
      status === "erro" ? "DELIVERIES_FAILED" : null,
      taskId,
    ]
  );
  await connection.execute(
    `UPDATE automacao_maquinas
        SET tarefa_atual_id = NULL,
            estado = 'online_available',
            ultimo_erro_codigo = ?
      WHERE maquina_id = ?
        AND tarefa_atual_id = ?`,
    [status === "erro" ? "DELIVERIES_FAILED" : null, machineId, taskId]
  );
  await recordEvent(connection, taskId, "TASK_FINISHED", { status });
  return { status, summary };
}

async function getMachineForUpdate(connection, machineId) {
  const [rows] = await connection.execute(
    `SELECT *
       FROM automacao_maquinas
      WHERE maquina_id = ?
      LIMIT 1
      FOR UPDATE`,
    [machineId]
  );
  const machine = rows[0];
  if (!machine || !machine.habilitada || machine.estado === "disabled") {
    const error = new Error("Máquina inexistente ou desabilitada.");
    error.status = 403;
    error.code = "MACHINE_DISABLED";
    throw error;
  }
  return machine;
}

async function chooseTask(connection, machine, owner, cfg) {
  if (machine.tarefa_atual_id) {
    const [currentRows] = await connection.execute(
      `SELECT *
         FROM fila_automacao
        WHERE id = ?
          AND maquina_destino = ?
          AND status IN ('pendente', 'executando')
        LIMIT 1
        FOR UPDATE`,
      [machine.tarefa_atual_id, machine.maquina_id]
    );
    const current = currentRows[0];
    if (current) {
      const leasedByOther = current.status === "executando"
        && current.lock_owner
        && current.lock_owner !== owner
        && current.lock_adquirido_em
        && Date.now() - new Date(current.lock_adquirido_em).getTime() < cfg.leaseSeconds * 1000;
      return leasedByOther ? null : current;
    }
    await connection.execute(
      "UPDATE automacao_maquinas SET tarefa_atual_id = NULL WHERE maquina_id = ?",
      [machine.maquina_id]
    );
  }

  const [rows] = await connection.execute(
    `SELECT *
       FROM fila_automacao
      WHERE maquina_destino = ?
        AND (
          status = 'pendente'
          OR (
            status = 'executando'
            AND lock_adquirido_em < TIMESTAMPADD(SECOND, -?, NOW())
          )
        )
      ORDER BY
        CASE WHEN status = 'executando' THEN 0 ELSE 1 END,
        data_solicitacao ASC,
        id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    [machine.maquina_id, cfg.leaseSeconds]
  );
  return rows[0] || null;
}

async function capturarTarefa({ maquinaId, workerId }) {
  const cfg = configuracao();
  const worker = validarWorkerId(workerId);
  const owner = lockOwner(maquinaId, worker);
  const connection = await db.getConnection();
  let transaction = false;
  try {
    await connection.beginTransaction();
    transaction = true;
    const machine = await getMachineForUpdate(connection, maquinaId);
    const task = await chooseTask(connection, machine, owner, cfg);
    if (!task) {
      await connection.commit();
      transaction = false;
      return null;
    }

    await connection.execute(
      `UPDATE automacao_maquinas
          SET tarefa_atual_id = ?,
              estado = 'online_busy',
              worker_id = ?,
              ultima_comunicacao_em = NOW(),
              ultimo_erro_codigo = NULL
        WHERE maquina_id = ?`,
      [task.id, worker, maquinaId]
    );
    await connection.execute(
      `UPDATE fila_automacao
          SET status = 'executando',
              lock_owner = ?,
              lock_adquirido_em = NOW(),
              iniciado_em = COALESCE(iniciado_em, NOW()),
              tentativas = tentativas + IF(status = 'pendente', 1, 0),
              erro = NULL
        WHERE id = ?`,
      [owner, task.id]
    );

    try {
      await prepareLegacyDeliveries(connection, task, cfg);
    } catch (error) {
      await connection.execute(
        `UPDATE fila_automacao
            SET status = 'erro',
                erro = ?,
                concluido_em = NOW(),
                lock_owner = NULL,
                lock_adquirido_em = NULL
          WHERE id = ?`,
        [safeErrorCode(error.code, "INVALID_LEGACY_TASK"), task.id]
      );
      await connection.execute(
        `UPDATE automacao_maquinas
            SET tarefa_atual_id = NULL,
                estado = 'online_error',
                ultimo_erro_codigo = ?
          WHERE maquina_id = ?`,
        [safeErrorCode(error.code, "INVALID_LEGACY_TASK"), maquinaId]
      );
      await recordEvent(connection, task.id, "TASK_REJECTED", {
        status: "erro",
        errorCode: safeErrorCode(error.code, "INVALID_LEGACY_TASK"),
      });
      await connection.commit();
      transaction = false;
      return {
        id: Number(task.id),
        api_version: Number(task.versao_api || 1),
        tipo: task.tipo_automacao,
        status: "erro",
        entregas: [],
      };
    }

    const existingIds = await existingBatchForOwner(connection, task.id, owner);
    const ids = existingIds.length
      ? existingIds
      : await reserveBatch(connection, task.id, owner, cfg);
    const deliveries = await buildDeliveries(connection, ids);
    const completion = await finalizeTaskIfPossible(connection, task.id, maquinaId, cfg);
    if (deliveries.length) {
      await recordEvent(connection, task.id, "TASK_CLAIMED", { status: "executando" });
    }
    await connection.commit();
    transaction = false;
    return {
      id: Number(task.id),
      api_version: Number(task.versao_api || 1),
      tipo: task.tipo_automacao,
      status: deliveries.length ? "executando" : completion.status,
      entregas: deliveries,
      resumo: completion.summary,
    };
  } catch (error) {
    if (transaction) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function registrarResultado({
  maquinaId,
  workerId,
  entregaId,
  status,
  erroCodigo,
  identificadorExterno,
}) {
  const cfg = configuracao();
  const worker = validarWorkerId(workerId);
  const owner = lockOwner(maquinaId, worker);
  const id = Number(entregaId);
  if (!Number.isInteger(id) || id <= 0 || !DELIVERY_RESULTS.has(status)) {
    const error = new Error("Resultado de entrega inválido.");
    error.status = 400;
    error.code = "INVALID_DELIVERY_RESULT";
    throw error;
  }
  const externalId = identificadorExterno
    ? String(identificadorExterno).replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 100)
    : null;
  const connection = await db.getConnection();
  let transaction = false;
  try {
    await connection.beginTransaction();
    transaction = true;
    await getMachineForUpdate(connection, maquinaId);
    const [rows] = await connection.execute(
      `SELECT delivery.id, delivery.status, delivery.fila_automacao_id
         FROM automacao_entregas delivery
         INNER JOIN fila_automacao task ON task.id = delivery.fila_automacao_id
        WHERE delivery.id = ?
          AND task.maquina_destino = ?
        LIMIT 1
        FOR UPDATE`,
      [id, maquinaId]
    );
    const delivery = rows[0];
    if (!delivery) {
      const error = new Error("Entrega não encontrada para esta máquina.");
      error.status = 404;
      error.code = "DELIVERY_NOT_FOUND";
      throw error;
    }
    if (["enviado", "ignorado", "cancelado"].includes(delivery.status)) {
      const completion = await finalizeTaskIfPossible(
        connection,
        delivery.fila_automacao_id,
        maquinaId,
        cfg
      );
      await connection.commit();
      transaction = false;
      return {
        entregaStatus: delivery.status,
        tarefaStatus: completion.status,
        resumo: completion.summary,
      };
    }

    const nextStatus = status === "enviado"
      ? "enviado"
      : status === "ignorado"
        ? "ignorado"
        : "erro";
    const code = nextStatus === "enviado"
      ? null
      : safeErrorCode(erroCodigo, nextStatus === "ignorado" ? "PERMANENT_ERROR" : "TEMPORARY_ERROR");
    const retryable = nextStatus === "erro" && TEMPORARY_ERROR_CODES.has(code);
    const [result] = await connection.execute(
      `UPDATE automacao_entregas
          SET status = ?,
              retentavel = ?,
              erro_codigo = ?,
              erro_mensagem = ?,
              identificador_externo = COALESCE(?, identificador_externo),
              concluido_em = IF(? = 'enviado' OR ? = FALSE OR ? = 'ignorado', NOW(), NULL),
              lock_owner = NULL,
              lock_adquirido_em = NULL
        WHERE id = ?
          AND status = 'processando'
          AND lock_owner = ?`,
      [
        nextStatus,
        retryable,
        code,
        code ? publicErrorMessage(code) : null,
        externalId,
        nextStatus,
        retryable,
        nextStatus,
        id,
        owner,
      ]
    );
    if (result.affectedRows !== 1) {
      const error = new Error("A entrega não está reservada por esta instância.");
      error.status = 409;
      error.code = "DELIVERY_LEASE_MISMATCH";
      throw error;
    }
    await recordEvent(connection, delivery.fila_automacao_id, "DELIVERY_RESULT", {
      deliveryId: id,
      status: nextStatus,
      errorCode: code,
    });
    const completion = await finalizeTaskIfPossible(
      connection,
      delivery.fila_automacao_id,
      maquinaId,
      cfg
    );
    await connection.commit();
    transaction = false;
    return {
      entregaStatus: nextStatus,
      tarefaStatus: completion.status,
      resumo: completion.summary,
    };
  } catch (error) {
    if (transaction) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function registrarHeartbeat({
  maquinaId,
  workerId,
  appVersion,
  state,
  currentTaskId = null,
  lastErrorCode = null,
}) {
  const worker = validarWorkerId(workerId);
  const owner = lockOwner(maquinaId, worker);
  const version = validarVersao(appVersion);
  const machineState = MACHINE_STATES.has(state) ? state : "online_available";
  const connection = await db.getConnection();
  let transaction = false;
  try {
    await connection.beginTransaction();
    transaction = true;
    const machine = await getMachineForUpdate(connection, maquinaId);
    if (compareVersions(version, machine.versao_minima) < 0) {
      const error = new Error(
        `Aplicativo incompatível. Atualize para a versão ${machine.versao_minima} ou superior.`
      );
      error.status = 409;
      error.code = "APP_VERSION_UNSUPPORTED";
      throw error;
    }
    const taskId = currentTaskId === null || currentTaskId === ""
      ? machine.tarefa_atual_id
      : Number(currentTaskId);
    if (taskId && (!Number.isInteger(Number(taskId)) || Number(taskId) <= 0)) {
      const error = new Error("Tarefa atual inválida.");
      error.status = 400;
      error.code = "INVALID_CURRENT_TASK";
      throw error;
    }
    if (
      machine.tarefa_atual_id
      && taskId
      && Number(machine.tarefa_atual_id) !== Number(taskId)
    ) {
      const error = new Error("A máquina não pode assumir uma tarefa diferente da reservada.");
      error.status = 409;
      error.code = "MACHINE_TASK_MISMATCH";
      throw error;
    }
    if (machine.tarefa_atual_id) {
      await connection.execute(
        `UPDATE fila_automacao
            SET lock_adquirido_em = NOW()
          WHERE id = ?
            AND maquina_destino = ?
            AND status = 'executando'
            AND lock_owner = ?`,
        [machine.tarefa_atual_id, maquinaId, owner]
      );
      await connection.execute(
        `UPDATE automacao_entregas
            SET lock_adquirido_em = NOW()
          WHERE fila_automacao_id = ?
            AND status = 'processando'
            AND lock_owner = ?`,
        [machine.tarefa_atual_id, owner]
      );
    }
    await connection.execute(
      `UPDATE automacao_maquinas
          SET estado = ?,
              ultima_comunicacao_em = NOW(),
              versao_aplicativo = ?,
              worker_id = ?,
              ultimo_erro_codigo = ?
        WHERE maquina_id = ?`,
      [
        machine.tarefa_atual_id ? "online_busy" : machineState,
        version,
        worker,
        lastErrorCode ? safeErrorCode(lastErrorCode) : null,
        maquinaId,
      ]
    );
    const [[queue]] = await connection.execute(
      `SELECT COUNT(*) AS total
         FROM fila_automacao
        WHERE maquina_destino = ?
          AND status = 'pendente'`,
      [maquinaId]
    );
    await connection.commit();
    transaction = false;
    return {
      machineId: `machine-${maquinaId}`,
      state: machine.tarefa_atual_id ? "online_busy" : machineState,
      currentTaskId: machine.tarefa_atual_id ? Number(machine.tarefa_atual_id) : null,
      queueDepth: Number(queue.total || 0),
      minimumVersion: machine.versao_minima,
      serverTime: new Date().toISOString(),
    };
  } catch (error) {
    if (transaction) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function obterSaude({ maquinaId }) {
  const [rows] = await db.execute(
    `SELECT maquina_id, identidade, habilitada, estado, versao_minima
       FROM automacao_maquinas
      WHERE maquina_id = ?
      LIMIT 1`,
    [maquinaId]
  );
  const machine = rows[0];
  if (!machine || !machine.habilitada) {
    const error = new Error("Máquina não cadastrada ou desabilitada.");
    error.status = 403;
    throw error;
  }
  return {
    status: "ok",
    maquina_id: Number(machine.maquina_id),
    machine_id: machine.identidade,
    minimum_version: machine.versao_minima,
  };
}

module.exports = {
  capturarTarefa,
  configuracao,
  existingBatchForOwner,
  normalizePhone,
  obterSaude,
  parsePayload,
  registrarHeartbeat,
  registrarResultado,
  renderizarMensagem: (template, data) => renderAttendanceMessage(template, {
    guardianName: data.nomeResponsavel,
    studentName: data.nomeAluno,
    absenceDate: data.data,
  }),
  validarWorkerId,
};
