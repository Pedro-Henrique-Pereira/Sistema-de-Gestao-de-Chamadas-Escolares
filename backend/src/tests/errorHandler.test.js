const test = require("node:test");
const assert = require("node:assert/strict");
const {
  errorMiddleware,
  notFoundMiddleware,
} = require("../utils/errorHandler");

function executarMiddleware(error) {
  const resposta = {
    statusCode: null,
    payload: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  const consoleErrorOriginal = console.error;
  let log = "";
  console.error = (mensagem) => {
    log = String(mensagem);
  };

  try {
    errorMiddleware(
      error,
      { method: "POST", originalUrl: "/api/teste" },
      resposta,
      () => {}
    );
  } finally {
    console.error = consoleErrorOriginal;
  }

  return { resposta, log };
}

test("duplicidade do MySQL retorna HTTP 409 sem expor detalhes do banco", () => {
  const error = Object.assign(new Error("Duplicate entry 'dado-sensivel'"), {
    code: "ER_DUP_ENTRY",
  });

  const { resposta, log } = executarMiddleware(error);

  assert.equal(resposta.statusCode, 409);
  assert.match(resposta.payload.erro, /existe um registro/i);
  assert.match(log, /status=409/);
  assert.doesNotMatch(log, /dado-sensivel/);
});

test("status operacional explícito continua sendo preservado", () => {
  const error = Object.assign(new Error("Entrada inválida."), { status: 400 });

  const { resposta } = executarMiddleware(error);

  assert.equal(resposta.statusCode, 400);
  assert.deepEqual(resposta.payload, { erro: "Entrada inválida." });
});

test("erro interno não relacionado continua retornando HTTP 500", () => {
  const { resposta } = executarMiddleware(new Error("Falha interna sensível."));

  assert.equal(resposta.statusCode, 500);
  assert.deepEqual(resposta.payload, {
    erro: "Ocorreu um erro interno no servidor",
  });
});

test("rota desconhecida retorna HTTP 404 no contrato JSON da API", () => {
  const resposta = {
    statusCode: null,
    payload: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  notFoundMiddleware({}, resposta);

  assert.equal(resposta.statusCode, 404);
  assert.deepEqual(resposta.payload, { erro: "Rota não encontrada." });
});
