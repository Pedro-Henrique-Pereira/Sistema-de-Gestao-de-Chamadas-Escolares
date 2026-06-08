const db = require("../database/db");
const { formatarNome } = require("../utils/formatadores");
const { garantirColunasAtraso, normalizarHorarioAtraso, normalizarDataHoraAtraso } = require("../utils/atrasoUtils");
const { dataBrasiliaISO, horarioBrasilia, dataHoraBrasiliaMySQL } = require("../utils/brasiliaTime");

const MATERIA_PEDAGOGICA = "Chamada Pedagógica";
const MOTIVO_PADRAO_JUSTIFICATIVA = "Justificado em triagem pedagógica";
const MENSAGEM_WHATSAPP_PADRAO = "Prezado(a) {nome_responsavel}, informamos que o(a) estudante {nome_aluno} não compareceu à aula na data de hoje, {data}, e não identificamos uma justificativa para a sua ausência. Solicitamos, gentilmente, que entrem em contato conosco para informar o motivo do não comparecimento. Agradecemos a cooperação.";
const TAGS_MENSAGEM_WHATSAPP = ["{nome_responsavel}", "{nome_aluno}", "{data}"];
const ERRO_PUBLICO_ROBO = "Falha no disparo. Verifique a máquina local ou o status do WhatsApp Web.";

function sanitizarAutomacao(row) {
  if (!row) return row;

  const { erro, ...automacao } = row;

  if (row.status === "erro" && erro) {
    automacao.erro_publico = ERRO_PUBLICO_ROBO;
  } else if (row.status === "expirado") {
    automacao.erro_publico = "A automação expirou antes de ser concluída. Verifique a máquina local.";
  } else if (row.status === "cancelado") {
    automacao.erro_publico = "Solicitação cancelada antes do início da execução.";
  } else {
    automacao.erro_publico = null;
  }

  return automacao;
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

function prepararAlunosParaConfirmacao(alunos = []) {
  if (!Array.isArray(alunos) || alunos.length === 0) {
    const erro = new Error("A chamada precisa ter pelo menos um aluno.");
    erro.status = 400;
    throw erro;
  }

  const alunosValidos = alunos
    .map((aluno) => ({
      aluno_id: obterAlunoId(aluno),
      aluno_nome: obterNomeAluno(aluno),
      status: statusFrequencia(aluno),
      atrasado: Boolean(aluno.atrasado),
      horario_registro_atraso: normalizarHorarioAtraso(aluno.horario_registro_atraso || aluno.horarioRegistroAtraso),
      atraso_registrado_em: normalizarDataHoraAtraso(aluno.atraso_registrado_em || aluno.atrasoRegistradoEm),
      motivo: motivoJustificativa(aluno),
    }))
    .filter((aluno) => aluno.aluno_id && aluno.aluno_nome);

  if (alunosValidos.length === 0) {
    const erro = new Error("Nenhum aluno válido foi enviado para confirmação.");
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
    };
  });
}

function contarTotais(alunos = []) {
  return alunos.reduce(
    (acc, aluno) => {
      if (aluno.status === "presente") acc.total_presentes += 1;
      if (aluno.status === "ausente" || aluno.status === "justificado") acc.total_ausentes += 1;
      if (aluno.status === "justificado") acc.total_justificados += 1;
      if (aluno.atrasado) acc.total_atrasos += 1;
      return acc;
    },
    { total_presentes: 0, total_ausentes: 0, total_justificados: 0, total_atrasos: 0 }
  );
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

  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.execute(
    `SELECT id FROM alunos WHERE turma_id = ? AND id IN (${placeholders})`,
    [turmaId, ...ids]
  );

  if (rows.length !== ids.length) {
    const idsEncontrados = new Set(rows.map((row) => Number(row.id)));
    const idsInvalidos = ids.filter((id) => !idsEncontrados.has(id));
    const erro = new Error(`Há aluno(s) que não pertencem à turma selecionada: ${idsInvalidos.join(", ")}.`);
    erro.status = 400;
    throw erro;
  }
}

function erroDuplicidadeChamada(error) {
  return error && error.code === "ER_DUP_ENTRY" && String(error.message || "").includes("uk_chamada_turma_data_ativa");
}

function erroDuplicidadeConfirmacao(error) {
  return error && error.code === "ER_DUP_ENTRY" && String(error.message || "").includes("uk_reg_chamada_origem");
}

function montarAlunosJSON(alunos = []) {
  const alunosPreparados = prepararAlunosParaConfirmacao(alunos);

  return alunosPreparados.map((aluno) => ({
    aluno_id: aluno.aluno_id,
    nome: aluno.aluno_nome,
    status_presenca: aluno.status === "presente" ? "presente" : "ausente",
    atrasado: Boolean(aluno.atrasado),
    horario_registro_atraso: aluno.horario_registro_atraso || null,
    atraso_registrado_em: aluno.atraso_registrado_em || null,
  }));
}

async function dashboard(req, res, next) {
  try {
    const data = req.query.data || hojeLocalISO();
    const incluirAlunosAtrasados = String(req.query.incluirAlunosAtrasados || req.query.incluir_alunos_atrasados || "") === "1";

    const consultasDashboard = [
      db.execute(
        `
        SELECT t.id, t.nome, COUNT(a.id) AS total_alunos
        FROM turmas t
        LEFT JOIN alunos a ON a.turma_id = t.id
        GROUP BY t.id, t.nome
        ORDER BY t.nome ASC
        `
      ),
      db.execute(
        `
        SELECT
          COUNT(DISTINCT rcc.id) AS chamadasHoje,
          COALESCE(SUM(f.status = 'presente'), 0) AS totalPresentes,
          COALESCE(SUM(f.status IN ('ausente', 'justificado')), 0) AS totalFaltas,
          COALESCE(SUM(f.status = 'justificado'), 0) AS totalJustificadas,
          COALESCE(SUM(f.atrasado = TRUE), 0) AS totalAtrasos
        FROM registros_chamadas_confirmadas rcc
        LEFT JOIN registros_frequencia_alunos f ON f.registro_chamada_id = rcc.id
        WHERE rcc.data_chamada = ?
        `,
        [data]
      ),
      db.execute(
        `
        SELECT COUNT(*) AS pendentes
        FROM chamadas_diarias
        WHERE data_chamada = ? AND status = 'pendente'
        `,
        [data]
      ),
      db.execute(
        `
        SELECT
          rcc.turma_id,
          COALESCE(SUM(f.status = 'presente'), 0) AS presentes,
          COALESCE(SUM(f.status IN ('ausente', 'justificado')), 0) AS faltas,
          COALESCE(SUM(f.status = 'justificado'), 0) AS justificadas,
          COALESCE(SUM(f.atrasado = TRUE), 0) AS atrasos,
          COUNT(DISTINCT rcc.id) AS chamadas_confirmadas
        FROM registros_chamadas_confirmadas rcc
        LEFT JOIN registros_frequencia_alunos f ON f.registro_chamada_id = rcc.id
        WHERE rcc.data_chamada = ?
        GROUP BY rcc.turma_id
        `,
        [data]
      ),
      db.execute(
        `
        SELECT turma_id, COUNT(*) AS chamadas_pendentes
        FROM chamadas_diarias
        WHERE data_chamada = ? AND status = 'pendente'
        GROUP BY turma_id
        `,
        [data]
      ),
    ];

    if (incluirAlunosAtrasados) {
      consultasDashboard.push(
        db.execute(
          `
          SELECT
            f.id,
            f.aluno_id AS alunoId,
            f.aluno_nome AS nome,
            f.turma_id AS turmaId,
            f.turma_nome AS turma,
            f.status,
            f.atrasado,
            TIME_FORMAT(rcc.horario_chamada, '%H:%i:%s') AS horarioChamada,
            TIME_FORMAT(f.horario_registro_atraso, '%H:%i:%s') AS horarioRegistroAtraso,
            GREATEST(TIMESTAMPDIFF(MINUTE, rcc.horario_chamada, f.horario_registro_atraso), 0) AS minutosAtraso,
            DATE_FORMAT(f.atraso_registrado_em, '%Y-%m-%d %H:%i:%s') AS atrasoRegistradoEm,
            DATE_FORMAT(f.data_chamada, '%Y-%m-%d') AS dataChamada
          FROM registros_frequencia_alunos f
          INNER JOIN registros_chamadas_confirmadas rcc ON rcc.id = f.registro_chamada_id
          WHERE rcc.data_chamada = ?
            AND f.atrasado = TRUE
          ORDER BY f.turma_nome ASC, f.horario_registro_atraso ASC, f.aluno_nome ASC
          `,
          [data]
        )
      );
    }

    const [[turmas], [resumoConfirmadas], [resumoPendentes], [resumoPorTurma], [pendentesPorTurma], alunosAtrasadosResult = []] = await Promise.all(consultasDashboard);
    const alunosAtrasadosRows = alunosAtrasadosResult[0] || [];

    const confirmadas = resumoConfirmadas[0] || {};
    const totalPresentes = Number(confirmadas.totalPresentes || 0);
    const totalFaltas = Number(confirmadas.totalFaltas || 0);
    const totalJustificadas = Number(confirmadas.totalJustificadas || 0);
    const totalAtrasos = Number(confirmadas.totalAtrasos || 0);
    const totalLancamentos = totalPresentes + totalFaltas;

    const mapaTurmas = new Map(
      resumoPorTurma.map((item) => [
        Number(item.turma_id || 0),
        {
          presentes: Number(item.presentes || 0),
          faltas: Number(item.faltas || 0),
          justificadas: Number(item.justificadas || 0),
          atrasos: Number(item.atrasos || 0),
          chamadas_confirmadas: Number(item.chamadas_confirmadas || 0),
        },
      ])
    );

    const mapaPendentes = new Map(
      pendentesPorTurma.map((item) => [Number(item.turma_id || 0), Number(item.chamadas_pendentes || 0)])
    );

    const turmasDoDia = turmas.map((turma) => {
      const resumo = mapaTurmas.get(Number(turma.id)) || {
        presentes: 0,
        faltas: 0,
        justificadas: 0,
        atrasos: 0,
        chamadas_confirmadas: 0,
      };
      const chamadasPendentesTurma = mapaPendentes.get(Number(turma.id)) || 0;

      return {
        id: turma.id,
        nome: turma.nome,
        total_alunos: Number(turma.total_alunos || 0),
        presentes: resumo.presentes,
        faltas: resumo.faltas,
        justificadas: resumo.justificadas,
        atrasos: resumo.atrasos,
        status_chamada: resumo.chamadas_confirmadas > 0 ? "finalizada" : chamadasPendentesTurma > 0 ? "aguardando_confirmacao" : "pendente",
      };
    });

    return res.json({
      data,
      resumo: {
        chamadasHoje: Number(confirmadas.chamadasHoje || 0),
        chamadasPendentes: Number(resumoPendentes[0]?.pendentes || 0),
        totalPresentes,
        totalFaltas,
        totalJustificadas,
        totalAtrasos,
        taxaFrequencia: totalLancamentos > 0 ? Math.round((totalPresentes / totalLancamentos) * 100) : 0,
      },
      alunosAtrasados: alunosAtrasadosRows.map((aluno) => ({
        ...aluno,
        atrasado: Boolean(aluno.atrasado),
      })),
      turmas: turmasDoDia,
    });
  } catch (error) {
    return next(error);
  }
}

async function chamadasDoDia(req, res, next) {
  try {
    const data = req.query.data || hojeLocalISO();
    const [rows] = await db.execute(
      `
      SELECT id, professor_id, professor_nome, turma_id, turma_nome, materia,
             data_chamada, horario_chamada, alunos, total_presentes, total_ausentes, status
      FROM chamadas_diarias
      WHERE data_chamada = ? AND status = 'pendente'
      ORDER BY horario_chamada DESC, id DESC
      `,
      [data]
    );

    return res.json({ chamadas: rows.map((chamada) => ({ ...chamada, alunos: parseAlunos(chamada.alunos) })) });
  } catch (error) {
    return next(error);
  }
}

async function chamadasConfirmadasHoje(req, res, next) {
  try {
    const data = req.query.data || hojeLocalISO();
    const [rows] = await db.execute(
      `
      SELECT id, chamada_diaria_id_origem, professor_id, professor_nome, pedagoga_id, pedagoga_nome,
             turma_id, turma_nome, materia, data_chamada, horario_chamada,
             total_presentes, total_ausentes, total_justificados, total_atrasos, observacao, confirmado_em
      FROM registros_chamadas_confirmadas
      WHERE data_chamada = ?
      ORDER BY confirmado_em DESC, id DESC
      `,
      [data]
    );

    return res.json({ chamadas: rows });
  } catch (error) {
    return next(error);
  }
}

async function detalharChamadaConfirmada(req, res, next) {
  try {
    const id = Number(req.params.id);
    const data = hojeLocalISO();

    const [chamadas] = await db.execute(
      `
      SELECT id, chamada_diaria_id_origem, professor_id, professor_nome, pedagoga_id, pedagoga_nome,
             turma_id, turma_nome, materia, data_chamada, horario_chamada,
             total_presentes, total_ausentes, total_justificados, total_atrasos, observacao, confirmado_em
      FROM registros_chamadas_confirmadas
      WHERE id = ? AND data_chamada = ?
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
        j.id AS justificativa_id,
        j.motivo
      FROM registros_frequencia_alunos f
      LEFT JOIN justificativas_frequencia j ON j.frequencia_aluno_id = f.id
      WHERE f.registro_chamada_id = ?
      ORDER BY f.aluno_nome ASC
      `,
      [id]
    );

    return res.json({ chamada: { ...chamadas[0], alunos } });
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
             horario_chamada, alunos, total_presentes, total_ausentes, status
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

    const alunosBase = Array.isArray(req.body.alunos) && req.body.alunos.length > 0
      ? req.body.alunos
      : parseAlunos(chamada.alunos);

    const alunos = prepararAlunosParaConfirmacao(alunosBase);
    await validarAlunosPertencemTurma(connection, chamada.turma_id, alunos);

    const [confirmacaoExistente] = await connection.execute(
      "SELECT id FROM registros_chamadas_confirmadas WHERE chamada_diaria_id_origem = ? LIMIT 1 FOR UPDATE",
      [chamada.id]
    );
    if (confirmacaoExistente[0]) {
      const erro = new Error("Essa chamada já foi confirmada anteriormente.");
      erro.status = 409;
      throw erro;
    }

    const totais = contarTotais(alunos);

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
          (registro_chamada_id, aluno_id, aluno_nome, turma_id, turma_nome, materia, data_chamada, status, atrasado, horario_registro_atraso, atraso_registrado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          aluno.atrasado ? (aluno.horario_registro_atraso || chamada.horario_chamada) : null,
          aluno.atrasado ? (aluno.atraso_registrado_em || null) : null,
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
      }
    }

    await connection.execute(
      "UPDATE chamadas_diarias SET status = 'confirmada' WHERE id = ?",
      [chamada.id]
    );

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
      SELECT f.*, r.data_chamada
      FROM registros_frequencia_alunos f
      INNER JOIN registros_chamadas_confirmadas r ON r.id = f.registro_chamada_id
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

    await connection.execute(
      `
      UPDATE registros_frequencia_alunos
      SET status = ?,
          atrasado = ?,
          horario_registro_atraso = CASE WHEN ? = 1 THEN COALESCE(horario_registro_atraso, ?) ELSE NULL END,
          atraso_registrado_em = CASE WHEN ? = 1 THEN COALESCE(atraso_registrado_em, ?) ELSE NULL END
      WHERE id = ?
      `,
      [status, atrasado ? 1 : 0, atrasado ? 1 : 0, horarioBrasilia(), atrasado ? 1 : 0, dataHoraBrasiliaMySQL(), frequenciaId]
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
    }

    const [[totais]] = await connection.execute(
      `
      SELECT
        SUM(status = 'presente') AS total_presentes,
        SUM(status IN ('ausente', 'justificado')) AS total_ausentes,
        SUM(status = 'justificado') AS total_justificados,
        SUM(atrasado = TRUE) AS total_atrasos
      FROM registros_frequencia_alunos
      WHERE registro_chamada_id = ?
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
    const totais = contarTotais(alunosPreparados);

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
    const alunos = montarAlunosJSON(req.body.alunos);

    if (!chamadaId) return res.status(400).json({ erro: "Chamada inválida." });

    const alunosPreparados = prepararAlunosParaConfirmacao(alunos);

    const [chamadasAtuais] = await db.execute(
      "SELECT turma_id FROM chamadas_diarias WHERE id = ? AND status = 'pendente' AND data_chamada = ? LIMIT 1",
      [chamadaId, dataBrasiliaISO()]
    );
    if (!chamadasAtuais[0]) return res.status(404).json({ erro: "Chamada pendente de hoje não encontrada." });

    await validarAlunosPertencemTurma(db, chamadasAtuais[0].turma_id, alunosPreparados);
    const totais = contarTotais(alunosPreparados);

    const [result] = await db.execute(
      `
      UPDATE chamadas_diarias
      SET materia = ?, alunos = ?, total_presentes = ?, total_ausentes = ?
      WHERE id = ? AND status = 'pendente' AND data_chamada = ?
      `,
      [materia, JSON.stringify(alunos), totais.total_presentes, totais.total_ausentes, chamadaId, dataBrasiliaISO()]
    );

    if (result.affectedRows === 0) return res.status(404).json({ erro: "Chamada pendente de hoje não encontrada." });

    return res.json({ mensagem: "Chamada atualizada com sucesso." });
  } catch (error) {
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
    const { paginaAtual, limite, offset } = normalizarPaginacaoLista(req.query);
    const busca = String(req.query.busca || "").trim().slice(0, 80);
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
      automacao: {
        ...automacaoCriada,
      },
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
        usuario_solicitante_id,
        usuario_solicitante_nome,
        maquina_destino,
        tipo_automacao,
        status,
        lock_owner,
        lock_adquirido_em,
        data_solicitacao,
        iniciado_em,
        concluido_em,
        tentativas,
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

    return res.json({ automacao: sanitizarAutomacao(rows[0]) });
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

