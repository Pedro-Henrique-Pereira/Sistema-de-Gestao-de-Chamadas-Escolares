const API_URL = import.meta.env.VITE_API_URL || "http://192.168.0.13:3001";
const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

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

async function obterCsrfToken() {
  let token = getCookie("csrfToken");
  if (token) return decodeURIComponent(token);

  const response = await fetch(`${API_URL}/api/auth/csrf-token`, {
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

  const response = await fetch(`${API_URL}${normalizarEndpoint(endpoint)}`, {
    ...options,
    method,
    headers,
    credentials: "include",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.erro || "Erro na requisição");
  }

  return data;
}

export async function apiDownload(endpoint, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = await montarHeaders({ ...options, method });

  const response = await fetch(`${API_URL}${normalizarEndpoint(endpoint)}`, {
    ...options,
    method,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.erro || "Não foi possível gerar o relatório.");
  }

  return response.blob();
}

async function request(method, endpoint, body) {
  const metodo = String(method || "GET").toUpperCase();
  const headers = await montarHeaders({ method: metodo });

  const response = await fetch(`${API_URL}${normalizarEndpoint(endpoint)}`, {
    method: metodo,
    credentials: "include",
    headers,
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.erro || "Erro na requisição");
  }

  return { data };
}

const api = {
  get: (endpoint) => request("GET", endpoint),
  post: (endpoint, body) => request("POST", endpoint, body),
  put: (endpoint, body) => request("PUT", endpoint, body),
  patch: (endpoint, body) => request("PATCH", endpoint, body),
  delete: (endpoint) => request("DELETE", endpoint),
};

export default api;
