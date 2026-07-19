const automationWorkerService = require("../services/automationWorkerService");

async function capturarTarefa(req, res, next) {
  try {
    const tarefa = await automationWorkerService.capturarTarefa({
      maquinaId: req.automationWorker.maquinaId,
      workerId: req.body?.worker_id,
    });
    return res.json({ tarefa });
  } catch (error) {
    return next(error);
  }
}

async function registrarResultado(req, res, next) {
  try {
    const resultado = await automationWorkerService.registrarResultado({
      maquinaId: req.automationWorker.maquinaId,
      workerId: req.body?.worker_id,
      entregaId: req.params.id,
      status: req.body?.status,
      erroCodigo: req.body?.erro_codigo,
      identificadorExterno: req.body?.external_id,
    });
    return res.json({ resultado });
  } catch (error) {
    return next(error);
  }
}

async function heartbeat(req, res, next) {
  try {
    const machine = await automationWorkerService.registrarHeartbeat({
      maquinaId: req.automationWorker.maquinaId,
      workerId: req.body?.worker_id,
      appVersion: req.body?.app_version,
      state: req.body?.state,
      currentTaskId: req.body?.current_task_id,
      lastErrorCode: req.body?.last_error_code,
    });
    return res.json({ machine });
  } catch (error) {
    return next(error);
  }
}

async function health(req, res, next) {
  try {
    return res.json(await automationWorkerService.obterSaude({
      maquinaId: req.automationWorker.maquinaId,
    }));
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  capturarTarefa,
  registrarResultado,
  heartbeat,
  health,
};
