const db = require("../database/connection");

async function painel(req, res, next) {
  try {
    const [[alunosRow], [metricasRows]] = await Promise.all([
      db.execute("SELECT COUNT(*) AS total FROM alunos"),
      db.execute(`
        SELECT
          COALESCE(SUM(f.status = 'presente'), 0) AS presentes,
          COALESCE(SUM(f.status IN ('ausente', 'justificado')), 0) AS ausentes,
          COALESCE(SUM(f.status = 'justificado'), 0) AS justificados,
          COALESCE(SUM(f.atrasado = TRUE), 0) AS atrasos
        FROM registros_frequencia_alunos f
        INNER JOIN registros_chamadas_confirmadas rcc ON rcc.id = f.registro_chamada_id
        WHERE rcc.data_chamada = CURDATE()
      `),
    ]);

    const metricas = metricasRows[0] || {};

    res.json({
      alunosCadastrados: Number(alunosRow[0]?.total || 0),
      presentes: Number(metricas.presentes || 0),
      ausentes: Number(metricas.ausentes || 0),
      justificados: Number(metricas.justificados || 0),
      atrasos: Number(metricas.atrasos || 0),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { painel };
