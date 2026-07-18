function serializar(valor) {
  if (valor === undefined) return null;
  return JSON.stringify(valor);
}

async function registrarAuditoria(connection, {
  chamadaId,
  usuario,
  evento,
  valoresAnteriores = null,
  valoresNovos = null,
}) {
  await connection.execute(
    `INSERT INTO chamada_auditoria
      (chamada_id, usuario_id, usuario_perfil, evento, valores_anteriores, valores_novos)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      Number(chamadaId),
      usuario?.id ? Number(usuario.id) : null,
      String(usuario?.tipo || "sistema"),
      evento,
      serializar(valoresAnteriores),
      serializar(valoresNovos),
    ]
  );
}

module.exports = { registrarAuditoria };
