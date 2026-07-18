const STATUS_PRESENTES = new Set(["presente", "atrasado"]);
const STATUS_AUSENTES = new Set(["ausente", "falta", "faltou", "justificado", "falta justificada", "falta_justificada"]);
const STATUS_JUSTIFICADOS = new Set(["justificado", "falta justificada", "falta_justificada"]);

function normalizarStatus(aluno = {}) {
  return String(aluno.status ?? aluno.status_presenca ?? aluno.presenca ?? "")
    .trim()
    .toLowerCase();
}

function valorBooleano(valor) {
  return valor === true || valor === 1 || String(valor || "").trim().toLowerCase() === "true" || String(valor || "").trim() === "1";
}

function classificarFrequencia(aluno = {}) {
  const status = normalizarStatus(aluno);
  const atrasado = valorBooleano(aluno.atrasado) || status === "atrasado";
  const presente = atrasado || STATUS_PRESENTES.has(status);
  const justificado = !presente && STATUS_JUSTIFICADOS.has(status);
  const ausente = !presente && (justificado || STATUS_AUSENTES.has(status) || !status);

  return { presente, ausente, justificado, atrasado };
}

function contarTotaisFrequencia(alunos = []) {
  return alunos.reduce((totais, aluno) => {
    const classificacao = classificarFrequencia(aluno);

    if (classificacao.presente) totais.total_presentes += 1;
    else totais.total_ausentes += 1;

    if (classificacao.justificado) totais.total_justificados += 1;
    if (classificacao.atrasado) totais.total_atrasos += 1;

    return totais;
  }, {
    total_presentes: 0,
    total_ausentes: 0,
    total_justificados: 0,
    total_atrasos: 0,
  });
}

function condicoesFrequenciaSql(alias = "rfa") {
  const status = `LOWER(COALESCE(${alias}.status, ''))`;
  const atrasado = `(COALESCE(${alias}.atrasado, FALSE) = TRUE OR ${status} = 'atrasado')`;
  const presente = `(${atrasado} OR ${status} = 'presente')`;
  const justificado = `(NOT ${atrasado} AND ${status} IN ('justificado', 'falta justificada', 'falta_justificada'))`;
  const ausente = `(NOT ${presente} AND ${status} IN ('ausente', 'falta', 'faltou', 'justificado', 'falta justificada', 'falta_justificada'))`;

  return { presente, ausente, justificado, atrasado };
}

module.exports = {
  classificarFrequencia,
  contarTotaisFrequencia,
  condicoesFrequenciaSql,
};
