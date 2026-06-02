const express = require("express");
const router = express.Router();

const pedagogaController = require("../controllers/pedagogaController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");
const { validarDatasRequest } = require("../utils/dateValidation");

router.use(autenticar);
router.use(validarDatasRequest());
router.use(autorizar("pedagoga", "administracao"));

router.get("/dashboard", pedagogaController.dashboard);
router.get("/preferencias", pedagogaController.obterPreferencias);
router.put("/preferencias/maquina", pedagogaController.salvarMaquinaPadraoChamadas);
router.get("/chamadas", pedagogaController.chamadasDoDia);
router.post("/automacao-whatsapp/solicitar", pedagogaController.solicitarAutomacaoWhatsApp);
router.get("/automacao-whatsapp/status/:id", pedagogaController.consultarStatusAutomacaoWhatsApp);
router.get("/automacao-whatsapp/mensagem", pedagogaController.obterMensagemWhatsApp);
router.put("/automacao-whatsapp/mensagem", pedagogaController.salvarMensagemWhatsApp);
router.post("/chamadas/:id/confirmar", pedagogaController.confirmarChamada);
router.get("/chamadas-confirmadas", pedagogaController.chamadasConfirmadasHoje);
router.get("/chamadas-confirmadas/:id", pedagogaController.detalharChamadaConfirmada);
router.put("/frequencias/:id", pedagogaController.atualizarFrequenciaAluno);
router.get("/turmas-pendentes", pedagogaController.turmasPendentes);
router.post("/chamadas-pedagogicas", pedagogaController.criarChamadaPedagogica);
router.put("/chamadas/:id", pedagogaController.atualizarChamada);
router.get("/relatorios/dados", pedagogaController.dadosRelatorios);
router.get("/responsaveis", pedagogaController.responsaveis);
router.put("/responsaveis/:id", pedagogaController.atualizarResponsavel);

module.exports = router;
