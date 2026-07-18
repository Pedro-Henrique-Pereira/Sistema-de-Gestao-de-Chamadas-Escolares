function obterStatusError(error) {
  return Number(
    error?.status
    || error?.statusCode
    || (error?.code === "ER_DUP_ENTRY" ? 409 : 500)
  );
}

function safeLogError(contexto, error) {
  const status = obterStatusError(error);
  const code = error?.code ? String(error.code) : "ERR_INTERNAL";
  const mensagem = error?.code === "ER_DUP_ENTRY"
    ? "Conflito de unicidade interceptado."
    : status >= 500
    ? "Erro interno interceptado. Detalhes sensíveis omitidos."
    : String(error?.message || "Erro operacional interceptado.");

  console.error(`[${new Date().toISOString()}] ${contexto} | status=${status} | code=${code} | message=${mensagem}`);
}

function mensagemPublica(error, fallback = "Ocorreu um erro interno no servidor") {
  const status = obterStatusError(error);

  if (status >= 500) {
    return fallback;
  }

  return error?.message || fallback;
}

function errorMiddleware(err, req, res, next) {
  safeLogError(`${req.method} ${req.path || "/"}`, err);

  const status = obterStatusError(err);
  const erro = err?.code === "ER_DUP_ENTRY"
    ? "Já existe um registro com esses dados."
    : mensagemPublica(err);

  return res.status(status).json({ erro });
}

function notFoundMiddleware(req, res) {
  return res.status(404).json({ erro: "Rota não encontrada." });
}

module.exports = {
  safeLogError,
  mensagemPublica,
  notFoundMiddleware,
  errorMiddleware,
};
