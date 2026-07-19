const db = require("../database/db");
const { safeLogError } = require("../utils/errorHandler");

const INTERVALO_LIMPEZA_DIAS = 30;
const VERIFICACAO_MS = 6 * 60 * 60 * 1000;

function normalizarDiasRetencao(valor) {
  const dias = Number.parseInt(valor, 10);
  if (!Number.isInteger(dias)) return 365;
  return Math.min(Math.max(dias, 30), 3650);
}

async function executarLimpezaAuditoria({ forcar = false, pool = db } = {}) {
  const connection = await pool.getConnection();
  let transacaoAtiva = false;
  let lockAdquirido = false;

  try {
    const [[lock]] = await connection.execute(
      "SELECT GET_LOCK('sistema_chamadas_auditoria_cleanup', 0) AS adquirido"
    );
    lockAdquirido = Number(lock.adquirido) === 1;
    if (!lockAdquirido) return { executada: false, motivo: "execucao_concorrente" };

    await connection.beginTransaction();
    transacaoAtiva = true;

    const [[estado]] = await connection.execute(
      `SELECT id,
              (em_execucao_desde IS NOT NULL
               AND em_execucao_desde > DATE_SUB(NOW(), INTERVAL 2 HOUR)) AS em_execucao,
              (proxima_execucao_em IS NULL OR proxima_execucao_em <= NOW()) AS vencida
         FROM auditoria_limpeza_estado
        WHERE id = 1
        FOR UPDATE`
    );

    if (!estado) throw new Error("Estado persistente da limpeza de auditoria não encontrado.");
    if (Boolean(estado.em_execucao) || (!forcar && !Boolean(estado.vencida))) {
      await connection.commit();
      transacaoAtiva = false;
      return { executada: false, motivo: estado.em_execucao ? "em_execucao" : "ainda_nao_vencida" };
    }

    await connection.execute(
      `UPDATE auditoria_limpeza_estado
          SET em_execucao_desde = NOW(), ultima_tentativa_em = NOW(), ultimo_erro = NULL
        WHERE id = 1`
    );
    await connection.commit();
    transacaoAtiva = false;

    await connection.beginTransaction();
    transacaoAtiva = true;
    const diasRetencao = normalizarDiasRetencao(process.env.AUDIT_RETENTION_DAYS);
    const [remocao] = await connection.execute(
      "DELETE FROM logs_auditoria WHERE criado_em < DATE_SUB(NOW(), INTERVAL ? DAY)",
      [diasRetencao]
    );
    const removidos = Number(remocao.affectedRows || 0);

    await connection.execute(
      `UPDATE auditoria_limpeza_estado
          SET ultima_execucao_em = NOW(),
              ultima_quantidade_removida = ?,
              proxima_execucao_em = DATE_ADD(NOW(), INTERVAL ? DAY),
              em_execucao_desde = NULL,
              ultimo_erro = NULL
        WHERE id = 1`,
      [removidos, INTERVALO_LIMPEZA_DIAS]
    );
    await connection.commit();
    transacaoAtiva = false;

    return { executada: true, removidos, diasRetencao };
  } catch (error) {
    if (transacaoAtiva) await connection.rollback();
    try {
      await connection.execute(
        `UPDATE auditoria_limpeza_estado
            SET em_execucao_desde = NULL,
                ultimo_erro = 'Falha interna registrada nos logs técnicos.'
          WHERE id = 1`
      );
    } catch {
      // A falha original continua sendo a fonte técnica principal.
    }
    safeLogError("limpezaAuditoriaService.Falha na limpeza", error);
    throw error;
  } finally {
    if (lockAdquirido) {
      try {
        await connection.execute("SELECT RELEASE_LOCK('sistema_chamadas_auditoria_cleanup')");
      } catch {
        // O MySQL também libera o lock ao encerrar a conexão.
      }
    }
    connection.release();
  }
}

function iniciarRotinaLimpezaAuditoria() {
  let timer;
  const verificar = async () => {
    try {
      await executarLimpezaAuditoria();
    } catch {
      // A rotina registra somente diagnósticos técnicos seguros.
    } finally {
      timer = setTimeout(verificar, VERIFICACAO_MS);
      timer.unref?.();
    }
  };

  verificar();
  return () => timer && clearTimeout(timer);
}

module.exports = {
  INTERVALO_LIMPEZA_DIAS,
  normalizarDiasRetencao,
  executarLimpezaAuditoria,
  iniciarRotinaLimpezaAuditoria,
};
