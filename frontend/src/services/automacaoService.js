import { apiFetch } from './api';

export function consultarStatusAutomacao(id) {
  return apiFetch(`/api/automacao/status/${id}`);
}

export function cancelarAutomacao(id) {
  return apiFetch(`/api/automacao/cancelar/${id}`, {
    method: 'POST',
  });
}
