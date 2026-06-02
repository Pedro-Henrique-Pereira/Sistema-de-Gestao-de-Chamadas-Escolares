const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Usuario = require("../models/usuarioModel");
const db = require("../database/connection");
const { formatarEmail } = require("../utils/formatadores");
const { emitirCsrfToken, cookieOptions: csrfCookieOptions } = require("../middlewares/csrfMiddleware");

const tokenCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
};

function modoDevHabilitado() {
  return process.env.NODE_ENV === "development" && process.env.AUTH_DEV_BYPASS === "true";
}

function obterJwtSecretSeguro() {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      "CRITICAL CONFIG ERROR: JWT_SECRET ausente ou muito fraco. Configure uma chave segura com pelo menos 32 caracteres."
    );
  }

  return jwtSecret;
}

function respostaLoginComCookie(res, usuario, mensagem = "Login realizado com sucesso.") {
  const token = gerarToken(usuario);

  res.cookie("token", token, tokenCookieOptions);

  const csrfToken = emitirCsrfToken(null, res);

  return res.status(200).json({
    mensagem,
    csrfToken,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      tipo: usuario.tipo,
    },
  });
}

function gerarToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      tipo: usuario.tipo,
    },
    obterJwtSecretSeguro(),
    {
      expiresIn: "1d",
    }
  );
}

async function login(req, res, next) {
  try {
    const { senha } = req.body;
    const email = formatarEmail(req.body.email);

    if (!email || !senha) {
      return res.status(400).json({
        erro: "Email e senha são obrigatórios.",
      });
    }

    const usuario = await Usuario.buscarPorEmail(email);

    if (!usuario) {
      return res.status(401).json({
        erro: "Email ou senha inválidos.",
      });
    }

    if (!usuario.ativo) {
      return res.status(403).json({
        erro: "Usuário desativado.",
      });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);

    if (!senhaValida) {
      return res.status(401).json({
        erro: "Email ou senha inválidos.",
      });
    }

    return respostaLoginComCookie(res, usuario);
  } catch (error) {
    return next(error);
  }
}

async function listarUsuariosDev(req, res, next) {
  try {
    if (!modoDevHabilitado()) {
      return res.status(404).json({ erro: "Login rápido indisponível." });
    }

    const [usuarios] = await db.execute(`
      SELECT id, nome, email, tipo, ativo
      FROM usuarios
      WHERE ativo = TRUE
      ORDER BY FIELD(tipo, 'administracao', 'pedagoga', 'professor'), nome ASC
    `);

    return res.json({ usuarios });
  } catch (error) {
    return next(error);
  }
}

async function devLogin(req, res, next) {
  try {
    if (!modoDevHabilitado()) {
      return res.status(404).json({ erro: "Login rápido indisponível." });
    }

    const id = Number(req.body.id || req.body.usuarioId);
    const email = req.body.email ? formatarEmail(req.body.email) : "";

    if (!id && !email) {
      return res.status(400).json({ erro: "Informe o id ou email do usuário para teste." });
    }

    const [rows] = await db.execute(`
      SELECT id, nome, email, tipo, ativo
      FROM usuarios
      WHERE ${id ? "id = ?" : "email = ?"}
      LIMIT 1
    `, [id || email]);

    const usuario = rows[0];

    if (!usuario || !usuario.ativo) {
      return res.status(404).json({ erro: "Usuário de teste não encontrado ou inativo." });
    }

    return respostaLoginComCookie(res, usuario, "Login rápido de desenvolvimento realizado.");
  } catch (error) {
    return next(error);
  }
}

async function me(req, res, next) {
  try {
    const usuario = await Usuario.buscarPorId(req.usuario.id);

    if (!usuario) {
      return res.status(404).json({
        erro: "Usuário não encontrado.",
      });
    }

    return res.status(200).json({
      usuario,
    });
  } catch (error) {
    return next(error);
  }
}

function logout(req, res) {
  res.clearCookie("token", tokenCookieOptions);
  res.clearCookie("csrfToken", csrfCookieOptions());

  return res.status(200).json({
    mensagem: "Logout realizado com sucesso.",
  });
}

module.exports = {
  login,
  listarUsuariosDev,
  devLogin,
  me,
  logout,
};