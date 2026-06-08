const db = require("../database/connection");
const { dataBrasiliaISO } = require("../utils/brasiliaTime");

async function painel(req, res, next) {
  try {
    const incluirAlunosAtrasados = String(req.query.incluirAlunosAtrasados || req.query.incluir_alunos_atrasados || "") === "1";

    const consultasBase = [
      db.execute("SELECT COUNT(*) AS total FROM alunos"),
      db.execute(`
        SELECT
          COALESCE(SUM(f.status = 'presente'), 0) AS presentes,
          COALESCE(SUM(f.status IN ('ausente', 'justificado')), 0) AS ausentes,
          COALESCE(SUM(f.status = 'justificado'), 0) AS justificados,
          COALESCE(SUM(f.atrasado = TRUE), 0) AS atrasos
        FROM registros_frequencia_alunos f
        INNER JOIN registros_chamadas_confirmadas rcc ON rcc.id = f.registro_chamada_id
        WHERE rcc.data_chamada = ?
      `, [dataBrasiliaISO()]),
    ];

    if (incluirAlunosAtrasados) {
      consultasBase.push(
        db.execute(`
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
        `, [dataBrasiliaISO()])
      );
    }

    const [[alunosRow], [metricasRows], alunosAtrasadosResult = []] = await Promise.all(consultasBase);
    const alunosAtrasadosRows = alunosAtrasadosResult[0] || [];
    const metricas = metricasRows[0] || {};

    res.json({
      alunosCadastrados: Number(alunosRow[0]?.total || 0),
      presentes: Number(metricas.presentes || 0),
      ausentes: Number(metricas.ausentes || 0),
      justificados: Number(metricas.justificados || 0),
      atrasos: Number(metricas.atrasos || 0),
      alunosAtrasados: alunosAtrasadosRows.map((aluno) => ({
        ...aluno,
        atrasado: Boolean(aluno.atrasado),
      })),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { painel };
