function normalizarIp(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, "");
}

function ipEhLoopback(valor) {
  const ip = normalizarIp(valor);
  return ip === "127.0.0.1" || ip === "::1";
}

function valorHostEhLocalhost(valor) {
  if (!valor) return false;

  const texto = String(valor).trim().toLowerCase();
  if (!texto) return false;

  try {
    const url = texto.includes("://") ? new URL(texto) : new URL(`http://${texto}`);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function requisicaoVeioDeLocalhost(req = {}) {
  const origin = req.get?.("origin");
  const referer = req.get?.("referer");
  const host = req.get?.("host");
  const enderecoRemoto = req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip;

  if (!ipEhLoopback(enderecoRemoto)) return false;
  if (!valorHostEhLocalhost(host) && !valorHostEhLocalhost(req.hostname)) return false;
  if (origin && !valorHostEhLocalhost(origin)) return false;
  if (referer && !valorHostEhLocalhost(referer)) return false;

  return true;
}

module.exports = {
  ipEhLoopback,
  valorHostEhLocalhost,
  requisicaoVeioDeLocalhost,
};
