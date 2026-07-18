const ERRO_PUBLICO_ROBO =
  "Falha no disparo. Verifique a maquina local ou o status do WhatsApp Web.";

function serializarUsuarioPublico(usuario) {
  if (!usuario) return null;

  return {
    id: Number(usuario.id),
    nome: usuario.nome,
    email: usuario.email,
    tipo: usuario.tipo,
  };
}

function mensagemErroAutomacao(row) {
  if (row?.status === "erro") return ERRO_PUBLICO_ROBO;
  if (row?.status === "expirado") {
    return "A automacao expirou antes de ser concluida. Verifique a maquina local.";
  }
  if (row?.status === "cancelado") {
    return "Solicitacao cancelada antes do inicio da execucao.";
  }
  return null;
}

function serializarStatusAutomacao(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    status: row.status,
    erro_publico: mensagemErroAutomacao(row),
  };
}

module.exports = {
  ERRO_PUBLICO_ROBO,
  serializarUsuarioPublico,
  serializarStatusAutomacao,
};
