const {
  normalizarHorarioAtraso,
  normalizarDataHoraAtraso,
} = require("../utils/atrasoUtils");
const { calculateStudentDelay } = require("./chamadaFluxoService");

function completarDadosAtraso(alunos = [], {
  horarioChamada,
  horarioMarcacao,
  dataHoraMarcacao,
} = {}) {
  const horarioBase = normalizarHorarioAtraso(horarioChamada);
  const horarioPadrao = normalizarHorarioAtraso(horarioMarcacao);
  const dataHoraPadrao = normalizarDataHoraAtraso(dataHoraMarcacao);

  return alunos.map((aluno) => {
    if (!aluno.atrasado) return aluno;

    const horarioRegistro = normalizarHorarioAtraso(
      aluno.horario_registro_atraso || aluno.horarioRegistroAtraso || horarioPadrao
    );
    const atrasoRegistradoEm = normalizarDataHoraAtraso(
      aluno.atraso_registrado_em || aluno.atrasoRegistradoEm || dataHoraPadrao
    );

    if (!horarioBase || !horarioRegistro || !atrasoRegistradoEm) {
      const erro = new Error("Nao foi possivel registrar o horario do atraso.");
      erro.status = 400;
      throw erro;
    }

    return {
      ...aluno,
      horario_registro_atraso: horarioRegistro,
      atraso_registrado_em: atrasoRegistradoEm,
      atraso_minutos: calculateStudentDelay(horarioBase, horarioRegistro),
    };
  });
}

module.exports = { completarDadosAtraso };
