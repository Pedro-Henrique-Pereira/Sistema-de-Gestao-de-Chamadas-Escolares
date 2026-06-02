function formatarNome(nome = "") {
  return String(nome)
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function formatarTurma(turma = "") {
  const valor = String(turma)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  // Aceita: 7A, 7a, 7ºA, 7º A, 7°A, 7ªA.
  // Como o símbolo existente é removido pelo regex, nunca duplica o º.
  const match = valor.match(/^(\d+)[º°ª]?([A-Z])$/);

  if (match) {
    return `${match[1]}º${match[2]}`;
  }

  return valor;
}

function formatarEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function sanitizarGrupoEscolar(grupo = "") {
  const valor = String(grupo || "")
    .replace(/\s+/g, "")
    .replace(/°/g, "")
    .trim();

  return valor || null;
}

module.exports = {
  formatarNome,
  formatarTurma,
  formatarEmail,
  sanitizarGrupoEscolar,
};
