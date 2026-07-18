const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classificarFrequencia,
  contarTotaisFrequencia,
  condicoesFrequenciaSql,
} = require("../services/frequenciaMetricasService");

test("falta justificada conta como ausência e como justificativa", () => {
  assert.deepEqual(contarTotaisFrequencia([{ status: "justificado" }]), {
    total_presentes: 0,
    total_ausentes: 1,
    total_justificados: 1,
    total_atrasos: 0,
  });
});

test("aluno atrasado conta como presente mesmo se o status legado estiver ausente", () => {
  assert.deepEqual(contarTotaisFrequencia([{ status: "ausente", atrasado: true }]), {
    total_presentes: 1,
    total_ausentes: 0,
    total_justificados: 0,
    total_atrasos: 1,
  });
});

test("total geral particiona alunos entre presentes e ausentes sem duplicar subcategorias", () => {
  const totais = contarTotaisFrequencia([
    { status: "presente" },
    { status: "ausente" },
    { status: "justificado" },
    { status: "presente", atrasado: true },
  ]);

  assert.equal(totais.total_presentes, 2);
  assert.equal(totais.total_ausentes, 2);
  assert.equal(totais.total_justificados, 1);
  assert.equal(totais.total_atrasos, 1);
  assert.equal(totais.total_presentes + totais.total_ausentes, 4);
});

test("classificação reconhece aliases históricos", () => {
  assert.equal(classificarFrequencia({ status: "falta_justificada" }).justificado, true);
  assert.equal(classificarFrequencia({ status: "atrasado" }).presente, true);
  assert.equal(classificarFrequencia({ status: "ausente", atrasado: "0" }).presente, false);
});

test("condições SQL incluem as mesmas relações de subconjunto", () => {
  const sql = condicoesFrequenciaSql("f");
  assert.match(sql.presente, /f\.atrasado/);
  assert.match(sql.ausente, /justificado/);
  assert.match(sql.justificado, /NOT/);
});
