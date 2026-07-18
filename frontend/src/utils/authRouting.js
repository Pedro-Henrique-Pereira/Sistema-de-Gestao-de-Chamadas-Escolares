export const ROTAS_POR_PERFIL = Object.freeze({
  administracao: "/admin",
  pedagoga: "/pedagoga",
  professor: "/professor",
});

export function normalizarPerfil(perfil) {
  return String(perfil || "").trim().toLowerCase();
}

export function rotaInicialPorPerfil(perfil) {
  return ROTAS_POR_PERFIL[normalizarPerfil(perfil)] || "/login";
}

export function resolverAcessoProtegido({ carregando, erro, usuario, cargosPermitidos = [] }) {
  if (carregando) return { estado: "carregando" };
  if (erro) return { estado: "erro" };
  if (!usuario) return { estado: "login", destino: "/login" };

  const perfil = normalizarPerfil(usuario.tipo);
  const permitidos = cargosPermitidos.map(normalizarPerfil);

  if (permitidos.length > 0 && !permitidos.includes(perfil)) {
    return { estado: "sem_permissao", destino: rotaInicialPorPerfil(perfil) };
  }

  return { estado: "permitido" };
}
