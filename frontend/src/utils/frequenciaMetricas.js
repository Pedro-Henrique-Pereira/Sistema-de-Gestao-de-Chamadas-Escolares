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

export function classificarFrequenciaParaExibicao(aluno = {}) {
  const status = String(aluno.status || aluno.status_presenca || "ausente").trim().toLowerCase();
  const atrasado = aluno.atrasado === true || aluno.atrasado === 1 || String(aluno.atrasado || "") === "1";
  const motivo = String(aluno.motivo || aluno.justificativa || "").trim();

  if (atrasado) {
    const valorMinutos = aluno.atraso_minutos;
    const minutos = Number(valorMinutos);
    const possuiMinutos = valorMinutos !== null && valorMinutos !== undefined && valorMinutos !== "" && Number.isFinite(minutos);
    return {
      categoria: "presente",
      rotulo: "Presente",
      detalhe: possuiMinutos ? `Atrasado • ${minutos} min` : "Atrasado",
      motivo: "",
    };
  }

  if (status === "presente") {
    return { categoria: "presente", rotulo: "Presente", detalhe: "", motivo: "" };
  }

  if (status === "justificado" || motivo) {
    return {
      categoria: "justificada",
      rotulo: "Falta justificada",
      detalhe: "",
      motivo: motivo || "Motivo não informado.",
    };
  }

  return { categoria: "ausente", rotulo: "Faltou", detalhe: "", motivo: "" };
}
