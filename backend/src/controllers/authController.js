const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
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

function valorHostEhLocalhost(valor) {
  if (!valor) return false;

  const texto = String(valor).trim().toLowerCase();

  if (!texto) return false;

  try {
    const url = texto.includes("://") ? new URL(texto) : new URL(`http://${texto}`);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    const hostSemPorta = texto
      .split(",")[0]
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(":")[0];

    return ["localhost", "127.0.0.1", "::1"].includes(hostSemPorta);
  }
}

function requisicaoVeioDeLocalhost(req) {
  const origin = req.get("origin");
  const referer = req.get("referer");
  const host = req.get("host");

  if (origin && !valorHostEhLocalhost(origin)) return false;
  if (referer && !valorHostEhLocalhost(referer)) return false;

  return valorHostEhLocalhost(host) || valorHostEhLocalhost(req.hostname);
}

function modoDevHabilitado(req) {
  return (
    process.env.NODE_ENV === "development" &&
    (process.env.AUTH_DEV_BYPASS === "true" || process.env.DEV_LOGIN_ENABLED === "true") &&
    requisicaoVeioDeLocalhost(req)
  );
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

async function registrarSessaoAtiva(usuarioId, tokenId, dispositivoInfo, expiraEm) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      "SELECT id FROM usuarios WHERE id = ? FOR UPDATE",
      [usuarioId]
    );

    await connection.execute("DELETE FROM sessoes_ativas WHERE expira_em <= NOW()");

    await connection.execute(
      "DELETE FROM sessoes_ativas WHERE usuario_id = ?",
      [usuarioId]
    );

    await connection.execute(
      `INSERT INTO sessoes_ativas (id, usuario_id, token_id, dispositivo_info, criado_em, expira_em)
       VALUES (?, ?, ?, ?, NOW(), ?)`,
      [crypto.randomUUID(), usuarioId, tokenId, dispositivoInfo || null, expiraEm]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function calcularExpiracaoSessao() {
  const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return expiraEm.toISOString().slice(0, 19).replace("T", " ");
}

async function respostaLoginComCookie(req, res, usuario, mensagem = "Login realizado com sucesso.") {
  const tokenId = crypto.randomUUID();
  const expiraEm = calcularExpiracaoSessao();
  const token = gerarToken(usuario, tokenId);

  await registrarSessaoAtiva(usuario.id, tokenId, req.get("user-agent"), expiraEm);

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

function gerarToken(usuario, tokenId) {
  return jwt.sign(
    {
      id: usuario.id,
      tipo: usuario.tipo,
      jti: tokenId,
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

    return respostaLoginComCookie(req, res, usuario);
  } catch (error) {
    return next(error);
  }
}

async function listarUsuariosDev(req, res, next) {
  try {
    if (!modoDevHabilitado(req)) {
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
    if (!modoDevHabilitado(req)) {
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

    return respostaLoginComCookie(req, res, usuario, "Login rápido de desenvolvimento realizado.");
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

async function logout(req, res, next) {
  try {
    if (req.usuario?.id) {
      await db.execute(
        "DELETE FROM sessoes_ativas WHERE usuario_id = ?",
        [req.usuario.id]
      );
    }

    res.clearCookie("token", tokenCookieOptions);
    res.clearCookie("csrfToken", csrfCookieOptions());

    return res.status(200).json({
      mensagem: "Logout realizado com sucesso.",
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  login,
  listarUsuariosDev,
  devLogin,
  me,
  logout,
};