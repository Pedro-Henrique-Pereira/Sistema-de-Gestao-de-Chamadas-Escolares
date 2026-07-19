const db = require("../database/db");
const { dataBrasiliaISO, horarioBrasilia } = require("../utils/brasiliaTime");

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

function normalizarBooleano(valor) {
  if (valor === true || valor === 1 || String(valor).toLowerCase() === "true" || String(valor) === "1") return true;
  if (valor === false || valor === 0 || String(valor).toLowerCase() === "false" || String(valor) === "0") return false;
  return null;
}

function booleanoDoBanco(valor, padrao = true) {
  const normalizado = normalizarBooleano(valor);
  return normalizado === null ? padrao : normalizado;
}

async function garantirConfiguracao(connection = db) {
  const [rows] = await connection.execute(
    "SELECT id, horario_limite_atraso, tempo_maximo_justificativas_meses, bloquear_edicao_chamadas_apos_horario FROM configuracoes_escola WHERE id = 1 LIMIT 1"
  );

  if (rows[0]) return { ...rows[0], horario_servidor: horarioBrasilia(), data_servidor: dataBrasiliaISO() };

  await connection.execute(
    "INSERT INTO configuracoes_escola (id, horario_limite_atraso, tempo_maximo_justificativas_meses, bloquear_edicao_chamadas_apos_horario) VALUES (1, '07:45:00', 1, TRUE)"
  );

  const [novasRows] = await connection.execute(
    "SELECT id, horario_limite_atraso, tempo_maximo_justificativas_meses, bloquear_edicao_chamadas_apos_horario FROM configuracoes_escola WHERE id = 1 LIMIT 1"
  );

  return { ...novasRows[0], horario_servidor: horarioBrasilia(), data_servidor: dataBrasiliaISO() };
}

async function obterConfiguracao(req, res, next) {
  try {
    const config = await garantirConfiguracao();
    const limite = String(config.horario_limite_atraso).slice(0, 8);
    const servidor = String(config.horario_servidor).slice(0, 8);
    const bloqueioEdicaoAtivado = booleanoDoBanco(config.bloquear_edicao_chamadas_apos_horario);
    const horarioMaximoPassou = horarioParaMinutos(servidor) > horarioParaMinutos(limite);
    const excecaoPedagogaAtiva = req.usuario?.tipo === "pedagoga" && !bloqueioEdicaoAtivado;

    return res.json({
      horario_limite_atraso: limite,
      horarioLimiteAtraso: limite.slice(0, 5),
      horario_servidor: servidor,
      data_servidor: config.data_servidor,
      tempo_maximo_justificativas_meses: Number(config.tempo_maximo_justificativas_meses || 1),
      tempoMaximoJustificativasMeses: Number(config.tempo_maximo_justificativas_meses || 1),
      bloquear_edicao_chamadas_apos_horario: bloqueioEdicaoAtivado,
      bloquearEdicaoChamadasAposHorario: bloqueioEdicaoAtivado,
      edicao_apos_horario_permitida: horarioMaximoPassou && excecaoPedagogaAtiva,
      atraso_liberado: !horarioMaximoPassou || excecaoPedagogaAtiva,
      automacao_liberada: horarioMaximoPassou,
      horario_maximo_chegada_passou: horarioMaximoPassou,
    });
  } catch (error) {
    return next(error);
  }
}

async function salvarConfiguracao(req, res, next) {
  let connection;
  let transacaoIniciada = false;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    transacaoIniciada = true;

    await garantirConfiguracao(connection);
    const [[configAtual]] = await connection.execute(
      "SELECT horario_limite_atraso, tempo_maximo_justificativas_meses, bloquear_edicao_chamadas_apos_horario FROM configuracoes_escola WHERE id = 1 LIMIT 1 FOR UPDATE"
    );

    const temHorario = Object.prototype.hasOwnProperty.call(req.body, "horario_limite_atraso")
      || Object.prototype.hasOwnProperty.call(req.body, "horarioLimiteAtraso");
    const temMeses = Object.prototype.hasOwnProperty.call(req.body, "tempo_maximo_justificativas_meses")
      || Object.prototype.hasOwnProperty.call(req.body, "tempoMaximoJustificativasMeses");
    const temBloqueio = Object.prototype.hasOwnProperty.call(req.body, "bloquear_edicao_chamadas_apos_horario")
      || Object.prototype.hasOwnProperty.call(req.body, "bloquearEdicaoChamadasAposHorario");

    const horarioRecebido = req.body.horario_limite_atraso ?? req.body.horarioLimiteAtraso;
    const horario = temHorario
      ? normalizarHorario(horarioRecebido)
      : String(configAtual.horario_limite_atraso).slice(0, 8);
    if (!horario) {
      const erro = new Error("Horário inválido. Use HH:MM.");
      erro.status = 400;
      throw erro;
    }

    const mesesRecebidos = req.body.tempo_maximo_justificativas_meses ?? req.body.tempoMaximoJustificativasMeses;
    const mesesJustificativas = temMeses
      ? normalizarMesesJustificativas(mesesRecebidos)
      : Number(configAtual.tempo_maximo_justificativas_meses || 1);
    if (!mesesJustificativas) {
      const erro = new Error("Tempo máximo de justificativas inválido. Use um valor entre 1 e 3 meses.");
      erro.status = 400;
      throw erro;
    }

    const bloqueioAnterior = booleanoDoBanco(configAtual.bloquear_edicao_chamadas_apos_horario);
    const bloqueioRecebido = req.body.bloquear_edicao_chamadas_apos_horario ?? req.body.bloquearEdicaoChamadasAposHorario;
    const bloqueioEdicao = temBloqueio ? normalizarBooleano(bloqueioRecebido) : bloqueioAnterior;
    if (bloqueioEdicao === null) {
      const erro = new Error("Estado do bloqueio de edição inválido.");
      erro.status = 400;
      throw erro;
    }

    await connection.execute(
      `INSERT INTO configuracoes_escola (id, horario_limite_atraso, tempo_maximo_justificativas_meses, bloquear_edicao_chamadas_apos_horario)
       VALUES (1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         horario_limite_atraso = VALUES(horario_limite_atraso),
         tempo_maximo_justificativas_meses = VALUES(tempo_maximo_justificativas_meses),
         bloquear_edicao_chamadas_apos_horario = VALUES(bloquear_edicao_chamadas_apos_horario)`,
      [horario, mesesJustificativas, bloqueioEdicao ? 1 : 0]
    );

    if (temBloqueio && bloqueioAnterior !== bloqueioEdicao) {
      await connection.execute(
        `INSERT INTO configuracoes_escola_auditoria
          (configuracao_id, alterado_por_id, alterado_por_perfil, campo, valor_anterior, valor_novo)
         VALUES (1, ?, ?, 'bloquear_edicao_chamadas_apos_horario', ?, ?)`,
        [Number(req.usuario.id), String(req.usuario.tipo), bloqueioAnterior ? "1" : "0", bloqueioEdicao ? "1" : "0"]
      );
    }

    await connection.commit();
    transacaoIniciada = false;

    return res.json({
      mensagem: "Configurações da escola atualizadas com sucesso.",
      horario_limite_atraso: horario,
      horarioLimiteAtraso: horario.slice(0, 5),
      tempo_maximo_justificativas_meses: mesesJustificativas,
      tempoMaximoJustificativasMeses: mesesJustificativas,
      bloquear_edicao_chamadas_apos_horario: bloqueioEdicao,
      bloquearEdicaoChamadasAposHorario: bloqueioEdicao,
    });
  } catch (error) {
    if (transacaoIniciada && connection) await connection.rollback();
    return next(error);
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  obterConfiguracao,
  salvarConfiguracao,
  garantirConfiguracao,
  horarioParaMinutos,
  normalizarBooleano,
  booleanoDoBanco,
};
