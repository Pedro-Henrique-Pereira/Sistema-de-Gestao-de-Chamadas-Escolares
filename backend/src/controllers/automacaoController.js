const db = require('../database/db');
const { serializarStatusAutomacao } = require('../utils/publicDtos');

function validarIdAutomacao(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    const erro = new Error('ID da automação inválido.');
    erro.status = 400;
    throw erro;
  }
  return id;
}

async function consultarStatus(req, res, next) {
  try {
    const id = validarIdAutomacao(req.params.id);

    const [rows] = await db.execute(
      `
      SELECT
        id,
        status,
        erro
      FROM fila_automacao
      WHERE id = ?
        AND (usuario_solicitante_id = ? OR ? = 'administracao')
      LIMIT 1
      `,
      [id, req.usuario.id, req.usuario.tipo]
    );

    if (!rows.length) {
      const erro = new Error('Solicitação de automação não encontrada.');
      erro.status = 404;
      throw erro;
    }

    return res.json({ automacao: serializarStatusAutomacao(rows[0]) });
  } catch (error) {
    return next(error);
  }
}

async function cancelarAutomacao(req, res, next) {
  let connection;
  let transacaoIniciada = false;

  try {
    connection = await db.getConnection();
    const id = validarIdAutomacao(req.params.id);

    await connection.beginTransaction();
    transacaoIniciada = true;

    const [resultado] = await connection.execute(
      `
      UPDATE fila_automacao
         SET status = 'cancelado',
             erro = 'Cancelado pelo usuário antes do início.',
             lock_owner = NULL,
             lock_adquirido_em = NULL
       WHERE id = ?
         AND status = 'pendente'
         AND (usuario_solicitante_id = ? OR ? = 'administracao')
      `,
      [id, req.usuario.id, req.usuario.tipo]
    );

    if (resultado.affectedRows === 1) {
      await connection.commit();
      transacaoIniciada = false;
      return res.json({
        mensagem: 'Automação cancelada com segurança antes do início.',
        automacao: { id, status: 'cancelado', erro_publico: 'Solicitação cancelada antes do início da execução.' },
      });
    }

    const [rows] = await connection.execute(
      `
      SELECT id, status, maquina_destino, tipo_automacao
      FROM fila_automacao
      WHERE id = ?
        AND (usuario_solicitante_id = ? OR ? = 'administracao')
      LIMIT 1
      `,
      [id, req.usuario.id, req.usuario.tipo]
    );

    await connection.rollback();
    transacaoIniciada = false;

    if (!rows.length) {
      const erro = new Error('Solicitação de automação não encontrada.');
      erro.status = 404;
      throw erro;
    }

    const statusAtual = rows[0].status;
    const erro = new Error(
      statusAtual === 'executando'
        ? 'Não é possível cancelar: o robô local já iniciou a execução.'
        : `Não é possível cancelar: a automação já está com status "${statusAtual}".`
    );
    erro.status = 409;
    throw erro;
  } catch (error) {
    if (transacaoIniciada && connection) {
      await connection.rollback();
    }
    return next(error);
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  consultarStatus,
  cancelarAutomacao,
};
