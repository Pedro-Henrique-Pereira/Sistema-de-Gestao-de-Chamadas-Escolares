const API_URL = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);
const ENDPOINTS_PUBLICOS_AUTH = new Set([
  "/api/auth/login",
  "/api/auth/dev-login",
  "/api/auth/dev-users",
  "/api/auth/csrf-token",
]);

const MENSAGEM_SESSAO_EXPIRADA =
  "Sua sessão foi encerrada por segurança. Faça login novamente.";

if (!API_URL) {
  throw new Error("VITE_API_URL não configurada para o frontend.");
}

if (import.meta.env.PROD && !API_URL.startsWith("https://")) {
  throw new Error("Em produção, VITE_API_URL deve usar HTTPS.");
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
  return `${API_URL}${caminho}${queryString}`;
}

function deveRedirecionarPorSessao(endpoint) {
  const caminho = normalizarEndpoint(endpoint);
  return !ENDPOINTS_PUBLICOS_AUTH.has(caminho) && window.location.pathname !== "/login";
}

function redirecionarParaLoginPorSessao(response, endpoint) {
  if (response.status !== 401 || !deveRedirecionarPorSessao(endpoint)) return;

  sessionStorage.setItem("loginMessage", MENSAGEM_SESSAO_EXPIRADA);
  window.location.replace("/login");
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

  redirecionarParaLoginPorSessao(response, endpoint);

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.erro || data?.message || "Erro na requisição");
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

  redirecionarParaLoginPorSessao(response, endpoint);

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.erro || data?.message || "Não foi possível gerar o relatório.");
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

  redirecionarParaLoginPorSessao(response, endpoint);

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.erro || data?.message || "Erro na requisição");
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
