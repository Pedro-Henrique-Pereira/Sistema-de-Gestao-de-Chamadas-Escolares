export function registrarErroCliente(contexto, error) {
  if (!import.meta.env.DEV) return;

  const status = Number(error?.status || 0) || "sem-status";
  const tipo = String(error?.name || "Error").slice(0, 40);
  console.warn(`[frontend] ${contexto} | status=${status} | tipo=${tipo}`);
}
