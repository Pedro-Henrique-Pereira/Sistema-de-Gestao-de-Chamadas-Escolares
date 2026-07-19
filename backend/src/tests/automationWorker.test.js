const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const {
  autenticarAutomationWorker,
  carregarTokensServico,
  tokensIguais,
} = require("../middlewares/automationWorkerAuth");
const {
  ATTENDANCE_MACHINES,
  GROUP_MACHINES,
  assertMachineAllowed,
  formatDateBR,
  normalizePhone,
  publicTaskStatus,
  renderAttendanceMessage,
} = require("../services/automationDomain");
const {
  validarWorkerId,
} = require("../services/automationWorkerService");
const {
  duplicateBlockCode,
  ensurePersonalizedTemplate,
  publicDeliveryStatus,
} = require("../services/automationTaskService");

const ROOT = path.resolve(__dirname, "../../..");

test("cada máquina usa uma credencial exclusiva comparada em tempo constante", () => {
  const tokens = carregarTokensServico(JSON.stringify({
    1: "a".repeat(32),
    3: "b".repeat(40),
  }));
  assert.equal(tokens.get(1), "a".repeat(32));
  assert.equal(tokens.get(3), "b".repeat(40));
  assert.equal(tokensIguais("a".repeat(32), tokens.get(1)), true);
  assert.equal(tokensIguais("x".repeat(32), tokens.get(1)), false);
  assert.throws(
    () => carregarTokensServico(JSON.stringify({ 1: "a".repeat(32), 2: "a".repeat(32) })),
    /credencial exclusiva/
  );
  assert.throws(
    () => carregarTokensServico('{"1":"curto"}'),
    /pelo menos 32 caracteres/
  );
});

test("worker, telefone e mensagem personalizada são validados", () => {
  assert.equal(validarWorkerId("maquina-1:escola"), "maquina-1:escola");
  assert.throws(() => validarWorkerId("../invalido"), /inválido/);
  assert.equal(normalizePhone("(44) 99913-5827", "55"), "5544999135827");
  assert.equal(normalizePhone("123", "55"), "");
  assert.equal(
    renderAttendanceMessage(
      "Olá {nome_responsavel}; {nome_aluno}; {data}",
      { guardianName: "Ana", studentName: "Bia", absenceDate: "2026-07-19" }
    ),
    "Olá Ana; Bia; 19/07/2026"
  );
  assert.match(ensurePersonalizedTemplate("Entre em contato com a escola."), /\{nome_aluno\}/);
  assert.match(ensurePersonalizedTemplate("Entre em contato com a escola."), /\{nome_responsavel\}/);
});

test("data da ausência é sempre apresentada no formato dia/mês/ano", () => {
  assert.equal(formatDateBR("2026-07-19"), "19/07/2026");
  assert.equal(formatDateBR("2026-07-19T12:30:00.000Z"), "19/07/2026");
  assert.equal(formatDateBR(new Date(2026, 6, 19, 12, 0, 0)), "19/07/2026");
  assert.equal(formatDateBR("19/07/2026"), "19/07/2026");
});

test("permissões de máquina e estados públicos seguem o contrato V2", () => {
  assert.equal(assertMachineAllowed(1, ATTENDANCE_MACHINES), 1);
  assert.equal(assertMachineAllowed(3, GROUP_MACHINES), 3);
  assert.throws(() => assertMachineAllowed(3, ATTENDANCE_MACHINES), /não é permitida/);
  assert.equal(publicTaskStatus({ status: "pendente" }, "offline"), "waiting_for_machine");
  assert.equal(publicTaskStatus({ status: "pendente" }, "online_busy"), "queued");
  assert.equal(publicTaskStatus({ status: "executando" }), "processing");
  assert.equal(publicTaskStatus({ status: "concluido" }), "completed_successfully");
  assert.equal(publicTaskStatus({ status: "concluido_parcial" }), "completed_partially");
  assert.equal(publicTaskStatus({ status: "erro" }), "completed_with_failures");
  assert.equal(publicTaskStatus({ status: "cancelado" }), "cancelled");
});

test("migration V2 persiste máquinas, eventos, idempotência e estados finais", () => {
  const baseMigration = fs.readFileSync(
    path.join(ROOT, "backend/src/database/migrations/2026-07-19_automacao_api.sql"),
    "utf8"
  );
  const v2Migration = fs.readFileSync(
    path.join(ROOT, "backend/src/database/migrations/2026-07-20_automacao_tarefas_v2.sql"),
    "utf8"
  );
  const runner = fs.readFileSync(
    path.join(ROOT, "backend/src/database/migrations/aplicarAutomacaoApi.js"),
    "utf8"
  );
  assert.match(baseMigration, /CREATE TABLE IF NOT EXISTS automacao_entregas/);
  assert.match(baseMigration, /UNIQUE KEY uk_automacao_entregas_idempotencia/);
  assert.match(v2Migration, /CREATE TABLE IF NOT EXISTS automacao_maquinas/);
  assert.match(v2Migration, /CREATE TABLE IF NOT EXISTS automacao_eventos/);
  assert.match(v2Migration, /online_available/);
  assert.match(v2Migration, /online_busy/);
  assert.match(runner, /uk_fila_automacao_request_id/);
  assert.match(runner, /uk_fila_automacao_idempotencia/);
  assert.match(runner, /idx_fila_maquina_fifo/);
  assert.match(runner, /concluido_parcial/);
  assert.match(runner, /falha_comunicacao/);
});

test("tarefa de faltas nasce da chamada confirmada e tarefa de grupos deduplica destinos", () => {
  const service = fs.readFileSync(
    path.join(ROOT, "backend/src/services/automationTaskService.js"),
    "utf8"
  );
  assert.match(service, /FROM registros_chamadas_confirmadas/);
  assert.match(service, /FROM registros_frequencia_alunos/);
  assert.match(service, /LOWER\(COALESCE\(f\.status, ''\)\) = 'ausente'/);
  assert.match(service, /COALESCE\(f\.atrasado, FALSE\) = FALSE/);
  assert.match(service, /attendance-request:\$\{requestId\}/);
  assert.match(service, /reserveAttendanceDeduplication/);
  assert.match(service, /Array\.from\(new Set/);
  assert.match(service, /groups:\$\{requestId\}/);
  assert.doesNotMatch(service, /FROM chamadas_diarias\s/);
});

test("fila usa lock por máquina, FIFO e checkpoints sem bloquear outras máquinas", () => {
  const service = fs.readFileSync(
    path.join(ROOT, "backend/src/services/automationWorkerService.js"),
    "utf8"
  );
  assert.match(service, /FROM automacao_maquinas/);
  assert.match(service, /WHERE maquina_destino = \?/);
  assert.match(service, /data_solicitacao ASC,\s*id ASC/);
  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /LIMIT \$\{batchSize\}\s+FOR UPDATE SKIP LOCKED/);
  assert.doesNotMatch(service, /LIMIT \?\s+FOR UPDATE SKIP LOCKED/);
  assert.match(service, /tarefa_atual_id/);
  assert.match(service, /lock_adquirido_em = NOW\(\)/);
  assert.match(service, /existingBatchForOwner/);
  assert.match(service, /status = 'processando'\s+AND lock_owner = \?/);
  assert.match(service, /DELIVERY_RESULT/);
  assert.match(service, /retentavel = TRUE/);
});

test("rota técnica fica antes do CSRF e oferece heartbeat, claim e resultado", () => {
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
  assert.match(routes, /\/heartbeat/);
  assert.match(routes, /\/tasks\/claim/);
  assert.match(routes, /\/deliveries\/:id\/result/);
});

test("credencial de uma máquina não pode selecionar outra máquina", async () => {
  const anterior = process.env.AUTOMATION_MACHINE_TOKENS;
  const token1 = "token-tecnico-maquina-1-".padEnd(40, "x");
  const token2 = "token-tecnico-maquina-2-".padEnd(40, "y");
  process.env.AUTOMATION_MACHINE_TOKENS = JSON.stringify({ 1: token1, 2: token2 });

  const app = express();
  app.get("/worker", autenticarAutomationWorker, (req, res) => {
    res.json(req.automationWorker);
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/worker`;

  try {
    assert.equal((await fetch(url)).status, 401);
    const valid = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token2}`,
        "X-Automation-Machine": "2",
      },
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { maquinaId: 2, identidade: "machine-2" });

    const forbidden = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token1}`,
        "X-Automation-Machine": "2",
      },
    });
    assert.equal(forbidden.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (anterior === undefined) delete process.env.AUTOMATION_MACHINE_TOKENS;
    else process.env.AUTOMATION_MACHINE_TOKENS = anterior;
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

test("deduplicação bloqueia sucesso e entregas ativas, mas libera falha final ou cancelamento", () => {
  const cfg = { maxAttempts: 3 };
  assert.equal(duplicateBlockCode({
    delivery_status: "enviado",
    task_status: "concluido",
  }, cfg), "DUPLICATE_ALREADY_SENT");
  assert.equal(duplicateBlockCode({
    delivery_status: "pendente",
    task_status: "pendente",
  }, cfg), "DUPLICATE_IN_PROGRESS");
  assert.equal(duplicateBlockCode({
    delivery_status: "processando",
    task_status: "executando",
  }, cfg), "DUPLICATE_IN_PROGRESS");
  assert.equal(duplicateBlockCode({
    delivery_status: "erro",
    task_status: "executando",
    retentavel: true,
    tentativas: 1,
  }, cfg), "DUPLICATE_IN_PROGRESS");
  assert.equal(duplicateBlockCode({
    delivery_status: "erro",
    task_status: "erro",
    retentavel: false,
    tentativas: 1,
  }, cfg), null);
  assert.equal(duplicateBlockCode({
    delivery_status: "cancelado",
    task_status: "cancelado",
  }, cfg), null);
});

test("resultado público separa duplicidade, fila existente e falha real", () => {
  assert.equal(publicDeliveryStatus({
    status: "ignorado",
    erro_codigo: "DUPLICATE_ALREADY_SENT",
  }), "ignored_duplicate");
  assert.equal(publicDeliveryStatus({
    status: "ignorado",
    erro_codigo: "DUPLICATE_IN_PROGRESS",
  }), "already_queued");
  assert.equal(publicDeliveryStatus({
    status: "erro",
    erro_codigo: "INVALID_PHONE",
    retentavel: false,
  }), "failed");
});

test("limpeza da fila trava a máquina, cancela somente pendentes e preserva execução", () => {
  const service = fs.readFileSync(
    path.join(ROOT, "backend/src/services/automationTaskService.js"),
    "utf8"
  );
  const routes = fs.readFileSync(
    path.join(ROOT, "backend/src/routes/automation.routes.js"),
    "utf8"
  );
  assert.match(service, /async function clearMachineQueue/);
  assert.match(service, /FROM automacao_maquinas[\s\S]+FOR UPDATE/);
  assert.match(service, /status = 'pendente'[\s\S]+FOR UPDATE/);
  assert.match(service, /status = 'executando'/);
  assert.match(service, /ATTENDANCE_MACHINES/);
  assert.match(service, /GROUP_MACHINES/);
  assert.match(routes, /\/queues\/:machineId\/clear/);
  assert.match(routes, /AUTOMACAO_FILA_LIMPA/);
});

test("migração cria trava persistente por destinatário e faz backfill de envios ativos", () => {
  const migration = fs.readFileSync(
    path.join(ROOT, "backend/src/database/migrations/2026-07-21_automacao_deduplicacao.sql"),
    "utf8"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS automacao_deduplicacao/);
  assert.match(migration, /PRIMARY KEY \(chave_deduplicacao\)/);
  assert.match(migration, /SHA2\(/);
  assert.match(migration, /delivery\.status IN \('pendente', 'processando', 'enviado'\)/);
});
