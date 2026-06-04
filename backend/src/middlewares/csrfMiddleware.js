const crypto = require("crypto");

const CSRF_COOKIE_NAME = "csrfToken";
const CSRF_HEADER_NAME = "x-csrf-token";
const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

function gerarCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function cookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? "none" : "strict",
    path: "/",
  };
}

function emitirCsrfToken(req, res) {
  const token = gerarCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, cookieOptions());
  return token;
}

function getCsrfToken(req, res) {
  const token = emitirCsrfToken(req, res);
  return res.status(200).json({ csrfToken: token });
}

function deveIgnorarCsrf(req) {
  if (METODOS_SEGUROS.has(req.method)) return true;

  const path = String(req.path || req.originalUrl || "");
  return (
    path.endsWith("/login") ||
    path.endsWith("/dev-login") ||
    path.endsWith("/csrf-token")
  );
}

function csrfProtection(req, res, next) {
  if (deveIgnorarCsrf(req)) return next();

  const tokenCookie = req.cookies?.[CSRF_COOKIE_NAME];
  const tokenHeader = req.get(CSRF_HEADER_NAME);

  if (!tokenCookie || !tokenHeader || tokenCookie !== tokenHeader) {
    return res.status(403).json({ erro: "Requisição bloqueada por proteção CSRF." });
  }

  return next();
}

module.exports = {
  CSRF_COOKIE_NAME,
  emitirCsrfToken,
  getCsrfToken,
  csrfProtection,
  cookieOptions,
};
