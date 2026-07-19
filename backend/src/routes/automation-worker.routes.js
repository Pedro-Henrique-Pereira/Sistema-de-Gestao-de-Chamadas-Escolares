const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/automationWorkerController");
const { autenticarAutomationWorker } = require("../middlewares/automationWorkerAuth");

const router = express.Router();

router.use(autenticarAutomationWorker);
router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `automacao-${req.automationWorker.maquinaId}`,
  message: { erro: "Muitas requisições da automação. Aguarde antes de tentar novamente." },
}));

router.get("/health", controller.health);
router.post("/heartbeat", controller.heartbeat);
router.post("/tasks/claim", controller.capturarTarefa);
router.post("/deliveries/:id/result", controller.registrarResultado);

module.exports = router;
