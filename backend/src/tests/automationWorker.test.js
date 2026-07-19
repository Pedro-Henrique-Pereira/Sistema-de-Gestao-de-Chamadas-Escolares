const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const {
  carregarTokensServico,
  tokensIguais,
} = require("../middlewares/automationWorkerAuth");
const {
  normalizarTelefone,
  renderizarMensagem,
  validarWorkerId,
} = require("../services/automationWorkerService");

const ROOT = path.resolve(__dirname, "../../..");

test("tokens da automação mapeiam máquinas autorizadas e são comparados com segurança", () => {
  const tokens = carregarTokensServico(JSON.stringify({
    1: "a".repeat(32),
    3: "b".repeat(40),
  }));
  assert.equal(tokens.get(1), "a".repeat(32));
  assert.equal(tokens.get(3), "b".repeat(40));
  assert.equal(tokensIguais("a".repeat(32), tokens.get(1)), true);
  assert.equal(tokensIguais("x".repeat(32), tokens.get(1)), false);
  assert.throws(
    () => carregarTokensServico('{"1":"curto"}'),
    /pelo menos 32 caracteres/
  );
});

test("worker id e dados mínimos da entrega são validados sem expor credenciais", () => {
  assert.equal(validarWorkerId("maquina-1:escola"), "maquina-1:escola");
  assert.throws(() => validarWorkerId("../invalido"), /inválido/);
  assert.equal(normalizarTelefone("(44) 99913-5827", "55"), "5544999135827");
  assert.equal(normalizarTelefone("123", "55"), "");
  assert.equal(
    renderizarMensagem(
      "Olá {nome_responsavel}; {nome_aluno}; {data}",
      { nomeResponsavel: "Ana", nomeAluno: "Bia", data: "2026-07-19" }
    ),
    "Olá Ana; Bia; 19/07/2026"
  );
});

test("migração cria estados completos e chave idempotente por ocorrência", () => {
  const migration = fs.readFileSync(
    path.join(ROOT, "backend/src/database/migrations/2026-07-19_automacao_api.sql"),
    "utf8"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS automacao_entregas/);
  assert.match(migration, /UNIQUE KEY uk_automacao_entregas_idempotencia/);
  for (const status of ["pendente", "processando", "enviado", "erro", "cancelado", "ignorado"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(migration, /tentativas <= 5/);
});

test("faltas temporárias e editadas não são enviadas pela integração", () => {
  const service = fs.readFileSync(
    path.join(ROOT, "backend/src/services/automationWorkerService.js"),
    "utf8"
  );
  assert.match(service, /FROM registros_frequencia_alunos rfa/);
  assert.doesNotMatch(service, /FROM chamadas_diarias\s/);
  assert.match(service, /LOWER\(COALESCE\(rfa\.status, ''\)\) = 'ausente'/);
  assert.match(service, /COALESCE\(rfa\.atrasado, FALSE\) = FALSE/);
  assert.match(service, /NOT EXISTS \(\s*SELECT 1\s*FROM registros_frequencia_alunos/s);
  assert.match(service, /CONCAT\('falta:', \?, ':', rfa\.aluno_id\)/);
});

test("rota do worker usa Bearer próprio e permanece separada do CSRF por cookies", () => {
  const server = fs.readFileSync(path.join(ROOT, "backend/src/server.js"), "utf8");
  const workerMount = server.indexOf('app.use("/api/automation-worker", automationWorkerRoutes)');
  const csrfMount = server.indexOf("app.use(csrfProtection)");
  assert.ok(workerMount > 0);
  assert.ok(csrfMount > workerMount);

  const routes = fs.readFileSync(
    path.join(ROOT, "backend/src/routes/automation-worker.routes.js"),
    "utf8"
  );
  assert.match(routes, /autenticarAutomationWorker/);
  assert.match(routes, /rateLimit/);
  assert.match(routes, /\/tasks\/claim/);
  assert.match(routes, /\/deliveries\/:id\/result/);
});

test("endpoint técnico rejeita ausência/token incorreto e aceita a identidade da máquina", async () => {
  const anterior = process.env.AUTOMATION_SERVICE_TOKENS;
  const token = "token-tecnico-maquina-1-".padEnd(40, "x");
  process.env.AUTOMATION_SERVICE_TOKENS = JSON.stringify({ 1: token });

  const app = express();
  app.use(express.json());
  app.use("/api/automation-worker", require("../routes/automation-worker.routes"));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();

  try {
    const ausente = await fetch(`http://127.0.0.1:${port}/api/automation-worker/health`);
    assert.equal(ausente.status, 401);

    const incorreto = await fetch(`http://127.0.0.1:${port}/api/automation-worker/health`, {
      headers: { Authorization: `Bearer ${"z".repeat(40)}` },
    });
    assert.equal(incorreto.status, 401);

    const valido = await fetch(`http://127.0.0.1:${port}/api/automation-worker/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(valido.status, 200);
    assert.deepEqual(await valido.json(), { status: "ok", maquina_id: 1 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (anterior === undefined) delete process.env.AUTOMATION_SERVICE_TOKENS;
    else process.env.AUTOMATION_SERVICE_TOKENS = anterior;
  }
});

test("token compartilhado seleciona somente uma das máquinas autorizadas pelo cabeçalho", async () => {
  const anterior = process.env.AUTOMATION_SERVICE_TOKENS;
  const tokenCompartilhado = "token-compartilhado-interface-".padEnd(40, "x");
  const tokenRestrito = "token-restrito-maquina-3-".padEnd(40, "y");
  process.env.AUTOMATION_SERVICE_TOKENS = JSON.stringify({
    1: tokenCompartilhado,
    2: tokenCompartilhado,
    3: tokenRestrito,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/automation-worker", require("../routes/automation-worker.routes"));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/automation-worker/health`;

  try {
    const maquina2 = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokenCompartilhado}`,
        "X-Automation-Machine": "2",
      },
    });
    assert.equal(maquina2.status, 200);
    assert.deepEqual(await maquina2.json(), { status: "ok", maquina_id: 2 });

    const semSelecao = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenCompartilhado}` },
    });
    assert.equal(semSelecao.status, 400);

    const naoAutorizada = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokenRestrito}`,
        "X-Automation-Machine": "2",
      },
    });
    assert.equal(naoAutorizada.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (anterior === undefined) delete process.env.AUTOMATION_SERVICE_TOKENS;
    else process.env.AUTOMATION_SERVICE_TOKENS = anterior;
  }
});

test("aplicativo independente não contém acesso direto ao MySQL", () => {
  const appDir = path.join(ROOT, "lysimaco-automacao-app");
  const arquivos = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".venv", "__pycache__", "runtime", "logs"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".py") || entry.name === "requirements.txt") arquivos.push(full);
    }
  }
  walk(appDir);
  const source = arquivos.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /mysql\.connector|mysql-connector-python|get_connection/);
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE)\s+(?:FROM|INTO|TABLE)/i);
});
