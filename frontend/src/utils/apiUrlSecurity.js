export function apiUrlSeguraEmProducao(apiUrl) {
  const valor = String(apiUrl || "").trim();
  if (valor.startsWith("/") && !valor.startsWith("//")) return true;

  try {
    const url = new URL(valor);
    return url.protocol === "https:"
      || ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
