const express = require("express");
const router = express.Router();

const relatoriosController = require("../controllers/relatoriosController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");
const { validarDatasRequest } = require("../utils/dateValidation");

router.use(autenticar);
router.use(validarDatasRequest());
router.use(autorizar("administracao", "pedagoga"));

router.get("/filtros/turmas", relatoriosController.listarTurmasFiltro);
router.post("/filtros/alunos", relatoriosController.buscarAlunosFiltro);
router.get("/geral-ano", relatoriosController.geralAno);
router.get("/resumo-anual", relatoriosController.resumoAnual);
router.get("/resumo-mensal", relatoriosController.resumoMensal);
router.get("/justificativas", relatoriosController.historicoJustificativas);
router.post("/exportar", relatoriosController.exportar);

module.exports = router;
