const db = require("../database/db");

const STATUS_ENTREGA = new Set(["enviado", "erro", "ignorado"]);
const WORKER_ID_PATTERN = /^[a-zA-Z0-9._:-]{3,80}$/;

function inteiroEnv(nome, padrao, minimo, maximo) {
  const valor = Number(process.env[nome] || padrao);
  if (!Number.isInteger(valor)) return padrao;
  return Math.max(minimo, Math.min(maximo, valor));
}

function configuracao() {
  return {
    maxTentativas: inteiroEnv("AUTOMATION_DELIVERY_MAX_ATTEMPTS", 3, 1, 5),
    leaseSeconds: inteiroEnv("AUTOMATION_DELIVERY_LEASE_SECONDS", 300, 60, 1800),
    batchSize: inteiroEnv("AUTOMATION_DELIVERY_BATCH_SIZE", 25, 1, 100),
    countryCode: String(process.env.AUTOMATION_DEFAULT_COUNTRY_CODE || "55").replace(/\D/g, "") || "55",
  };
}

function validarWorkerId(valor) {
  const workerId = String(valor || "").trim();
  if (!WORKER_ID_PATTERN.test(workerId)) {
    const error = new Error("Identificador do worker inválido.");
    error.status = 400;
    throw error;
  }
  return workerId;
}

function parsePayload(valor) {
  if (!valor) return {};
  if (typeof valor === "object") return valor;
  try {
    const parsed = JSON.parse(valor);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function dataReferenciaTarefa(tarefa) {
  const payload = parsePayload(tarefa.payload);
  const data = String(payload.data || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null;
}

function normalizarTelefone(valor, countryCode) {
  let digits = String(valor || "").replace(/\D/g, "");
  if (!digits) return "";
  digits = digits.replace(/^0+/, "");
  if (!digits.startsWith(countryCode)) digits = `${countryCode}${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : "";
}

function renderizarMensagem(modelo, dados) {
  return String(modelo || "")
    .replaceAll("{nome_responsavel}", String(dados.nomeResponsavel || "").trim())
    .replaceAll("{nome_aluno}", String(dados.nomeAluno || "").trim())
    .replaceAll("{data}", String(dados.data || "").split("-").reverse().join("/"))
    .trim();
}

function lockOwner(maquinaId, workerId) {
  return `maquina-${maquinaId}:${workerId}`.slice(0, 100);
}

async function prepararEntregasFaltas(connection, tarefa, dataReferencia) {
  await connection.execute(
    `
    INSERT IGNORE INTO automacao_entregas (
      fila_automacao_id,
      chave_idempotencia,
      tipo_destino,
      aluno_id,
      frequencia_aluno_id,
      responsavel_id,
      data_referencia,
      status
    )
    SELECT
      ?,
      CONCAT('falta:', ?, ':', rfa.aluno_id),
      'responsavel',
      rfa.aluno_id,
      MIN(rfa.id),
      r.id,
      ?,
      'pendente'
    FROM registros_frequencia_alunos rfa
    INNER JOIN alunos a
      ON a.id = rfa.aluno_id
     AND a.ativo = TRUE
    INNER JOIN responsaveis r
      ON r.id = (
        SELECT r2.id
        FROM responsaveis r2
        WHERE r2.aluno_id = rfa.aluno_id
          AND r2.ativo = TRUE
        ORDER BY r2.id ASC
        LIMIT 1
      )
    WHERE rfa.data_chamada = ?
      AND LOWER(COALESCE(rfa.status, '')) = 'ausente'
      AND COALESCE(rfa.atrasado, FALSE) = FALSE
    GROUP BY rfa.aluno_id, r.id
    `,
    [tarefa.id, dataReferencia, dataReferencia, dataReferencia]
  );
}

async function prepararEntregaGrupo(connection, tarefa) {
  const payload = parsePayload(tarefa.payload);
  const grupoId = Number(payload.grupo_whatsapp_id);
  if (!Number.isInteger(grupoId) || grupoId <= 0) {
    const error = new Error("Tarefa de grupo sem identificador válido.");
    error.code = "GRUPO_INVALIDO";
    throw error;
  }

  const [[grupo]] = await connection.execute(
    "SELECT id FROM grupos_whatsapp WHERE id = ? AND ativo = TRUE LIMIT 1",
    [grupoId]
  );
  if (!grupo) {
    const error = new Error("Grupo do WhatsApp não está ativo ou não existe.");
    error.code = "GRUPO_INDISPONIVEL";
    throw error;
  }

  await connection.execute(
    `
    INSERT IGNORE INTO automacao_entregas (
      fila_automacao_id,
      chave_idempotencia,
      tipo_destino,
      grupo_whatsapp_id,
      status
    )
    VALUES (?, ?, 'grupo', ?, 'pendente')
    `,
    [tarefa.id, `grupo:${tarefa.id}:${grupoId}`, grupoId]
  );
}

async function prepararEntregas(connection, tarefa) {
  if (tarefa.tipo_automacao === "mensagem_grupo") {
    await prepararEntregaGrupo(connection, tarefa);
    return;
  }

  const dataReferencia = dataReferenciaTarefa(tarefa);
  if (!dataReferencia) {
    const error = new Error("Tarefa de faltas sem data de referência válida.");
    error.code = "DATA_REFERENCIA_INVALIDA";
    throw error;
  }
  await prepararEntregasFaltas(connection, tarefa, dataReferencia);
}

async function ignorarEntregasDesatualizadas(connection, tarefaId) {
  await connection.execute(
    `
    UPDATE automacao_entregas ae
    SET ae.status = 'ignorado',
        ae.concluido_em = NOW(),
        ae.lock_owner = NULL,
        ae.lock_adquirido_em = NULL,
        ae.erro_codigo = 'FALTA_NAO_ELEGIVEL'
    WHERE ae.fila_automacao_id = ?
      AND ae.tipo_destino = 'responsavel'
      AND ae.status IN ('pendente', 'erro')
      AND NOT EXISTS (
        SELECT 1
        FROM registros_frequencia_alunos rfa
        WHERE rfa.aluno_id = ae.aluno_id
          AND rfa.data_chamada = ae.data_referencia
          AND LOWER(COALESCE(rfa.status, '')) = 'ausente'
          AND COALESCE(rfa.atrasado, FALSE) = FALSE
      )
    `,
    [tarefaId]
  );
}

async function reservarLote(connection, tarefaId, owner, cfg) {
  await connection.execute(
    `
    UPDATE automacao_entregas
    SET status = 'erro',
        lock_owner = NULL,
        lock_adquirido_em = NULL,
        erro_codigo = COALESCE(erro_codigo, 'LEASE_EXPIRADO')
    WHERE fila_automacao_id = ?
      AND status = 'processando'
      AND lock_adquirido_em < TIMESTAMPADD(SECOND, -?, NOW())
    `,
    [tarefaId, cfg.leaseSeconds]
  );

  await ignorarEntregasDesatualizadas(connection, tarefaId);

  const [candidatas] = await connection.execute(
    `
    SELECT id
    FROM automacao_entregas
    WHERE fila_automacao_id = ?
      AND (
        status = 'pendente'
        OR (status = 'erro' AND tentativas < ?)
      )
    ORDER BY id ASC
    LIMIT ?
    FOR UPDATE SKIP LOCKED
    `,
    [tarefaId, cfg.maxTentativas, cfg.batchSize]
  );

  const ids = candidatas.map((row) => Number(row.id)).filter(Number.isInteger);
  if (!ids.length) return [];

  const placeholders = ids.map(() => "?").join(", ");
  await connection.execute(
    `
    UPDATE automacao_entregas
    SET status = 'processando',
        tentativas = tentativas + 1,
        lock_owner = ?,
        lock_adquirido_em = NOW(),
        iniciado_em = COALESCE(iniciado_em, NOW()),
        erro_codigo = NULL
    WHERE id IN (${placeholders})
    `,
    [owner, ...ids]
  );
  return ids;
}

async function montarEntregas(connection, tarefa, ids, cfg) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await connection.execute(
    `
    SELECT
      ae.id,
      ae.tipo_destino,
      ae.aluno_id,
      ae.responsavel_id,
      ae.grupo_whatsapp_id,
      ae.data_referencia,
      ae.tentativas,
      a.nome AS aluno_nome,
      r.nome AS responsavel_nome,
      r.contato AS responsavel_contato,
      g.nome_grupo
    FROM automacao_entregas ae
    LEFT JOIN alunos a ON a.id = ae.aluno_id AND a.ativo = TRUE
    LEFT JOIN responsaveis r ON r.id = ae.responsavel_id AND r.ativo = TRUE
    LEFT JOIN grupos_whatsapp g ON g.id = ae.grupo_whatsapp_id AND g.ativo = TRUE
    WHERE ae.id IN (${placeholders})
    ORDER BY ae.id ASC
    `,
    ids
  );

  const payload = parsePayload(tarefa.payload);
  const entregas = [];
  for (const row of rows) {
    if (row.tipo_destino === "grupo") {
      const nomeGrupo = String(row.nome_grupo || payload.nome_grupo_whatsapp || "").trim();
      const mensagem = String(tarefa.mensagem || "").trim();
      if (!nomeGrupo || !mensagem) {
        await connection.execute(
          "UPDATE automacao_entregas SET status = 'ignorado', concluido_em = NOW(), lock_owner = NULL, lock_adquirido_em = NULL, erro_codigo = 'GRUPO_SEM_DADOS' WHERE id = ?",
          [row.id]
        );
        continue;
      }
      entregas.push({
        id: Number(row.id),
        canal: "grupo",
        nome_grupo: nomeGrupo,
        nome_grupo_busca: String(payload.nome_grupo_whatsapp_busca || "").trim(),
        mensagem,
        tentativa: Number(row.tentativas),
      });
      continue;
    }

    const telefone = normalizarTelefone(row.responsavel_contato, cfg.countryCode);
    const mensagem = renderizarMensagem(tarefa.mensagem, {
      nomeResponsavel: row.responsavel_nome,
      nomeAluno: row.aluno_nome,
      data: row.data_referencia,
    });
    if (!telefone || !mensagem || !row.aluno_nome || !row.responsavel_nome) {
      await connection.execute(
        "UPDATE automacao_entregas SET status = 'ignorado', concluido_em = NOW(), lock_owner = NULL, lock_adquirido_em = NULL, erro_codigo = 'DESTINATARIO_INVALIDO' WHERE id = ?",
        [row.id]
      );
      continue;
    }
    entregas.push({
      id: Number(row.id),
      canal: "responsavel",
      telefone,
      mensagem,
      tentativa: Number(row.tentativas),
    });
  }
  return entregas;
}

async function resumoEntregas(connection, tarefaId, cfg) {
  const [[row]] = await connection.execute(
    `
    SELECT
      COUNT(*) AS total,
      SUM(status = 'processando') AS processando,
      SUM(status = 'pendente') AS pendentes,
      SUM(status = 'erro' AND tentativas < ?) AS retentativas,
      SUM(status = 'erro' AND tentativas >= ?) AS falhas_finais,
      SUM(status = 'enviado') AS enviados,
      SUM(status = 'ignorado') AS ignorados
    FROM automacao_entregas
    WHERE fila_automacao_id = ?
    `,
    [cfg.maxTentativas, cfg.maxTentativas, tarefaId]
  );
  return {
    total: Number(row?.total || 0),
    processando: Number(row?.processando || 0),
    pendentes: Number(row?.pendentes || 0),
    retentativas: Number(row?.retentativas || 0),
    falhasFinais: Number(row?.falhas_finais || 0),
    enviados: Number(row?.enviados || 0),
    ignorados: Number(row?.ignorados || 0),
  };
}

async function finalizarTarefaSePossivel(connection, tarefaId, cfg) {
  const resumo = await resumoEntregas(connection, tarefaId, cfg);
  const ativas = resumo.processando + resumo.pendentes + resumo.retentativas;
  if (ativas > 0) return { status: "executando", resumo };

  if (resumo.falhasFinais > 0) {
    await connection.execute(
      `
      UPDATE fila_automacao
      SET status = 'erro',
          erro = 'Uma ou mais mensagens atingiram o limite seguro de tentativas.',
          concluido_em = NOW(),
          lock_owner = NULL,
          lock_adquirido_em = NULL
      WHERE id = ?
      `,
      [tarefaId]
    );
    return { status: "erro", resumo };
  }

  await connection.execute(
    `
    UPDATE fila_automacao
    SET status = 'concluido',
        erro = NULL,
        concluido_em = NOW(),
        lock_owner = NULL,
        lock_adquirido_em = NULL
    WHERE id = ?
    `,
    [tarefaId]
  );
  return { status: "concluido", resumo };
}

async function capturarTarefa({ maquinaId, workerId }) {
  const cfg = configuracao();
  const worker = validarWorkerId(workerId);
  const owner = lockOwner(maquinaId, worker);
  const connection = await db.getConnection();
  let transacao = false;

  try {
    await connection.beginTransaction();
    transacao = true;

    const [tarefas] = await connection.execute(
      `
      SELECT id, tipo_automacao, maquina_destino, mensagem, payload, status, lock_owner
      FROM fila_automacao
      WHERE maquina_destino = ?
        AND (
          status = 'pendente'
          OR (
            status = 'executando'
            AND (
              lock_owner = ?
              OR lock_adquirido_em < TIMESTAMPADD(SECOND, -?, NOW())
            )
          )
        )
      ORDER BY (status = 'executando') DESC, data_solicitacao ASC, id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
      `,
      [maquinaId, owner, cfg.leaseSeconds]
    );

    const tarefa = tarefas[0];
    if (!tarefa) {
      await connection.commit();
      transacao = false;
      return null;
    }

    await connection.execute(
      `
      UPDATE fila_automacao
      SET status = 'executando',
          lock_owner = ?,
          lock_adquirido_em = NOW(),
          iniciado_em = COALESCE(iniciado_em, NOW()),
          tentativas = tentativas + IF(status = 'pendente', 1, 0),
          erro = NULL
      WHERE id = ?
      `,
      [owner, tarefa.id]
    );

    try {
      await prepararEntregas(connection, tarefa);
    } catch (error) {
      await connection.execute(
        `
        UPDATE fila_automacao
        SET status = 'erro',
            erro = ?,
            concluido_em = NOW(),
            lock_owner = NULL,
            lock_adquirido_em = NULL
        WHERE id = ?
        `,
        [String(error.code || "TAREFA_INVALIDA").slice(0, 80), tarefa.id]
      );
      await connection.commit();
      transacao = false;
      return {
        id: Number(tarefa.id),
        tipo: tarefa.tipo_automacao,
        status: "erro",
        entregas: [],
      };
    }

    const ids = await reservarLote(connection, tarefa.id, owner, cfg);
    const entregas = await montarEntregas(connection, tarefa, ids, cfg);
    const finalizacao = await finalizarTarefaSePossivel(connection, tarefa.id, cfg);

    await connection.commit();
    transacao = false;
    return {
      id: Number(tarefa.id),
      tipo: tarefa.tipo_automacao,
      status: entregas.length ? "executando" : finalizacao.status,
      entregas,
      resumo: finalizacao.resumo,
    };
  } catch (error) {
    if (transacao) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function registrarResultado({ maquinaId, workerId, entregaId, status, erroCodigo }) {
  const cfg = configuracao();
  const worker = validarWorkerId(workerId);
  const owner = lockOwner(maquinaId, worker);
  const id = Number(entregaId);
  if (!Number.isInteger(id) || id <= 0 || !STATUS_ENTREGA.has(status)) {
    const error = new Error("Resultado de entrega inválido.");
    error.status = 400;
    throw error;
  }

  const connection = await db.getConnection();
  let transacao = false;
  try {
    await connection.beginTransaction();
    transacao = true;
    const [rows] = await connection.execute(
      `
      SELECT ae.id, ae.status, ae.fila_automacao_id
      FROM automacao_entregas ae
      INNER JOIN fila_automacao fa ON fa.id = ae.fila_automacao_id
      WHERE ae.id = ?
        AND fa.maquina_destino = ?
      LIMIT 1
      FOR UPDATE
      `,
      [id, maquinaId]
    );
    const entrega = rows[0];
    if (!entrega) {
      const error = new Error("Entrega não encontrada para esta máquina.");
      error.status = 404;
      throw error;
    }

    if (["enviado", "ignorado"].includes(entrega.status)) {
      const finalizacao = await finalizarTarefaSePossivel(connection, entrega.fila_automacao_id, cfg);
      await connection.commit();
      transacao = false;
      return { entregaStatus: entrega.status, tarefaStatus: finalizacao.status, resumo: finalizacao.resumo };
    }

    const proximoStatus = status === "enviado" ? "enviado" : status === "ignorado" ? "ignorado" : "erro";
    const codigoSeguro = String(erroCodigo || (proximoStatus === "erro" ? "FALHA_ENVIO" : ""))
      .replace(/[^A-Z0-9_.-]/gi, "_")
      .slice(0, 80) || null;

    const [resultado] = await connection.execute(
      `
      UPDATE automacao_entregas
      SET status = ?,
          erro_codigo = ?,
          concluido_em = IF(? IN ('enviado', 'ignorado'), NOW(), NULL),
          lock_owner = NULL,
          lock_adquirido_em = NULL
      WHERE id = ?
        AND status = 'processando'
        AND lock_owner = ?
      `,
      [proximoStatus, codigoSeguro, proximoStatus, id, owner]
    );
    if (resultado.affectedRows !== 1) {
      const error = new Error("A entrega não está reservada por este worker.");
      error.status = 409;
      throw error;
    }

    const finalizacao = await finalizarTarefaSePossivel(connection, entrega.fila_automacao_id, cfg);
    await connection.commit();
    transacao = false;
    return { entregaStatus: proximoStatus, tarefaStatus: finalizacao.status, resumo: finalizacao.resumo };
  } catch (error) {
    if (transacao) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  capturarTarefa,
  registrarResultado,
  validarWorkerId,
  normalizarTelefone,
  renderizarMensagem,
  parsePayload,
  configuracao,
};
