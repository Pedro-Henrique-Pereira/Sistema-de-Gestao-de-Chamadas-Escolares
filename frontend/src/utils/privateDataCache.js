const cachePrivadoEmMemoria = new Map();
const PREFIXOS_LEGADOS_SENSIVEIS = [
  "alunos_atrasados_",
  "relatorios_agregados",
];

export function lerCachePrivado(chave) {
  return cachePrivadoEmMemoria.get(String(chave)) ?? null;
}

export function salvarCachePrivado(chave, valor) {
  cachePrivadoEmMemoria.set(String(chave), valor);
}

export function limparCachePrivado() {
  cachePrivadoEmMemoria.clear();
}

export function limparPersistenciaPrivadaLegada(storage = globalThis.sessionStorage) {
  if (!storage) return;

  const chavesParaRemover = [];
  for (let indice = 0; indice < storage.length; indice += 1) {
    const chave = storage.key(indice);
    if (PREFIXOS_LEGADOS_SENSIVEIS.some((prefixo) => chave?.startsWith(prefixo))) {
      chavesParaRemover.push(chave);
    }
  }

  chavesParaRemover.forEach((chave) => storage.removeItem(chave));
}

export function limparDadosPrivados(storage = globalThis.sessionStorage) {
  limparCachePrivado();
  limparPersistenciaPrivadaLegada(storage);
}
