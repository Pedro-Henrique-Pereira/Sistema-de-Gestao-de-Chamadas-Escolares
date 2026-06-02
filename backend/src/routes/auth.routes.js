const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const authController = require("../controllers/authController");
const { getCsrfToken } = require("../middlewares/csrfMiddleware");
const { autenticar } = require("../middlewares/authMiddleware");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { erro: "Muitas tentativas de login. Tente novamente após 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/csrf-token", getCsrfToken);
router.post("/login", loginLimiter, authController.login);
router.get("/dev-users", authController.listarUsuariosDev);
router.post("/dev-login", authController.devLogin);
router.get("/me", autenticar, authController.me);
router.post("/logout", authController.logout);

module.exports = router;