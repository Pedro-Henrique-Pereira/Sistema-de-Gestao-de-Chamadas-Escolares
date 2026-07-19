const crypto = require("crypto");
const db = require("../database/db");
const { registrarEvento } = require("../services/auditoriaService");

function hashesCoincidem(hashCalculado, hashArmazenado) {
  const calculado = Buffer.from(String(hashCalculado || ""), "utf8");
  const armazenado = Buffer.from(String(hashArmazenado || ""), "utf8");

  if (calculado.length !== armazenado.length) return false;
  return crypto.timingSafeEqual(calculado, armazenado);
}

async function criarToken({ usuarioId, tokenHash, expiraEm }) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute(
      "SELECT id FROM usuarios WHERE id = ? AND ativo = TRUE FOR UPDATE",
      [usuarioId]
    );
    await connection.execute(
      `UPDATE recuperacoes_senha
       SET invalidado_em = COALESCE(invalidado_em, NOW())
       WHERE usuario_id = ?
         AND utilizado_em IS NULL
         AND invalidado_em IS NULL`,
      [usuarioId]
    );
    await connection.execute(
      `INSERT INTO recuperacoes_senha
        (usuario_id, token_hash, expira_em, criado_em)
       VALUES (?, ?, ?, NOW())`,
      [usuarioId, tokenHash, expiraEm]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function buscarTokenValido(tokenHash) {
  const [rows] = await db.execute(
    `SELECT r.id, r.usuario_id, r.token_hash
     FROM recuperacoes_senha r
     INNER JOIN usuarios u ON u.id = r.usuario_id AND u.ativo = TRUE
     WHERE r.token_hash = ?
       AND r.utilizado_em IS NULL
       AND r.invalidado_em IS NULL
       AND r.expira_em > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  const registro = rows[0];
  if (!registro || !hashesCoincidem(tokenHash, registro.token_hash)) return null;
  return registro;
}

async function redefinirSenha({ tokenHash, senhaHash }) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT r.id, r.usuario_id, r.token_hash
       FROM recuperacoes_senha r
       INNER JOIN usuarios u ON u.id = r.usuario_id AND u.ativo = TRUE
       WHERE r.token_hash = ?
         AND r.utilizado_em IS NULL
         AND r.invalidado_em IS NULL
         AND r.expira_em > NOW()
       LIMIT 1
       FOR UPDATE`,
      [tokenHash]
    );

    const registro = rows[0];

    if (!registro || !hashesCoincidem(tokenHash, registro.token_hash)) {
      await connection.rollback();
      return false;
    }

    await connection.execute(
      "UPDATE usuarios SET senha_hash = ? WHERE id = ?",
      [senhaHash, registro.usuario_id]
    );
    await connection.execute(
      `UPDATE recuperacoes_senha
       SET utilizado_em = NOW(), invalidado_em = NOW()
       WHERE id = ?`,
      [registro.id]
    );
    await connection.execute(
      `UPDATE recuperacoes_senha
       SET invalidado_em = COALESCE(invalidado_em, NOW())
       WHERE usuario_id = ?
         AND id <> ?
         AND utilizado_em IS NULL`,
      [registro.usuario_id, registro.id]
    );
    await connection.execute(
      "DELETE FROM sessoes_ativas WHERE usuario_id = ?",
      [registro.usuario_id]
    );
    await registrarEvento({
      executor: connection,
      usuario: { id: registro.usuario_id },
      acao: "ALTERACAO_SENHA",
      descricao: "A senha do usuário foi redefinida com sucesso. Nenhum dado da senha foi armazenado.",
      entidade: "usuario",
      entidadeId: registro.usuario_id,
      resultado: "sucesso",
      detalhes: { origem: "recuperacao_segura" },
    });

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function invalidarPorHash(tokenHash) {
  await db.execute(
    `UPDATE recuperacoes_senha
     SET invalidado_em = COALESCE(invalidado_em, NOW())
     WHERE token_hash = ?`,
    [tokenHash]
  );
}

async function limparTokensAntigos(executor = db) {
  const [resultado] = await executor.execute(
    `DELETE FROM recuperacoes_senha
     WHERE expira_em < DATE_SUB(NOW(), INTERVAL 7 DAY)
        OR (
          (utilizado_em IS NOT NULL OR invalidado_em IS NOT NULL)
          AND criado_em < DATE_SUB(NOW(), INTERVAL 7 DAY)
        )`
  );

  return resultado.affectedRows || 0;
}

module.exports = {
  criarToken,
  buscarTokenValido,
  redefinirSenha,
  invalidarPorHash,
  limparTokensAntigos,
  hashesCoincidem,
};
