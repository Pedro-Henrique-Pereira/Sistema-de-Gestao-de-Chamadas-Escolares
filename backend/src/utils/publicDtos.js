function serializarUsuarioPublico(usuario) {
  if (!usuario) return null;

  return {
    id: Number(usuario.id),
    nome: usuario.nome,
    email: usuario.email,
    tipo: usuario.tipo,
  };
}

module.exports = {
  serializarUsuarioPublico,
};
