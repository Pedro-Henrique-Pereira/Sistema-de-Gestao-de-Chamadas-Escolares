const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const db = require("../database/db");
const { autorizar } = require("../middlewares/authMiddleware");
const controller = require("../controllers/configuracoesEscolaController");

function executarAutorizacao(tipo) {
  const resposta = { statusCode: 200, body: null };
  const res = {
    status(codigo) {
      resposta.statusCode = codigo;
      return this;
    },
    json(body) {
      resposta.body = body;
      return this;
    },
  };
  let chamouNext = false;
  autorizar("administracao")({ usuario: { id: 1, tipo } }, res, () => {
    chamouNext = true;
  });
  return { ...resposta, chamouNext };
}

test("configuração administrativa aceita booleanos explícitos e rejeita valores ambíguos", () => {
  assert.equal(controller.normalizarBooleano(true), true);
  assert.equal(controller.normalizarBooleano("0"), false);
  assert.equal(controller.normalizarBooleano("false"), false);
  assert.equal(controller.normalizarBooleano("talvez"), null);
  assert.equal(controller.booleanoDoBanco(undefined), true);
});

test("somente administração passa pela autorização da rota de alteração", () => {
  assert.equal(executarAutorizacao("administracao").chamouNext, true);
  assert.equal(executarAutorizacao("pedagoga").statusCode, 403);
  assert.equal(executarAutorizacao("professor").statusCode, 403);

  const rota = fs.readFileSync(path.resolve(__dirname, "../routes/configuracoes-escola.routes.js"), "utf8");
  assert.match(rota, /router\.put\("\/", autorizar\("administracao"\), controller\.salvarConfiguracao\)/);
});

test("salvar bloqueio persiste e audita valor anterior e novo na mesma transação", async (t) => {
  const eventos = [];
  let bloqueioAtual = 1;
  const connection = {
    async beginTransaction() {
      eventos.push("begin");
    },
    async commit() {
      eventos.push("commit");
    },
    async rollback() {
      eventos.push("rollback");
    },
    release() {
      eventos.push("release");
    },
    async execute(sql, params = []) {
      if (sql.includes("FROM configuracoes_escola") && sql.includes("FOR UPDATE")) {
        return [[{
          horario_limite_atraso: "07:45:00",
          tempo_maximo_justificativas_meses: 1,
          bloquear_edicao_chamadas_apos_horario: bloqueioAtual,
        }]];
      }
      if (sql.startsWith("SELECT id, horario_limite_atraso")) {
        return [[{
          id: 1,
          horario_limite_atraso: "07:45:00",
          tempo_maximo_justificativas_meses: 1,
          bloquear_edicao_chamadas_apos_horario: bloqueioAtual,
        }]];
      }
      if (sql.includes("INSERT INTO configuracoes_escola_auditoria")) {
        eventos.push({ tipo: "audit", params });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO configuracoes_escola")) {
        bloqueioAtual = params[2];
        eventos.push({ tipo: "update", params });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`SQL não esperado no teste: ${sql}`);
    },
  };

  const getConnectionOriginal = db.getConnection;
  db.getConnection = async () => connection;
  t.after(() => {
    db.getConnection = getConnectionOriginal;
  });

  let payloadResposta;
  let erroEncaminhado;
  await controller.salvarConfiguracao(
    {
      body: { bloquear_edicao_chamadas_apos_horario: false },
      usuario: { id: 99, tipo: "administracao" },
    },
    {
      json(payload) {
        payloadResposta = payload;
        return payload;
      },
    },
    (error) => {
      erroEncaminhado = error;
    }
  );

  assert.equal(erroEncaminhado, undefined);
  assert.equal(payloadResposta.bloquear_edicao_chamadas_apos_horario, false);
  assert.deepEqual(eventos, [
    "begin",
    { tipo: "update", params: ["07:45:00", 1, 0] },
    { tipo: "audit", params: [99, "administracao", "1", "0"] },
    "commit",
    "release",
  ]);
});

test("migration é idempotente e aplica padrão seguro ativado", () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, "../database/migrations/2026-07-18_bloqueio_edicao_chamadas.sql"),
    "utf8"
  );

  assert.match(migration, /INFORMATION_SCHEMA\.COLUMNS/);
  assert.match(migration, /bloquear_edicao_chamadas_apos_horario BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS configuracoes_escola_auditoria/);
});
