const db = require("../database/db");
const { formatarNome } = require("../utils/formatadores");
const { garantirColunasAtraso, normalizarHorarioAtraso, normalizarDataHoraAtraso } = require("../utils/atrasoUtils");
const { dataBrasiliaISO, horarioBrasilia, dataHoraBrasiliaMySQL } = require("../utils/brasiliaTime");
const { garantirConfiguracao } = require("./configuracoesEscolaController");
const fluxoService = require("../services/chamadaFluxoService");
const chamadaService = require("../services/chamadaService");
const atrasoService = require("../services/atrasoService");
const dashboardService = require("../services/dashboardService");
const { registrarAuditoria } = require("../services/chamadaAuditoriaService");
const { contarTotaisFrequencia, condicoesFrequenciaSql } = require("../services/frequenciaMetricasService");
const { serializarStatusAutomacao } = require("../utils/publicDtos");

const FREQUENCIA_SQL = condicoesFrequenciaSql("f");

const MATERIA_PEDAGOGICA = "Chamada Pedagógica";
const MOTIVO_PADRAO_JUSTIFICATIVA = "Justificado em triagem pedagógica";
const MENSAGEM_WHATSAPP_PADRAO = "Prezado(a) {nome_responsavel}, informamos que o(a) estudante {nome_aluno} não compareceu à aula na data de hoje, {data}, e não identificamos uma justificativa para a sua ausência. Solicitamos, gentilmente, que entrem em contato conosco para informar o motivo do não comparecimento. Agradecemos a cooperação.";
const TAGS_MENSAGEM_WHATSAPP = ["{nome_responsavel}", "{nome_aluno}", "{data}"];

function auditarBloqueioHorario(error, req) {
  if (![fluxoService.MENSAGENS.HORARIO_ENCERRADO, fluxoService.MENSAGENS.ATRASO_FORA_DO_HORARIO].includes(error?.message)) return;
  registrarAuditoria(db, {
    chamadaId: Number(req.params.id),
    usuario: req.usuario,
    evento: "EDICAO_BLOQUEADA_POR_HORARIO",
    valoresNovos: { rota: req.originalUrl },
  }).catch(() => {});
}
function hojeLocalISO() {
  return dataBrasiliaISO();
}

function parseAlunos(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor;
  try {
    return JSON.parse(valor);
  } catch {
    return [];
  }
}

function normalizarTexto(valor = "") {
  return String(valor).trim().toLowerCase();
}

function obterAlunoId(aluno) {
  return Number(aluno.aluno_id || aluno.alunoId || aluno.id);
}

function obterNomeAluno(aluno) {
  return String(aluno.aluno_nome || aluno.nome || aluno.nome_aluno || "").trim();
}

function motivoJustificativa(aluno) {
  return String(aluno.motivo || aluno.justificativa || aluno.observacao || "").trim();
}

function statusFrequencia(aluno) {
  const status = normalizarTexto(aluno.status || aluno.status_presenca || aluno.presenca);
  const motivo = motivoJustificativa(aluno);

  if (status.includes("just") || motivo) return "justificado";
  if (status === "presente" || status === "p" || status === "true") return "presente";
  return "ausente";
}

function atrasoMinutosInformado(aluno) {
  const valor = aluno.atraso_minutos ?? aluno.atrasoMinutos;
  if (valor === null || valor === undefined || valor === "") return null;

  const minutos = Number(valor);
  return Number.isFinite(minutos) && minutos >= 0 ? Math.floor(minutos) : null;
}

function prepararAlunosParaConfirmacao(alunos = []) {
  if (!Array.isArray(alunos) || alunos.length === 0) {
    const erro = new Error("A chamada precisa ter pelo menos um aluno.");
    erro.status = 400;
    throw erro;
  }

  const alunosValidos = alunos.map((aluno) => ({
    aluno_id: obterAlunoId(aluno),
    aluno_nome: obterNomeAluno(aluno),
    status: statusFrequencia(aluno),
    atrasado: Boolean(aluno.atrasado),
    horario_registro_atraso: normalizarHorarioAtraso(aluno.horario_registro_atraso || aluno.horarioRegistroAtraso),
    atraso_registrado_em: normalizarDataHoraAtraso(aluno.atraso_registrado_em || aluno.atrasoRegistradoEm),
    atraso_minutos: atrasoMinutosInformado(aluno),
    motivo: motivoJustificativa(aluno),
  }));

  if (alunosValidos.some((aluno) => !aluno.aluno_id || !aluno.aluno_nome)) {
    const erro = new Error("Todos os alunos precisam possuir ID e nome válidos.");
    erro.status = 400;
    throw erro;
  }

  return alunosValidos.map((aluno) => {
    if (aluno.atrasado) {
      return { ...aluno, status: "presente" };
    }

    return {
      ...aluno,
      horario_registro_atraso: null,
      atraso_registrado_em: null,
      atraso_minutos: null,
    };
  });
}

function completarDadosAtraso(alunos, horarioChamada, horarioMarcacao, dataHoraMarcacao) {
  return atrasoService.completarDadosAtraso(prepararAlunosParaConfirmacao(alunos), {
    horarioChamada,
    horarioMarcacao,
    dataHoraMarcacao,
  });
}

async function validarAlunosPertencemTurma(connection, turmaId, alunos) {
  const ids = [...new Set(alunos.map((aluno) => Number(aluno.aluno_id)).filter(Boolean))];

  if (ids.length !== alunos.length) {
    const erro = new Error("Lista de alunos inválida ou com IDs duplicados.");
    erro.status = 400;
    throw erro;
  }

  if (ids.length === 0) {
    const erro = new Error("A chamada precisa ter pelo menos um aluno válido.");
    erro.status = 400;
    throw erro;
  }

  const [rows] = await connection.execute(
    "SELECT id FROM alunos WHERE turma_id = ? ORDER BY id ASC",
    [turmaId]
  );

  fluxoService.assertPermission(
    fluxoService.validateCompleteStudentList(rows, alunos),
    409
  );
}

function erroDuplicidadeChamada(error) {
  return error && error.code === "ER_DUP_ENTRY" && String(error.message || "").includes("uk_chamada_turma_data_ativa");
}

function erroDuplicidadeConfirmacao(error) {
  return error && error.code === "ER_DUP_ENTRY" && String(error.message || "").includes("uk_reg_chamada_origem");
}

function montarAlunosJSON(alunos = [], contextoAtraso = null) {
  const alunosPreparados = contextoAtraso
    ? completarDadosAtraso(
      alunos,
      contextoAtraso.horarioChamada,
      contextoAtraso.horarioMarcacao,
      contextoAtraso.dataHoraMarcacao
    )
    : prepararAlunosParaConfirmacao(alunos);

  return alunosPreparados.map((aluno) => ({
    aluno_id: aluno.aluno_id,
    nome: aluno.aluno_nome,
    status_presenca: aluno.status === "presente" ? "presente" : "ausente",
    atrasado: Boolean(aluno.atrasado),
    horario_registro_atraso: aluno.horario_registro_atraso || null,
    atraso_registrado_em: aluno.atraso_registrado_em || null,
    atraso_minutos: aluno.atraso_minutos ?? null,
    motivo: aluno.motivo || null,
  }));
}

async function dashboard(req, res, next) {
  try {
    const data = req.query.data || hojeLocalISO();
    const incluirAlunosAtrasados = String(
      req.query.incluirAlunosAtrasados || req.query.incluir_alunos_atrasados || ""
    ) === "1";
    const resultado = await dashboardService.obterDashboardDia({
      data,
      incluirAlunosAtrasados,
    });

    return res.json(resultado);
  } catch (error) {
    return next(error);
  }
}

async function chamadasDoDia(req, res, next) {
  try {
    const data = req.query.data || hojeLocalISO();
    const config = await garantirConfiguracao();
    const [rows] = await db.execute(
      `
      SELECT id, professor_id, professor_nome, turma_id, turma_nome, materia,
             data_chamada, horario_chamada, alunos, total_presentes, total_ausentes, status,
             versao, atualizado_em
      FROM chamadas_diarias
      WHERE data_chamada = ? AND status = 'pendente'
      ORDER BY horario_chamada DESC, id DESC
      `,
      [data]
    );

    return res.json({
      chamadas: rows.map((chamada) => ({
        ...chamada,
        status_fluxo: fluxoService.statusEfetivo(chamada, config, req.usuario),
        pode_editar: fluxoService.canPedagogueEditCall(chamada, req.usuario, config).permitido,
        pode_confirmar: fluxoService.canConfirmCall(chamada, req.usuario, config).permitido,
        alunos: parseAlunos(chamada.alunos),
      })),
      horario_limite_atraso: config.horario_limite_atraso,
      horario_servidor: config.horario_servidor,
    });
  } catch (error) {
    return next(error);
  }
}

async function chamadasConfirmadasHoje(req, res, next) {
  try {
    const data = req.query.data || hojeLocalISO();
    const config = await garantirConfiguracao();
    if (fluxoService.hasMaximumArrivalTimePassed(config)) {
      await db.execute(
        `UPDATE chamadas_diarias cd
         INNER JOIN registros_chamadas_confirmadas rcc ON rcc.chamada_diaria_id_origem = cd.id
         SET cd.bloqueada_em = COALESCE(cd.bloqueada_em, TIMESTAMP(rcc.data_chamada, ?))
         WHERE rcc.data_chamada = ? AND cd.status = 'confirmada'`,
        [String(config.horario_limite_atraso).slice(0, 8), data]
      );
    }
    const [rows] = await db.execute(
      `
      SELECT rcc.id, rcc.chamada_diaria_id_origem, rcc.professor_nome,
             rcc.turma_nome, rcc.materia, rcc.data_chamada,
             rcc.total_presentes, rcc.total_ausentes, rcc.total_justificados, rcc.total_atrasos,
             COALESCE(cd.status, 'confirmada') AS status, cd.versao AS versao_chamada
      FROM registros_chamadas_confirmadas rcc
      LEFT JOIN chamadas_diarias cd ON cd.id = rcc.chamada_diaria_id_origem
      WHERE rcc.data_chamada = ?
      ORDER BY rcc.confirmado_em DESC, rcc.id DESC
      `,
      [data]
    );

    return res.json({
      chamadas: rows.map((chamada) => ({
        ...chamada,
        status_fluxo: fluxoService.statusEfetivo(chamada, config, req.usuario),
        pode_editar: Boolean(chamada.chamada_diaria_id_origem && chamada.versao_chamada) && fluxoService.canPedagogueEditCall(chamada, req.usuario, config).permitido,
      })),
      automacao_liberada: fluxoService.canStartAutomation(config, rows.length > 0).permitido,
      horario_limite_atraso: config.horario_limite_atraso,
      horario_servidor: config.horario_servidor,
    });
  } catch (error) {
    return next(error);
  }
}

async function detalharChamadaConfirmada(req, res, next) {
  try {
    const id = Number(req.params.id);
    const data = hojeLocalISO();
    const config = await garantirConfiguracao();

    const [chamadas] = await db.execute(
      `
      SELECT rcc.id, rcc.chamada_diaria_id_origem, rcc.professor_nome,
             rcc.turma_nome, rcc.materia, rcc.data_chamada,
             rcc.total_presentes, rcc.total_ausentes, rcc.total_justificados, rcc.total_atrasos,
             COALESCE(cd.status, 'confirmada') AS status, cd.versao AS versao_chamada
      FROM registros_chamadas_confirmadas rcc
      LEFT JOIN chamadas_diarias cd ON cd.id = rcc.chamada_diaria_id_origem
      WHERE rcc.id = ? AND rcc.data_chamada = ?
      LIMIT 1
      `,
      [id, data]
    );

    if (!chamadas[0]) return res.status(404).json({ erro: "Chamada confirmada de hoje não encontrada." });

    const [alunos] = await db.execute(
      `
      SELECT
        f.id AS frequencia_id,
        f.aluno_id,
        f.aluno_nome,
        f.status,
        f.atrasado,
        f.horario_registro_atraso,
        f.atraso_registrado_em,
        f.atraso_minutos,
        j.motivo
      FROM registros_frequencia_alunos f
      LEFT JOIN justificativas_frequencia j ON j.frequencia_aluno_id = f.id
      WHERE f.registro_chamada_id = ?
      ORDER BY f.aluno_nome ASC
      `,
      [id]
    );

    const chamada = chamadas[0];
    return res.json({
      chamada: {
        ...chamada,
        status_fluxo: fluxoService.statusEfetivo(chamada, config, req.usuario),
        pode_editar: Boolean(chamada.chamada_diaria_id_origem && chamada.versao_chamada) && fluxoService.canPedagogueEditCall(chamada, req.usuario, config).permitido,
        horario_limite_atraso: config.horario_limite_atraso,
        horario_servidor: config.horario_servidor,
        alunos,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function confirmarChamada(req, res, next) {
  let connection;
  let transacaoIniciada = false;

  try {
    connection = await db.getConnection();
    const chamadaId = Number(req.params.id);
    const pedagogaId = Number(req.usuario.id);
    const observacao = String(req.body.observacao || "").trim() || null;

    if (!chamadaId) return res.status(400).json({ erro: "Chamada inválida." });

    await garantirColunasAtraso(connection);
    await connection.beginTransaction();
    transacaoIniciada = true;

    const [[pedagoga]] = await connection.execute(
      "SELECT id, nome, email, maquina_padrao_chamadas FROM usuarios WHERE id = ? AND tipo IN ('pedagoga', 'administracao') AND ativo = TRUE LIMIT 1",
      [pedagogaId]
    );

    if (!pedagoga) {
      const erro = new Error("Pedagoga não encontrada ou inativa.");
      erro.status = 404;
      throw erro;
    }

    const [chamadas] = await connection.execute(
      `
      SELECT id, turma_id, turma_nome, professor_id, professor_nome, materia, data_chamada,
             horario_chamada, alunos, total_presentes, total_ausentes, status, versao
      FROM chamadas_diarias
      WHERE id = ? AND data_chamada = ? AND status = 'pendente'
      LIMIT 1
      FOR UPDATE
      `,
      [chamadaId, dataBrasiliaISO()]
    );

    const chamada = chamadas[0];
    if (!chamada) {
      const erro = new Error("Chamada pendente de hoje não encontrada ou já confirmada.");
      erro.status = 404;
      throw erro;
    }

    const configFluxo = await garantirConfiguracao(connection);
    fluxoService.assertPermission(fluxoService.canConfirmCall(chamada, req.usuario, configFluxo));
    fluxoService.assertPermission(fluxoService.validateCallVersion(chamada, req.body.versao), 409);

    const alunosBase = Array.isArray(req.body.alunos) && req.body.alunos.length > 0
      ? req.body.alunos
      : parseAlunos(chamada.alunos);

    const alunos = completarDadosAtraso(
      alunosBase,
      chamada.horario_chamada,
      horarioBrasilia(),
      dataHoraBrasiliaMySQL()
    );
    fluxoService.assertPermission(
      fluxoService.validateCompleteStudentList(parseAlunos(chamada.alunos), alunos),
      409
    );

    const [confirmacaoExistente] = await connection.execute(
      "SELECT id FROM registros_chamadas_confirmadas WHERE chamada_diaria_id_origem = ? LIMIT 1 FOR UPDATE",
      [chamada.id]
    );
    if (confirmacaoExistente[0]) {
      const erro = new Error("Essa chamada já foi confirmada anteriormente.");
      erro.status = 409;
      throw erro;
    }

    const totais = contarTotaisFrequencia(alunos);

    const [registroResult] = await connection.execute(
      `
      INSERT INTO registros_chamadas_confirmadas
        (chamada_diaria_id_origem, professor_id, professor_nome, pedagoga_id, pedagoga_nome,
         turma_id, turma_nome, materia, data_chamada, horario_chamada,
         total_presentes, total_ausentes, total_justificados, total_atrasos, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        chamada.id,
        chamada.professor_id,
        chamada.professor_nome,
        pedagoga.id,
        pedagoga.nome,
        chamada.turma_id,
        chamada.turma_nome,
        chamada.materia,
        chamada.data_chamada,
        chamada.horario_chamada,
        totais.total_presentes,
        totais.total_ausentes,
        totais.total_justificados,
        totais.total_atrasos,
        observacao,
      ]
    );

    const registroChamadaId = registroResult.insertId;

    for (const aluno of alunos) {
      const [frequenciaResult] = await connection.execute(
        `
        INSERT INTO registros_frequencia_alunos
          (registro_chamada_id, aluno_id, aluno_nome, turma_id, turma_nome, materia, data_chamada, status, atrasado, horario_registro_atraso, atraso_registrado_em, atraso_minutos, alterado_por_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          registroChamadaId,
          aluno.aluno_id,
          aluno.aluno_nome,
          chamada.turma_id,
          chamada.turma_nome,
          chamada.materia,
          chamada.data_chamada,
          aluno.status,
          aluno.atrasado ? 1 : 0,
          aluno.atrasado ? aluno.horario_registro_atraso : null,
          aluno.atrasado ? aluno.atraso_registrado_em : null,
          aluno.atrasado ? aluno.atraso_minutos : null,
          pedagoga.id,
        ]
      );

      if (aluno.status === "justificado") {
        await connection.execute(
          `
          INSERT INTO justificativas_frequencia
            (frequencia_aluno_id, aluno_id, registro_chamada_id, motivo, anexos, registrada_por_id, registrada_por_nome)
          VALUES (?, ?, ?, ?, NULL, ?, ?)
          `,
          [
            frequenciaResult.insertId,
            aluno.aluno_id,
            registroChamadaId,
            aluno.motivo || MOTIVO_PADRAO_JUSTIFICATIVA,
            pedagoga.id,
            pedagoga.nome,
          ]
        );
        await registrarAuditoria(connection, {
          chamadaId: chamada.id,
          usuario: req.usuario,
          evento: "JUSTIFICATIVA_ADICIONADA",
          valoresNovos: { aluno_id: aluno.aluno_id, motivo: aluno.motivo || MOTIVO_PADRAO_JUSTIFICATIVA },
        });
      }
    }

    await connection.execute(
      "UPDATE chamadas_diarias SET status = 'confirmada', confirmada_por_id = ?, confirmado_em = ?, versao = versao + 1 WHERE id = ? AND status = 'pendente' AND versao = ?",
      [pedagoga.id, dataHoraBrasiliaMySQL(), chamada.id, chamada.versao]
    );

    await registrarAuditoria(connection, {
      chamadaId: chamada.id,
      usuario: req.usuario,
      evento: "CHAMADA_CONFIRMADA",
      valoresAnteriores: { status: "TEMPORARIA", versao: chamada.versao },
      valoresNovos: { status: "CONFIRMADA", confirmada_por_id: pedagoga.id, versao: Number(chamada.versao) + 1, totais },
    });

    await connection.commit();
    transacaoIniciada = false;

    return res.status(201).json({
      mensagem: "Chamada salva com sucesso. A automação do WhatsApp não foi iniciada automaticamente.",
      registro_chamada_id: registroChamadaId,
      totais,
      automacao: null,
    });
  } catch (error) {
    if (transacaoIniciada && connection) {
      await connection.rollback();
    }
    auditarBloqueioHorario(error, req);
    if (erroDuplicidadeConfirmacao(error)) {
      const erro = new Error("Essa chamada já foi confirmada anteriormente.");
      erro.status = 409;
      return next(erro);
    }
    return next(error);
  } finally {
    if (connection) connection.release();
  }
}

async function atualizarFrequenciaAluno(req, res, next) {
  let connection;
  let transacaoIniciada = false;

  try {
    connection = await db.getConnection();
    const frequenciaId = Number(req.params.id);
    const pedagogaId = Number(req.usuario.id);
    let status = statusFrequencia(req.body);
    let atrasado = Boolean(req.body.atrasado);

    if (atrasado) status = "presente";
    if (status !== "presente") atrasado = false;
    const motivo = motivoJustificativa(req.body) || MOTIVO_PADRAO_JUSTIFICATIVA;

    if (!frequenciaId) return res.status(400).json({ erro: "Frequência inválida." });

    await garantirColunasAtraso(connection);
    await connection.beginTransaction();
    transacaoIniciada = true;

    const [[pedagoga]] = await connection.execute(
      "SELECT id, nome FROM usuarios WHERE id = ? AND tipo IN ('pedagoga', 'administracao') AND ativo = TRUE LIMIT 1",
      [pedagogaId]
    );

    if (!pedagoga) {
      const erro = new Error("Pedagoga não encontrada ou inativa.");
      erro.status = 404;
      throw erro;
    }

    const [frequencias] = await connection.execute(
      `
       SELECT f.*, r.data_chamada, r.horario_chamada, r.chamada_diaria_id_origem,
              cd.status AS chamada_status, cd.versao AS chamada_versao
       FROM registros_frequencia_alunos f
       INNER JOIN registros_chamadas_confirmadas r ON r.id = f.registro_chamada_id
       INNER JOIN chamadas_diarias cd ON cd.id = r.chamada_diaria_id_origem
      WHERE f.id = ? AND r.data_chamada = ?
      LIMIT 1
      FOR UPDATE
      `,
      [frequenciaId, dataBrasiliaISO()]
    );

    const frequencia = frequencias[0];
    if (!frequencia) {
      const erro = new Error("Frequência de hoje não encontrada para edição.");
      erro.status = 404;
      throw erro;
    }

    const chamadaFluxo = {
      id: frequencia.chamada_diaria_id_origem,
      status: frequencia.chamada_status,
      versao: frequencia.chamada_versao,
    };
    const configFluxo = await garantirConfiguracao(connection);
    fluxoService.assertPermission(fluxoService.canPedagogueEditCall(chamadaFluxo, req.usuario, configFluxo));
    fluxoService.assertPermission(fluxoService.validateCallVersion(chamadaFluxo, req.body.versao), 409);
    const horarioMarcacao = horarioBrasilia();
    const atrasoMinutos = atrasado
      ? fluxoService.calculateStudentDelay(frequencia.horario_chamada, frequencia.horario_registro_atraso || horarioMarcacao)
      : null;

    await connection.execute(
      `
      UPDATE registros_frequencia_alunos
      SET status = ?,
           atrasado = ?,
           horario_registro_atraso = CASE WHEN ? = 1 THEN COALESCE(horario_registro_atraso, ?) ELSE NULL END,
           atraso_registrado_em = CASE WHEN ? = 1 THEN COALESCE(atraso_registrado_em, ?) ELSE NULL END,
           atraso_minutos = ?,
           alterado_por_id = ?
      WHERE id = ?
      `,
      [status, atrasado ? 1 : 0, atrasado ? 1 : 0, horarioMarcacao, atrasado ? 1 : 0, dataHoraBrasiliaMySQL(), atrasoMinutos, pedagoga.id, frequenciaId]
    );

    const [[justificativaAnterior]] = await connection.execute(
      "SELECT motivo FROM justificativas_frequencia WHERE frequencia_aluno_id = ? LIMIT 1 FOR UPDATE",
      [frequenciaId]
    );
    await connection.execute("DELETE FROM justificativas_frequencia WHERE frequencia_aluno_id = ?", [frequenciaId]);

    if (status === "justificado") {
      await connection.execute(
        `
        INSERT INTO justificativas_frequencia
          (frequencia_aluno_id, aluno_id, registro_chamada_id, motivo, anexos, registrada_por_id, registrada_por_nome)
        VALUES (?, ?, ?, ?, NULL, ?, ?)
        `,
        [frequenciaId, frequencia.aluno_id, frequencia.registro_chamada_id, motivo, pedagoga.id, pedagoga.nome]
      );
      await registrarAuditoria(connection, {
        chamadaId: frequencia.chamada_diaria_id_origem,
        usuario: req.usuario,
        evento: "JUSTIFICATIVA_ADICIONADA",
        valoresAnteriores: { aluno_id: frequencia.aluno_id, motivo: justificativaAnterior?.motivo || null },
        valoresNovos: { aluno_id: frequencia.aluno_id, motivo },
      });
    }

    const [[totais]] = await connection.execute(
      `
      SELECT
        SUM(${FREQUENCIA_SQL.presente}) AS total_presentes,
        SUM(${FREQUENCIA_SQL.ausente}) AS total_ausentes,
        SUM(${FREQUENCIA_SQL.justificado}) AS total_justificados,
        SUM(${FREQUENCIA_SQL.atrasado}) AS total_atrasos
      FROM registros_frequencia_alunos f
      WHERE f.registro_chamada_id = ?
      `,
      [frequencia.registro_chamada_id]
    );

    await connection.execute(
      `
      UPDATE registros_chamadas_confirmadas
      SET total_presentes = ?, total_ausentes = ?, total_justificados = ?, total_atrasos = ?
      WHERE id = ? AND data_chamada = ?
      `,
      [
        Number(totais.total_presentes || 0),
        Number(totais.total_ausentes || 0),
        Number(totais.total_justificados || 0),
        Number(totais.total_atrasos || 0),
        frequencia.registro_chamada_id,
        dataBrasiliaISO(),
      ]
    );

    await connection.execute(
      "UPDATE chamadas_diarias SET versao = versao + 1 WHERE id = ? AND versao = ?",
      [frequencia.chamada_diaria_id_origem, frequencia.chamada_versao]
    );
    await registrarAuditoria(connection, {
      chamadaId: frequencia.chamada_diaria_id_origem,
      usuario: req.usuario,
      evento: "CHAMADA_EDITADA_PELA_PEDAGOGIA",
      valoresAnteriores: { aluno_id: frequencia.aluno_id, status: frequencia.status, atrasado: Boolean(frequencia.atrasado), versao: frequencia.chamada_versao },
      valoresNovos: {
        aluno_id: frequencia.aluno_id,
        status,
        atrasado,
        atraso_minutos: atrasoMinutos,
        versao: Number(frequencia.chamada_versao) + 1,
        edicao_apos_horario: fluxoService.canPedagogueBypassMaximumArrivalTime(configFluxo, req.usuario)
          && fluxoService.hasMaximumArrivalTimePassed(configFluxo),
      },
    });

    await connection.commit();
    transacaoIniciada = false;

    return res.json({
      mensagem: "Frequência atualizada com sucesso.",
      totais: {
        total_presentes: Number(totais.total_presentes || 0),
        total_ausentes: Number(totais.total_ausentes || 0),
        total_justificados: Number(totais.total_justificados || 0),
        total_atrasos: Number(totais.total_atrasos || 0),
      },
      versao_chamada: Number(frequencia.chamada_versao) + 1,
    });
  } catch (error) {
    if (transacaoIniciada && connection) {
      await connection.rollback();
    }
    auditarBloqueioHorario(error, req);
    return next(error);
  } finally {
    if (connection) connection.release();
  }
}

async function turmasPendentes(req, res, next) {
  try {
    const data = req.query.data || hojeLocalISO();
    const [rows] = await db.execute(
      `
      SELECT
        t.id,
        t.nome,
        COALESCE(JSON_ARRAYAGG(
          CASE WHEN a.id IS NULL THEN NULL ELSE JSON_OBJECT('id', a.id, 'nome', a.nome) END
        ), JSON_ARRAY()) AS alunos
      FROM turmas t
      LEFT JOIN chamadas_diarias cd
        ON cd.turma_id = t.id
        AND cd.data_chamada = ?
        AND cd.status <> 'cancelada'
      LEFT JOIN alunos a ON a.turma_id = t.id
      WHERE cd.id IS NULL
      GROUP BY t.id, t.nome
      ORDER BY t.nome ASC
      `,
      [data]
    );

    return res.json({
      turmas: rows.map((turma) => ({ ...turma, alunos: parseAlunos(turma.alunos).filter(Boolean) })),
    });
  } catch (error) {
    return next(error);
  }
}

async function criarChamadaPedagogica(req, res, next) {
  try {
    const usuarioId = Number(req.usuario.id);
    const turmaId = Number(req.body.turma_id || req.body.turmaId);
    const dataChamada = req.body.data_chamada || hojeLocalISO();
    const alunos = montarAlunosJSON(req.body.alunos);

    if (!turmaId) return res.status(400).json({ erro: "Turma é obrigatória." });

    const [usuariosEncontrados, turmasEncontradas, chamadasExistentes] = await Promise.all([
      db.execute("SELECT id, nome FROM usuarios WHERE id = ? AND ativo = TRUE LIMIT 1", [usuarioId]).then(([rows]) => rows),
      db.execute("SELECT id, nome FROM turmas WHERE id = ? LIMIT 1", [turmaId]).then(([rows]) => rows),
      db.execute(
        "SELECT id FROM chamadas_diarias WHERE turma_id = ? AND data_chamada = ? AND status <> 'cancelada' LIMIT 1",
        [turmaId, dataChamada]
      ).then(([rows]) => rows),
    ]);

    const usuario = usuariosEncontrados?.[0];
    const turma = turmasEncontradas?.[0];

    if (!usuario) return res.status(404).json({ erro: "Usuário não encontrado." });
    if (!turma) return res.status(404).json({ erro: "Turma não encontrada." });
    if (chamadasExistentes?.[0]) return res.status(409).json({ erro: "Essa turma já possui chamada hoje." });

    const alunosPreparados = prepararAlunosParaConfirmacao(alunos);
    await validarAlunosPertencemTurma(db, turmaId, alunosPreparados);
    const totais = contarTotaisFrequencia(alunosPreparados);

    const [result] = await db.execute(
      `
      INSERT INTO chamadas_diarias
        (professor_id, professor_nome, turma_id, turma_nome, materia, data_chamada, alunos, total_presentes, total_ausentes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        usuarioId,
        usuario.nome,
        turmaId,
        turma.nome,
        MATERIA_PEDAGOGICA,
        dataChamada,
        JSON.stringify(alunos),
        totais.total_presentes,
        totais.total_ausentes,
      ]
    );
    return res.status(201).json({ mensagem: "Chamada pedagógica registrada com sucesso.", chamada: { id: result.insertId } });
  } catch (error) {
    if (erroDuplicidadeChamada(error)) {
      const erro = new Error("Essa turma já possui chamada ativa nessa data.");
      erro.status = 409;
      return next(erro);
    }
    return next(error);
  }
}

async function atualizarChamada(req, res, next) {
  try {
    const chamadaId = Number(req.params.id);
    const materia = String(req.body.materia || req.body.disciplina || MATERIA_PEDAGOGICA).trim();

    if (!chamadaId) return res.status(400).json({ erro: "Chamada inválida." });

    const resultado = await chamadaService.executarTransacao(db, async (connection) => {
      const dataHoje = dataBrasiliaISO();
      const [chamadasAtuais] = await connection.execute(
        "SELECT id, turma_id, status, versao, materia, horario_chamada, alunos FROM chamadas_diarias WHERE id = ? AND data_chamada = ? LIMIT 1 FOR UPDATE",
        [chamadaId, dataHoje]
      );

      const chamadaAtual = chamadasAtuais[0];
      if (!chamadaAtual) {
        const erro = new Error("Chamada pendente de hoje não encontrada.");
        erro.status = 404;
        throw erro;
      }

      const configFluxo = await garantirConfiguracao(connection);
      fluxoService.assertPermission(fluxoService.canPedagogueEditCall(chamadaAtual, req.usuario, configFluxo));
      fluxoService.assertPermission(fluxoService.validateCallVersion(chamadaAtual, req.body.versao), 409);
      fluxoService.assertPermission(
        fluxoService.canApplyStudentDelays(parseAlunos(chamadaAtual.alunos), req.body.alunos, configFluxo, req.usuario)
      );

      const alunos = montarAlunosJSON(req.body.alunos, {
        horarioChamada: chamadaAtual.horario_chamada,
        horarioMarcacao: horarioBrasilia(),
        dataHoraMarcacao: dataHoraBrasiliaMySQL(),
      });
      const alunosPreparados = prepararAlunosParaConfirmacao(alunos);

      fluxoService.assertPermission(
        fluxoService.validateCompleteStudentList(parseAlunos(chamadaAtual.alunos), alunosPreparados),
        409
      );
      const totais = contarTotaisFrequencia(alunosPreparados);

      const [result] = await connection.execute(
        `
        UPDATE chamadas_diarias
        SET materia = ?, alunos = ?, total_presentes = ?, total_ausentes = ?, versao = versao + 1
        WHERE id = ? AND status = 'pendente' AND data_chamada = ? AND versao = ?
        `,
        [materia, JSON.stringify(alunos), totais.total_presentes, totais.total_ausentes, chamadaId, dataHoje, chamadaAtual.versao]
      );

      if (result.affectedRows === 0) {
        fluxoService.assertPermission(fluxoService.validateCallVersion(null, null), 409);
      }

      await registrarAuditoria(connection, {
        chamadaId,
        usuario: req.usuario,
        evento: "CHAMADA_EDITADA_PELA_PEDAGOGIA",
        valoresAnteriores: { materia: chamadaAtual.materia, alunos: parseAlunos(chamadaAtual.alunos), versao: chamadaAtual.versao },
        valoresNovos: {
          materia,
          alunos,
          versao: Number(chamadaAtual.versao) + 1,
          edicao_apos_horario: fluxoService.canPedagogueBypassMaximumArrivalTime(configFluxo, req.usuario)
            && fluxoService.hasMaximumArrivalTimePassed(configFluxo),
        },
      });

      return {
        versao: Number(chamadaAtual.versao) + 1,
      };
    });

    return res.json({
      mensagem: "Chamada temporária atualizada com sucesso.",
      versao: resultado.versao,
    });
  } catch (error) {
    auditarBloqueioHorario(error, req);
    return next(error);
  }
}

function normalizarPaginacaoLista(query = {}) {
  const paginaAtual = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limitRecebido = Number.parseInt(query.limit, 10) || 50;
  const limite = Math.min(Math.max(limitRecebido, 1), 100);
  const offset = (paginaAtual - 1) * limite;
  return { paginaAtual, limite, offset };
}

function montarMetaLista(totalRegistros, paginaAtual, limite) {
  const total = Number(totalRegistros || 0);
  return {
    totalRegistros: total,
    paginaAtual,
    totalPaginas: Math.max(Math.ceil(total / limite), 1),
    limite,
  };
}

async function responsaveis(req, res, next) {
  try {
    const entrada = (req.method === "POST" ? req.body : req.query) || {};

    if (req.method === "GET" && req.query.busca) {
      return res.status(400).json({
        erro: "Use a pesquisa protegida para buscar dados pessoais de responsáveis.",
      });
    }

    const { paginaAtual, limite, offset } = normalizarPaginacaoLista(entrada);
    const busca = String(entrada.busca || "").trim().slice(0, 80);
    const filtros = [];
    const parametros = [];

    if (busca) {
      const termo = `%${busca.toLowerCase()}%`;
      filtros.push(`
        AND (
          LOWER(r.nome) LIKE ?
          OR LOWER(a.nome) LIKE ?
          OR LOWER(t.nome) LIKE ?
          OR LOWER(r.contato) LIKE ?
          OR REPLACE(REPLACE(REPLACE(REPLACE(r.contato, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
        )
      `);
      parametros.push(termo, termo, termo, termo, `%${busca.replace(/\D/g, "") || busca}%`);
    }

    const whereClause = `WHERE 1 = 1 ${filtros.join("\n")}`;

    const [[totalRow]] = await db.execute(
      `
      SELECT COUNT(*) AS total
      FROM responsaveis r
      INNER JOIN alunos a ON a.id = r.aluno_id
      LEFT JOIN turmas t ON t.id = a.turma_id
      ${whereClause}
      `,
      parametros
    );

    const [rows] = await db.execute(
      `
      SELECT
        r.id,
        r.nome,
        r.contato,
        r.parentesco,
        a.id AS aluno_id,
        a.nome AS aluno_nome,
        t.id AS turma_id,
        t.nome AS turma_nome
      FROM responsaveis r
      INNER JOIN alunos a ON a.id = r.aluno_id
      LEFT JOIN turmas t ON t.id = a.turma_id
      ${whereClause}
      ORDER BY t.nome ASC, r.nome ASC, a.nome ASC, r.id ASC
      LIMIT ${limite} OFFSET ${offset}
      `,
      parametros
    );

    const grupos = new Map();
    rows.forEach((row) => {
      const turmaId = row.turma_id || "sem-turma";
      const chave = `${turmaId}|${String(row.nome).trim().toLowerCase()}|${String(row.contato).trim()}`;
      const atual = grupos.get(chave) || {
        id: row.id,
        ids: [],
        nome: row.nome,
        contato: row.contato,
        parentesco: row.parentesco,
        turma_id: row.turma_id,
        turma_nome: row.turma_nome || "Sem turma vinculada",
        alunos: [],
      };

      atual.ids.push(row.id);
      atual.alunos.push({ id: row.aluno_id, nome: row.aluno_nome, turma: row.turma_nome });
      grupos.set(chave, atual);
    });

    const lista = Array.from(grupos.values());
    return res.json({
      responsaveis: lista,
      dados: lista,
      ...montarMetaLista(totalRow.total, paginaAtual, limite),
    });
  } catch (error) {
    return next(error);
  }
}

async function atualizarResponsavel(req, res, next) {
  try {
    if (!req.usuario || !["pedagoga", "administracao"].includes(req.usuario.tipo)) {
      return res.status(403).json({ erro: "Você não tem permissão para editar responsáveis." });
    }

    const id = Number(req.params.id);
    const nome = formatarNome(req.body.nome || "");
    const contato = String(req.body.contato || "").trim();

    if (!id) return res.status(400).json({ erro: "Responsável inválido." });
    if (!nome || nome.length < 2) return res.status(400).json({ erro: "Nome do responsável inválido." });
    if (!contato || contato.length < 8) return res.status(400).json({ erro: "Contato inválido." });

    const [result] = await db.execute("UPDATE responsaveis SET nome = ?, contato = ? WHERE id = ?", [nome, contato, id]);
    if (result.affectedRows === 0) return res.status(404).json({ erro: "Responsável não encontrado." });

    return res.json({ mensagem: "Responsável atualizado com sucesso." });
  } catch (error) {
    return next(error);
  }
}



function validarTextoMensagemWhatsApp(texto) {
  const textoNormalizado = String(texto || "").trim();

  if (!textoNormalizado) {
    const erro = new Error("A mensagem personalizada não pode ficar vazia.");
    erro.status = 400;
    throw erro;
  }

  if (textoNormalizado.length > 1000) {
    const erro = new Error("A mensagem personalizada deve ter no máximo 1000 caracteres.");
    erro.status = 400;
    throw erro;
  }

  const tagsEncontradas = TAGS_MENSAGEM_WHATSAPP.filter((tag) => textoNormalizado.includes(tag));
  if (tagsEncontradas.length === 0) {
    const erro = new Error("Use pelo menos uma tag dinâmica: {nome_responsavel}, {nome_aluno} ou {data}.");
    erro.status = 400;
    throw erro;
  }

  return textoNormalizado;
}

function obterGrupoMaquinasPorTipoUsuario(tipo) {
  if (tipo === "pedagoga") return [1, 2];
  if (tipo === "administracao") return [3, 4, 5];
  return [];
}

async function buscarDadosUsuarioSolicitante(connection, usuario) {
  const [rows] = await connection.execute(
    "SELECT id, nome, email, tipo, maquina_padrao_chamadas FROM usuarios WHERE id = ? AND ativo = TRUE LIMIT 1",
    [usuario.id]
  );

  if (!rows.length) {
    const erro = new Error("Usuário solicitante não encontrado ou inativo.");
    erro.status = 401;
    throw erro;
  }

  return rows[0];
}

function validarMaquinaPorTipoUsuario(tipo, valor, obrigatoria = true) {
  const maquinasPermitidas = obterGrupoMaquinasPorTipoUsuario(tipo);

  if (!maquinasPermitidas.length) {
    const erro = new Error("Seu perfil não tem permissão para selecionar máquina de automação.");
    erro.status = 403;
    throw erro;
  }

  if (!obrigatoria && (valor === null || valor === undefined || valor === "")) return null;

  const maquina = Number(valor);
  if (Number.isInteger(maquina) && maquinasPermitidas.includes(maquina)) return maquina;

  const erro = new Error(`Selecione uma máquina válida para este perfil: ${maquinasPermitidas.map((m) => `Máquina ${m}`).join(", ")}.`);
  erro.status = 400;
  throw erro;
}

function resolverMaquinaDestinoSemBalanceamento(usuario, valorInformado) {
  const valorEfetivo = valorInformado ?? usuario.maquina_padrao_chamadas;

  if (valorEfetivo === null || valorEfetivo === undefined || valorEfetivo === "") {
    const maquinasPermitidas = obterGrupoMaquinasPorTipoUsuario(usuario.tipo);
    const erro = new Error(`Selecione manualmente a máquina de destino antes de iniciar a automação. Máquinas permitidas: ${maquinasPermitidas.map((m) => `Máquina ${m}`).join(", ")}.`);
    erro.status = 400;
    throw erro;
  }

  return validarMaquinaPorTipoUsuario(usuario.tipo, valorEfetivo);
}

async function obterPreferencias(req, res, next) {
  try {
    const [rows] = await db.execute(
      "SELECT tipo, maquina_padrao_chamadas FROM usuarios WHERE id = ? AND tipo IN ('pedagoga', 'administracao') AND ativo = TRUE LIMIT 1",
      [req.usuario.id]
    );

    if (!rows[0]) return res.status(404).json({ erro: "Usuário não encontrado ou inativo." });

    const maquinasPermitidas = obterGrupoMaquinasPorTipoUsuario(rows[0].tipo);
    const maquinaSalva = validarMaquinaPorTipoUsuario(rows[0].tipo, rows[0].maquina_padrao_chamadas, false);

    return res.json({
      maquinaPadraoChamadas: maquinaSalva,
      maquinasPermitidas,
    });
  } catch (error) {
    return next(error);
  }
}

async function salvarMaquinaPadraoChamadas(req, res, next) {
  try {
    const [usuarios] = await db.execute(
      "SELECT tipo FROM usuarios WHERE id = ? AND tipo IN ('pedagoga', 'administracao') AND ativo = TRUE LIMIT 1",
      [req.usuario.id]
    );

    if (!usuarios[0]) return res.status(404).json({ erro: "Usuário não encontrado ou inativo." });

    const maquinaPadraoChamadas = validarMaquinaPorTipoUsuario(
      usuarios[0].tipo,
      req.body.maquinaPadraoChamadas || req.body.maquina_padrao_chamadas || req.body.maquina
    );

    await db.execute(
      "UPDATE usuarios SET maquina_padrao_chamadas = ? WHERE id = ? AND tipo IN ('pedagoga', 'administracao') AND ativo = TRUE",
      [maquinaPadraoChamadas, req.usuario.id]
    );

    return res.json({
      mensagem: `Máquina ${maquinaPadraoChamadas} salva como padrão para este perfil.`,
      maquinaPadraoChamadas,
    });
  } catch (error) {
    return next(error);
  }
}

async function criarSolicitacaoFilaFaltas(connection, usuario, maquinaDestino, origem, payload = {}) {
  const [[configMensagem]] = await connection.execute(
    "SELECT texto FROM config_mensagem_whatsapp WHERE id = 1 LIMIT 1"
  );
  const mensagem = configMensagem?.texto || MENSAGEM_WHATSAPP_PADRAO;

  const [result] = await connection.execute(
    `
    INSERT INTO fila_automacao (
      usuario_solicitante_id,
      usuario_solicitante_nome,
      maquina_destino,
      tipo_automacao,
      mensagem,
      payload,
      status,
      data_solicitacao
    )
    VALUES (?, ?, ?, 'faltas', ?, ?, 'pendente', ?)
    `,
    [
      usuario.id,
      usuario.nome || usuario.email || `usuario-${usuario.id}`,
      maquinaDestino,
      mensagem,
      JSON.stringify({ origem, ...payload }),
      dataHoraBrasiliaMySQL(),
    ]
  );

  return {
    id: result.insertId,
    status: "pendente",
    maquina_destino: maquinaDestino,
    usuario_solicitante_id: usuario.id,
    usuario_solicitante_nome: usuario.nome,
  };
}

async function solicitarAutomacaoWhatsApp(req, res, next) {
  let connection;
  let transacaoIniciada = false;

  try {
    connection = await db.getConnection();
    if (!req.usuario?.id || !req.usuario?.tipo) {
      const erro = new Error("Usuário não autenticado.");
      erro.status = 401;
      throw erro;
    }

    await connection.beginTransaction();
    transacaoIniciada = true;

    const usuario = await buscarDadosUsuarioSolicitante(connection, req.usuario);
    const maquinasPermitidas = obterGrupoMaquinasPorTipoUsuario(usuario.tipo);

    if (!maquinasPermitidas.length) {
      const erro = new Error("Seu perfil não tem permissão para executar a automação do WhatsApp.");
      erro.status = 403;
      throw erro;
    }

    const configFluxo = await garantirConfiguracao(connection);
    const [[confirmadasHoje]] = await connection.execute(
      "SELECT COUNT(*) AS total FROM registros_chamadas_confirmadas WHERE data_chamada = ?",
      [dataBrasiliaISO()]
    );
    fluxoService.assertPermission(
      fluxoService.canStartAutomation(configFluxo, Number(confirmadasHoje.total || 0) > 0)
    );

    const maquinaDestino = resolverMaquinaDestinoSemBalanceamento(
      usuario,
      req.body.maquinaDestino || req.body.maquina_destino
    );

    const automacaoCriada = await criarSolicitacaoFilaFaltas(connection, usuario, maquinaDestino, "botao_executar_automacao", {
      data: hojeLocalISO(),
    });

    await connection.commit();
    transacaoIniciada = false;

    return res.status(201).json({
      mensagem: `Solicitação de automação registrada para a máquina ${maquinaDestino}.`,
      automacao: serializarStatusAutomacao(automacaoCriada),
    });
  } catch (error) {
    if (transacaoIniciada && connection) {
      await connection.rollback();
    }
    return next(error);
  } finally {
    if (connection) connection.release();
  }
}

async function consultarStatusAutomacaoWhatsApp(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ erro: "ID da automação inválido." });
    }

    const [rows] = await db.execute(
      `
      SELECT
        id,
        status,
        erro
      FROM fila_automacao
      WHERE id = ?
        AND (usuario_solicitante_id = ? OR ? = 'administracao')
      LIMIT 1
      `,
      [id, req.usuario.id, req.usuario.tipo]
    );

    if (!rows.length) {
      return res.status(404).json({ erro: "Solicitação de automação não encontrada." });
    }

    return res.json({ automacao: serializarStatusAutomacao(rows[0]) });
  } catch (error) {
    return next(error);
  }
}

async function obterMensagemWhatsApp(req, res, next) {
  try {
    const [rows] = await db.execute(
      "SELECT texto, atualizado_em FROM config_mensagem_whatsapp WHERE id = 1 LIMIT 1"
    );

    return res.json({
      texto: rows[0]?.texto || MENSAGEM_WHATSAPP_PADRAO,
      padrao: !rows[0],
      tagsPermitidas: TAGS_MENSAGEM_WHATSAPP,
      atualizado_em: rows[0]?.atualizado_em || null,
    });
  } catch (error) {
    return next(error);
  }
}

async function salvarMensagemWhatsApp(req, res, next) {
  try {
    const texto = validarTextoMensagemWhatsApp(req.body.texto);

    await db.execute(
      `
      INSERT INTO config_mensagem_whatsapp (id, texto)
      VALUES (1, ?)
      ON DUPLICATE KEY UPDATE texto = VALUES(texto), atualizado_em = CURRENT_TIMESTAMP
      `,
      [texto]
    );

    return res.json({
      mensagem: "Mensagem personalizada salva com sucesso.",
      texto,
      padrao: false,
      tagsPermitidas: TAGS_MENSAGEM_WHATSAPP,
    });
  } catch (error) {
    return next(error);
  }
}

async function dadosRelatorios(req, res, next) {
  try {
    const [[turmas], [alunos]] = await Promise.all([
      db.execute(`
        SELECT id, nome
        FROM turmas
        ORDER BY nome ASC
      `),
      db.execute(`
        SELECT
          a.id,
          a.nome,
          a.turma_id,
          t.nome AS turma
        FROM alunos a
        LEFT JOIN turmas t ON t.id = a.turma_id
        ORDER BY a.nome ASC
      `),
    ]);

    return res.json({ turmas, alunos });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  dashboard,
  chamadasDoDia,
  chamadasConfirmadasHoje,
  detalharChamadaConfirmada,
  confirmarChamada,
  atualizarFrequenciaAluno,
  turmasPendentes,
  criarChamadaPedagogica,
  atualizarChamada,
  responsaveis,
  atualizarResponsavel,
  dadosRelatorios,
  obterPreferencias,
  salvarMaquinaPadraoChamadas,
  solicitarAutomacaoWhatsApp,
  consultarStatusAutomacaoWhatsApp,
  obterMensagemWhatsApp,
  salvarMensagemWhatsApp,
};
