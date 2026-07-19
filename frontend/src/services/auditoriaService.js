import { apiFetch } from "./api";

export function buscarLogsAuditoria(filtros = {}) {
  return apiFetch("/api/admin/logs-auditoria", { params: filtros });
}

export function buscarOpcoesAuditoria() {
  return apiFetch("/api/admin/logs-auditoria/opcoes");
}
