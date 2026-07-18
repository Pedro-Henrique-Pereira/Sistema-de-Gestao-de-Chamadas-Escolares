export function resumirStatusFrequencia(statusAlunos = []) {
  return statusAlunos.reduce((resumo, valor) => {
    const status = String(valor || "").trim().toLowerCase();
    const atrasado = status === "atrasado";
    const justificado = status === "falta justificada" || status === "justificado";

    if (status === "presente" || atrasado) resumo.presentes += 1;
    else resumo.faltas += 1;

    if (justificado) resumo.justificadas += 1;
    if (atrasado) resumo.atrasos += 1;
    resumo.total += 1;
    return resumo;
  }, { total: 0, presentes: 0, faltas: 0, justificadas: 0, atrasos: 0 });
}
