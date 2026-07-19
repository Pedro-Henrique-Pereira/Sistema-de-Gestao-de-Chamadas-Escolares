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
  "/queues/:machineId/clear",
  autorizar("pedagoga", "administracao"),
  auditarMutacao({
    acao: "AUTOMACAO_FILA_LIMPA",
    entidade: "automacao_fila",
    entidadeId: ({ payload, req }) => payload?.result?.machineId || req.params.machineId,
    descricao: ({ payload }) => (
      `Removeu ${Number(payload?.result?.removedTasks || 0)} tarefa(s) pendente(s) da fila da Máquina ${Number(payload?.result?.machineNumber || 0)}.`
    ),
    descricaoFalha: "A tentativa de limpar a fila da máquina não foi concluída.",
    detalhes: ({ payload, req }) => ({
      maquina: payload?.result?.machineNumber || req.params.machineId,
      tarefas_removidas: payload?.result?.removedTasks ?? null,
      tarefas_em_processamento_preservadas: payload?.result?.preservedProcessingTasks ?? null,
      executado_em: payload?.result?.executedAt || null,
    }),
  }),
  controller.clearMachineQueue
);

router.get(
  "/tasks/attendance-notifications/batch-preview",
  autorizar("pedagoga"),
  controller.previewAttendanceBatch
);

router.post(
  "/tasks/attendance-notifications/batch",
  autorizar("pedagoga"),
  auditarMutacao({
    acao: "AUTOMACAO_FALTAS_LOTE_CRIADO",
    entidade: "automacao_lote",
    entidadeId: ({ payload }) => payload?.summary?.requestId,
    descricao: ({ payload }) => (
      `Processou ${Number(payload?.summary?.totalEligibleClasses || 0)} turma(s) para notificacao em lote.`
    ),
    descricaoFalha: "A tentativa de notificar todas as turmas nao foi concluida.",
    detalhes: ({ req, payload }) => ({
      maquina: payload?.summary?.machineNumber || req.body.machineId,
      turmas_analisadas: payload?.summary?.totalClassesAnalyzed ?? null,
      turmas_elegiveis: payload?.summary?.totalEligibleClasses ?? null,
      tarefas_criadas: payload?.summary?.totalTasksAddedToQueue ?? null,
      duplicatas_bloqueadas: Number(payload?.summary?.totalAlreadyNotified || 0)
        + Number(payload?.summary?.totalAlreadyPending || 0)
        + Number(payload?.summary?.totalAlreadyProcessing || 0),
      falhas: payload?.summary?.totalErrors ?? null,
    }),
  }),
  controller.createAttendanceBatch
);

router.post(
  "/tasks/attendance-notifications",
  autorizar("pedagoga", "administracao"),
  auditarMutacao({
    acao: "AUTOMACAO_FALTAS_CRIADA",
    entidade: "automacao",
    entidadeId: ({ payload }) => payload?.task?.taskId,
    descricao: "Criou uma tarefa de notificações de ausência.",
    detalhes: ({ req, payload }) => ({
      chamada_id: req.body.attendanceId,
      maquina: req.body.machineId,
      duplicatas_ja_notificadas: payload?.task?.ignoredDuplicateCount ?? null,
      duplicatas_em_andamento: payload?.task?.alreadyQueuedCount ?? null,
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
