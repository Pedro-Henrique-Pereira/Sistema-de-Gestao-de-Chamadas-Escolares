export function apiUrlSeguraEmProducao(apiUrl) {
  try {
    const url = new URL(apiUrl);
    return url.protocol === "https:"
      || ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
