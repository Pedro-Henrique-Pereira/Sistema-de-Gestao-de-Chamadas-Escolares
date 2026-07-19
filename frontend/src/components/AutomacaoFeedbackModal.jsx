import { useEffect, useMemo, useRef, useState } from "react";
import { cancelarAutomacao, consultarStatusAutomacao } from "../services/automacaoService";
import "../styles/AutomacaoFeedbackModal.css";

const ONGOING = new Set(["waiting_for_machine", "queued", "processing"]);
const SUCCESS = new Set(["completed_successfully"]);
const PROBLEM = new Set([
  "completed_partially",
  "completed_with_failures",
  "communication_failure",
  "cancelled",
]);

const STATUS_LABELS = {
  waiting_for_machine: "Aguardando máquina",
  queued: "Na fila",
  processing: "Em processamento",
  completed_successfully: "Concluída com sucesso",
  completed_partially: "Concluída parcialmente",
  completed_with_failures: "Concluída com falhas",
  communication_failure: "Falha de comunicação",
  cancelled: "Cancelada",
};

function normalizeIds(requests) {
  if (!Array.isArray(requests)) return [];
  return requests
    .map((item) => Number(typeof item === "object" ? item?.taskId || item?.id : item))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function durationLabel(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}min ${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

function summarize(tasks) {
  const values = Object.values(tasks || {});
  const total = values.reduce((sum, task) => sum + Number(task.total || 0), 0);
  const processed = values.reduce((sum, task) => sum + Number(task.processed || 0), 0);
  const successes = values.reduce((sum, task) => sum + Number(task.successCount || 0), 0);
  const failures = values.reduce((sum, task) => sum + Number(task.failureCount || 0), 0);
  const ignoredDuplicates = values.reduce(
    (sum, task) => sum + Number(task.ignoredDuplicateCount || 0),
    0
  );
  const alreadyQueued = values.reduce(
    (sum, task) => sum + Number(task.alreadyQueuedCount || 0),
    0
  );
  let status = "queued";
  if (values.some((task) => task.status === "processing")) status = "processing";
  else if (values.some((task) => task.status === "waiting_for_machine")) status = "waiting_for_machine";
  else if (values.length && values.every((task) => SUCCESS.has(task.status))) status = "completed_successfully";
  else if (values.some((task) => PROBLEM.has(task.status))) {
    status = values.some((task) => task.status === "completed_partially")
      ? "completed_partially"
      : values.find((task) => PROBLEM.has(task.status))?.status || "completed_with_failures";
  }
  return { total, processed, successes, failures, ignoredDuplicates, alreadyQueued, status };
}

export default function AutomacaoFeedbackModal({
  aberto,
  solicitacoes,
  titulo = "Automação de mensagens",
  timeoutAlertaSegundos = 180,
  permitirCancelamento = false,
  onClose,
  onCancelado,
  onConcluido,
  onErro,
}) {
  const ids = useMemo(() => normalizeIds(solicitacoes), [solicitacoes]);
  const idsKey = ids.join(",");
  const [tasks, setTasks] = useState({});
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [timeoutWarning, setTimeoutWarning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const startedAt = useRef(0);
  const summary = useMemo(() => summarize(tasks), [tasks]);

  useEffect(() => {
    if (!aberto || !ids.length) return undefined;
    let active = true;
    let finishedNotified = false;
    let polling;
    let timer;
    startedAt.current = Date.now();
    setTasks(Object.fromEntries(ids.map((id) => [id, {
      taskId: id,
      status: "queued",
      total: 0,
      processed: 0,
      successCount: 0,
      failureCount: 0,
      ignoredDuplicateCount: 0,
      alreadyQueuedCount: 0,
      results: [],
    }])));
    setDurationSeconds(0);
    setTimeoutWarning(false);
    setCancelError("");

    async function refresh() {
      const responses = await Promise.all(ids.map((id) => consultarStatusAutomacao(id)));
      if (!active) return;
      const next = Object.fromEntries(responses.map(({ task }) => [task.taskId, task]));
      setTasks(next);
      const current = summarize(next);
      if (!ONGOING.has(current.status) && !finishedNotified) {
        finishedNotified = true;
        if (polling) clearInterval(polling);
        if (timer) clearInterval(timer);
        const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
        if (SUCCESS.has(current.status)) onConcluido?.({ duracaoSegundos: elapsed, tarefas: next });
        else onErro?.({ duracaoSegundos: elapsed, tarefas: next });
      }
    }

    refresh().catch(() => {
      if (!active) return;
      setCancelError("Não foi possível consultar a tarefa. A execução continua no servidor.");
    });
    polling = setInterval(() => {
      refresh().catch(() => {
        if (active) setCancelError("Comunicação temporariamente indisponível. Tentando novamente...");
      });
    }, 3000);
    timer = setInterval(() => {
      if (!active) return;
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setDurationSeconds(elapsed);
      if (elapsed >= timeoutAlertaSegundos) setTimeoutWarning(true);
    }, 1000);

    return () => {
      active = false;
      clearInterval(polling);
      clearInterval(timer);
    };
  }, [aberto, idsKey, timeoutAlertaSegundos]);

  if (!aberto) return null;

  const taskList = Object.values(tasks);
  const primaryTask = taskList[0] || {};
  const ongoing = ONGOING.has(summary.status);
  const failures = taskList.flatMap((task) => (
    (task.results || []).filter((result) => result.status === "failed")
  ));
  const duplicateBlocks = taskList.flatMap((task) => (
    (task.results || []).filter((result) => (
      result.status === "ignored_duplicate" || result.status === "already_queued"
    ))
  ));
  const cancellable = permitirCancelamento
    && taskList.length > 0
    && taskList.every((task) => ["waiting_for_machine", "queued"].includes(task.status));

  async function handleCancel() {
    if (!cancellable || cancelling) return;
    setCancelling(true);
    setCancelError("");
    try {
      await Promise.all(taskList.map((task) => cancelarAutomacao(task.taskId)));
      onCancelado?.();
    } catch (error) {
      setCancelError(error.message || "Não foi possível cancelar a tarefa.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="modal-backdrop automation-feedback-backdrop">
      <div className={`content-card modal-card automation-feedback-modal ${PROBLEM.has(summary.status) ? "automation-feedback-error" : ""}`}>
        {ongoing && <div className="automation-spinner" aria-hidden="true" />}
        {!ongoing && SUCCESS.has(summary.status) && <div className="automation-success-icon">✓</div>}
        {!ongoing && PROBLEM.has(summary.status) && <div className="automation-error-icon">!</div>}

        <h2>{ongoing ? titulo : STATUS_LABELS[summary.status] || titulo}</h2>
        <p>
          Máquina {primaryTask.machineNumber || "—"}: {STATUS_LABELS[primaryTask.status] || "Consultando"}.
          {primaryTask.queuePosition ? ` Posição aproximada na fila: ${primaryTask.queuePosition}.` : ""}
        </p>

        <div className="automation-task-progress" role="status">
          <strong>{summary.processed} de {summary.total} processados</strong>
          <span>Sucessos: {summary.successes}</span>
          <span>Falhas: {summary.failures}</span>
          <span>Já notificados: {summary.ignoredDuplicates}</span>
          <span>Já na fila: {summary.alreadyQueued}</span>
          <span>Restantes: {Math.max(summary.total - summary.processed, 0)}</span>
        </div>

        {duplicateBlocks.length > 0 && (
          <div className="automation-failure-list">
            <h3>Envios não duplicados</h3>
            {duplicateBlocks.map((result) => (
              <div key={result.deliveryId} className="automation-failure-item">
                <strong>{result.studentName || result.recipientName || "Aluno"}</strong>
                {result.studentName && result.recipientName && (
                  <span>Responsável: {result.recipientName}</span>
                )}
                <small>{result.errorMessage}</small>
              </div>
            ))}
          </div>
        )}

        {failures.length > 0 && (
          <div className="automation-failure-list">
            <h3>Não notificados</h3>
            {failures.map((result) => (
              <div key={result.deliveryId} className="automation-failure-item">
                <strong>{result.studentName || result.groupName || result.recipientName || "Destinatário"}</strong>
                {result.studentName && result.recipientName && (
                  <span>Responsável: {result.recipientName}</span>
                )}
                <small>{result.errorMessage || "Não foi possível concluir o envio."}</small>
              </div>
            ))}
          </div>
        )}

        {ongoing && <strong className="automation-timer">Tempo: {durationLabel(durationSeconds)}</strong>}
        {timeoutWarning && ongoing && (
          <p className="automation-timeout-alert">
            A tarefa permanece salva. Verifique o estado da máquina; você pode fechar esta janela e consultar novamente depois.
          </p>
        )}
        {cancelError && <p className="automation-cancel-error">{cancelError}</p>}

        <div className="automation-modal-actions">
          {cancellable && (
            <button className="btn-secondary automation-cancel-button" type="button" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? "Cancelando..." : "Cancelar tarefa"}
            </button>
          )}
          <button className="btn-primary" type="button" onClick={onClose}>
            {ongoing ? "Fechar e acompanhar depois" : "Fechar"}
          </button>
        </div>
      </div>
    </div>
  );
}
