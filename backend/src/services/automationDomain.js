const crypto = require("crypto");

const ATTENDANCE_MACHINES = Object.freeze([1, 2]);
const GROUP_MACHINES = Object.freeze([3, 4, 5]);
const ALL_MACHINES = Object.freeze([1, 2, 3, 4, 5]);
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{16,64}$/;
const MESSAGE_TAGS = Object.freeze(["{nome_responsavel}", "{nome_aluno}", "{data}"]);

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  INVALID_PHONE: "Telefone inválido.",
  NO_GUARDIAN: "Responsável não cadastrado.",
  NO_PHONE: "Responsável sem telefone.",
  RECIPIENT_NOT_FOUND: "Destinatário não localizado no WhatsApp.",
  GROUP_NOT_FOUND: "Grupo não localizado no WhatsApp.",
  GROUP_VALIDATION_FAILED: "O cabe\u00e7alho da conversa aberta n\u00e3o corresponde ao grupo solicitado.",
  TEMPORARY_ERROR: "Falha temporária durante o envio.",
  PERMANENT_ERROR: "Não foi possível concluir o envio.",
  LEASE_EXPIRED: "A conexão com a máquina foi interrompida durante o envio.",
  ATTENDANCE_NOT_ELIGIBLE: "A ausência deixou de ser elegível para notificação.",
  CANCELLED: "Envio cancelado por usuário autorizado.",
  DUPLICATE_ALREADY_SENT: "O responsável já foi notificado sobre esta ausência.",
  DUPLICATE_PENDING: "Esta notifica\u00e7\u00e3o j\u00e1 est\u00e1 aguardando na fila.",
  DUPLICATE_IN_PROGRESS: "Esta notificação já está pendente ou em processamento.",
});

function httpError(message, status = 400, code = "VALIDATION_ERROR") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeRequestId(value) {
  const requestId = String(value || "").trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw httpError("requestId inválido.", 400, "INVALID_REQUEST_ID");
  }
  return requestId;
}

function parseMachineId(value) {
  const text = String(value || "").trim().toLowerCase().replace(/^machine-/, "");
  const machineId = Number(text);
  if (!Number.isInteger(machineId) || !ALL_MACHINES.includes(machineId)) {
    throw httpError("Máquina inválida.", 400, "INVALID_MACHINE");
  }
  return machineId;
}

function assertMachineAllowed(machineId, allowed) {
  if (!allowed.includes(machineId)) {
    throw httpError(
      `Máquina ${machineId} não é permitida para este tipo de tarefa.`,
      403,
      "MACHINE_NOT_ALLOWED"
    );
  }
  return machineId;
}

function normalizeMessage(value, maxLength = 4000) {
  const message = String(value || "").trim();
  if (!message) throw httpError("A mensagem não pode ficar vazia.", 400, "EMPTY_MESSAGE");
  if (message.length > maxLength) {
    throw httpError(`A mensagem não pode ultrapassar ${maxLength} caracteres.`, 400, "MESSAGE_TOO_LONG");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(message)) {
    throw httpError("A mensagem contém caracteres de controle não suportados.", 400, "INVALID_MESSAGE");
  }
  return message;
}

function normalizePhone(value, countryCode = "55") {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  digits = digits.replace(/^0+/, "");
  if (!digits.startsWith(countryCode)) digits = `${countryCode}${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : "";
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${digits.slice(0, 2)}*******${digits.slice(-2)}`;
}

function formatDateBR(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = String(value.getDate()).padStart(2, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${value.getFullYear()}`;
  }

  const text = String(value || "").trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text;

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;

  return text;
}

function renderAttendanceMessage(template, data) {
  return String(template || "")
    .replaceAll("{nome_responsavel}", String(data.guardianName || "").trim())
    .replaceAll("{nome_aluno}", String(data.studentName || "").trim())
    .replaceAll("{data}", formatDateBR(data.absenceDate))
    .trim();
}

function safeErrorCode(value, fallback = "PERMANENT_ERROR") {
  return String(value || fallback)
    .replace(/[^A-Z0-9_.-]/gi, "_")
    .slice(0, 80)
    .toUpperCase() || fallback;
}

function publicErrorMessage(code) {
  return PUBLIC_ERROR_MESSAGES[safeErrorCode(code)] || PUBLIC_ERROR_MESSAGES.PERMANENT_ERROR;
}

function hashPayload(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function compareVersions(left, right) {
  const normalize = (value) => String(value || "0")
    .split(".")
    .slice(0, 3)
    .map((part) => Number(String(part).replace(/\D.*$/, "")) || 0);
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function publicTaskStatus(task, machineState = "offline") {
  const status = String(task?.status || "pendente");
  if (status === "pendente") {
    return machineState === "offline" || machineState === "disabled"
      ? "waiting_for_machine"
      : "queued";
  }
  if (status === "executando") return "processing";
  if (status === "concluido") return "completed_successfully";
  if (status === "concluido_parcial") return "completed_partially";
  if (status === "cancelado") return "cancelled";
  if (status === "falha_comunicacao" || status === "expirado") return "communication_failure";
  return "completed_with_failures";
}

module.exports = {
  ALL_MACHINES,
  ATTENDANCE_MACHINES,
  GROUP_MACHINES,
  MESSAGE_TAGS,
  PUBLIC_ERROR_MESSAGES,
  assertMachineAllowed,
  compareVersions,
  formatDateBR,
  hashPayload,
  hashText,
  httpError,
  maskPhone,
  normalizeMessage,
  normalizePhone,
  normalizeRequestId,
  parseMachineId,
  publicErrorMessage,
  publicTaskStatus,
  renderAttendanceMessage,
  safeErrorCode,
};
