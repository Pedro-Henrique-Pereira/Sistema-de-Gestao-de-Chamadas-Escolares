const express = require("express");
const router = express.Router();
const controller = require("../controllers/configuracoesEscolaController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");

router.use(autenticar);
router.get("/", autorizar("professor", "pedagoga", "administracao"), controller.obterConfiguracao);
router.put("/", autorizar("administracao"), controller.salvarConfiguracao);

module.exports = router;
