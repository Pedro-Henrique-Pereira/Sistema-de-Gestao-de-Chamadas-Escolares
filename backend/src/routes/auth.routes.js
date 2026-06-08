const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const authController = require("../controllers/authController");
const { getCsrfToken } = require("../middlewares/csrfMiddleware");
const { autenticar } = require("../middlewares/authMiddleware");
const { formatarEmail } = require("../utils/formatadores");

function normalizarEmailLogin(req) {
  return formatarEmail(req.body?.email || "") || "email-nao-informado";
}

function normalizarIpCliente(req) {
  return rateLimit.ipKeyGenerator(req.ip || req.socket?.remoteAddress || "ip-desconhecido");
}

function gerarChaveLogin(req) {
  const ipCliente = normalizarIpCliente(req);
  const email = normalizarEmailLogin(req);

  return `login:${ipCliente}:${email}`;
}

const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.LOGIN_RATE_LIMIT_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode < 400,
  keyGenerator: gerarChaveLogin,
  message: {
    erro: "Muitas tentativas de login para este usuário neste computador. Tente novamente após 15 minutos.",
  },
});

function limparLoginLimiterAoSucesso(req, res, next) {
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      loginLimiter.resetKey(gerarChaveLogin(req));
    }
  });

  next();
}

router.get("/csrf-token", getCsrfToken);
router.post("/login", limparLoginLimiterAoSucesso, loginLimiter, authController.login);
router.get("/dev-users", authController.listarUsuariosDev);
router.post("/dev-login", authController.devLogin);
router.get("/me", autenticar, authController.me);
router.post("/logout", autenticar, authController.logout);

module.exports = router;
