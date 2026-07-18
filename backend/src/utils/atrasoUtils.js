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
  const temMinutos = await colunaExiste(dbOrConnection, "registros_frequencia_alunos", "atraso_minutos");
  const temVersao = await colunaExiste(dbOrConnection, "chamadas_diarias", "versao");

  if (!temHorario || !temTimestamp || !temMinutos || !temVersao) {
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
  const match = texto.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const horas = Number(match[1]);
  const minutos = Number(match[2]);
  const segundos = Number(match[3] || 0);

  if (horas > 23 || minutos > 59 || segundos > 59) return null;
  return `${match[1]}:${match[2]}:${String(segundos).padStart(2, "0")}`;
}

function formatarDataHoraBrasilia(data) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(data);
  const mapa = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return `${mapa.year}-${mapa.month}-${mapa.day} ${mapa.hour}:${mapa.minute}:${mapa.second}`;
}

function normalizarDataHoraAtraso(valor) {
  if (!valor) return null;

  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return formatarDataHoraBrasilia(valor);
  }

  const texto = String(valor).trim();
  const temFusoExplicito = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(texto);

  if (!temFusoExplicito) {
    const matchLocal = texto.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
    );

    if (matchLocal) {
      const [, ano, mes, dia, hora, minuto, segundo = "00"] = matchLocal;
      return `${ano}-${mes}-${dia} ${hora}:${minuto}:${segundo}`;
    }
  }

  const data = new Date(texto);
  if (!Number.isNaN(data.getTime())) {
    return formatarDataHoraBrasilia(data);
  }

  return texto.slice(0, 19).replace("T", " ") || null;
}

module.exports = {
  colunaExiste,
  garantirColunasAtraso,
  normalizarHorarioAtraso,
  normalizarDataHoraAtraso,
};
