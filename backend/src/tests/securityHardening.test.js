const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tokenCookieOptions,
  csrfCookieOptions,
} = require("../utils/authCookies");
const {
  serializarUsuarioPublico,
  serializarStatusAutomacao,
} = require("../utils/publicDtos");
const { requisicaoVeioDeLocalhost } = require("../utils/devAccess");
const { tokensCoincidem } = require("../middlewares/csrfMiddleware");
const { securityHeaders } = require("../middlewares/securityHeaders");

test("cookie de autenticacao fica inacessivel ao JavaScript", () => {
  const ambienteAnterior = process.env.NODE_ENV;

  process.env.NODE_ENV = "production";
  const token = tokenCookieOptions();
  const csrf = csrfCookieOptions();

  assert.equal(token.httpOnly, true);
  assert.equal(token.secure, true);
  assert.equal(token.sameSite, "none");
  assert.equal(token.path, "/");
  assert.equal(token.domain, undefined);
  assert.equal(csrf.httpOnly, false);
  assert.equal(csrf.secure, true);

  if (ambienteAnterior === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ambienteAnterior;
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

test("DTO de automacao remove metadados internos e erro bruto", () => {
  const dto = serializarStatusAutomacao({
    id: 9,
    status: "erro",
    erro: "stack e caminho interno",
    lock_owner: "maquina-interna",
    usuario_solicitante_nome: "Nome pessoal",
    payload: { segredo: true },
  });

  assert.deepEqual(Object.keys(dto).sort(), ["erro_publico", "id", "status"]);
  assert.equal(dto.erro_publico.includes("stack"), false);
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
