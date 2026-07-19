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
    });
    return res.json({ resultado });
  } catch (error) {
    return next(error);
  }
}

function health(req, res) {
  return res.json({
    status: "ok",
    maquina_id: req.automationWorker.maquinaId,
  });
}

module.exports = {
  capturarTarefa,
  registrarResultado,
  health,
};
