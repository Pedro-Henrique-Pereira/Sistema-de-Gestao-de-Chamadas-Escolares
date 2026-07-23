const ORIGENS_PRODUCAO_PADRAO = [
  "https://lysimaco.com.br",
  "https://www.lysimaco.com.br",
];

const ORIGENS_DESENVOLVIMENTO = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
];

function separarLista(valor) {
  return String(valor || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function obterOrigensPermitidas(env = process.env) {
  const ambienteProducao = env.NODE_ENV === "production";
  const origensConfiguradas = separarLista(env.ALLOWED_ORIGINS);
  const origensLegadas = [
    env.FRONTEND_URL,
    ...separarLista(env.FRONTEND_URLS_EXTRAS),
  ].filter(Boolean);

  const origensBase = origensConfiguradas.length > 0
    ? origensConfiguradas
    : (origensLegadas.length > 0 ? origensLegadas : ORIGENS_PRODUCAO_PADRAO);

  return new Set([
    ...origensBase,
    ...(ambienteProducao ? [] : ORIGENS_DESENVOLVIMENTO),
  ]);
}

function origemCorsPermitida(origem, origensPermitidas) {
  return !origem || origensPermitidas.has(origem);
}

function obterTrustProxy(env = process.env) {
  const valor = Number(env.TRUST_PROXY || env.TRUST_PROXY_HOPS || 1);
  return Number.isInteger(valor) && valor >= 1 ? valor : 1;
}

module.exports = {
  ORIGENS_PRODUCAO_PADRAO,
  ORIGENS_DESENVOLVIMENTO,
  obterOrigensPermitidas,
  origemCorsPermitida,
  obterTrustProxy,
};
