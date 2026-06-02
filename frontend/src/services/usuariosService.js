import { apiFetch } from "./api";

export function atualizarConfiguracoesUsuario(dados) {
  return apiFetch("/api/usuarios/configurar", {
    method: "PUT",
    body: JSON.stringify(dados),
  });
}
