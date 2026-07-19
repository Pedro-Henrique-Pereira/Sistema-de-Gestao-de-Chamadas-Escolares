import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const service = fs.readFileSync(new URL("../services/automacaoService.js", import.meta.url), "utf8");
const pedagoga = fs.readFileSync(new URL("../pages/Pedagoga.jsx", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../pages/MensagensAdmin.jsx", import.meta.url), "utf8");
const modal = fs.readFileSync(new URL("../components/AutomacaoFeedbackModal.jsx", import.meta.url), "utf8");

test("frontend cria tarefas somente pelo backend do Sistema de Chamadas", () => {
  assert.match(service, /\/api\/automation\/tasks\/attendance-notifications/);
  assert.match(service, /\/api\/automation\/tasks\/group-messages/);
  assert.match(service, /\/api\/automation\/queues\/\$\{encodeURIComponent\(machineId\)\}\/clear/);
  assert.doesNotMatch(service, /automation-worker/);
  assert.doesNotMatch(service, /Authorization/);
  assert.doesNotMatch(service, /AUTOMATION_MACHINE_TOKENS/);
});

test("pedagoga cria uma tarefa por chamada confirmada nas máquinas 1 ou 2", () => {
  assert.match(pedagoga, /iniciarAutomacaoChamada\(chamada\)/);
  assert.match(pedagoga, /attendanceId: chamada\.id/);
  assert.match(pedagoga, /useState\(\[1, 2\]\)/);
  assert.match(pedagoga, /Notificar responsáveis/);
  assert.match(pedagoga, /total_ausentes/);
  assert.match(pedagoga, /Limpar fila da máquina/);
  assert.match(pedagoga, /window\.confirm/);
  assert.match(pedagoga, /delete requestIdsFaltasRef\.current\[chamada\.id\]/);
});

test("editor da mensagem informa o salvamento e mantém falhas visíveis no modal", () => {
  assert.match(pedagoga, /salvandoMensagemWhatsapp/);
  assert.match(pedagoga, /erroMensagemWhatsapp/);
  assert.match(pedagoga, /Salvando\.\.\./);
  assert.match(pedagoga, /role="alert"/);
  assert.match(pedagoga, /type="submit"/);
  assert.match(pedagoga, /dia\/mês\/ano/);
});

test("administrador cria uma tarefa deduplicável para grupos nas máquinas 3, 4 ou 5", () => {
  assert.match(admin, /const MAQUINAS = \[3, 4, 5\]/);
  assert.match(admin, /requestIdPendente\.current/);
  assert.match(admin, /allGroups: modoDestinatarios === 'todos'/);
  assert.match(admin, /disabled=\{enviando \|\| carregando \|\| totalDestinatarios === 0\}/);
  assert.match(admin, /Limpar fila da máquina/);
  assert.match(admin, /handleLimparFila/);
});

test("modal apresenta progresso e falhas individuais sem bloquear a página", () => {
  assert.match(modal, /successCount/);
  assert.match(modal, /failureCount/);
  assert.match(modal, /ignoredDuplicateCount/);
  assert.match(modal, /alreadyQueuedCount/);
  assert.match(modal, /studentName \|\| result\.groupName/);
  assert.match(modal, /errorMessage/);
  assert.match(modal, /Fechar e acompanhar depois/);
});
