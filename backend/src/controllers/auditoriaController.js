const auditoriaService = require("../services/auditoriaService");
const { dataISOValida } = require("../utils/dateValidation");

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function validarFiltros(query = {}) {
  if (query.dataInicio && (!DATA_ISO.test(query.dataInicio) || !dataISOValida(query.dataInicio))) {
    const error = new Error("Data inicial inválida.");
    error.status = 400;
    throw error;
  }
  if (query.dataFim && (!DATA_ISO.test(query.dataFim) || !dataISOValida(query.dataFim))) {
    const error = new Error("Data final inválida.");
    error.status = 400;
    throw error;
  }
  if (query.dataInicio && query.dataFim && query.dataInicio > query.dataFim) {
    const error = new Error("A data inicial não pode ser posterior à data final.");
    error.status = 400;
    throw error;
  }
}

async function listar(req, res, next) {
  try {
    validarFiltros(req.query);
    return res.json(await auditoriaService.listarLogs(req.query));
  } catch (error) {
    return next(error);
  }
}

async function opcoes(req, res, next) {
  try {
    return res.json(await auditoriaService.listarOpcoesFiltros());
  } catch (error) {
    return next(error);
  }
}

module.exports = { listar, opcoes, validarFiltros };
