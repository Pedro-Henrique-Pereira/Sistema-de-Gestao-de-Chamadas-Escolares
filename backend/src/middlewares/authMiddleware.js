const jwt = require("jsonwebtoken");
const db = require("../database/connection");
const { limparCookiesAutenticacao } = require("../utils/authCookies");

function rejeitarSessao(res, mensagem) {
  limparCookiesAutenticacao(res);
  return res.status(401).json({ erro: mensagem });
}

async function autenticar(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return rejeitarSessao(res, "Acesso negado. Faça login primeiro.");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (!decoded.id || !decoded.jti) {
      return rejeitarSessao(res, "Sessão inválida. Faça login novamente.");
    }

    const [rows] = await db.execute(
      `SELECT u.id, u.tipo, u.ativo
       FROM usuarios u
       INNER JOIN sessoes_ativas s
         ON s.usuario_id = u.id
        AND s.token_id = ?
        AND s.expira_em > NOW()
       WHERE u.id = ?
       LIMIT 1`,
      [decoded.jti, decoded.id]
    );

    if (!rows[0] || !rows[0].ativo) {
      return rejeitarSessao(res, "Sessão inválida ou usuário inativo.");
    }

    req.usuario = {
      id: rows[0].id,
      tipo: rows[0].tipo,
      tokenId: decoded.jti,
    };

    next();
  } catch (error) {
    return rejeitarSessao(res, "Token inválido ou expirado.");
  }
}

function autorizar(...tiposPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({
        erro: "Usuário não autenticado.",
      });
    }

    if (!tiposPermitidos.includes(req.usuario.tipo)) {
      return res.status(403).json({
        erro: "Você não tem permissão para acessar esta rota.",
      });
    }

    next();
  };
}

module.exports = {
  autenticar,
  autorizar,
};
