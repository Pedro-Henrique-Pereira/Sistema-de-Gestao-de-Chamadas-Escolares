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