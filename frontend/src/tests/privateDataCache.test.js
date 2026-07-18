import test from "node:test";
import assert from "node:assert/strict";

import {
  lerCachePrivado,
  salvarCachePrivado,
  limparDadosPrivados,
} from "../utils/privateDataCache.js";

function criarStorage(inicial = {}) {
  const dados = new Map(Object.entries(inicial));

  return {
    get length() {
      return dados.size;
    },
    key(indice) {
      return [...dados.keys()][indice] ?? null;
    },
    getItem(chave) {
      return dados.get(chave) ?? null;
    },
    setItem(chave, valor) {
      dados.set(chave, String(valor));
    },
    removeItem(chave) {
      dados.delete(chave);
    },
  };
}

test("cache privado existe somente em memoria e pode ser limpo no logout", () => {
  salvarCachePrivado("alunos", [{ id: 1, nome: "Aluno" }]);
  assert.equal(lerCachePrivado("alunos")[0].nome, "Aluno");

  limparDadosPrivados(criarStorage());
  assert.equal(lerCachePrivado("alunos"), null);
});

test("limpeza remove caches sensiveis legados sem apagar mensagem de sessao", () => {
  const storage = criarStorage({
    alunos_atrasados_institucional_2026: "dados",
    "relatorios_agregados:1m": "dados",
    loginMessage: "Sessao encerrada",
  });

  limparDadosPrivados(storage);

  assert.equal(storage.getItem("alunos_atrasados_institucional_2026"), null);
  assert.equal(storage.getItem("relatorios_agregados:1m"), null);
  assert.equal(storage.getItem("loginMessage"), "Sessao encerrada");
});
