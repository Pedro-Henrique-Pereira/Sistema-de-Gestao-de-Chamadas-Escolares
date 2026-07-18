import test from "node:test";
import assert from "node:assert/strict";

import {
  ATRASOS_CACHE_NAMESPACE,
  ATRASOS_SYNC_INTERVAL_MS,
  criarChaveCacheAtrasos,
  deveSincronizarAtrasos,
} from "../utils/atrasosSync.js";

test("admin e pedagoga compartilham o mesmo cache institucional de atrasos", () => {
  assert.equal(ATRASOS_CACHE_NAMESPACE, "institucional");
  assert.equal(
    criarChaveCacheAtrasos("2026-07-17"),
    "alunos_atrasados_institucional_2026-07-17"
  );
});

test("sincronizacao periodica e bloqueada quando a tela nao pode atualizar", () => {
  assert.equal(ATRASOS_SYNC_INTERVAL_MS, 60_000);
  assert.equal(deveSincronizarAtrasos({
    podeGerarLista: true,
    carregando: false,
    temCarregador: true,
    documentoVisivel: true,
  }), true);
  assert.equal(deveSincronizarAtrasos({
    podeGerarLista: true,
    carregando: false,
    temCarregador: true,
    documentoVisivel: false,
  }), false);
  assert.equal(deveSincronizarAtrasos({
    podeGerarLista: true,
    carregando: true,
    temCarregador: true,
    documentoVisivel: true,
  }), false);
});
