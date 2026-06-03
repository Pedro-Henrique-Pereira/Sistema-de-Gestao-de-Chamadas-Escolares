const jwt = require("jsonwebtoken");
const db = require("../database/connection");

async function autenticar(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({
      erro: "Acesso negado. Faça login primeiro.",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.id || !decoded.jti) {
      return res.status(401).json({
        erro: "Sessão inválida. Faça login novamente.",
      });
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
      return res.status(401).json({
        erro: "Sessão inválida ou usuário inativo.",
      });
    }

    req.usuario = {
      id: rows[0].id,
      tipo: rows[0].tipo,
      tokenId: decoded.jti,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      erro: "Token inválido ou expirado.",
    });
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