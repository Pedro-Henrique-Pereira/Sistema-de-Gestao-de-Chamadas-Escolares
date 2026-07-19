const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const auditoriaService = require("../services/auditoriaService");
const { sanitizarDetalhes } = require("../utils/auditoriaSanitizer");
const { auditarMutacao } = require("../middlewares/auditoriaMiddleware");
const { autorizar } = require("../middlewares/authMiddleware");
const auditoriaController = require("../controllers/auditoriaController");
const limpezaService = require("../services/limpezaAuditoriaService");

function aguardarResposta() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("sanitização remove senha, hash, token, cookie e dados privados em qualquer nível", () => {
  const seguro = sanitizarDetalhes({
    status: "ativo",
    senha: "Segredo123",
    nested: { senha_hash: "hash", tokenJWT: "jwt", csrfToken: "csrf", cookie: "cookie" },
    responsavel: { nome: "Pessoa", contato: "9999", documento: "123" },
  });
  const texto = JSON.stringify(seguro);

  assert.equal(seguro.status, "ativo");
  assert.equal(seguro.responsavel.nome, "Pessoa");
  assert.doesNotMatch(texto, /Segredo123|hash|jwt|csrf|cookie|9999|123/);
});

test("registro consulta o ator no backend e nunca usa nome ou perfil falsificado pelo cliente", async () => {
  const chamadas = [];
  const executor = {
    async execute(sql, params) {
      chamadas.push({ sql, params });
      if (sql.startsWith("SELECT id, nome, tipo")) {
        return [[{ id: 7, nome: "Maria Servidora", tipo: "administracao" }]];
      }
      return [{ insertId: 91 }];
    },
  };

  await auditoriaService.registrarEvento({
    executor,
    usuario: { id: 7, nome: "Nome Falso", tipo: "professor" },
    acao: "USUARIO_EDITADO",
    descricao: "Atualizou o usuário.",
    entidade: "usuario",
    entidadeId: 12,
    detalhes: { senha: "nao-pode", ativo: true },
  });

  const insertParams = chamadas[1].params;
  assert.equal(insertParams[3], "Maria Servidora");
  assert.equal(insertParams[4], "administracao");
  assert.doesNotMatch(JSON.stringify(insertParams), /Nome Falso|nao-pode/);
});

test("middleware registra sucesso com autoria autenticada e resposta somente depois da auditoria", async (t) => {
  const original = auditoriaService.registrarEvento;
  const eventos = [];
  auditoriaService.registrarEvento = async (evento) => eventos.push(evento);
  t.after(() => { auditoriaService.registrarEvento = original; });

  const req = {
    usuario: { id: 5, tipo: "administracao" },
    body: { usuario: { id: 999 }, senha: "secreta" },
    params: { id: "22" },
    ip: "127.0.0.1",
  };
  let resposta;
  const res = {
    statusCode: 200,
    json(payload) { resposta = payload; return this; },
  };
  const middleware = auditarMutacao({
    acao: "TESTE", entidade: "aluno", entidadeId: ({ req: request }) => request.params.id,
    descricao: "Operação concluída.",
  });

  middleware(req, res, () => res.json({ ok: true }));
  await aguardarResposta();

  assert.deepEqual(resposta, { ok: true });
  assert.equal(eventos[0].usuario.id, 5);
  assert.equal(eventos[0].resultado, "sucesso");
  assert.equal(eventos[0].entidadeId, "22");
});

test("middleware registra falha relevante com descrição segura", async (t) => {
  const original = auditoriaService.registrarEvento;
  let evento;
  auditoriaService.registrarEvento = async (dados) => { evento = dados; };
  t.after(() => { auditoriaService.registrarEvento = original; });

  const req = { usuario: { id: 2, tipo: "pedagoga" }, body: {}, params: {}, ip: "::ffff:10.0.0.2" };
  const res = { statusCode: 400, json() { return this; } };
  auditarMutacao({
    acao: "FREQUENCIA_ALTERADA", entidade: "frequencia",
    descricao: "Alterou frequência.", descricaoFalha: "Tentativa de alteração de frequência recusada.",
  })(req, res, () => res.json({ erro: "Entrada inválida" }));
  await aguardarResposta();

  assert.equal(evento.resultado, "falha");
  assert.equal(evento.descricao, "Tentativa de alteração de frequência recusada.");
  assert.equal(evento.ip, "10.0.0.2");
});

test("somente administração acessa consulta de logs", () => {
  const executar = (tipo) => {
    let status = 200;
    let next = false;
    autorizar("administracao")(
      { usuario: { id: 1, tipo } },
      { status(codigo) { status = codigo; return this; }, json() { return this; } },
      () => { next = true; }
    );
    return { status, next };
  };

  assert.equal(executar("administracao").next, true);
  assert.equal(executar("professor").status, 403);
  assert.equal(executar("pedagoga").status, 403);
});

test("rotas de auditoria são somente leitura e protegidas pelo router administrativo", () => {
  const rota = fs.readFileSync(path.resolve(__dirname, "../routes/admin.routes.js"), "utf8");
  assert.match(rota, /router\.use\(autenticar\)/);
  assert.match(rota, /router\.use\(autorizar\("administracao"\)\)/);
  assert.match(rota, /router\.get\("\/logs-auditoria"/);
  assert.doesNotMatch(rota, /router\.(post|put|patch|delete)\("\/logs-auditoria/);
});

test("filtros rejeitam intervalo invertido", () => {
  assert.throws(
    () => auditoriaController.validarFiltros({ dataInicio: "2026-07-20", dataFim: "2026-07-19" }),
    /data inicial/i
  );
  assert.doesNotThrow(() => auditoriaController.validarFiltros({ dataInicio: "2026-07-01", dataFim: "2026-07-19" }));
});

test("listagem aplica filtros no banco, pagina e ordena do evento mais recente", async () => {
  const sqlExecutado = [];
  const executor = {
    async execute(sql, params) {
      sqlExecutado.push({ sql, params });
      if (sql.includes("COUNT(*)")) return [[{ total: 26 }]];
      if (sql.includes("FROM auditoria_limpeza_estado")) return [[{ ultima_execucao_em: null, ultima_quantidade_removida: 0 }]];
      return [[{ id: 3, criado_em: "2026-07-19T12:00:00" }]];
    },
  };

  const resultado = await auditoriaService.listarLogs({
    page: 2, limit: 10, busca: "Maria%", acao: "CHAMADA_EDITADA", resultado: "sucesso",
  }, executor);

  assert.equal(resultado.paginacao.paginaAtual, 2);
  assert.equal(resultado.paginacao.totalPaginas, 3);
  assert.match(sqlExecutado[1].sql, /ORDER BY criado_em DESC, id DESC/);
  assert.match(sqlExecutado[1].sql, /LIMIT 10 OFFSET 10/);
  assert.equal(sqlExecutado[1].params.includes(10), false);
  assert.equal(sqlExecutado[0].params[0], "%Maria!%%");
});

test("pagina e limite interpolados no SQL continuam restritos a inteiros seguros", async () => {
  const consultas = [];
  const executor = {
    async execute(sql) {
      consultas.push(sql);
      if (sql.includes("COUNT(*)")) return [[{ total: 0 }]];
      if (sql.includes("FROM auditoria_limpeza_estado")) return [[null]];
      return [[]];
    },
  };

  await auditoriaService.listarLogs({ page: "2; DROP TABLE usuarios", limit: "999999" }, executor);

  assert.match(consultas[1], /LIMIT 100 OFFSET 0/);
  assert.doesNotMatch(consultas[1], /DROP TABLE/);
});

test("limpeza concorrente é ignorada sem remover registros", async () => {
  const sql = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(query) {
      sql.push(query);
      if (query.includes("GET_LOCK")) return [[{ adquirido: 1 }]];
      if (query.includes("RELEASE_LOCK")) return [[{ liberado: 1 }]];
      if (query.includes("FOR UPDATE")) return [[{ id: 1, em_execucao: 1, vencida: 1 }]];
      return [{ affectedRows: 0 }];
    },
  };
  const pool = { getConnection: async () => connection };

  const resultado = await limpezaService.executarLimpezaAuditoria({ forcar: true, pool });
  assert.deepEqual(resultado, { executada: false, motivo: "em_execucao" });
  assert.equal(sql.some((query) => query.includes("DELETE FROM logs_auditoria")), false);
});

test("limpeza vencida remove somente por data de retenção e persiste o resumo", async (t) => {
  const ambiente = process.env.AUDIT_RETENTION_DAYS;
  const chamadas = [];
  const connection = {
    async beginTransaction() { chamadas.push("begin"); },
    async commit() { chamadas.push("commit"); },
    async rollback() { chamadas.push("rollback"); },
    release() { chamadas.push("release"); },
    async execute(sql, params = []) {
      chamadas.push({ sql, params });
      if (sql.includes("GET_LOCK")) return [[{ adquirido: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ liberado: 1 }]];
      if (sql.includes("FOR UPDATE")) return [[{ id: 1, em_execucao: 0, vencida: 1 }]];
      if (sql.includes("DELETE FROM logs_auditoria")) return [{ affectedRows: 14 }];
      return [{ affectedRows: 1 }];
    },
  };
  process.env.AUDIT_RETENTION_DAYS = "365";
  const pool = { getConnection: async () => connection };
  t.after(() => {
    if (ambiente === undefined) delete process.env.AUDIT_RETENTION_DAYS;
    else process.env.AUDIT_RETENTION_DAYS = ambiente;
  });

  const resultado = await limpezaService.executarLimpezaAuditoria({ pool });
  const deleteCall = chamadas.find((item) => item.sql?.includes("DELETE FROM logs_auditoria"));
  const estadoCall = chamadas.find((item) => item.sql?.includes("ultima_execucao_em = NOW"));

  assert.deepEqual(resultado, { executada: true, removidos: 14, diasRetencao: 365 });
  assert.match(deleteCall.sql, /criado_em < DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/);
  assert.deepEqual(deleteCall.params, [365]);
  assert.deepEqual(estadoCall.params, [14, 30]);
});

test("migração cria tabelas, índices de filtro e estado persistente separado", () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, "../database/migrations/2026-07-19_logs_auditoria.sql"),
    "utf8"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS logs_auditoria/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auditoria_limpeza_estado/);
  assert.match(migration, /idx_auditoria_(acao|perfil|resultado|entidade)_data/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /VALUES \(1, NULL, 0, NOW\(\)\)/);
});

test("mutações críticas de chamada, justificativa, usuário e configuração estão instrumentadas", () => {
  const arquivos = [
    "../routes/chamadas.routes.js",
    "../routes/pedagoga.routes.js",
    "../routes/registros.routes.js",
    "../routes/configuracoes-escola.routes.js",
  ].map((arquivo) => fs.readFileSync(path.resolve(__dirname, arquivo), "utf8")).join("\n");

  for (const acao of [
    "CHAMADA_EDITADA", "ALUNO_MARCADO_COMO_ATRASADO", "JUSTIFICATIVA_ADICIONADA",
    "CHAMADA_CONFIRMADA", "ALUNO_EXCLUIDO", "USUARIO_CRIADO", "USUARIO_EDITADO",
    "CONFIGURACAO_ADMINISTRATIVA_EDITADA",
  ]) assert.match(arquivos, new RegExp(acao));
});

test("redefinição de senha audita dentro da transação sem armazenar senha, hash ou token", () => {
  const model = fs.readFileSync(path.resolve(__dirname, "../models/passwordResetModel.js"), "utf8");
  const inicioAuditoria = model.indexOf('acao: "ALTERACAO_SENHA"');
  const commit = model.indexOf("await connection.commit();", inicioAuditoria);
  const trecho = model.slice(inicioAuditoria, commit);

  assert.ok(inicioAuditoria > 0 && commit > inicioAuditoria);
  assert.match(trecho, /Nenhum dado da senha foi armazenado/);
  assert.doesNotMatch(trecho, /senhaHash|tokenHash|senha_hash|token_hash/);
});

test("interface mostra aviso de limpeza antes da listagem e oferece filtros e paginação", () => {
  const tela = fs.readFileSync(path.resolve(__dirname, "../../../frontend/src/pages/LogsAuditoria.jsx"), "utf8");
  assert.ok(tela.indexOf("<AvisoLimpeza") < tela.indexOf("audit-table-shell"));
  for (const campo of ["busca", "acao", "perfil", "resultado", "entidade", "dataInicio", "dataFim"]) {
    assert.match(tela, new RegExp(`name=\\"${campo}\\"`));
  }
  assert.match(tela, /Página/);
  assert.match(tela, /Nenhum evento encontrado/);
  assert.match(tela, /corrigirTextoLegado\(log\.descricao\)/);
  assert.match(tela, /const limpeza = ultimaLimpeza \|\| LIMPEZA_INICIAL/);
});
