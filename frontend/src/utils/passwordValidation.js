export function senhaAtendeRequisitos(senha) {
  const senhaNormalizada = String(senha || "").trim();
  return senhaNormalizada.length >= 6 && senhaNormalizada.length <= 128;
}
