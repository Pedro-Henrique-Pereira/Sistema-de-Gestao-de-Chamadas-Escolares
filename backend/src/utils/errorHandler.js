function safeLogError(contexto, error) {
  const status = Number(error?.status || error?.statusCode || 500);
  const code = error?.code ? String(error.code) : "ERR_INTERNAL";
  const mensagem = status >= 500
    ? "Erro interno interceptado. Detalhes sensíveis omitidos."
    : String(error?.message || "Erro operacional interceptado.");

  console.error(`[${new Date().toISOString()}] ${contexto} | status=${status} | code=${code} | message=${mensagem}`);
}

function mensagemPublica(error, fallback = "Ocorreu um erro interno no servidor") {
  const status = Number(error?.status || error?.statusCode || 500);

  if (status >= 500) {
    return fallback;
  }

  return error?.message || fallback;
}

function errorMiddleware(err, req, res, next) {
  safeLogError(`${req.method} ${req.originalUrl}`, err);

  const status = Number(err?.status || err?.statusCode || 500);
  const erro = err?.code === "ER_DUP_ENTRY"
    ? "Já existe um registro com esses dados."
    : mensagemPublica(err);

  return res.status(status).json({ erro });
}

module.exports = {
  safeLogError,
  mensagemPublica,
  errorMiddleware,
};
