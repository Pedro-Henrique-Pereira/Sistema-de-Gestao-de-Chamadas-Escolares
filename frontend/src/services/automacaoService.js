import { apiFetch } from "./api";

export function criarRequestId(prefix = "automation") {
  const id = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`.slice(0, 64);
}

export function criarTarefaFaltas({ requestId, machineId, attendanceId }) {
  return apiFetch("/api/automation/tasks/attendance-notifications", {
    method: "POST",
    body: JSON.stringify({ requestId, machineId, attendanceId }),
  });
}

export function criarTarefaGrupos({ requestId, machineId, groups, allGroups, message }) {
  return apiFetch("/api/automation/tasks/group-messages", {
    method: "POST",
    body: JSON.stringify({ requestId, machineId, groups, allGroups, message }),
  });
}

export function consultarStatusAutomacao(id) {
  return apiFetch(`/api/automation/tasks/${id}`);
}

export function listarTarefasAutomacao(params = {}) {
  return apiFetch("/api/automation/tasks", { params });
}

export function listarMaquinasAutomacao() {
  return apiFetch("/api/automation/machines");
}

export function listarFilasAutomacao() {
  return apiFetch("/api/automation/queues");
}

export function cancelarAutomacao(id) {
  return apiFetch(`/api/automation/tasks/${id}/cancel`, {
    method: "POST",
  });
}

export function obterModeloMensagemAutomacao() {
  return apiFetch("/api/automation/message-template");
}

export function salvarModeloMensagemAutomacao(text) {
  return apiFetch("/api/automation/message-template", {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
}
