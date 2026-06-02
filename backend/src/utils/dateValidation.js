const CAMPOS_DATA_PADRAO = new Set(["data", "data_chamada", "dataInicial", "dataFinal"]);

function dataISOValida(valor) {
  if (typeof valor !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

  const [ano, mes, dia] = valor.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));

  return (
    data.getUTCFullYear() === ano &&
    data.getUTCMonth() === mes - 1 &&
    data.getUTCDate() === dia
  );
}

function validarCamposData(objeto = {}, campos = CAMPOS_DATA_PADRAO) {
  for (const campo of campos) {
    const valor = objeto?.[campo];
    if (valor === undefined || valor === null || valor === "") continue;

    if (!dataISOValida(String(valor))) {
      const erro = new Error(`Campo ${campo} inválido. Use o formato YYYY-MM-DD.`);
      erro.status = 400;
      throw erro;
    }
  }
}

function validarDatasRequest(campos = [...CAMPOS_DATA_PADRAO]) {
  const camposSet = new Set(campos);

  return (req, res, next) => {
    try {
      validarCamposData(req.query, camposSet);
      validarCamposData(req.body, camposSet);
      return next();
    } catch (error) {
      return res.status(error.status || 400).json({ erro: error.message });
    }
  };
}

module.exports = {
  dataISOValida,
  validarCamposData,
  validarDatasRequest,
};
