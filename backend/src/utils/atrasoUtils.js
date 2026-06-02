async function colunaExiste(dbOrConnection, tabela, coluna) {
  const [rows] = await dbOrConnection.execute(
    `
    SELECT COUNT(*) AS total
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [tabela, coluna]
  );

  return Number(rows[0]?.total || 0) > 0;
}

async function garantirColunasAtraso(dbOrConnection) {
  const temHorario = await colunaExiste(dbOrConnection, "registros_frequencia_alunos", "horario_registro_atraso");
  const temTimestamp = await colunaExiste(dbOrConnection, "registros_frequencia_alunos", "atraso_registrado_em");

  if (!temHorario || !temTimestamp) {
    const erro = new Error(
      "Banco desatualizado: execute as migrations de atraso antes de iniciar a API. A API não altera schema em runtime."
    );
    erro.status = 500;
    throw erro;
  }
}

function normalizarHorarioAtraso(valor) {
  if (!valor) return null;
  const texto = String(valor).trim();
  const match = texto.match(/^(\d{2}:\d{2})(?::\d{2})?/);
  return match ? `${match[1]}:00` : null;
}

function normalizarDataHoraAtraso(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  if (!Number.isNaN(data.getTime())) {
    return data.toISOString().slice(0, 19).replace("T", " ");
  }
  return String(valor).trim().slice(0, 19).replace("T", " ") || null;
}

module.exports = {
  colunaExiste,
  garantirColunasAtraso,
  normalizarHorarioAtraso,
  normalizarDataHoraAtraso,
};
