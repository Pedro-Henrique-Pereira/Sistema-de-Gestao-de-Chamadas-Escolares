const db = require('../database/connection');
const { safeLogError } = require('../utils/errorHandler');

async function limparFilaAutomacaoAntiga() {
  const [removidas] = await db.execute(`
    DELETE FROM fila_automacao
    WHERE status IN ('concluido', 'erro', 'expirado', 'cancelado')
      AND data_solicitacao < DATE_SUB(NOW(), INTERVAL 30 DAY)
  `);

  const [expiradas] = await db.execute(`
    UPDATE fila_automacao
    SET status = 'expirado',
        erro = COALESCE(erro, 'Tarefa expirada automaticamente por ficar pendente por mais de 7 dias.')
    WHERE status = 'pendente'
      AND data_solicitacao < DATE_SUB(NOW(), INTERVAL 7 DAY)
  `);

  const [locksLiberados] = await db.execute(`
    UPDATE fila_automacao
    SET status = 'pendente',
        lock_owner = NULL,
        lock_adquirido_em = NULL,
        iniciado_em = NULL,
        erro = COALESCE(erro, 'Lock liberado automaticamente por inatividade superior a 30 minutos.')
    WHERE status = 'executando'
      AND lock_adquirido_em < DATE_SUB(NOW(), INTERVAL 30 MINUTE)
  `);

  return {
    removidas: removidas.affectedRows || 0,
    expiradas: expiradas.affectedRows || 0,
    locksLiberados: locksLiberados.affectedRows || 0,
  };
}

function iniciarRotinaLimpezaAutomacao() {
  const intervaloHoras = Number(process.env.AUTOMACAO_CLEANUP_INTERVAL_HOURS || 6);
  const intervaloMs = Math.max(intervaloHoras, 1) * 60 * 60 * 1000;

  async function executar() {
    try {
      await limparFilaAutomacaoAntiga();
    } catch (error) {
      safeLogError('limpezaAutomacaoService.iniciarRotinaLimpezaAutomacao', error);
    }
  }

  executar();
  setInterval(executar, intervaloMs);
}

module.exports = {
  limparFilaAutomacaoAntiga,
  iniciarRotinaLimpezaAutomacao,
};
