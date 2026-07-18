export const ATRASOS_CACHE_NAMESPACE = "institucional";
export const ATRASOS_SYNC_INTERVAL_MS = 60_000;

export function criarChaveCacheAtrasos(data, namespace = ATRASOS_CACHE_NAMESPACE) {
  return `alunos_atrasados_${namespace}_${data}`;
}

export function deveSincronizarAtrasos({
  podeGerarLista,
  carregando,
  temCarregador,
  documentoVisivel = true,
}) {
  return Boolean(
    podeGerarLista &&
    !carregando &&
    temCarregador &&
    documentoVisivel
  );
}
