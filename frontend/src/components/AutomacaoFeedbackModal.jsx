import { useEffect, useMemo, useRef, useState } from 'react';
import { cancelarAutomacao, consultarStatusAutomacao } from '../services/automacaoService';
import '../styles/AutomacaoFeedbackModal.css';

const STATUS_EM_ANDAMENTO = new Set(['pendente', 'executando']);
const STATUS_FINAIS_OK = new Set(['concluido']);
const STATUS_FINAIS_PROBLEMA = new Set(['erro', 'expirado', 'cancelado']);
const MENSAGEM_ERRO_AUTOMACAO = 'Falha no disparo. Verifique a máquina local ou o status do WhatsApp Web.';

function normalizarIds(solicitacoes) {
  if (!Array.isArray(solicitacoes)) return [];
  return solicitacoes
    .map((item) => Number(typeof item === 'object' ? item?.id : item))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function formatarDuracao(totalSegundos) {
  const segundos = Math.max(0, Number(totalSegundos || 0));
  const minutos = Math.floor(segundos / 60);
  const restoSegundos = segundos % 60;
  if (minutos <= 0) return `${restoSegundos}s`;
  return `${minutos}min ${String(restoSegundos).padStart(2, '0')}s`;
}

function resumirStatus(statusPorId) {
  const automacoes = Object.values(statusPorId || {});
  if (!automacoes.length) return { statusGeral: 'pendente', concluidas: 0, pendentes: 0, executando: 0, problemas: 0 };

  const concluidas = automacoes.filter((item) => STATUS_FINAIS_OK.has(item.status)).length;
  const pendentes = automacoes.filter((item) => item.status === 'pendente').length;
  const executando = automacoes.filter((item) => item.status === 'executando').length;
  const problemas = automacoes.filter((item) => STATUS_FINAIS_PROBLEMA.has(item.status)).length;

  let statusGeral = 'pendente';
  if (problemas > 0) statusGeral = 'erro';
  else if (concluidas === automacoes.length) statusGeral = 'concluido';
  else if (executando > 0) statusGeral = 'executando';

  return { statusGeral, concluidas, pendentes, executando, problemas };
}

export default function AutomacaoFeedbackModal({
  aberto,
  solicitacoes,
  titulo = 'Automação WhatsApp',
  timeoutAlertaSegundos = 180,
  onClose,
  onCancelado,
  onConcluido,
  onErro,
}) {
  const ids = useMemo(() => normalizarIds(solicitacoes), [solicitacoes]);
  const pollingRef = useRef(null);
  const timerRef = useRef(null);
  const inicioRef = useRef(null);
  const [statusPorId, setStatusPorId] = useState({});
  const [duracaoSegundos, setDuracaoSegundos] = useState(0);
  const [cancelando, setCancelando] = useState(false);
  const [erroCancelamento, setErroCancelamento] = useState('');
  const [mostrarAlertaTimeout, setMostrarAlertaTimeout] = useState(false);
  const resumo = useMemo(() => resumirStatus(statusPorId), [statusPorId]);

  function limparPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  function limparTimerVisual() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function limparTimers() {
    limparPolling();
    limparTimerVisual();
  }

  async function consultarTodos() {
    if (!ids.length) return;

    const resultados = await Promise.all(
      ids.map(async (id) => {
        const data = await consultarStatusAutomacao(id);
        return [id, data.automacao || { id, status: 'erro', erro_publico: MENSAGEM_ERRO_AUTOMACAO }];
      })
    );

    const proximoStatus = Object.fromEntries(resultados);
    setStatusPorId(proximoStatus);

    const resumoAtual = resumirStatus(proximoStatus);
    const duracaoAtual = Math.floor((Date.now() - inicioRef.current) / 1000);
    setDuracaoSegundos(duracaoAtual);

    if (!STATUS_EM_ANDAMENTO.has(resumoAtual.statusGeral)) {
      limparTimers();
      setDuracaoSegundos(duracaoAtual);
      if (resumoAtual.statusGeral === 'concluido') onConcluido?.({ duracaoSegundos: duracaoAtual, statusPorId: proximoStatus });
      else onErro?.({ duracaoSegundos: duracaoAtual, statusPorId: proximoStatus });
    }
  }

  useEffect(() => {
    if (!aberto || !ids.length) return undefined;

    let ativo = true;

    async function consultarTodosSeguro() {
      if (!ids.length) return;

      const resultados = await Promise.all(
        ids.map(async (id) => {
          const data = await consultarStatusAutomacao(id);
          return [id, data.automacao || { id, status: 'erro', erro_publico: MENSAGEM_ERRO_AUTOMACAO }];
        })
      );

      if (!ativo) return;

      const proximoStatus = Object.fromEntries(resultados);
      setStatusPorId(proximoStatus);

      const resumoAtual = resumirStatus(proximoStatus);
      const duracaoAtual = Math.floor((Date.now() - inicioRef.current) / 1000);
      setDuracaoSegundos(duracaoAtual);

      if (!STATUS_EM_ANDAMENTO.has(resumoAtual.statusGeral)) {
        limparTimers();
        setDuracaoSegundos(duracaoAtual);
        if (resumoAtual.statusGeral === 'concluido') onConcluido?.({ duracaoSegundos: duracaoAtual, statusPorId: proximoStatus });
        else onErro?.({ duracaoSegundos: duracaoAtual, statusPorId: proximoStatus });
      }
    }

    limparTimers();
    inicioRef.current = Date.now();
    setDuracaoSegundos(0);
    setCancelando(false);
    setErroCancelamento('');
    setMostrarAlertaTimeout(false);
    setStatusPorId(Object.fromEntries(ids.map((id) => [id, { id, status: 'pendente' }])));

    consultarTodosSeguro().catch((error) => {
      if (!ativo) return;
      limparTimers();
      setStatusPorId(Object.fromEntries(ids.map((id) => [id, { id, status: 'erro', erro_publico: MENSAGEM_ERRO_AUTOMACAO }])));
      onErro?.({ duracaoSegundos: 0, statusPorId: {} });
    });

    pollingRef.current = setInterval(() => {
      consultarTodosSeguro().catch((error) => {
        if (!ativo) return;
        limparTimers();
        setStatusPorId(Object.fromEntries(ids.map((id) => [id, { id, status: 'erro', erro_publico: MENSAGEM_ERRO_AUTOMACAO }])));
      });
    }, 3000);

    timerRef.current = setInterval(() => {
      if (!ativo || !inicioRef.current) return;

      const duracaoAtual = Math.floor((Date.now() - inicioRef.current) / 1000);
      setDuracaoSegundos(duracaoAtual);

      if (duracaoAtual >= timeoutAlertaSegundos) {
        setMostrarAlertaTimeout(true);
      }
    }, 1000);

    return () => {
      ativo = false;
      limparTimers();
    };
  }, [aberto, ids.join(','), timeoutAlertaSegundos]);

  if (!aberto) return null;

  const total = ids.length;
  const podeCancelar = resumo.statusGeral === 'pendente' && resumo.executando === 0 && resumo.concluidas === 0 && resumo.problemas === 0;
  const finalizado = !STATUS_EM_ANDAMENTO.has(resumo.statusGeral);
  const statusExecutando = resumo.statusGeral === 'executando';
  const mensagemErroPublica = Object.values(statusPorId)
    .find((item) => STATUS_FINAIS_PROBLEMA.has(item.status) && item.erro_publico)
    ?.erro_publico || MENSAGEM_ERRO_AUTOMACAO;

  async function handleCancelar() {
    if (!podeCancelar || cancelando) return;

    setCancelando(true);
    setErroCancelamento('');

    try {
      const idsPendentes = Object.values(statusPorId)
        .filter((item) => item.status === 'pendente')
        .map((item) => Number(item.id));

      await Promise.all(idsPendentes.map((id) => cancelarAutomacao(id)));
      limparTimers();
      setStatusPorId((atual) => {
        const proximo = { ...atual };
        idsPendentes.forEach((id) => {
          proximo[id] = { ...(proximo[id] || { id }), status: 'cancelado', erro_publico: 'Solicitação cancelada antes do início da execução.' };
        });
        return proximo;
      });
      onCancelado?.();
    } catch (error) {
      setErroCancelamento(error.message || 'Não foi possível cancelar. Consulte o status novamente.');
      await consultarTodos().catch(() => null);
    } finally {
      setCancelando(false);
    }
  }

  return (
    <div className="modal-backdrop automation-feedback-backdrop">
      <div className={`content-card modal-card automation-feedback-modal ${resumo.statusGeral === 'erro' ? 'automation-feedback-error' : ''}`}>
        {!finalizado ? (
          <>
            <div className="automation-spinner" aria-hidden="true" />
            <h2>{statusExecutando ? 'Automação em execução' : titulo}</h2>
            <p>{statusExecutando ? 'O robô local já iniciou o envio pelo WhatsApp Web.' : 'Solicitação registrada. Aguardando o robô local iniciar.'}</p>
            <small>
              {total > 1
                ? `${resumo.concluidas}/${total} tarefa(s) concluída(s). Pendentes: ${resumo.pendentes}. Executando: ${resumo.executando}.`
                : `Status atual: ${statusExecutando ? 'executando' : 'pendente'}.`}
            </small>
            <strong className="automation-timer">Tempo: {formatarDuracao(duracaoSegundos)}</strong>

            {podeCancelar ? (
              <button className="btn-secondary automation-cancel-button" type="button" onClick={handleCancelar} disabled={cancelando}>
                {cancelando ? 'Cancelando...' : 'Cancelar envio'}
              </button>
            ) : (
              <small className="automation-cancel-disabled">Cancelamento indisponível após o início da execução.</small>
            )}

            {mostrarAlertaTimeout && (
              <p className="automation-timeout-alert">
                A automação está demorando mais do que o esperado para responder. Por favor, verifique se a máquina local destinada aos disparos está ligada, conectada à internet e com o WhatsApp Web devidamente logado.
              </p>
            )}

            {erroCancelamento && <p className="automation-cancel-error">{erroCancelamento}</p>}
          </>
        ) : resumo.statusGeral === 'concluido' ? (
          <>
            <div className="automation-success-icon">✓</div>
            <h2>Automação concluída</h2>
            <p>Envio finalizado com sucesso em {formatarDuracao(duracaoSegundos)}.</p>
            <button className="btn-primary" type="button" onClick={onClose}>Fechar</button>
          </>
        ) : resumo.statusGeral === 'cancelado' || Object.values(statusPorId).every((item) => item.status === 'cancelado') ? (
          <>
            <div className="automation-error-icon">×</div>
            <h2>Envio cancelado</h2>
            <p>A solicitação foi cancelada antes do robô local iniciar.</p>
            <button className="btn-primary" type="button" onClick={onClose}>Fechar</button>
          </>
        ) : (
          <>
            <div className="automation-error-icon">!</div>
            <h2>Erro na automação</h2>
            <p>Uma ou mais tarefas não foram concluídas.</p>
            <p>{mensagemErroPublica}</p>
            <button className="btn-primary" type="button" onClick={onClose}>Entendi</button>
          </>
        )}
      </div>
    </div>
  );
}
