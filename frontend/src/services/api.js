import { apiUrlSeguraEmProducao } from "../utils/apiUrlSecurity";

const API_URL = String(import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);
const ENDPOINTS_SEM_NOTIFICACAO_GLOBAL_401 = new Set([
  "/api/auth/login",
  "/api/auth/dev-login",
  "/api/auth/dev-users",
  "/api/auth/csrf-token",
  "/api/auth/me",
  "/api/auth/forgot-password",
  "/api/auth/reset-password/validate",
  "/api/auth/reset-password",
]);

const MENSAGEM_SESSAO_EXPIRADA =
  "Sua sessão foi encerrada por segurança. Faça login novamente.";

if (import.meta.env.PROD && !apiUrlSeguraEmProducao(API_URL)) {
  throw new Error("Em produção, VITE_API_URL deve usar HTTPS ou loopback local.");
}

function getCookie(nome) {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${nome}=`))
    ?.split("=")
    .slice(1)
    .join("=") || "";
}

function normalizarEndpoint(endpoint = "") {
  const caminho = String(endpoint || "").trim();
  if (!caminho) return "/api";
  if (caminho.startsWith("/api/")) return caminho;
  if (caminho === "/api") return caminho;
  return `/api${caminho.startsWith("/") ? caminho : `/${caminho}`}`;
}

function montarQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([chave, valor]) => {
    if (valor === undefined || valor === null || valor === "") return;

    if (Array.isArray(valor)) {
      valor.forEach((item) => {
        if (item !== undefined && item !== null && item !== "") {
          searchParams.append(chave, item);
        }
      });
      return;
    }

    searchParams.append(chave, valor);
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

function montarUrl(endpoint, params) {
  const caminho = normalizarEndpoint(endpoint);
  const queryString = montarQueryString(params);
  const base = API_URL.endsWith("/api") ? API_URL.slice(0, -4) : API_URL;
  return `${base}${caminho}${queryString}`;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function deveNotificarSessaoInvalida(endpoint) {
  const caminho = normalizarEndpoint(endpoint);
  const rotaPublica = ["/login", "/esqueci-minha-senha", "/redefinir-senha"]
    .includes(window.location.pathname);
  return !ENDPOINTS_SEM_NOTIFICACAO_GLOBAL_401.has(caminho) && !rotaPublica;
}

function notificarSessaoInvalida(response, endpoint) {
  if (response.status !== 401 || !deveNotificarSessaoInvalida(endpoint)) return;

  sessionStorage.setItem("loginMessage", MENSAGEM_SESSAO_EXPIRADA);
  window.dispatchEvent(new CustomEvent("auth:unauthorized"));
}

async function obterCsrfToken() {
  let token = getCookie("csrfToken");
  if (token) return decodeURIComponent(token);

  const endpoint = "/api/auth/csrf-token";
  const response = await fetch(montarUrl(endpoint), {
    method: "GET",
    credentials: "include",
  });

  const data = await response.json().catch(() => null);
  token = data?.csrfToken || getCookie("csrfToken");
  return token ? decodeURIComponent(token) : "";
}

async function montarHeaders(options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (!METODOS_SEGUROS.has(method)) {
    const csrfToken = await obterCsrfToken();
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }

  return headers;
}

export async function apiFetch(endpoint, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = await montarHeaders({ ...options, method });

  const response = await fetch(montarUrl(endpoint, options.params), {
    ...options,
    method,
    headers,
    credentials: "include",
  });

  notificarSessaoInvalida(response, endpoint);

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(data?.erro || data?.message || "Erro na requisição", response.status);
  }

  return data;
}

export async function apiDownload(endpoint, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = await montarHeaders({ ...options, method });

  const response = await fetch(montarUrl(endpoint, options.params), {
    ...options,
    method,
    headers,
    credentials: "include",
  });

  notificarSessaoInvalida(response, endpoint);

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.erro || data?.message || "Não foi possível gerar o relatório.", response.status);
  }

  return response.blob();
}

async function request(method, endpoint, body, config = {}) {
  const metodo = String(method || "GET").toUpperCase();
  const headers = await montarHeaders({ ...config, method: metodo });

  const response = await fetch(montarUrl(endpoint, config.params), {
    ...config,
    method: metodo,
    credentials: "include",
    headers,
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });

  notificarSessaoInvalida(response, endpoint);

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(data?.erro || data?.message || "Erro na requisição", response.status);
  }

  return { data };
}

const api = {
  get: (endpoint, config) => request("GET", endpoint, undefined, config),
  post: (endpoint, body, config) => request("POST", endpoint, body, config),
  put: (endpoint, body, config) => request("PUT", endpoint, body, config),
  patch: (endpoint, body, config) => request("PATCH", endpoint, body, config),
  delete: (endpoint, config) => request("DELETE", endpoint, undefined, config),
};

export { API_URL, MENSAGEM_SESSAO_EXPIRADA };
export default api;
