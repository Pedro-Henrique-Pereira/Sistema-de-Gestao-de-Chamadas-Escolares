const express = require("express");
const router = express.Router();

const pedagogaController = require("../controllers/pedagogaController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");
const { validarDatasRequest } = require("../utils/dateValidation");
const { auditarMutacao } = require("../middlewares/auditoriaMiddleware");

router.use(autenticar);
router.use(validarDatasRequest());
router.use(autorizar("pedagoga", "administracao"));

router.get("/dashboard", pedagogaController.dashboard);
router.get("/preferencias", pedagogaController.obterPreferencias);
router.put("/preferencias/maquina", auditarMutacao({
  acao: "PREFERENCIA_AUTOMACAO_EDITADA", entidade: "usuario", entidadeId: ({ req }) => req.usuario.id,
  descricao: "Alterou a máquina padrão para automações de chamadas.",
  detalhes: ({ req }) => ({ maquina: req.body.maquina || req.body.maquinaDestino }),
}), pedagogaController.salvarMaquinaPadraoChamadas);
router.get("/chamadas", pedagogaController.chamadasDoDia);
router.post("/automacao-whatsapp/solicitar", auditarMutacao({
  acao: "AUTOMACAO_ADMINISTRATIVA_EXECUTADA", entidade: "automacao",
  entidadeId: ({ payload }) => payload.id || payload.tarefa.id,
  descricao: "Solicitou a execução da automação de faltas por WhatsApp.",
  detalhes: ({ req }) => ({ maquina: req.body.maquinaDestino || req.body.maquina }),
}), pedagogaController.solicitarAutomacaoWhatsApp);
router.get("/automacao-whatsapp/status/:id", pedagogaController.consultarStatusAutomacaoWhatsApp);
router.get("/automacao-whatsapp/mensagem", pedagogaController.obterMensagemWhatsApp);
router.put("/automacao-whatsapp/mensagem", auditarMutacao({
  acao: "CONFIGURACAO_MENSAGEM_EDITADA", entidade: "configuracao", entidadeId: "mensagem_whatsapp",
  descricao: "Atualizou o modelo de mensagem automática do WhatsApp.",
}), pedagogaController.salvarMensagemWhatsApp);
router.post("/chamadas/:id/confirmar", auditarMutacao({
  acao: "CHAMADA_CONFIRMADA", entidade: "chamada", entidadeId: ({ req }) => req.params.id,
  descricao: ({ req }) => `Confirmou a chamada ${req.params.id}.`,
}), pedagogaController.confirmarChamada);
router.get("/chamadas-confirmadas", pedagogaController.chamadasConfirmadasHoje);
router.get("/chamadas-confirmadas/:id", pedagogaController.detalharChamadaConfirmada);
router.put("/frequencias/:id", auditarMutacao({
  acao: ({ req }) => {
    if (req.body.justificativa || req.body.motivo || String(req.body.status || "").includes("just")) return "JUSTIFICATIVA_ADICIONADA";
    if (req.body.atrasado || String(req.body.status || "").includes("atras")) return "ALUNO_MARCADO_COMO_ATRASADO";
    return "FREQUENCIA_ALTERADA";
  },
  entidade: "frequencia", entidadeId: ({ req }) => req.params.id,
  descricao: ({ req }) => {
    if (req.body.justificativa || req.body.motivo || String(req.body.status || "").includes("just")) {
      return "Registrou uma justificativa de frequência sem armazenar seu conteúdo no log.";
    }
    if (req.body.atrasado || String(req.body.status || "").includes("atras")) {
      return "Alterou a frequência do aluno de ausência para atraso.";
    }
    return `Alterou a frequência do aluno para ${req.body.status || "o estado informado"}.`;
  },
  detalhes: ({ req }) => ({ status: req.body.status, atrasado: req.body.atrasado, justificativa_registrada: Boolean(req.body.justificativa || req.body.motivo) }),
}), pedagogaController.atualizarFrequenciaAluno);
router.get("/turmas-pendentes", pedagogaController.turmasPendentes);
router.post("/chamadas-pedagogicas", auditarMutacao({
  acao: "CHAMADA_CRIADA_PELA_PEDAGOGIA", entidade: "chamada",
  entidadeId: ({ payload }) => payload.chamada.id || payload.id,
  descricao: "Criou uma chamada pela área pedagógica.",
  detalhes: ({ req }) => ({ turma_id: req.body.turma_id, materia: req.body.materia, data_chamada: req.body.data_chamada }),
}), pedagogaController.criarChamadaPedagogica);
router.put("/chamadas/:id", auditarMutacao({
  acao: "CHAMADA_EDITADA_PELA_PEDAGOGIA", entidade: "chamada", entidadeId: ({ req }) => req.params.id,
  descricao: ({ req }) => `Atualizou os registros de frequência de ${Array.isArray(req.body.alunos) ? req.body.alunos.length : 0} alunos na chamada ${req.params.id} pela área pedagógica.`,
}), pedagogaController.atualizarChamada);
router.get("/relatorios/dados", pedagogaController.dadosRelatorios);
router.get("/responsaveis", pedagogaController.responsaveis);
router.post("/responsaveis/pesquisar", pedagogaController.responsaveis);
router.put("/responsaveis/:id", auditarMutacao({
  acao: "RESPONSAVEL_EDITADO", entidade: "responsavel", entidadeId: ({ req }) => req.params.id,
  descricao: "Atualizou o cadastro de um responsável sem armazenar dados privados no log.",
}), pedagogaController.atualizarResponsavel);

module.exports = router;
