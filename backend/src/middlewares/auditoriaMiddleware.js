const auditoriaService = require("../services/auditoriaService");
const { safeLogError } = require("../utils/errorHandler");

function resolver(valor, contexto) {
  return typeof valor === "function" ? valor(contexto) : valor;
}

function auditarMutacao(configuracao) {
  return (req, res, next) => {
    const jsonOriginal = res.json.bind(res);
    let respostaInterceptada = false;

    res.json = (payload) => {
      if (respostaInterceptada) return jsonOriginal(payload);
      respostaInterceptada = true;

      const status = Number(res.statusCode || 200);
      const sucesso = status >= 200 && status < 400;
      const contexto = { req, res, payload, status, sucesso };
      const acao = resolver(configuracao.acao, contexto);
      const descricaoSucesso = resolver(configuracao.descricao, contexto);
      const descricaoFalha = resolver(configuracao.descricaoFalha, contexto)
        || `Tentativa de ${String(descricaoSucesso || "operação").toLowerCase()} não foi concluída.`;

      Promise.resolve(
        auditoriaService.registrarEvento({
          usuario: resolver(configuracao.usuario, contexto) || req.usuario,
          acao,
          descricao: sucesso ? descricaoSucesso : descricaoFalha,
          entidade: resolver(configuracao.entidade, contexto),
          entidadeId: resolver(configuracao.entidadeId, contexto),
          resultado: sucesso ? "sucesso" : "falha",
          ip: auditoriaService.normalizarIp(req),
          detalhes: resolver(configuracao.detalhes, contexto),
        })
      )
        .catch((error) => safeLogError("auditoriaMiddleware.Falha ao persistir auditoria", error))
        .finally(() => jsonOriginal(payload));

      return res;
    };

    next();
  };
}

module.exports = { auditarMutacao };
