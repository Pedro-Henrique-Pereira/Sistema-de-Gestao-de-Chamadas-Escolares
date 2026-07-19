const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const authController = require("../controllers/authController");
const passwordResetController = require("../controllers/passwordResetController");
const { getCsrfToken } = require("../middlewares/csrfMiddleware");
const { autenticar } = require("../middlewares/authMiddleware");
const { formatarEmail } = require("../utils/formatadores");
const { auditarMutacao } = require("../middlewares/auditoriaMiddleware");

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

function hashIdentificador(valor) {
  return require("crypto")
    .createHash("sha256")
    .update(String(valor || ""), "utf8")
    .digest("hex");
}

const mensagemRecuperacaoGenerica = {
  erro: "Não foi possível processar novas solicitações agora. Aguarde alguns minutos e tente novamente.",
};

const recuperacaoPorIpLimiter = rateLimit({
  windowMs: Number(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.PASSWORD_RESET_IP_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `forgot-ip:${normalizarIpCliente(req)}`,
  message: mensagemRecuperacaoGenerica,
});

const recuperacaoPorEmailLimiter = rateLimit({
  windowMs: Number(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.PASSWORD_RESET_EMAIL_RATE_LIMIT_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `forgot-email:${hashIdentificador(normalizarEmailLogin(req))}`,
  message: mensagemRecuperacaoGenerica,
});

const validacaoTokenLimiter = rateLimit({
  windowMs: Number(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.PASSWORD_RESET_TOKEN_VALIDATE_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `reset-validate:${normalizarIpCliente(req)}`,
  message: {
    erro: "Muitas tentativas com este link. Solicite um novo link de recuperação.",
  },
});

const redefinicaoTokenLimiter = rateLimit({
  windowMs: Number(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.PASSWORD_RESET_TOKEN_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode < 400,
  keyGenerator: (req) => `reset-use:${normalizarIpCliente(req)}`,
  message: {
    erro: "Muitas tentativas de redefinição. Solicite um novo link.",
  },
});

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
router.post("/login", limparLoginLimiterAoSucesso, loginLimiter, auditarMutacao({
  acao: "LOGIN",
  entidade: "sessao",
  usuario: ({ payload }) => payload.usuario,
  entidadeId: ({ payload }) => payload.usuario.id,
  descricao: "Realizou login no sistema.",
  descricaoFalha: "Tentativa de login não concluída.",
}), authController.login);
router.post(
  "/forgot-password",
  recuperacaoPorIpLimiter,
  recuperacaoPorEmailLimiter,
  passwordResetController.solicitar
);
router.post(
  "/reset-password/validate",
  validacaoTokenLimiter,
  passwordResetController.validar
);
router.post(
  "/reset-password",
  redefinicaoTokenLimiter,
  passwordResetController.redefinir
);
router.get("/dev-users", authController.listarUsuariosDev);
router.post("/dev-login", authController.devLogin);
router.get("/me", autenticar, authController.me);
router.post("/logout", autenticar, auditarMutacao({
  acao: "LOGOUT", entidade: "sessao",
  descricao: "Encerrou a sessão autenticada no sistema.",
}), authController.logout);

module.exports = router;
