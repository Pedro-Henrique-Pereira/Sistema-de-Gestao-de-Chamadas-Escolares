const express = require("express");
const router = express.Router();

const chamadasController = require("../controllers/chamadasController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");
const { validarDatasRequest } = require("../utils/dateValidation");

router.use(autenticar);
router.use(validarDatasRequest());

router.get("/verificar-turmas", autorizar("professor", "pedagoga", "administracao"), chamadasController.verificarTurmas);
router.get("/historico", autorizar("professor", "pedagoga", "administracao"), chamadasController.historico);
router.post("/", autorizar("professor"), chamadasController.criar);
router.patch("/:id/atraso", autorizar("professor", "pedagoga", "administracao"), chamadasController.marcarAtraso);
router.put("/:id", autorizar("professor"), chamadasController.atualizar);

module.exports = router;
