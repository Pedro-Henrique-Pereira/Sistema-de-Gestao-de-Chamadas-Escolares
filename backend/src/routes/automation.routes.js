const express = require("express");
const controller = require("../controllers/automationController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");
const { auditarMutacao } = require("../middlewares/auditoriaMiddleware");

const router = express.Router();

router.use(autenticar);

router.get("/machines", autorizar("pedagoga", "administracao"), controller.listMachines);
router.get("/tasks", autorizar("pedagoga", "administracao"), controller.listTasks);
router.get("/tasks/:id", autorizar("pedagoga", "administracao"), controller.getTask);
router.get("/queues", autorizar("administracao"), controller.listQueues);
router.get("/message-template", autorizar("pedagoga", "administracao"), controller.getMessageTemplate);

router.post(
  "/tasks/attendance-notifications",
  autorizar("pedagoga", "administracao"),
  auditarMutacao({
    acao: "AUTOMACAO_FALTAS_CRIADA",
    entidade: "automacao",
    entidadeId: ({ payload }) => payload?.task?.taskId,
    descricao: "Criou uma tarefa de notificações de ausência.",
    detalhes: ({ req }) => ({
      chamada_id: req.body.attendanceId,
      maquina: req.body.machineId,
    }),
  }),
  controller.createAttendanceTask
);

router.post(
  "/tasks/group-messages",
  autorizar("administracao"),
  auditarMutacao({
    acao: "AUTOMACAO_GRUPOS_CRIADA",
    entidade: "automacao",
    entidadeId: ({ payload }) => payload?.task?.taskId,
    descricao: "Criou uma tarefa administrativa de mensagens para grupos.",
    detalhes: ({ req }) => ({
      total_grupos_informados: Array.isArray(req.body.groups) ? req.body.groups.length : null,
      todos_grupos: req.body.allGroups === true,
      maquina: req.body.machineId,
    }),
  }),
  controller.createGroupTask
);

router.put(
  "/message-template",
  autorizar("pedagoga", "administracao"),
  auditarMutacao({
    acao: "CONFIGURACAO_MENSAGEM_EDITADA",
    entidade: "configuracao",
    entidadeId: "mensagem_whatsapp",
    descricao: "Atualizou o modelo de mensagem automática sem registrar seu conteúdo.",
  }),
  controller.updateMessageTemplate
);

router.post(
  "/tasks/:id/cancel",
  autorizar("administracao"),
  auditarMutacao({
    acao: "AUTOMACAO_CANCELADA",
    entidade: "automacao",
    entidadeId: ({ req }) => req.params.id,
    descricao: "Cancelou uma tarefa de automação antes do início.",
  }),
  controller.cancelTask
);

module.exports = router;
