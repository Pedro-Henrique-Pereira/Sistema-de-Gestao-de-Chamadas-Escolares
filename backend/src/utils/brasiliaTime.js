const TIME_ZONE = 'America/Sao_Paulo';
process.env.TZ = process.env.TZ || TIME_ZONE;

function partesBrasilia(date = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, parte) => {
    if (parte.type !== 'literal') acc[parte.type] = parte.value;
    return acc;
  }, {});
  return partes;
}

function dataBrasiliaISO(date = new Date()) {
  const p = partesBrasilia(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function horarioBrasilia(date = new Date()) {
  const p = partesBrasilia(date);
  return `${p.hour}:${p.minute}:${p.second}`;
}

function dataHoraBrasiliaMySQL(date = new Date()) {
  return `${dataBrasiliaISO(date)} ${horarioBrasilia(date)}`;
}

function anoBrasilia(date = new Date()) {
  return Number(partesBrasilia(date).year);
}

module.exports = {
  TIME_ZONE,
  dataBrasiliaISO,
  horarioBrasilia,
  dataHoraBrasiliaMySQL,
  anoBrasilia,
};
