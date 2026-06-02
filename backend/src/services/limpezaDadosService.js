const db = require("../database/db");
const { garantirConfiguracao } = require("../controllers/configuracoesEscolaController");
const { safeLogError } = require("../utils/errorHandler");

const UM_DIA_EM_MS = 24 * 60 * 60 * 1000;

function normalizarMesesRetencao(valor) {
  const meses = Number.parseInt(valor, 10);
  if (!Number.isInteger(meses) || meses < 1 || meses > 3) {
    return 1;
  }
  return meses;
}

async function executarLimpezaAutomatica() {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const config = await garantirConfiguracao(connection);
    const mesesRetencao = normalizarMesesRetencao(config.tempo_maximo_justificativas_meses);

    const [resultadoJustificativas] = await connection.execute(
      `DELETE FROM justificativas_frequencia
       WHERE registrada_em < DATE_SUB(NOW(), INTERVAL ? MONTH)`,
      [mesesRetencao]
    );

    const [resultadoChamadas] = await connection.execute("DELETE FROM chamadas_diarias");

    await connection.commit();

    const resumo = {
      chamadasDiariasRemovidas: resultadoChamadas.affectedRows || 0,
      justificativasRemovidas: resultadoJustificativas.affectedRows || 0,
      mesesRetencaoJustificativas: mesesRetencao,
      executadoEm: new Date().toISOString(),
    };

    return resumo;
  } catch (error) {
    await connection.rollback();
    safeLogError("limpezaDadosService.Erro na limpeza automática", error);
    throw error;
  } finally {
    connection.release();
  }
}

function calcularMsAteProximaMeiaNoite() {
  const agora = new Date();
  const proximaMeiaNoite = new Date(agora);
  proximaMeiaNoite.setHours(24, 0, 0, 0);
  return Math.max(proximaMeiaNoite.getTime() - agora.getTime(), 1000);
}

function iniciarRotinaLimpezaDiaria() {
  const agendarProximaExecucao = () => {
    setTimeout(async () => {
      try {
        await executarLimpezaAutomatica();
      } catch (error) {
        // Erro já tratado com safeLogError dentro da rotina.
      } finally {
        setInterval(() => {
          executarLimpezaAutomatica().catch(() => {});
        }, UM_DIA_EM_MS);
      }
    }, calcularMsAteProximaMeiaNoite());
  };

  agendarProximaExecucao();
}

module.exports = {
  executarLimpezaAutomatica,
  iniciarRotinaLimpezaDiaria,
  normalizarMesesRetencao,
};
