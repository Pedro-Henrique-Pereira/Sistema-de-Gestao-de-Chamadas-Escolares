const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../database/connection");
const Registros = require("../models/registrosModel");

async function comResultadoExclusao(affectedRows, executar) {
  const executeOriginal = db.execute;
  const chamadas = [];

  db.execute = async (sql, parametros) => {
    chamadas.push({ sql, parametros });
    return [{ affectedRows }];
  };

  try {
    await executar();
    return chamadas;
  } finally {
    db.execute = executeOriginal;
  }
}

test("exclusões existentes preservam o fluxo de sucesso", async () => {
  const chamadasAluno = await comResultadoExclusao(
    1,
    () => Registros.removerAluno(10)
  );
  const chamadasEquipe = await comResultadoExclusao(
    1,
    () => Registros.removerEquipe(20)
  );

  assert.deepEqual(chamadasAluno[0].parametros, [10]);
  assert.match(chamadasAluno[0].sql, /DELETE FROM alunos/);
  assert.deepEqual(chamadasEquipe[0].parametros, [20]);
  assert.match(chamadasEquipe[0].sql, /DELETE FROM usuarios/);
});

test("exclusão de aluno inexistente retorna HTTP 404", async () => {
  await assert.rejects(
    comResultadoExclusao(0, () => Registros.removerAluno(999)),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.message, "Aluno não encontrado.");
      return true;
    }
  );
});

test("exclusão de conta inexistente retorna HTTP 404", async () => {
  await assert.rejects(
    comResultadoExclusao(0, () => Registros.removerEquipe(999)),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.message, "Conta não encontrada.");
      return true;
    }
  );
});
