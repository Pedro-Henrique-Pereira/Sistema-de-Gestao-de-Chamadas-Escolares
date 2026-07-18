import { apiFetch } from "./api";

export function verificarTurmas(materia) {
  const params = new URLSearchParams();
  if (materia?.trim()) params.set("materia", materia.trim());
  const query = params.toString();
  return apiFetch(`/api/chamadas/verificar-turmas${query ? `?${query}` : ""}`);
}

export function listarHistoricoChamadas(filtros = {}) {
  const params = new URLSearchParams();
  if (filtros.data) params.set("data", filtros.data);
  if (filtros.turma_id) params.set("turma_id", filtros.turma_id);
  if (filtros.materia?.trim()) params.set("materia", filtros.materia.trim());
  const query = params.toString();
  return apiFetch(`/api/chamadas/historico${query ? `?${query}` : ""}`);
}

export function criarChamada(dados) {
  return apiFetch("/api/chamadas", {
    method: "POST",
    body: JSON.stringify(dados),
  });
}

export function atualizarChamada(id, dados) {
  return apiFetch(`/api/chamadas/${id}`, {
    method: "PUT",
    body: JSON.stringify(dados),
  });
}

export function marcarAlunoAtrasado(chamadaId, alunoId, versao) {
  return apiFetch(`/api/chamadas/${chamadaId}/atraso`, {
    method: "PATCH",
    body: JSON.stringify({ aluno_id: alunoId, versao }),
  });
}
