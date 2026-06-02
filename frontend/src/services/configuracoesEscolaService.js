import { apiFetch } from "./api";

export function buscarConfiguracaoEscola() {
  return apiFetch("/api/configuracoes-escola");
}

export function salvarConfiguracaoEscola(payload) {
  return apiFetch("/api/configuracoes-escola", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
