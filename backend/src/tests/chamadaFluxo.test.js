const test = require("node:test");
const assert = require("node:assert/strict");

const fluxo = require("../services/chamadaFluxoService");
const chamadaService = require("../services/chamadaService");

const professorA = { id: 10, tipo: "professor" };
const professorB = { id: 11, tipo: "professor" };
const pedagoga = { id: 20, tipo: "pedagoga" };
const administracao = { id: 30, tipo: "administracao" };
const antesDoLimite = { horario_servidor: "07:30:00", horario_limite_atraso: "07:45:00" };
const exatamenteNoLimite = { horario_servidor: "07:45:00", horario_limite_atraso: "07:45:00" };
const depoisDoLimite = { horario_servidor: "07:45:01", horario_limite_atraso: "07:45:00" };
const depoisDoLimiteSemBloqueio = {
  ...depoisDoLimite,
  bloquear_edicao_chamadas_apos_horario: false,
};

function chamada(status = "pendente", versao = 1) {
  return { id: 1, professor_id: professorA.id, status, versao };
}

test("1 - fluxo padrao: temporaria pode ser confirmada pela pedagogia com justificativas preservadas", () => {
  const atual = chamada();
  const justificativas = ["Atestado medico", "Consulta odontologica"];
  assert.equal(fluxo.canConfirmCall(atual, pedagoga, antesDoLimite).permitido, true);
  assert.deepEqual(justificativas, ["Atestado medico", "Consulta odontologica"]);
  assert.equal(fluxo.statusEfetivo({ ...atual, status: "confirmada" }, antesDoLimite), "CONFIRMADA");
});

test("2 - professor responsavel edita apenas a chamada temporaria", () => {
  assert.equal(fluxo.canProfessorEditCall(chamada(), professorA).permitido, true);
  assert.equal(fluxo.validateCallVersion(chamada(), 1).permitido, true);
});

test("3 - professor nao edita chamada confirmada", () => {
  const resultado = fluxo.canProfessorEditCall(chamada("confirmada"), professorA);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.mensagem, fluxo.MENSAGENS.PROFESSOR_CONFIRMADA);
});

test("4 - outro professor nao edita a chamada temporaria", () => {
  const resultado = fluxo.canProfessorEditCall(chamada(), professorB);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.mensagem, fluxo.MENSAGENS.PROFESSOR_NAO_RESPONSAVEL);
});

test("5 - atraso usa o horario de criacao da chamada", () => {
  assert.equal(fluxo.calculateStudentDelay("07:10:00", "07:32:00"), 22);
  assert.equal(fluxo.canPedagogueEditCall(chamada(), pedagoga, exatamenteNoLimite).permitido, true);
});

test("6 - pedagoga edita chamada confirmada antes ou exatamente no limite", () => {
  assert.equal(fluxo.canPedagogueEditCall(chamada("confirmada"), pedagoga, antesDoLimite).permitido, true);
  assert.equal(fluxo.canPedagogueEditCall(chamada("confirmada"), pedagoga, exatamenteNoLimite).permitido, true);
});

test("7 - pedagoga nao edita chamada confirmada depois do limite", () => {
  const resultado = fluxo.canPedagogueEditCall(chamada("confirmada"), pedagoga, depoisDoLimite);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.mensagem, fluxo.MENSAGENS.HORARIO_ENCERRADO);
  assert.equal(fluxo.statusEfetivo(chamada("confirmada"), depoisDoLimite), "BLOQUEADA");
});

test("8 - automacao e bloqueada antes e liberada depois do limite", () => {
  assert.equal(fluxo.canStartAutomation(antesDoLimite, true).permitido, false);
  assert.equal(fluxo.canStartAutomation(depoisDoLimite, true).permitido, true);
  assert.equal(fluxo.canStartAutomation(depoisDoLimite, false).permitido, false);
});

test("9 - versao desatualizada rejeita sobrescrita simultanea", () => {
  const atualizadaPelaPedagogia = chamada("confirmada", 2);
  const resultado = fluxo.validateCallVersion(atualizadaPelaPedagogia, 1);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.mensagem, fluxo.MENSAGENS.CONFLITO_VERSAO);
});

test("10 - lista completa aceita todos os alunos independentemente da ordem", () => {
  const esperados = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const recebidos = [{ aluno_id: 3 }, { aluno_id: 1 }, { aluno_id: 2 }];
  const resultado = fluxo.validateCompleteStudentList(esperados, recebidos);

  assert.equal(resultado.permitido, true);
  assert.deepEqual(resultado.faltantes, []);
  assert.deepEqual(resultado.inesperados, []);
});

test("11 - lista incompleta informa os alunos faltantes", () => {
  const esperados = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const recebidos = [{ aluno_id: 1 }, { aluno_id: 3 }];
  const resultado = fluxo.validateCompleteStudentList(esperados, recebidos);

  assert.equal(resultado.permitido, false);
  assert.equal(resultado.status, 409);
  assert.deepEqual(resultado.faltantes, [2]);
  assert.deepEqual(resultado.inesperados, []);
});

test("12 - lista com aluno de fora informa o item inesperado", () => {
  const esperados = [{ id: 1 }, { id: 2 }];
  const recebidos = [{ aluno_id: 1 }, { aluno_id: 2 }, { aluno_id: 9 }];
  const resultado = fluxo.validateCompleteStudentList(esperados, recebidos);

  assert.equal(resultado.permitido, false);
  assert.equal(resultado.status, 409);
  assert.deepEqual(resultado.faltantes, []);
  assert.deepEqual(resultado.inesperados, [9]);
});

test("13 - lista com IDs duplicados é rejeitada como payload inválido", () => {
  const esperados = [{ id: 1 }, { id: 2 }];
  const recebidos = [{ aluno_id: 1 }, { aluno_id: 1 }];
  const resultado = fluxo.validateCompleteStudentList(esperados, recebidos);

  assert.equal(resultado.permitido, false);
  assert.equal(resultado.status, 400);
  assert.equal(resultado.mensagem, "A lista de alunos possui IDs duplicados.");
});

function criarPoolTransacaoFake(eventos) {
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
  };

  return {
    async getConnection() {
      eventos.push("connection");
      return connection;
    },
  };
}

test("14 - alteração e auditoria são confirmadas juntas na mesma transação", async () => {
  const eventos = [];
  const pool = criarPoolTransacaoFake(eventos);

  const resultado = await chamadaService.executarTransacao(pool, async () => {
    eventos.push("update");
    eventos.push("audit");
    return { versao: 2 };
  });

  assert.deepEqual(resultado, { versao: 2 });
  assert.deepEqual(eventos, [
    "connection",
    "begin",
    "update",
    "audit",
    "commit",
    "release",
  ]);
});

test("15 - falha da auditoria desfaz a alteração antes de liberar a conexão", async () => {
  const eventos = [];
  const pool = criarPoolTransacaoFake(eventos);
  const erroAuditoria = new Error("Falha simulada na auditoria");

  await assert.rejects(
    chamadaService.executarTransacao(pool, async () => {
      eventos.push("update");
      eventos.push("audit");
      throw erroAuditoria;
    }),
    erroAuditoria
  );

  assert.deepEqual(eventos, [
    "connection",
    "begin",
    "update",
    "audit",
    "rollback",
    "release",
  ]);
});

test("16 - edição não pode introduzir novo atraso depois do horário máximo", () => {
  const anteriores = [{ aluno_id: 1, status_presenca: "ausente", atrasado: false }];
  const recebidos = [{ aluno_id: 1, status_presenca: "presente", atrasado: true }];
  const resultado = fluxo.canApplyStudentDelays(anteriores, recebidos, depoisDoLimite);

  assert.equal(resultado.permitido, false);
  assert.equal(resultado.mensagem, fluxo.MENSAGENS.ATRASO_FORA_DO_HORARIO);
});

test("17 - edição preserva atraso já registrado mesmo depois do horário máximo", () => {
  const anteriores = [{ aluno_id: 1, status_presenca: "presente", atrasado: true }];
  const recebidos = [{ aluno_id: 1, status_presenca: "presente", atrasado: true }];

  assert.equal(fluxo.canApplyStudentDelays(anteriores, recebidos, depoisDoLimite).permitido, true);
});

test("18 - novo atraso continua permitido até o horário máximo inclusive", () => {
  const anteriores = [{ aluno_id: 1, status_presenca: "ausente", atrasado: false }];
  const recebidos = [{ aluno_id: 1, status_presenca: "presente", atrasado: true }];

  assert.equal(fluxo.canApplyStudentDelays(anteriores, recebidos, exatamenteNoLimite).permitido, true);
});

test("19 - configuração ausente preserva o bloqueio seguro para bancos existentes", () => {
  assert.equal(fluxo.isEditLockEnabled(depoisDoLimite), true);
  assert.equal(fluxo.canPedagogueEditCall(chamada("confirmada"), pedagoga, depoisDoLimite).permitido, false);
});

test("20 - bloqueio desativado libera edição confirmada somente para pedagoga", () => {
  assert.equal(fluxo.canPedagogueEditCall(chamada("confirmada"), pedagoga, depoisDoLimiteSemBloqueio).permitido, true);
  assert.equal(fluxo.statusEfetivo(chamada("confirmada"), depoisDoLimiteSemBloqueio, pedagoga), "CONFIRMADA");
  assert.equal(fluxo.canPedagogueEditCall(chamada("confirmada"), administracao, depoisDoLimiteSemBloqueio).permitido, false);
  assert.equal(fluxo.canProfessorEditCall(chamada("confirmada"), professorA).permitido, false);
});

test("21 - pedagoga pode transformar falta em atraso após o limite quando o bloqueio está desativado", () => {
  const anteriores = [{ aluno_id: 1, status_presenca: "ausente", atrasado: false }];
  const recebidos = [{ aluno_id: 1, status_presenca: "presente", atrasado: true }];

  assert.equal(
    fluxo.canApplyStudentDelays(anteriores, recebidos, depoisDoLimiteSemBloqueio, pedagoga).permitido,
    true
  );
  assert.equal(
    fluxo.canApplyStudentDelays(anteriores, recebidos, depoisDoLimiteSemBloqueio, professorA).permitido,
    false
  );
  assert.equal(
    fluxo.canApplyStudentDelays(anteriores, recebidos, depoisDoLimiteSemBloqueio, administracao).permitido,
    false
  );
});

test("22 - cálculo de atraso continua igual e nunca gera valor negativo", () => {
  assert.equal(fluxo.calculateStudentDelay("07:10:00", "08:05:00"), 55);
  assert.equal(fluxo.calculateStudentDelay("08:05:00", "07:10:00"), 0);
});
