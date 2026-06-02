import { apiFetch } from './api';

export function listarGruposMensagens() {
  return apiFetch('/api/mensagens/grupos');
}

export function criarGrupoWhatsapp({ nomeGrupo }) {
  return apiFetch('/api/mensagens/grupos', {
    method: 'POST',
    body: JSON.stringify({ nomeGrupo }),
  });
}

export function atualizarGrupoWhatsapp(id, { nomeGrupo }) {
  return apiFetch(`/api/mensagens/grupos/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nomeGrupo }),
  });
}

export function removerGrupoWhatsapp(id) {
  return apiFetch(`/api/mensagens/grupos/${id}`, {
    method: 'DELETE',
  });
}

export function obterPreferenciasMensagens() {
  return apiFetch('/api/mensagens/preferencias');
}

export function salvarPreferenciasMensagens(maquinaPadraoMensagens) {
  return apiFetch('/api/mensagens/preferencias', {
    method: 'PUT',
    body: JSON.stringify({ maquinaPadraoMensagens }),
  });
}

export function enviarMensagemGrupos({ modoDestinatarios, grupos, mensagem, maquinaDestino }) {
  return apiFetch('/api/mensagens/enviar', {
    method: 'POST',
    body: JSON.stringify({ modoDestinatarios, grupos, mensagem, maquinaDestino }),
  });
}

export function limparTarefasAntigasAutomacao() {
  return apiFetch('/api/mensagens/limpar-tarefas-antigas', {
    method: 'POST',
  });
}
