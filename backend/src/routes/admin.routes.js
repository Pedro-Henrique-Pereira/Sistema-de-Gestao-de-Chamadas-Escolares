const express = require("express");
const router = express.Router();

const adminController = require("../controllers/adminController");
const auditoriaController = require("../controllers/auditoriaController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");
const { validarDatasRequest } = require("../utils/dateValidation");

router.use(autenticar);
router.use(validarDatasRequest());
router.use(autorizar("administracao"));

router.get("/painel", adminController.painel);
router.get("/logs-auditoria", auditoriaController.listar);
router.get("/logs-auditoria/opcoes", auditoriaController.opcoes);

module.exports = router;
