const db = require("../database/connection");
const { formatarEmail } = require("../utils/formatadores");

async function buscarPorEmail(email) {
  const emailNormalizado = formatarEmail(email);

  const [rows] = await db.execute(
    `
    SELECT 
      id, 
      nome, 
      email, 
      senha_hash, 
      tipo, 
      ativo 
    FROM usuarios 
    WHERE email = ? 
    LIMIT 1
    `,
    [emailNormalizado]
  );

  return rows[0];
}

async function buscarPorId(id) {
  const [rows] = await db.execute(
    `
    SELECT 
      id, 
      nome, 
      email, 
      tipo, 
      ativo, 
      criado_em 
    FROM usuarios 
    WHERE id = ? 
    LIMIT 1
    `,
    [id]
  );

  return rows[0];
}

module.exports = {
  buscarPorEmail,
  buscarPorId,
};