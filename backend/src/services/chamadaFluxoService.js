const STATUS_TEMPORARIO = "pendente";
const STATUS_CONFIRMADO = "confirmada";

const MENSAGENS = Object.freeze({
  PROFESSOR_NAO_RESPONSAVEL: "Somente o professor responsável pode editar esta chamada.",
  PROFESSOR_CONFIRMADA: "Esta chamada já foi confirmada pela pedagogia e não pode mais ser editada pelo professor.",
  SEM_PERMISSAO: "Você não possui permissão para editar esta chamada.",
  HORARIO_ENCERRADO: "O Horário Máximo de Chegada já passou. Esta chamada não pode mais ser alterada.",
  SOMENTE_PEDAGOGIA_CONFIRMA: "Apenas a pedagogia pode confirmar uma chamada.",
  CONFLITO_VERSAO: "A chamada foi alterada por outro usuário. Atualize a página antes de tentar novamente.",
  AUTOMACAO_ANTECIPADA: "Automação indisponível até o Horário Máximo de Chegada.",
});

function horarioParaSegundos(valor) {
  const partes = String(valor || "00:00:00").slice(0, 8).split(":").map(Number);
  return (partes[0] || 0) * 3600 + (partes[1] || 0) * 60 + (partes[2] || 0);
}

function hasMaximumArrivalTimePassed(config = {}) {
  return horarioParaSegundos(config.horario_servidor) > horarioParaSegundos(config.horario_limite_atraso);
}

function statusEfetivo(chamada, config = {}) {
  if (chamada?.status === STATUS_CONFIRMADO && hasMaximumArrivalTimePassed(config)) return "BLOQUEADA";
  if (chamada?.status === STATUS_CONFIRMADO) return "CONFIRMADA";
  if (chamada?.status === STATUS_TEMPORARIO) return "TEMPORARIA";
  return String(chamada?.status || "").toUpperCase();
}

function permitido() {
  return { permitido: true, mensagem: null };
}

function negado(mensagem) {
  return { permitido: false, mensagem };
}

function canProfessorEditCall(chamada, usuario) {
  if (!chamada || usuario?.tipo !== "professor") return negado(MENSAGENS.SEM_PERMISSAO);
  if (Number(chamada.professor_id) !== Number(usuario.id)) return negado(MENSAGENS.PROFESSOR_NAO_RESPONSAVEL);
  if (chamada.status === STATUS_CONFIRMADO) return negado(MENSAGENS.PROFESSOR_CONFIRMADA);
  if (chamada.status !== STATUS_TEMPORARIO) return negado(MENSAGENS.SEM_PERMISSAO);
  return permitido();
}

function canPedagogueEditCall(chamada, usuario, config = {}) {
  if (!chamada || !["pedagoga", "administracao"].includes(usuario?.tipo)) return negado(MENSAGENS.SEM_PERMISSAO);
  if (chamada.status === STATUS_CONFIRMADO && hasMaximumArrivalTimePassed(config)) return negado(MENSAGENS.HORARIO_ENCERRADO);
  if (![STATUS_TEMPORARIO, STATUS_CONFIRMADO].includes(chamada.status)) return negado(MENSAGENS.SEM_PERMISSAO);
  return permitido();
}

function canConfirmCall(chamada, usuario, config = {}) {
  if (!["pedagoga", "administracao"].includes(usuario?.tipo)) return negado(MENSAGENS.SOMENTE_PEDAGOGIA_CONFIRMA);
  if (!chamada || chamada.status !== STATUS_TEMPORARIO) return negado("Esta chamada já foi confirmada ou não está disponível para confirmação.");
  return permitido();
}

function canStartAutomation(config = {}, hasConfirmedCall = true) {
  if (!hasMaximumArrivalTimePassed(config)) return negado(MENSAGENS.AUTOMACAO_ANTECIPADA);
  if (!hasConfirmedCall) return negado("Não existem chamadas confirmadas hoje para iniciar a automação.");
  return permitido();
}

function calculateStudentDelay(horarioChamada, horarioMarcacao) {
  return Math.max(0, Math.floor((horarioParaSegundos(horarioMarcacao) - horarioParaSegundos(horarioChamada)) / 60));
}

function validateCallVersion(chamada, versaoRecebida) {
  const recebida = Number(versaoRecebida);
  const atual = Number(chamada?.versao);
  return Number.isInteger(recebida) && recebida > 0 && recebida === atual
    ? permitido()
    : negado(MENSAGENS.CONFLITO_VERSAO);
}

function obterAlunoId(aluno) {
  return Number(aluno?.aluno_id || aluno?.alunoId || aluno?.id);
}

function validateCompleteStudentList(alunosEsperados = [], alunosRecebidos = []) {
  if (!Array.isArray(alunosEsperados) || !Array.isArray(alunosRecebidos)) {
    return {
      ...negado("A lista de alunos enviada é inválida."),
      status: 400,
    };
  }

  const idsEsperados = alunosEsperados.map(obterAlunoId);
  const idsRecebidos = alunosRecebidos.map(obterAlunoId);
  const idsEsperadosValidos = idsEsperados.filter((id) => Number.isInteger(id) && id > 0);
  const idsRecebidosValidos = idsRecebidos.filter((id) => Number.isInteger(id) && id > 0);

  if (
    idsEsperadosValidos.length !== idsEsperados.length ||
    new Set(idsEsperadosValidos).size !== idsEsperadosValidos.length
  ) {
    return {
      ...negado("A lista original de alunos da chamada está inválida. Atualize a chamada antes de continuar."),
      status: 409,
    };
  }

  if (idsRecebidosValidos.length !== idsRecebidos.length) {
    return {
      ...negado("Todos os alunos precisam possuir um ID válido."),
      status: 400,
    };
  }

  if (new Set(idsRecebidosValidos).size !== idsRecebidosValidos.length) {
    return {
      ...negado("A lista de alunos possui IDs duplicados."),
      status: 400,
    };
  }

  const esperados = new Set(idsEsperadosValidos);
  const recebidos = new Set(idsRecebidosValidos);
  const faltantes = [...esperados].filter((id) => !recebidos.has(id));
  const inesperados = [...recebidos].filter((id) => !esperados.has(id));

  if (faltantes.length > 0 || inesperados.length > 0 || esperados.size !== recebidos.size) {
    return {
      ...negado(
        `A lista de alunos está incompleta ou desatualizada. Atualize a chamada antes de continuar. Alunos faltantes: ${faltantes.length}. Alunos não esperados: ${inesperados.length}.`
      ),
      status: 409,
      faltantes,
      inesperados,
    };
  }

  return {
    ...permitido(),
    faltantes: [],
    inesperados: [],
  };
}

function assertPermission(resultado, status = 403) {
  if (resultado.permitido) return;
  const erro = new Error(resultado.mensagem);
  erro.status = resultado.status || (resultado.mensagem === MENSAGENS.CONFLITO_VERSAO ? 409 : status);
  throw erro;
}

module.exports = {
  STATUS_TEMPORARIO,
  STATUS_CONFIRMADO,
  MENSAGENS,
  hasMaximumArrivalTimePassed,
  statusEfetivo,
  canProfessorEditCall,
  canPedagogueEditCall,
  canConfirmCall,
  canStartAutomation,
  calculateStudentDelay,
  validateCallVersion,
  validateCompleteStudentList,
  assertPermission,
};
