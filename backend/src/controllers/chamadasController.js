const db = require("../database/db");
const { garantirConfiguracao } = require("./configuracoesEscolaController");
const { garantirColunasAtraso } = require("../utils/atrasoUtils");
const chamadaService = require("../services/chamadaService");
const fluxoService = require("../services/chamadaFluxoService");
const { registrarAuditoria } = require("../services/chamadaAuditoriaService");
const { contarTotaisFrequencia, condicoesFrequenciaSql } = require("../services/frequenciaMetricasService");
const { safeLogError } = require("../utils/errorHandler");
const { dataBrasiliaISO, horarioBrasilia, dataHoraBrasiliaMySQL } = require("../utils/brasiliaTime");

const STATUS_VALIDOS = new Set(["presente", "ausente"]);
const FREQUENCIA_SQL = condicoesFrequenciaSql("f");

function alunoEstaAusente(aluno) {
  return String(aluno.status_presenca || aluno.status || "").toLowerCase() === "ausente";
}

function atrasoLiberadoPelaConfiguracao(config, usuario) {
  return fluxoService.canRegisterStudentDelay(config, usuario);
}

function hojeLocalISO() {
  return dataBrasiliaISO();
}

function normalizarMateria(materia) {
  return String(materia || "").trim();
}

function montarAlunosJSON(alunos = []) {
  if (!Array.isArray(alunos) || alunos.length === 0) {
    const erro = new Error("A lista de alunos é obrigatória.");
    erro.status = 400;
    throw erro;
  }

  const alunosNormalizados = alunos.map((aluno) => {
    const status = STATUS_VALIDOS.has(aluno.status_presenca)
      ? aluno.status_presenca
      : STATUS_VALIDOS.has(aluno.status)
        ? aluno.status
        : "ausente";

    const atrasado = Boolean(aluno.atrasado) && status !== "ausente";

    return {
      aluno_id: Number(aluno.id || aluno.aluno_id || aluno.alunoId),
      nome: String(aluno.nome || "").trim(),
      status_presenca: atrasado ? "presente" : status,
      atrasado,
      horario_registro_atraso: atrasado ? (aluno.horario_registro_atraso || aluno.horarioRegistroAtraso || null) : null,
      atraso_registrado_em: atrasado ? (aluno.atraso_registrado_em || aluno.atrasoRegistradoEm || null) : null,
      atraso_minutos: atrasado ? Number(aluno.atraso_minutos || aluno.atrasoMinutos || 0) : null,
      motivo: String(aluno.motivo || aluno.justificativa || "").trim() || null,
    };
  });

  if (alunosNormalizados.some((aluno) => !aluno.aluno_id || !aluno.nome)) {
    const erro = new Error("Todos os alunos precisam possuir ID e nome válidos.");
    erro.status = 400;
    throw erro;
  }

  return alunosNormalizados;
}

async function validarAlunosPertencemTurma(connection, turmaId, alunos) {
  const ids = [...new Set(alunos.map((aluno) => Number(aluno.aluno_id)).filter(Boolean))];

  if (ids.length !== alunos.length) {
    const erro = new Error("Lista de alunos inválida ou com IDs duplicados.");
    erro.status = 400;
    throw erro;
  }

  if (ids.length === 0) {
    const erro = new Error("A lista de alunos é obrigatória.");
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


async function existeChamadaParaTurmaNaData(connection, turmaId, dataChamada, ignorarChamadaDiariaId = null) {
  const paramsDiarias = [turmaId, dataChamada];
  let filtroIgnorar = "";

  if (ignorarChamadaDiariaId) {
    filtroIgnorar = "AND id <> ?";
    paramsDiarias.push(Number(ignorarChamadaDiariaId));
  }

  const [temporarias] = await connection.execute(
    `SELECT id, status, 'temporaria' AS origem
     FROM chamadas_diarias
     WHERE turma_id = ?
       AND data_chamada = ?
       AND status <> 'cancelada'
       ${filtroIgnorar}
     LIMIT 1`,
    paramsDiarias
  );

  if (temporarias[0]) return temporarias[0];

  const [confirmadas] = await connection.execute(
    `SELECT id, 'confirmada' AS status, 'confirmada' AS origem
     FROM registros_chamadas_confirmadas
     WHERE turma_id = ?
       AND data_chamada = ?
     LIMIT 1`,
    [turmaId, dataChamada]
  );

  return confirmadas[0] || null;
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

async function verificarTurmas(req, res, next) {
  try {
    const data = req.query.data || hojeLocalISO();
    const materia = normalizarMateria(req.query.materia);

    const configAtraso = await garantirConfiguracao();
    const atrasoLiberado = atrasoLiberadoPelaConfiguracao(configAtraso, req.usuario);

    const [rows] = await db.execute(
      `
      SELECT
        t.id,
        t.nome,
        COALESCE(
          JSON_ARRAYAGG(
            CASE
              WHEN a.id IS NULL THEN NULL
              ELSE JSON_OBJECT('id', a.id, 'nome', a.nome)
            END
          ),
          JSON_ARRAY()
        ) AS alunos
      FROM turmas t
      LEFT JOIN alunos a ON a.turma_id = t.id
      WHERE NOT EXISTS (
        SELECT 1
        FROM chamadas_diarias cd
        WHERE cd.turma_id = t.id
          AND cd.data_chamada = ?
          AND cd.status <> 'cancelada'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM registros_chamadas_confirmadas rcc
        WHERE rcc.turma_id = t.id
          AND rcc.data_chamada = ?
      )
      GROUP BY t.id, t.nome
      ORDER BY t.nome ASC
      `,
      [data, data]
    );

    const turmas = rows.map((turma) => ({
      ...turma,
      alunos: parseAlunos(turma.alunos).filter(Boolean),
    }));

    return res.json({ turmas });
  } catch (error) {
    return next(error);
  }
}

async function historico(req, res, next) {
  try {
    const { data, turma_id, materia } = req.query;
    const filtros = [];
    const params = [];

    if (req.usuario.tipo === "professor") {
      filtros.push("cd.professor_id = ?");
      params.push(Number(req.usuario.id));
    }

    if (data) {
      filtros.push("cd.data_chamada = ?");
      params.push(data);
    }

    if (turma_id) {
      filtros.push("cd.turma_id = ?");
      params.push(Number(turma_id));
    }

    if (materia) {
      filtros.push("cd.materia = ?");
      params.push(normalizarMateria(materia));
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
    const configAtraso = await garantirConfiguracao();
    const atrasoLiberado = atrasoLiberadoPelaConfiguracao(configAtraso);

    const [rows] = await db.execute(
      `
      SELECT
        cd.id,
        cd.professor_id,
        cd.professor_nome,
        cd.turma_id,
        cd.turma_nome,
        cd.materia,
        cd.data_chamada,
        cd.horario_chamada,
        cd.alunos,
        cd.total_presentes,
        cd.total_ausentes,
        cd.status,
        cd.confirmado_em,
        cd.versao
      FROM chamadas_diarias cd
      ${where}
      ORDER BY cd.data_chamada DESC, cd.horario_chamada DESC, cd.id DESC
      LIMIT 200
      `,
      params
    );

    const chamadas = rows.map((chamada) => ({
      ...chamada,
      status_fluxo: fluxoService.statusEfetivo(chamada, configAtraso, req.usuario),
      pode_editar: fluxoService.canProfessorEditCall(chamada, req.usuario).permitido,
      pode_marcar_atraso: atrasoLiberado && fluxoService.canProfessorEditCall(chamada, req.usuario).permitido,
      atraso_liberado: atrasoLiberado,
      alunos: parseAlunos(chamada.alunos),
    }));

    return res.json({ chamadas });
  } catch (error) {
    return next(error);
  }
}

async function criar(req, res, next) {
  try {
    const professorId = Number(req.usuario.id);
    const turmaId = Number(req.body.turma_id || req.body.turmaId);
    const materia = normalizarMateria(req.body.materia || req.body.disciplina);
    const dataChamada = req.body.data_chamada || hojeLocalISO();
    const alunos = montarAlunosJSON(req.body.alunos);

    if (!turmaId || !materia) {
      return res.status(400).json({ erro: "Turma e matéria são obrigatórias." });
    }

    const [[professor], [turma]] = await Promise.all([
      db.execute("SELECT id, nome FROM usuarios WHERE id = ? AND ativo = TRUE LIMIT 1", [professorId]).then(([r]) => r),
      db.execute("SELECT id, nome FROM turmas WHERE id = ? LIMIT 1", [turmaId]).then(([r]) => r),
    ]);

    if (!professor) return res.status(404).json({ erro: "Professor não encontrado." });
    if (!turma) return res.status(404).json({ erro: "Turma não encontrada." });

    await validarAlunosPertencemTurma(db, turmaId, alunos);

    const chamadaExistente = await existeChamadaParaTurmaNaData(db, turmaId, dataChamada);

    if (chamadaExistente) {
      return res.status(409).json({ erro: "Essa turma já possui chamada hoje. Não é permitido registrar chamada duplicada para a mesma turma na mesma data." });
    }

    const totais = contarTotaisFrequencia(alunos);

    const result = await chamadaService.executarTransacao(db, async (connection) => {
      const [insertResult] = await connection.execute(
        `INSERT INTO chamadas_diarias
          (professor_id, professor_nome, turma_id, turma_nome, materia, data_chamada, alunos, total_presentes, total_ausentes, status, versao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 1)`,
        [professorId, professor.nome, turmaId, turma.nome, materia, dataChamada, JSON.stringify(alunos), totais.total_presentes, totais.total_ausentes]
      );

      await registrarAuditoria(connection, {
        chamadaId: insertResult.insertId,
        usuario: req.usuario,
        evento: "CHAMADA_CRIADA",
        valoresNovos: { status: "TEMPORARIA", turma_id: turmaId, materia, totais },
      });
      return insertResult;
    });

    return res.status(201).json({
      mensagem: "Chamada temporária salva e enviada para revisão da pedagogia.",
      chamada: { id: result.insertId, status: "pendente", status_fluxo: "TEMPORARIA", versao: 1, ...totais },
    });
  } catch (error) {
    if (erroDuplicidadeChamada(error)) {
      const erro = new Error("Essa turma já possui chamada ativa nessa data.");
      erro.status = 409;
      return next(erro);
    }
    return next(error);
  }
}

async function atualizar(req, res, next) {
  try {
    const chamadaId = Number(req.params.id);
    const professorId = Number(req.usuario.id);

    const resultado = await chamadaService.executarTransacao(db, async (connection) => {
      const [chamadas] = await connection.execute(
        "SELECT id, professor_id, turma_id, status, versao, materia, alunos FROM chamadas_diarias WHERE id = ? LIMIT 1 FOR UPDATE",
        [chamadaId]
      );

      const chamada = chamadas[0];
      if (!chamada) {
        const erro = new Error("Chamada nao encontrada.");
        erro.status = 404;
        throw erro;
      }

      fluxoService.assertPermission(fluxoService.canProfessorEditCall(chamada, req.usuario));
      fluxoService.assertPermission(fluxoService.validateCallVersion(chamada, req.body.versao), 409);

      if (fluxoService.hasNewStudentDelay(parseAlunos(chamada.alunos), req.body.alunos)) {
        const configFluxo = await garantirConfiguracao(connection);
        fluxoService.assertPermission(
          fluxoService.canApplyStudentDelays(parseAlunos(chamada.alunos), req.body.alunos, configFluxo, req.usuario)
        );
      }

      const materia = normalizarMateria(req.body.materia || req.body.disciplina);
      const alunos = montarAlunosJSON(req.body.alunos);
      fluxoService.assertPermission(
        fluxoService.validateCompleteStudentList(parseAlunos(chamada.alunos), alunos),
        409
      );
      const totais = contarTotaisFrequencia(alunos);

      if (!materia) {
        const erro = new Error("Matéria é obrigatória.");
        erro.status = 400;
        throw erro;
      }

      const [resultadoAtualizacao] = await connection.execute(
        `
        UPDATE chamadas_diarias
        SET materia = ?, alunos = ?, total_presentes = ?, total_ausentes = ?, versao = versao + 1
        WHERE id = ? AND professor_id = ? AND status = 'pendente' AND versao = ?
        `,
        [materia, JSON.stringify(alunos), totais.total_presentes, totais.total_ausentes, chamadaId, professorId, chamada.versao]
      );

      if (resultadoAtualizacao.affectedRows !== 1) {
        fluxoService.assertPermission(fluxoService.validateCallVersion(null, null), 409);
      }

      await registrarAuditoria(connection, {
        chamadaId,
        usuario: req.usuario,
        evento: "CHAMADA_EDITADA_PELO_PROFESSOR",
        valoresAnteriores: { materia: chamada.materia, alunos: parseAlunos(chamada.alunos), versao: chamada.versao },
        valoresNovos: { materia, alunos, versao: Number(chamada.versao) + 1 },
      });

      return {
        chamada: {
          id: chamadaId,
          versao: Number(chamada.versao) + 1,
          ...totais,
        },
      };
    });

    return res.json({
      mensagem: "Chamada temporária atualizada com sucesso.",
      chamada: resultado.chamada,
    });
  } catch (error) {
    return next(error);
  }
}


async function marcarAtraso(req, res, next) {
  const connection = await db.getConnection();
  let transacaoIniciada = false;

  try {
    const chamadaId = Number(req.params.id);
    const alunoId = Number(req.body.aluno_id || req.body.alunoId || req.body.id);

    if (!chamadaId || !alunoId) {
      return res.status(400).json({ erro: "Chamada e aluno são obrigatórios." });
    }

    await garantirColunasAtraso(connection);
    await connection.beginTransaction();
    transacaoIniciada = true;

    const configFluxo = await garantirConfiguracao(connection);
    if (!fluxoService.canRegisterStudentDelay(configFluxo, req.usuario)) {
      const erro = new Error(fluxoService.MENSAGENS.HORARIO_ENCERRADO);
      erro.status = 403;
      throw erro;
    }

    const [chamadas] = await connection.execute(
      `SELECT id, turma_id, turma_nome, professor_id, professor_nome, materia, data_chamada, horario_chamada, alunos, total_presentes, total_ausentes, status, versao FROM chamadas_diarias WHERE id = ? AND data_chamada = ? LIMIT 1 FOR UPDATE`,
      [chamadaId, dataBrasiliaISO()]
    );

    const chamada = chamadas[0];
    if (!chamada) {
      const erro = new Error("Chamada diária de hoje não encontrada.");
      erro.status = 404;
      throw erro;
    }

    const permissao = req.usuario.tipo === "professor"
      ? fluxoService.canProfessorEditCall(chamada, req.usuario)
      : fluxoService.canPedagogueEditCall(chamada, req.usuario, configFluxo);
    fluxoService.assertPermission(permissao);
    fluxoService.assertPermission(fluxoService.validateCallVersion(chamada, req.body.versao), 409);

    const horarioMarcacao = horarioBrasilia();
    const atrasoMinutos = fluxoService.calculateStudentDelay(chamada.horario_chamada, horarioMarcacao);

    if (chamada.status === "pendente") {
      const alunos = parseAlunos(chamada.alunos);
      let alterou = false;
      const alunosAtualizados = alunos.map((aluno) => {
        const id = Number(aluno.aluno_id || aluno.alunoId || aluno.id);
        if (id === alunoId) {
          if (!alunoEstaAusente(aluno)) {
            const erro = new Error("Só é permitido transformar alunos ausentes em atrasados.");
            erro.status = 409;
            throw erro;
          }
          alterou = true;
          return { ...aluno, status_presenca: "presente", status: "presente", atrasado: true, horario_registro_atraso: horarioMarcacao, atraso_registrado_em: dataHoraBrasiliaMySQL(), atraso_minutos: atrasoMinutos, alterado_por_id: Number(req.usuario.id) };
        }
        return aluno;
      });

      if (!alterou) {
        const erro = new Error("Aluno não encontrado nesta chamada.");
        erro.status = 404;
        throw erro;
      }

      const totais = contarTotaisFrequencia(alunosAtualizados);
      await connection.execute(
        `UPDATE chamadas_diarias
         SET alunos = ?, total_presentes = ?, total_ausentes = ?, atraso_processado = TRUE, versao = versao + 1
         WHERE id = ? AND versao = ?`,
        [JSON.stringify(alunosAtualizados), totais.total_presentes, totais.total_ausentes, chamadaId, chamada.versao]
      );

      await registrarAuditoria(connection, {
        chamadaId,
        usuario: req.usuario,
        evento: "ALUNO_MARCADO_COMO_ATRASADO",
        valoresNovos: {
          aluno_id: alunoId,
          horario_registro_atraso: horarioMarcacao,
          atraso_minutos: atrasoMinutos,
          edicao_apos_horario: fluxoService.canPedagogueBypassMaximumArrivalTime(configFluxo, req.usuario)
            && fluxoService.hasMaximumArrivalTimePassed(configFluxo),
        },
      });

      await connection.commit();
      transacaoIniciada = false;
      return res.json({
        mensagem: "Aluno marcado como atrasado na chamada temporária.",
        origem: "temporaria",
        totais,
        versao: Number(chamada.versao) + 1,
      });
    }

    if (chamada.status !== "confirmada") {
      const erro = new Error("Atraso só pode ser lançado em chamada pendente ou confirmada.");
      erro.status = 409;
      throw erro;
    }

    const [frequencias] = await connection.execute(
      `SELECT f.*
       FROM registros_frequencia_alunos f
       INNER JOIN registros_chamadas_confirmadas r ON r.id = f.registro_chamada_id
       WHERE f.aluno_id = ?
         AND r.data_chamada = ?
         AND (r.chamada_diaria_id_origem = ? OR (r.turma_id = ? AND r.materia = ?))
       LIMIT 1
       FOR UPDATE`,
      [alunoId, dataBrasiliaISO(), chamadaId, chamada.turma_id, chamada.materia]
    );

    const frequencia = frequencias[0];
    if (!frequencia) {
      const erro = new Error("Registro permanente do aluno não encontrado.");
      erro.status = 404;
      throw erro;
    }

    if (frequencia.status !== "ausente") {
      const erro = new Error("Só é permitido transformar alunos ausentes em atrasados.");
      erro.status = 409;
      throw erro;
    }

    await connection.execute(
      `UPDATE registros_frequencia_alunos
       SET status = 'presente',
           atrasado = TRUE,
           horario_registro_atraso = COALESCE(horario_registro_atraso, ?),
           atraso_registrado_em = COALESCE(atraso_registrado_em, ?),
           atraso_minutos = ?,
           alterado_por_id = ?
       WHERE id = ?`,
      [horarioMarcacao, dataHoraBrasiliaMySQL(), atrasoMinutos, req.usuario.id, frequencia.id]
    );

    const [[totais]] = await connection.execute(
      `SELECT
         SUM(${FREQUENCIA_SQL.presente}) AS total_presentes,
         SUM(${FREQUENCIA_SQL.ausente}) AS total_ausentes,
         SUM(${FREQUENCIA_SQL.justificado}) AS total_justificados,
         SUM(${FREQUENCIA_SQL.atrasado}) AS total_atrasos
       FROM registros_frequencia_alunos f
       WHERE f.registro_chamada_id = ?`,
      [frequencia.registro_chamada_id]
    );

    await connection.execute(
      `UPDATE registros_chamadas_confirmadas
       SET total_presentes = ?, total_ausentes = ?, total_justificados = ?, total_atrasos = ?
       WHERE id = ?`,
      [
        Number(totais.total_presentes || 0),
        Number(totais.total_ausentes || 0),
        Number(totais.total_justificados || 0),
        Number(totais.total_atrasos || 0),
        frequencia.registro_chamada_id,
      ]
    );

    await connection.execute(
      "UPDATE chamadas_diarias SET versao = versao + 1 WHERE id = ? AND versao = ?",
      [chamadaId, chamada.versao]
    );
    await registrarAuditoria(connection, {
      chamadaId,
      usuario: req.usuario,
      evento: "ALUNO_MARCADO_COMO_ATRASADO",
      valoresAnteriores: { aluno_id: alunoId, status: frequencia.status, atrasado: Boolean(frequencia.atrasado) },
      valoresNovos: {
        aluno_id: alunoId,
        status: "presente",
        atrasado: true,
        horario_registro_atraso: horarioMarcacao,
        atraso_minutos: atrasoMinutos,
        edicao_apos_horario: fluxoService.canPedagogueBypassMaximumArrivalTime(configFluxo, req.usuario)
          && fluxoService.hasMaximumArrivalTimePassed(configFluxo),
      },
    });

    await connection.commit();
    transacaoIniciada = false;
    return res.json({
      mensagem: "Aluno marcado como atrasado na chamada permanente.",
      origem: "permanente",
      totais: {
        total_presentes: Number(totais.total_presentes || 0),
        total_ausentes: Number(totais.total_ausentes || 0),
        total_justificados: Number(totais.total_justificados || 0),
        total_atrasos: Number(totais.total_atrasos || 0),
      },
    });
  } catch (error) {
    if (transacaoIniciada) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        safeLogError("chamadasController.marcarAtraso.rollback", rollbackError);
      }
    }
    if (error.message === fluxoService.MENSAGENS.HORARIO_ENCERRADO) {
      registrarAuditoria(db, {
        chamadaId: Number(req.params.id),
        usuario: req.usuario,
        evento: "EDICAO_BLOQUEADA_POR_HORARIO",
        valoresNovos: { rota: req.originalUrl },
      }).catch(() => {});
    }
    return next(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  verificarTurmas,
  historico,
  criar,
  atualizar,
  marcarAtraso,
};
