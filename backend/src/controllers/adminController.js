const { dataBrasiliaISO } = require("../utils/brasiliaTime");
const dashboardService = require("../services/dashboardService");

async function painel(req, res, next) {
  try {
    const data = req.query.data || dataBrasiliaISO();
    const incluirAlunosAtrasados = String(req.query.incluirAlunosAtrasados || req.query.incluir_alunos_atrasados || "") === "1";
    const dashboard = await dashboardService.obterDashboardDia({
      data,
      incluirAlunosAtrasados,
    });

    return res.json(dashboard);
  } catch (error) {
    return next(error);
  }
}

module.exports = { painel };
