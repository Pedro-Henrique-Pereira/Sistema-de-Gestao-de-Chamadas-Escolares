const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inserirMensagensGrupoNaFila,
} = require("../services/filaAutomacaoService");

function criarTarefa(indice) {
  return {
    usuarioSolicitanteId: 1,
    usuarioSolicitanteNome: "ADMINISTRADOR",
    maquinaDestino: 3,
    mensagem: `Mensagem ${indice}`,
    payload: JSON.stringify({ grupo_whatsapp_id: indice }),
  };
}

test("retorna os IDs reais mesmo quando não são consecutivos", async () => {
  const idsBanco = [101, 105, 109];
  const chamadas = [];
  const connection = {
    async execute(sql, parametros) {
      chamadas.push({ sql, parametros });
      return [{ insertId: idsBanco[chamadas.length - 1], affectedRows: 1 }];
    },
  };

  const ids = await inserirMensagensGrupoNaFila(
    connection,
    [criarTarefa(1), criarTarefa(2), criarTarefa(3)]
  );

  assert.deepEqual(ids, [101, 105, 109]);
  assert.equal(chamadas.length, 3);
  assert.ok(chamadas.every(({ sql }) => sql.includes("INSERT INTO fila_automacao")));
});

test("interrompe a transação quando o banco não retorna um ID válido", async () => {
  const connection = {
    async execute() {
      return [{ insertId: 0, affectedRows: 1 }];
    },
  };

  await assert.rejects(
    inserirMensagensGrupoNaFila(connection, [criarTarefa(1)]),
    /identificar a tarefa inserida/
  );
});
