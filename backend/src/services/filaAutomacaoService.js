async function inserirMensagensGrupoNaFila(connection, tarefas = []) {
  const ids = [];

  for (const tarefa of tarefas) {
    const [resultado] = await connection.execute(
      `INSERT INTO fila_automacao
        (usuario_solicitante_id, usuario_solicitante_nome, maquina_destino, tipo_automacao, mensagem, payload, status)
       VALUES (?, ?, ?, 'mensagem_grupo', ?, ?, 'pendente')`,
      [
        tarefa.usuarioSolicitanteId,
        tarefa.usuarioSolicitanteNome,
        tarefa.maquinaDestino,
        tarefa.mensagem,
        tarefa.payload,
      ]
    );

    const id = Number(resultado?.insertId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("Não foi possível identificar a tarefa inserida na fila de automação.");
    }

    ids.push(id);
  }

  return ids;
}

module.exports = {
  inserirMensagensGrupoNaFila,
};
