const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tokenCookieOptions,
  csrfCookieOptions,
} = require("../utils/authCookies");
const {
  serializarUsuarioPublico,
} = require("../utils/publicDtos");
const { publicErrorMessage } = require("../services/automationDomain");
const { requisicaoVeioDeLocalhost } = require("../utils/devAccess");
const { tokensCoincidem } = require("../middlewares/csrfMiddleware");
const { securityHeaders } = require("../middlewares/securityHeaders");
const {
  obterOrigensPermitidas,
  origemCorsPermitida,
} = require("../config/runtimeConfig");
const { criarReadyHandler } = require("../controllers/healthController");

test("cookie de autenticacao fica inacessivel ao JavaScript", () => {
  const ambienteAnterior = process.env.NODE_ENV;

  process.env.NODE_ENV = "production";
  const token = tokenCookieOptions();
  const csrf = csrfCookieOptions();

  assert.equal(token.httpOnly, true);
  assert.equal(token.secure, true);
  assert.equal(token.sameSite, "lax");
  assert.equal(token.path, "/");
  assert.equal(token.domain, undefined);
  assert.equal(csrf.httpOnly, false);
  assert.equal(csrf.secure, true);

  if (ambienteAnterior === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ambienteAnterior;
});

test("CORS de producao aceita somente a allowlist configurada", () => {
  const origens = obterOrigensPermitidas({
    NODE_ENV: "production",
    ALLOWED_ORIGINS: "https://lysimaco.com.br,https://www.lysimaco.com.br",
  });

  assert.equal(origemCorsPermitida("https://lysimaco.com.br", origens), true);
  assert.equal(origemCorsPermitida("https://www.lysimaco.com.br", origens), true);
  assert.equal(origemCorsPermitida("https://externo.example", origens), false);
  assert.equal(origemCorsPermitida(undefined, origens), true);
});

test("readiness responde sem expor o erro do banco", async () => {
  const respostas = [];
  const res = {
    status(code) {
      respostas.push({ code });
      return this;
    },
    json(payload) {
      respostas[respostas.length - 1].payload = payload;
      return this;
    },
  };

  await criarReadyHandler({ query: async () => [[{ ok: 1 }]] })({}, res);
  await criarReadyHandler({ query: async () => { throw new Error("segredo"); } })({}, res);

  assert.deepEqual(respostas, [
    { code: 200, payload: { status: "ready" } },
    { code: 503, payload: { status: "unavailable" } },
  ]);
});

test("DTO publico de usuario nunca inclui hash, senha ou token", () => {
  const dto = serializarUsuarioPublico({
    id: 7,
    nome: "Usuario",
    email: "usuario@escola.test",
    tipo: "professor",
    senha_hash: "hash-secreto",
    token: "token-secreto",
    ativo: true,
    criado_em: "2026-01-01",
  });

  assert.deepEqual(Object.keys(dto).sort(), ["email", "id", "nome", "tipo"]);
});

test("erro público da automação nunca repassa erro bruto", () => {
  const mensagem = publicErrorMessage("stack e caminho interno");
  assert.equal(mensagem.includes("stack"), false);
  assert.match(mensagem, /envio/i);
});

test("login rapido exige conexao de loopback real", () => {
  const criarReq = (remoteAddress, host = "localhost:3001") => ({
    socket: { remoteAddress },
    hostname: "localhost",
    get(nome) {
      if (nome === "host") return host;
      return undefined;
    },
  });

  assert.equal(requisicaoVeioDeLocalhost(criarReq("127.0.0.1")), true);
  assert.equal(requisicaoVeioDeLocalhost(criarReq("192.168.0.50")), false);
  assert.equal(
    requisicaoVeioDeLocalhost(criarReq("192.168.0.50", "localhost:3001")),
    false
  );
});

test("comparacao CSRF rejeita valores ausentes, diferentes e de tamanhos distintos", () => {
  assert.equal(tokensCoincidem("abc", "abc"), true);
  assert.equal(tokensCoincidem("abc", "abd"), false);
  assert.equal(tokensCoincidem("abc", "abcd"), false);
  assert.equal(tokensCoincidem("", "abc"), false);
});

test("middleware aplica no-store e headers de seguranca", () => {
  const headers = new Map();
  const res = {
    setHeader(nome, valor) {
      headers.set(nome, valor);
    },
  };
  let chamouNext = false;

  securityHeaders({}, res, () => {
    chamouNext = true;
  });

  assert.equal(chamouNext, true);
  assert.match(headers.get("Cache-Control"), /no-store/);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.match(headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
});
