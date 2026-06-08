import api from "./api";

export const pedagogaService = {
  dashboard: (params = {}) => api.get("/api/pedagoga/dashboard", { params }),
  chamadasPendentes: () => api.get("/api/pedagoga/chamadas"),
  chamadasConfirmadas: () => api.get("/api/pedagoga/chamadas-confirmadas"),
  detalharChamadaConfirmada: (id) => api.get(`/api/pedagoga/chamadas-confirmadas/${id}`),
  confirmarChamada: (id, payload) => api.post(`/api/pedagoga/chamadas/${id}/confirmar`, payload),
  atualizarFrequencia: (frequenciaId, payload) => api.put(`/api/pedagoga/frequencias/${frequenciaId}`, payload),
  turmasPendentes: () => api.get("/api/pedagoga/turmas-pendentes"),
  criarChamadaPedagogica: (payload) => api.post("/api/pedagoga/chamadas-pedagogicas", payload),
  atualizarChamadaTemporaria: (id, payload) => api.put(`/api/pedagoga/chamadas/${id}`, payload),
  marcarAlunoAtrasado: (chamadaId, alunoId) => api.patch(`/api/chamadas/${chamadaId}/atraso`, { aluno_id: alunoId }),
  solicitarAutomacaoWhatsApp: (payload = {}) => api.post("/api/pedagoga/automacao-whatsapp/solicitar", payload),
  consultarStatusAutomacaoWhatsApp: (id) => api.get(`/api/pedagoga/automacao-whatsapp/status/${id}`),
  obterMensagemWhatsApp: () => api.get("/api/pedagoga/automacao-whatsapp/mensagem"),
  salvarMensagemWhatsApp: (texto) => api.put("/api/pedagoga/automacao-whatsapp/mensagem", { texto }),
  obterPreferencias: () => api.get("/api/pedagoga/preferencias"),
  salvarMaquinaPadraoChamadas: (maquinaPadraoChamadas) => api.put("/api/pedagoga/preferencias/maquina", { maquinaPadraoChamadas }),
};
