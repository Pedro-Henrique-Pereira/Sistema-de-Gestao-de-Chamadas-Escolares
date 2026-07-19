import test from "node:test";
import assert from "node:assert/strict";
import {
  classificarFrequenciaParaExibicao,
  resumirStatusFrequencia,
} from "../utils/frequenciaMetricas.js";

test("justificada participa do total de faltas", () => {
  const resumo = resumirStatusFrequencia(["Falta Justificada"]);
  assert.equal(resumo.faltas, 1);
  assert.equal(resumo.justificadas, 1);
});

test("atrasado participa do total de presenças", () => {
  const resumo = resumirStatusFrequencia(["Atrasado"]);
  assert.equal(resumo.presentes, 1);
  assert.equal(resumo.atrasos, 1);
});

test("subcategorias não aumentam o total geral", () => {
  const resumo = resumirStatusFrequencia(["Presente", "Ausente", "Falta Justificada", "Atrasado"]);
  assert.equal(resumo.presentes + resumo.faltas, resumo.total);
  assert.deepEqual(resumo, { total: 4, presentes: 2, faltas: 2, justificadas: 1, atrasos: 1 });
});

test("detalhe exibe aluno atrasado como presente", () => {
  assert.deepEqual(
    classificarFrequenciaParaExibicao({ status: "presente", atrasado: 1, atraso_minutos: 8 }),
    { categoria: "presente", rotulo: "Presente", detalhe: "Atrasado • 8 min", motivo: "" }
  );
});

test("detalhe exibe falta justificada com o motivo", () => {
  assert.deepEqual(
    classificarFrequenciaParaExibicao({ status: "justificado", motivo: "Atestado médico" }),
    { categoria: "justificada", rotulo: "Falta justificada", detalhe: "", motivo: "Atestado médico" }
  );
});

test("detalhe diferencia falta sem justificativa", () => {
  assert.deepEqual(
    classificarFrequenciaParaExibicao({ status: "ausente" }),
    { categoria: "ausente", rotulo: "Faltou", detalhe: "", motivo: "" }
  );
});
