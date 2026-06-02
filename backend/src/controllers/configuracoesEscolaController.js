const db = require("../database/db");

function normalizarHorario(valor) {
  const horario = String(valor || "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(horario)) {
    return null;
  }
  return horario.length === 5 ? `${horario}:00` : horario;
}

function horarioParaMinutos(horario) {
  const [h, m] = String(horario || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function normalizarMesesJustificativas(valor) {
  const meses = Number.parseInt(valor, 10);
  if (!Number.isInteger(meses) || meses < 1 || meses > 3) {
    return null;
  }
  return meses;
}

async function garantirConfiguracao(connection = db) {
  const [rows] = await connection.execute(
    "SELECT id, horario_limite_atraso, tempo_maximo_justificativas_meses, TIME_FORMAT(CURTIME(), '%H:%i:%s') AS horario_servidor, CURDATE() AS data_servidor FROM configuracoes_escola WHERE id = 1 LIMIT 1"
  );

  if (rows[0]) return rows[0];

  await connection.execute(
    "INSERT INTO configuracoes_escola (id, horario_limite_atraso, tempo_maximo_justificativas_meses) VALUES (1, '07:45:00', 1)"
  );

  const [novasRows] = await connection.execute(
    "SELECT id, horario_limite_atraso, tempo_maximo_justificativas_meses, TIME_FORMAT(CURTIME(), '%H:%i:%s') AS horario_servidor, CURDATE() AS data_servidor FROM configuracoes_escola WHERE id = 1 LIMIT 1"
  );

  return novasRows[0];
}

async function obterConfiguracao(req, res, next) {
  try {
    const config = await garantirConfiguracao();
    const limite = String(config.horario_limite_atraso).slice(0, 8);
    const servidor = String(config.horario_servidor).slice(0, 8);

    return res.json({
      horario_limite_atraso: limite,
      horarioLimiteAtraso: limite.slice(0, 5),
      horario_servidor: servidor,
      data_servidor: config.data_servidor,
      tempo_maximo_justificativas_meses: Number(config.tempo_maximo_justificativas_meses || 1),
      tempoMaximoJustificativasMeses: Number(config.tempo_maximo_justificativas_meses || 1),
      atraso_liberado: horarioParaMinutos(servidor) <= horarioParaMinutos(limite),
    });
  } catch (error) {
    return next(error);
  }
}

async function salvarConfiguracao(req, res, next) {
  try {
    const horario = normalizarHorario(req.body.horario_limite_atraso || req.body.horarioLimiteAtraso);
    if (!horario) return res.status(400).json({ erro: "Horário inválido. Use HH:MM." });

    const valorMesesJustificativas = Object.prototype.hasOwnProperty.call(req.body, "tempo_maximo_justificativas_meses")
      ? req.body.tempo_maximo_justificativas_meses
      : req.body.tempoMaximoJustificativasMeses ?? 1;

    const mesesJustificativas = normalizarMesesJustificativas(valorMesesJustificativas);
    if (!mesesJustificativas) {
      return res.status(400).json({ erro: "Tempo máximo de justificativas inválido. Use um valor entre 1 e 3 meses." });
    }

    await db.execute(
      `INSERT INTO configuracoes_escola (id, horario_limite_atraso, tempo_maximo_justificativas_meses)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE
         horario_limite_atraso = VALUES(horario_limite_atraso),
         tempo_maximo_justificativas_meses = VALUES(tempo_maximo_justificativas_meses)`,
      [horario, mesesJustificativas]
    );

    const config = await garantirConfiguracao();
    return res.json({
      mensagem: "Horário máximo de chegada atualizado com sucesso.",
      horario_limite_atraso: String(config.horario_limite_atraso).slice(0, 8),
      horarioLimiteAtraso: String(config.horario_limite_atraso).slice(0, 5),
      tempo_maximo_justificativas_meses: Number(config.tempo_maximo_justificativas_meses || 1),
      tempoMaximoJustificativasMeses: Number(config.tempo_maximo_justificativas_meses || 1),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { obterConfiguracao, salvarConfiguracao, garantirConfiguracao, horarioParaMinutos };
