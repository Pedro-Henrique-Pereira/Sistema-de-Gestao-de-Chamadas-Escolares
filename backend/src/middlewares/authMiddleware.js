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

    const [rows] = await db.execute(
      "SELECT id, tipo, ativo FROM usuarios WHERE id = ? LIMIT 1",
      [decoded.id]
    );

    if (!rows[0] || !rows[0].ativo) {
      return res.status(401).json({
        erro: "Sessão inválida ou usuário inativo.",
      });
    }

    req.usuario = {
      id: rows[0].id,
      tipo: rows[0].tipo,
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