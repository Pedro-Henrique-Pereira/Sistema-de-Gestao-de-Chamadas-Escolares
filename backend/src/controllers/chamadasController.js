const db = require("../database/db");
const { garantirConfiguracao, horarioParaMinutos } = require("./configuracoesEscolaController");
const { garantirColunasAtraso } = require("../utils/atrasoUtils");
const chamadaService = require("../services/chamadaService");
const { safeLogError } = require("../utils/errorHandler");

const STATUS_VALIDOS = new Set(["presente", "ausente"]);

function alunoEstaAusente(aluno) {
  return String(aluno.status_presenca || aluno.status || "").toLowerCase() === "ausente";
}

function atrasoLiberadoPelaConfiguracao(config) {
  const limite = String(config.horario_limite_atraso || "07:45:00").slice(0, 8);
  const servidor = String(config.horario_servidor || "00:00:00").slice(0, 8);
  return horarioParaMinutos(servidor) <= horarioParaMinutos(limite);
}

function hojeLocalISO() {
  const agora = new Date();
  const offset = agora.getTimezoneOffset() * 60000;
  return new Date(agora.getTime() - offset).toISOString().slice(0, 10);
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

  return alunos.map((aluno) => {
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
    };
  }).filter((aluno) => aluno.aluno_id && aluno.nome);
}

function calcularTotais(alunos) {
  return alunos.reduce(
    (acc, aluno) => {
      if (aluno.status_presenca === "presente") acc.total_presentes += 1;
      else acc.total_ausentes += 1;
      return acc;
    },
    { total_presentes: 0, total_ausentes: 0 }
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
    const erro = new Error("A lista de alunos é obrigatória.");
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
    const atrasoLiberado = atrasoLiberadoPelaConfiguracao(configAtraso);

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
    const params = [Number(req.usuario.id)];

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
        (cd.professor_id = ?) AS pode_editar
      FROM chamadas_diarias cd
      ${where}
      ORDER BY cd.data_chamada DESC, cd.horario_chamada DESC, cd.id DESC
      LIMIT 200
      `,
      params
    );

    const chamadas = rows.map((chamada) => ({
      ...chamada,
      pode_editar: Boolean(chamada.pode_editar),
      pode_marcar_atraso: atrasoLiberado,
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

    const totais = calcularTotais(alunos);

    const [result] = await db.execute(
      `
      INSERT INTO chamadas_diarias
        (professor_id, professor_nome, turma_id, turma_nome, materia, data_chamada, alunos, total_presentes, total_ausentes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        professorId,
        professor.nome,
        turmaId,
        turma.nome,
        materia,
        dataChamada,
        JSON.stringify(alunos),
        totais.total_presentes,
        totais.total_ausentes,
      ]
    );

    return res.status(201).json({
      mensagem: "Chamada registrada com sucesso.",
      chamada: { id: result.insertId, ...totais },
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

    const [chamadas] = await db.execute(
      "SELECT id, professor_id, turma_id FROM chamadas_diarias WHERE id = ? LIMIT 1",
      [chamadaId]
    );

    const chamada = chamadas[0];
    if (!chamada) return res.status(404).json({ erro: "Chamada não encontrada." });

    if (Number(chamada.professor_id) !== professorId) {
      return res.status(403).json({ erro: "Você só pode editar chamadas feitas por você." });
    }

    const materia = normalizarMateria(req.body.materia || req.body.disciplina);
    const alunos = montarAlunosJSON(req.body.alunos);
    await validarAlunosPertencemTurma(db, chamada.turma_id, alunos);
    const totais = calcularTotais(alunos);

    if (!materia) return res.status(400).json({ erro: "Matéria é obrigatória." });

    await db.execute(
      `
      UPDATE chamadas_diarias
      SET materia = ?, alunos = ?, total_presentes = ?, total_ausentes = ?
      WHERE id = ? AND professor_id = ?
      `,
      [materia, JSON.stringify(alunos), totais.total_presentes, totais.total_ausentes, chamadaId, professorId]
    );

    return res.json({ mensagem: "Chamada atualizada com sucesso.", chamada: { id: chamadaId, ...totais } });
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

    await chamadaService.validarJanelaAtraso(connection);

    const [chamadas] = await connection.execute(
      `SELECT * FROM chamadas_diarias WHERE id = ? AND data_chamada = CURDATE() LIMIT 1 FOR UPDATE`,
      [chamadaId]
    );

    const chamada = chamadas[0];
    if (!chamada) {
      const erro = new Error("Chamada diária de hoje não encontrada.");
      erro.status = 404;
      throw erro;
    }

    if (req.usuario.tipo === "professor" && Number(chamada.professor_id) !== Number(req.usuario.id)) {
      const erro = new Error("Você não tem permissão para alterar chamada de outro professor.");
      erro.status = 403;
      throw erro;
    }
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
          return { ...aluno, status_presenca: "presente", status: "presente", atrasado: true, horario_registro_atraso: new Date().toTimeString().slice(0, 8), atraso_registrado_em: new Date().toISOString().slice(0, 19).replace("T", " ") };
        }
        return aluno;
      });

      if (!alterou) {
        const erro = new Error("Aluno não encontrado nesta chamada.");
        erro.status = 404;
        throw erro;
      }

      const totais = calcularTotais(alunosAtualizados);
      await connection.execute(
        `UPDATE chamadas_diarias
         SET alunos = ?, total_presentes = ?, total_ausentes = ?, atraso_processado = TRUE
         WHERE id = ?`,
        [JSON.stringify(alunosAtualizados), totais.total_presentes, totais.total_ausentes, chamadaId]
      );

      await connection.commit();
      transacaoIniciada = false;
      return res.json({ mensagem: "Aluno marcado como atrasado na chamada temporária.", origem: "temporaria", totais, alunos: alunosAtualizados });
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
         AND r.data_chamada = CURDATE()
         AND (r.chamada_diaria_id_origem = ? OR (r.turma_id = ? AND r.materia = ?))
       LIMIT 1
       FOR UPDATE`,
      [alunoId, chamadaId, chamada.turma_id, chamada.materia]
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
           horario_registro_atraso = COALESCE(horario_registro_atraso, CURTIME()),
           atraso_registrado_em = COALESCE(atraso_registrado_em, NOW())
       WHERE id = ?`,
      [frequencia.id]
    );

    const [[totais]] = await connection.execute(
      `SELECT
         SUM(status = 'presente') AS total_presentes,
         SUM(status IN ('ausente', 'justificado')) AS total_ausentes,
         SUM(status = 'justificado') AS total_justificados,
         SUM(atrasado = TRUE) AS total_atrasos
       FROM registros_frequencia_alunos
       WHERE registro_chamada_id = ?`,
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

