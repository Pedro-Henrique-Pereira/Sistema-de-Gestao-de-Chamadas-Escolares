const db = require('../database/connection');
const { safeLogError } = require('../utils/errorHandler');

async function limparFilaAutomacaoAntiga() {
  const retencaoDias = Math.min(
    Math.max(Number(process.env.AUTOMATION_TASK_RETENTION_DAYS || 365), 30),
    3650
  );
  const heartbeatTimeout = Math.min(
    Math.max(Number(process.env.AUTOMATION_HEARTBEAT_TIMEOUT_SECONDS || 60), 30),
    300
  );

  const [removidas] = await db.execute(`
    DELETE FROM fila_automacao
    WHERE status IN ('concluido', 'concluido_parcial', 'erro', 'falha_comunicacao', 'expirado', 'cancelado')
      AND data_solicitacao < TIMESTAMPADD(DAY, -?, NOW())
  `, [retencaoDias]);

  const [locksLiberados] = await db.execute(`
    UPDATE fila_automacao
    SET status = 'pendente',
        lock_owner = NULL,
        lock_adquirido_em = NULL,
        iniciado_em = NULL,
        erro = 'LEASE_EXPIRED'
    WHERE status = 'executando'
      AND lock_adquirido_em < TIMESTAMPADD(SECOND, -?, NOW())
  `, [Math.max(heartbeatTimeout * 3, 180)]);

  await db.execute(`
    UPDATE automacao_entregas
       SET status = 'erro',
           retentavel = TRUE,
           erro_codigo = 'LEASE_EXPIRED',
           erro_mensagem = 'A conexão com a máquina foi interrompida durante o envio.',
           lock_owner = NULL,
           lock_adquirido_em = NULL
     WHERE status = 'processando'
       AND lock_adquirido_em < TIMESTAMPADD(SECOND, -?, NOW())
  `, [Math.max(heartbeatTimeout * 3, 180)]);

  const [maquinasOffline] = await db.execute(`
    UPDATE automacao_maquinas
       SET estado = 'offline',
           tarefa_atual_id = NULL,
           worker_id = NULL
     WHERE habilitada = TRUE
       AND ultima_comunicacao_em IS NOT NULL
       AND ultima_comunicacao_em < TIMESTAMPADD(SECOND, -?, NOW())
  `, [heartbeatTimeout]);

  return {
    removidas: removidas.affectedRows || 0,
    locksLiberados: locksLiberados.affectedRows || 0,
    maquinasOffline: maquinasOffline.affectedRows || 0,
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
