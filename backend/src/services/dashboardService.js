const db = require("../database/db");
const { condicoesFrequenciaSql } = require("./frequenciaMetricasService");

const FREQUENCIA_SQL = condicoesFrequenciaSql("f");

function montarDashboardCompartilhado({
  data,
  totalAlunosRows = [],
  turmasRows = [],
  resumoConfirmadasRows = [],
  resumoPendentesRows = [],
  resumoPorTurmaRows = [],
  pendentesPorTurmaRows = [],
  alunosAtrasadosRows = [],
}) {
  const confirmadas = resumoConfirmadasRows[0] || {};
  const alunosCadastrados = Number(totalAlunosRows[0]?.total || 0);
  const totalPresentes = Number(confirmadas.totalPresentes || 0);
  const totalFaltas = Number(confirmadas.totalFaltas || 0);
  const totalJustificadas = Number(confirmadas.totalJustificadas || 0);
  const totalAtrasos = Number(confirmadas.totalAtrasos || 0);
  const totalLancamentos = totalPresentes + totalFaltas;

  const mapaTurmas = new Map(
    resumoPorTurmaRows.map((item) => [
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
    pendentesPorTurmaRows.map((item) => [
      Number(item.turma_id || 0),
      Number(item.chamadas_pendentes || 0),
    ])
  );

  const turmas = turmasRows.map((turma) => {
    const resumo = mapaTurmas.get(Number(turma.id)) || {
      presentes: 0,
      faltas: 0,
      justificadas: 0,
      atrasos: 0,
      chamadas_confirmadas: 0,
    };
    const chamadasPendentes = mapaPendentes.get(Number(turma.id)) || 0;

    return {
      id: turma.id,
      nome: turma.nome,
      total_alunos: Number(turma.total_alunos || 0),
      presentes: resumo.presentes,
      faltas: resumo.faltas,
      justificadas: resumo.justificadas,
      atrasos: resumo.atrasos,
      status_chamada: resumo.chamadas_confirmadas > 0
        ? "finalizada"
        : chamadasPendentes > 0
          ? "aguardando_confirmacao"
          : "pendente",
    };
  });

  const resumo = {
    alunosCadastrados,
    chamadasHoje: Number(confirmadas.chamadasHoje || 0),
    chamadasPendentes: Number(resumoPendentesRows[0]?.pendentes || 0),
    totalPresentes,
    totalFaltas,
    totalJustificadas,
    totalAtrasos,
    taxaFrequencia: totalLancamentos > 0
      ? Math.round((totalPresentes / totalLancamentos) * 100)
      : 0,
  };

  return {
    data,
    resumo,
    turmas,
    alunosAtrasados: alunosAtrasadosRows.map((aluno) => ({
      ...aluno,
      atrasado: Boolean(aluno.atrasado),
    })),
    alunosCadastrados,
    presentes: totalPresentes,
    ausentes: totalFaltas,
    justificados: totalJustificadas,
    atrasos: totalAtrasos,
  };
}

async function obterDashboardDia({
  data,
  incluirAlunosAtrasados = false,
  database = db,
}) {
  const consultas = [
    database.execute("SELECT COUNT(*) AS total FROM alunos"),
    database.execute(`
      SELECT t.id, t.nome, COUNT(a.id) AS total_alunos
      FROM turmas t
      LEFT JOIN alunos a ON a.turma_id = t.id
      GROUP BY t.id, t.nome
      ORDER BY t.nome ASC
    `),
    database.execute(`
      SELECT
        COUNT(DISTINCT rcc.id) AS chamadasHoje,
        COALESCE(SUM(${FREQUENCIA_SQL.presente}), 0) AS totalPresentes,
        COALESCE(SUM(${FREQUENCIA_SQL.ausente}), 0) AS totalFaltas,
        COALESCE(SUM(${FREQUENCIA_SQL.justificado}), 0) AS totalJustificadas,
        COALESCE(SUM(${FREQUENCIA_SQL.atrasado}), 0) AS totalAtrasos
      FROM registros_chamadas_confirmadas rcc
      LEFT JOIN registros_frequencia_alunos f ON f.registro_chamada_id = rcc.id
      WHERE rcc.data_chamada = ?
    `, [data]),
    database.execute(`
      SELECT COUNT(*) AS pendentes
      FROM chamadas_diarias
      WHERE data_chamada = ? AND status = 'pendente'
    `, [data]),
    database.execute(`
      SELECT
        rcc.turma_id,
        COALESCE(SUM(${FREQUENCIA_SQL.presente}), 0) AS presentes,
        COALESCE(SUM(${FREQUENCIA_SQL.ausente}), 0) AS faltas,
        COALESCE(SUM(${FREQUENCIA_SQL.justificado}), 0) AS justificadas,
        COALESCE(SUM(${FREQUENCIA_SQL.atrasado}), 0) AS atrasos,
        COUNT(DISTINCT rcc.id) AS chamadas_confirmadas
      FROM registros_chamadas_confirmadas rcc
      LEFT JOIN registros_frequencia_alunos f ON f.registro_chamada_id = rcc.id
      WHERE rcc.data_chamada = ?
      GROUP BY rcc.turma_id
    `, [data]),
    database.execute(`
      SELECT turma_id, COUNT(*) AS chamadas_pendentes
      FROM chamadas_diarias
      WHERE data_chamada = ? AND status = 'pendente'
      GROUP BY turma_id
    `, [data]),
  ];

  if (incluirAlunosAtrasados) {
    consultas.push(database.execute(`
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
        COALESCE(
          f.atraso_minutos,
          GREATEST(TIMESTAMPDIFF(MINUTE, rcc.horario_chamada, f.horario_registro_atraso), 0)
        ) AS minutosAtraso,
        DATE_FORMAT(f.atraso_registrado_em, '%Y-%m-%d %H:%i:%s') AS atrasoRegistradoEm,
        DATE_FORMAT(f.data_chamada, '%Y-%m-%d') AS dataChamada
      FROM registros_frequencia_alunos f
      INNER JOIN registros_chamadas_confirmadas rcc ON rcc.id = f.registro_chamada_id
      WHERE rcc.data_chamada = ?
        AND f.atrasado = TRUE
      ORDER BY f.turma_nome ASC, f.horario_registro_atraso ASC, f.aluno_nome ASC
    `, [data]));
  }

  const resultados = await Promise.all(consultas);

  return montarDashboardCompartilhado({
    data,
    totalAlunosRows: resultados[0][0],
    turmasRows: resultados[1][0],
    resumoConfirmadasRows: resultados[2][0],
    resumoPendentesRows: resultados[3][0],
    resumoPorTurmaRows: resultados[4][0],
    pendentesPorTurmaRows: resultados[5][0],
    alunosAtrasadosRows: incluirAlunosAtrasados ? resultados[6][0] : [],
  });
}

module.exports = {
  montarDashboardCompartilhado,
  obterDashboardDia,
};
