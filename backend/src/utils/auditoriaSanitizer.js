const CAMPOS_SENSIVEIS = /(?:senha|password|hash|token|cookie|csrf|authorization|secret|segredo|api[_-]?key|documento|cpf|rg|contato|telefone|anexo|motivo)/i;
const PROFUNDIDADE_MAXIMA = 4;
const ITENS_MAXIMOS = 30;
const TEXTO_MAXIMO = 500;

function sanitizarTexto(valor, limite = TEXTO_MAXIMO) {
  return String(valor ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, limite);
}

function sanitizarValor(valor, profundidade = 0, vistos = new WeakSet()) {
  if (valor === null || valor === undefined) return null;
  if (["string", "number", "boolean"].includes(typeof valor)) {
    return typeof valor === "string" ? sanitizarTexto(valor) : valor;
  }
  if (valor instanceof Date) return valor.toISOString();
  if (profundidade >= PROFUNDIDADE_MAXIMA) return "[limite de profundidade]";
  if (typeof valor !== "object") return sanitizarTexto(valor);
  if (vistos.has(valor)) return "[referencia circular]";

  vistos.add(valor);

  if (Array.isArray(valor)) {
    return valor.slice(0, ITENS_MAXIMOS).map((item) => sanitizarValor(item, profundidade + 1, vistos));
  }

  return Object.entries(valor).reduce((seguro, [chave, conteudo]) => {
    if (CAMPOS_SENSIVEIS.test(chave)) return seguro;
    seguro[sanitizarTexto(chave, 80)] = sanitizarValor(conteudo, profundidade + 1, vistos);
    return seguro;
  }, {});
}

function sanitizarDetalhes(valor) {
  if (valor === null || valor === undefined) return null;
  const sanitizado = sanitizarValor(valor);
  const serializado = JSON.stringify(sanitizado);
  if (Buffer.byteLength(serializado, "utf8") <= 8192) return sanitizado;
  return { resumo: sanitizarTexto(serializado, 2000), truncado: true };
}

module.exports = {
  CAMPOS_SENSIVEIS,
  sanitizarTexto,
  sanitizarDetalhes,
};
