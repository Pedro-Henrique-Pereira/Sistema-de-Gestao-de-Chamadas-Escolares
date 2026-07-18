const test = require("node:test");
const assert = require("node:assert/strict");

const {
  montarDashboardCompartilhado,
} = require("../services/dashboardService");

test("dashboard compartilhado entrega o mesmo resumo para admin e pedagoga", () => {
  const dashboard = montarDashboardCompartilhado({
    data: "2026-07-17",
    totalAlunosRows: [{ total: 30 }],
    turmasRows: [
      { id: 1, nome: "1 A", total_alunos: 20 },
      { id: 2, nome: "2 B", total_alunos: 10 },
    ],
    resumoConfirmadasRows: [{
      chamadasHoje: 1,
      totalPresentes: 16,
      totalFaltas: 4,
      totalJustificadas: 1,
      totalAtrasos: 2,
    }],
    resumoPendentesRows: [{ pendentes: 1 }],
    resumoPorTurmaRows: [{
      turma_id: 1,
      presentes: 16,
      faltas: 4,
      justificadas: 1,
      atrasos: 2,
      chamadas_confirmadas: 1,
    }],
    pendentesPorTurmaRows: [{ turma_id: 2, chamadas_pendentes: 1 }],
    alunosAtrasadosRows: [{ id: 5, atrasado: 1, minutosAtraso: 8 }],
  });

  assert.deepEqual(dashboard.resumo, {
    alunosCadastrados: 30,
    chamadasHoje: 1,
    chamadasPendentes: 1,
    totalPresentes: 16,
    totalFaltas: 4,
    totalJustificadas: 1,
    totalAtrasos: 2,
    taxaFrequencia: 80,
  });
  assert.equal(dashboard.presentes, dashboard.resumo.totalPresentes);
  assert.equal(dashboard.ausentes, dashboard.resumo.totalFaltas);
  assert.equal(dashboard.justificados, dashboard.resumo.totalJustificadas);
  assert.equal(dashboard.atrasos, dashboard.resumo.totalAtrasos);
  assert.equal(dashboard.alunosAtrasados[0].atrasado, true);
});

test("status por turma distingue finalizada, aguardando confirmacao e pendente", () => {
  const dashboard = montarDashboardCompartilhado({
    data: "2026-07-17",
    turmasRows: [
      { id: 1, nome: "1 A", total_alunos: 10 },
      { id: 2, nome: "2 B", total_alunos: 10 },
      { id: 3, nome: "3 C", total_alunos: 10 },
    ],
    resumoPorTurmaRows: [{ turma_id: 1, chamadas_confirmadas: 1 }],
    pendentesPorTurmaRows: [{ turma_id: 2, chamadas_pendentes: 1 }],
  });

  assert.deepEqual(
    dashboard.turmas.map((turma) => turma.status_chamada),
    ["finalizada", "aguardando_confirmacao", "pendente"]
  );
});
