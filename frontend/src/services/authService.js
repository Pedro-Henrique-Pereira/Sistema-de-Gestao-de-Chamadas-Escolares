import { apiFetch } from "./api";

export function login(email, senha) {
  return apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, senha }),
  });
}

export function getUsuarioLogado() {
  return apiFetch("/api/auth/me", {
    method: "GET",
  });
}

export function logout() {
  return apiFetch("/api/auth/logout", {
    method: "POST",
  });
}

export function solicitarRecuperacaoSenha(email) {
  return apiFetch("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function validarTokenRecuperacao(token) {
  return apiFetch("/api/auth/reset-password/validate", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function redefinirSenha(token, senha, confirmacaoSenha) {
  return apiFetch("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, senha, confirmacaoSenha }),
  });
}
