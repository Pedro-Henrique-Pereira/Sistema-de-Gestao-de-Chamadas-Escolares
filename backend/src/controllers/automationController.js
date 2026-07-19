const db = require("../database/db");
const taskService = require("../services/automationTaskService");
const { MESSAGE_TAGS, normalizeMessage } = require("../services/automationDomain");

async function createAttendanceTask(req, res, next) {
  try {
    const result = await taskService.createAttendanceTask({
      requestId: req.body?.requestId,
      machineId: req.body?.machineId,
      attendanceId: req.body?.attendanceId,
      user: req.usuario,
    });
    return res.status(result.reused ? 200 : 201).json({
      message: result.reused
        ? "A solicitação já existia e foi reutilizada sem duplicar mensagens."
        : `Tarefa adicionada à fila da Máquina ${result.task.machineNumber}.`,
      reused: result.reused,
      task: result.task,
    });
  } catch (error) {
    return next(error);
  }
}

async function createGroupTask(req, res, next) {
  try {
    const result = await taskService.createGroupTask({
      requestId: req.body?.requestId,
      machineId: req.body?.machineId,
      groupIds: req.body?.groups,
      allGroups: req.body?.allGroups === true,
      message: req.body?.message,
      user: req.usuario,
    });
    return res.status(result.reused ? 200 : 201).json({
      message: result.reused
        ? "A solicitação já existia e foi reutilizada sem duplicar grupos."
        : `Tarefa adicionada à fila da Máquina ${result.task.machineNumber}.`,
      reused: result.reused,
      task: result.task,
    });
  } catch (error) {
    return next(error);
  }
}

async function getTask(req, res, next) {
  try {
    return res.json({ task: await taskService.getTask(req.params.id, req.usuario) });
  } catch (error) {
    return next(error);
  }
}

async function listTasks(req, res, next) {
  try {
    const tasks = await taskService.listTasks(req.usuario, {
      limit: req.query.limit,
      type: req.query.type,
    });
    return res.json({ tasks });
  } catch (error) {
    return next(error);
  }
}

async function listMachines(req, res, next) {
  try {
    return res.json({ machines: await taskService.listMachines(req.usuario) });
  } catch (error) {
    return next(error);
  }
}

async function listQueues(req, res, next) {
  try {
    return res.json({ queues: await taskService.listQueues(req.usuario) });
  } catch (error) {
    return next(error);
  }
}

async function cancelTask(req, res, next) {
  try {
    const task = await taskService.cancelTask(req.params.id, req.usuario);
    return res.json({
      message: "Tarefa cancelada antes do início por usuário autorizado.",
      task,
    });
  } catch (error) {
    return next(error);
  }
}

async function getMessageTemplate(req, res, next) {
  try {
    const [rows] = await db.execute(
      "SELECT texto, atualizado_em FROM config_mensagem_whatsapp WHERE id = 1 LIMIT 1"
    );
    return res.json({
      text: rows[0]?.texto || taskService.DEFAULT_ATTENDANCE_MESSAGE,
      allowedTags: MESSAGE_TAGS,
      updatedAt: rows[0]?.atualizado_em || null,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateMessageTemplate(req, res, next) {
  try {
    const text = normalizeMessage(req.body?.text, 1000);
    const missingTags = MESSAGE_TAGS.filter((tag) => !text.includes(tag));
    if (missingTags.length) {
      const error = new Error(`Inclua as tags obrigatórias: ${MESSAGE_TAGS.join(", ")}.`);
      error.status = 400;
      throw error;
    }
    await db.execute(
      `INSERT INTO config_mensagem_whatsapp (id, texto)
       VALUES (1, ?)
       ON DUPLICATE KEY UPDATE texto = VALUES(texto), atualizado_em = CURRENT_TIMESTAMP`,
      [text]
    );
    return res.json({ message: "Mensagem personalizada salva com sucesso.", text, allowedTags: MESSAGE_TAGS });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  cancelTask,
  createAttendanceTask,
  createGroupTask,
  getMessageTemplate,
  getTask,
  listMachines,
  listQueues,
  listTasks,
  updateMessageTemplate,
};
