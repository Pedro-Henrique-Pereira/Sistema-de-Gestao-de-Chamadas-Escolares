const crypto = require("crypto");

function carregarTokensServico(valor = process.env.AUTOMATION_MACHINE_TOKENS) {
  if (!valor) return new Map();

  let parsed;
  try {
    parsed = JSON.parse(valor);
  } catch {
    throw new Error("AUTOMATION_MACHINE_TOKENS deve ser um objeto JSON válido.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AUTOMATION_MACHINE_TOKENS deve mapear máquinas para tokens.");
  }

  const tokens = new Map();
  for (const [maquinaRaw, tokenRaw] of Object.entries(parsed)) {
    const maquinaId = Number(maquinaRaw);
    const token = String(tokenRaw || "");
    if (!Number.isInteger(maquinaId) || maquinaId < 1 || maquinaId > 5) {
      throw new Error("AUTOMATION_MACHINE_TOKENS contém uma máquina inválida.");
    }
    if (token.length < 32) {
      throw new Error(`Token da máquina ${maquinaId} deve possuir pelo menos 32 caracteres.`);
    }
    tokens.set(maquinaId, token);
  }

  if (new Set(tokens.values()).size !== tokens.size) {
    throw new Error("Cada máquina deve possuir uma credencial exclusiva.");
  }
  return tokens;
}

function tokensIguais(recebido, esperado) {
  if (!recebido || !esperado) return false;
  const recebidoBuffer = Buffer.from(String(recebido));
  const esperadoBuffer = Buffer.from(String(esperado));
  if (recebidoBuffer.length !== esperadoBuffer.length) return false;
  return crypto.timingSafeEqual(recebidoBuffer, esperadoBuffer);
}

function extrairBearer(req) {
  const authorization = String(req.get("authorization") || "");
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || "";
}

function extrairMaquinaSolicitada(req) {
  const valor = String(req.get("x-automation-machine") || "").trim();
  if (!valor) return null;

  const maquinaId = Number(valor);
  if (!Number.isInteger(maquinaId) || maquinaId < 1 || maquinaId > 5) {
    return Number.NaN;
  }
  return maquinaId;
}

function autenticarAutomationWorker(req, res, next) {
  let tokens;
  try {
    tokens = carregarTokensServico();
  } catch {
    return res.status(503).json({ erro: "Integração da automação indisponível por configuração inválida." });
  }

  if (!tokens.size) {
    return res.status(503).json({ erro: "Integração da automação não configurada." });
  }

  const recebido = extrairBearer(req);
  let maquinaCredencial = null;
  for (const [maquina, esperado] of tokens.entries()) {
    if (tokensIguais(recebido, esperado)) {
      maquinaCredencial = maquina;
    }
  }

  if (!maquinaCredencial) {
    return res.status(401).json({ erro: "Credencial da automação inválida." });
  }

  const maquinaSolicitada = extrairMaquinaSolicitada(req);
  if (Number.isNaN(maquinaSolicitada)) {
    return res.status(400).json({ erro: "Máquina solicitada inválida." });
  }

  if (
    maquinaSolicitada !== null
    && maquinaSolicitada !== maquinaCredencial
  ) {
    return res.status(403).json({ erro: "Credencial não autorizada para a máquina solicitada." });
  }

  const maquinaId = maquinaSolicitada ?? maquinaCredencial;
  req.automationWorker = {
    maquinaId,
    identidade: `machine-${maquinaId}`,
  };
  return next();
}

module.exports = {
  autenticarAutomationWorker,
  carregarTokensServico,
  extrairMaquinaSolicitada,
  tokensIguais,
};
