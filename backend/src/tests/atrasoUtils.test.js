const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizarHorarioAtraso,
  normalizarDataHoraAtraso,
} = require("../utils/atrasoUtils");
const { calculateStudentDelay } = require("../services/chamadaFluxoService");
const { completarDadosAtraso } = require("../services/atrasoService");

test("preserva os segundos usados no calculo do atraso", () => {
  const horarioChegada = normalizarHorarioAtraso("00:07:35");

  assert.equal(horarioChegada, "00:07:35");
  assert.equal(calculateStudentDelay("00:04:04", horarioChegada), 3);
});

test("completa segundos ausentes sem aceitar horarios invalidos", () => {
  assert.equal(normalizarHorarioAtraso("07:32"), "07:32:00");
  assert.equal(normalizarHorarioAtraso("24:00:00"), null);
  assert.equal(normalizarHorarioAtraso("07:60:00"), null);
});

test("preserva data e hora local sem aplicar deslocamento de fuso", () => {
  assert.equal(
    normalizarDataHoraAtraso("2026-07-17 00:07:35"),
    "2026-07-17 00:07:35"
  );
});

test("converte ISO com fuso explicito uma unica vez para Brasilia", () => {
  assert.equal(
    normalizarDataHoraAtraso("2026-07-17T03:07:35.000Z"),
    "2026-07-17 00:07:35"
  );
});

test("preenche pelo servidor um atraso recebido sem horario", () => {
  const [aluno] = completarDadosAtraso(
    [{ aluno_id: 1, status: "presente", atrasado: true }],
    {
      horarioChamada: "07:10:10",
      horarioMarcacao: "07:14:20",
      dataHoraMarcacao: "2026-07-17 07:14:20",
    }
  );

  assert.equal(aluno.horario_registro_atraso, "07:14:20");
  assert.equal(aluno.atraso_registrado_em, "2026-07-17 07:14:20");
  assert.equal(aluno.atraso_minutos, 4);
});

test("reedicao preserva o horario original e os minutos calculados", () => {
  const [aluno] = completarDadosAtraso(
    [{
      aluno_id: 1,
      atrasado: true,
      horario_registro_atraso: "07:14:20",
      atraso_registrado_em: "2026-07-17 07:14:20",
    }],
    {
      horarioChamada: "07:10:10",
      horarioMarcacao: "07:20:00",
      dataHoraMarcacao: "2026-07-17 07:20:00",
    }
  );

  assert.equal(aluno.horario_registro_atraso, "07:14:20");
  assert.equal(aluno.atraso_registrado_em, "2026-07-17 07:14:20");
  assert.equal(aluno.atraso_minutos, 4);
});
