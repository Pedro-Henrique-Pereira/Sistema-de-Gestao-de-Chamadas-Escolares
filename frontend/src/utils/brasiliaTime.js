const TIME_ZONE = 'America/Sao_Paulo';

function partesBrasilia(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, parte) => {
    if (parte.type !== 'literal') acc[parte.type] = parte.value;
    return acc;
  }, {});
}

export function dataBrasiliaISO(date = new Date()) {
  const p = partesBrasilia(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function minutosAtuaisBrasilia(date = new Date()) {
  const p = partesBrasilia(date);
  return Number(p.hour) * 60 + Number(p.minute);
}
