const db = require('../database/connection');
const { inserirMensagensGrupoNaFila } = require('../services/filaAutomacaoService');

function validarMaquina(valor) {
  const maquina = Number(valor);
  if (!Number.isInteger(maquina) || ![3, 4, 5].includes(maquina)) {
    const erro = new Error('Administradores só podem usar as máquinas 3, 4 e 5 para mensagens em grupos.');
    erro.status = 400;
    throw erro;
  }
  return maquina;
}

function validarMensagem(valor) {
  const mensagem = String(valor || '').trim();
  if (mensagem.length < 3) {
    const erro = new Error('Digite uma mensagem com pelo menos 3 caracteres.');
    erro.status = 400;
    throw erro;
  }
  if (mensagem.length > 4000) {
    const erro = new Error('A mensagem não pode ultrapassar 4000 caracteres.');
    erro.status = 400;
    throw erro;
  }
  return mensagem;
}

function normalizarTexto(valor, campo, tamanhoMaximo = 150) {
  const texto = String(valor || '').trim().replace(/\s+/g, ' ');
  if (!texto) {
    const erro = new Error(`${campo} é obrigatório.`);
    erro.status = 400;
    throw erro;
  }
  if (texto.length > tamanhoMaximo) {
    const erro = new Error(`${campo} não pode ultrapassar ${tamanhoMaximo} caracteres.`);
    erro.status = 400;
    throw erro;
  }
  return texto;
}


function normalizarNomeGrupoParaBusca(valor) {
  return String(valor || '')
    .normalize('NFC')
    .replace(/[º°]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

async function listarGrupos(req, res, next) {
  try {
    const [rows] = await db.execute(`
      SELECT
        gw.id,
        gw.nome_grupo AS nomeGrupo,
        REPLACE(REPLACE(REPLACE(REPLACE(TRIM(gw.nome_grupo), ' ', ''), CHAR(9), ''), 'º', ''), '°', '') AS nomeGrupoBusca,
        gw.ativo,
        gw.criado_em AS criadoEm,
        gw.atualizado_em AS atualizadoEm
      FROM grupos_whatsapp gw
      WHERE gw.ativo = TRUE
      ORDER BY gw.nome_grupo ASC
    `);

    res.json({ grupos: rows });
  } catch (error) {
    next(error);
  }
}

async function criarGrupo(req, res, next) {
  try {
    const nomeGrupo = normalizarTexto(req.body.nomeGrupo || req.body.nome_grupo, 'Nome do grupo do WhatsApp');
    const [result] = await db.execute(
      `INSERT INTO grupos_whatsapp (nome_grupo, ativo)
       VALUES (?, TRUE)
       ON DUPLICATE KEY UPDATE ativo = TRUE`,
      [nomeGrupo]
    );

    res.status(201).json({
      mensagem: 'Grupo do WhatsApp cadastrado com sucesso.',
      id: result.insertId || null,
      nomeGrupo,
      nomeGrupoBusca: normalizarNomeGrupoParaBusca(nomeGrupo),
    });
  } catch (error) {
    next(error);
  }
}

async function atualizarGrupo(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      const erro = new Error('ID do grupo inválido.');
      erro.status = 400;
      throw erro;
    }

    const nomeGrupo = normalizarTexto(req.body.nomeGrupo || req.body.nome_grupo, 'Nome do grupo do WhatsApp');
    const [result] = await db.execute(
      `UPDATE grupos_whatsapp
          SET nome_grupo = ?, ativo = TRUE
        WHERE id = ?`,
      [nomeGrupo, id]
    );

    if (result.affectedRows === 0) {
      const erro = new Error('Grupo do WhatsApp não encontrado.');
      erro.status = 404;
      throw erro;
    }

    res.json({
      mensagem: 'Grupo do WhatsApp atualizado com sucesso.',
      id,
      nomeGrupo,
      nomeGrupoBusca: normalizarNomeGrupoParaBusca(nomeGrupo),
    });
  } catch (error) {
    next(error);
  }
}

async function removerGrupo(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      const erro = new Error('ID do grupo inválido.');
      erro.status = 400;
      throw erro;
    }

    const [result] = await db.execute('UPDATE grupos_whatsapp SET ativo = FALSE WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      const erro = new Error('Grupo do WhatsApp não encontrado.');
      erro.status = 404;
      throw erro;
    }

    res.json({ mensagem: 'Grupo do WhatsApp removido da lista de envios.' });
  } catch (error) {
    next(error);
  }
}

async function obterPreferencias(req, res, next) {
  try {
    const [rows] = await db.execute(
      'SELECT maquina_padrao_mensagens FROM usuarios WHERE id = ? LIMIT 1',
      [req.usuario.id]
    );

    res.json({
      maquinaPadraoMensagens: [3, 4, 5].includes(Number(rows[0]?.maquina_padrao_mensagens)) ? Number(rows[0].maquina_padrao_mensagens) : 3,
    });
  } catch (error) {
    next(error);
  }
}

async function salvarPreferencias(req, res, next) {
  try {
    const maquina = validarMaquina(req.body.maquinaPadraoMensagens || req.body.maquina_padrao_mensagens || req.body.maquina);

    await db.execute(
      'UPDATE usuarios SET maquina_padrao_mensagens = ? WHERE id = ?',
      [maquina, req.usuario.id]
    );

    res.json({
      mensagem: 'Preferência de máquina salva com sucesso.',
      maquinaPadraoMensagens: maquina,
    });
  } catch (error) {
    next(error);
  }
}

async function enviarMensagem(req, res, next) {
  let connection;
  let transacaoIniciada = false;

  try {
    connection = await db.getConnection();
    const mensagem = validarMensagem(req.body.mensagem);
    const maquinaDestino = validarMaquina(req.body.maquinaDestino || req.body.maquina_destino);
    const modoDestinatarios = req.body.modoDestinatarios || req.body.modo_destinatarios || 'todos';

    let grupos = [];

    if (modoDestinatarios === 'todos') {
      const [rows] = await connection.execute(`
        SELECT id, nome_grupo
        FROM grupos_whatsapp
        WHERE ativo = TRUE
        ORDER BY nome_grupo ASC
      `);
      grupos = rows;
    } else {
      const ids = Array.isArray(req.body.grupos)
        ? Array.from(new Set(req.body.grupos.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)))
        : [];

      if (ids.length === 0) {
        const erro = new Error('Selecione pelo menos um grupo do WhatsApp.');
        erro.status = 400;
        throw erro;
      }

      const placeholders = ids.map(() => '?').join(', ');
      const [rows] = await connection.execute(
        `SELECT id, nome_grupo
           FROM grupos_whatsapp
          WHERE ativo = TRUE AND id IN (${placeholders})
          ORDER BY nome_grupo ASC`,
        ids
      );

      if (rows.length !== ids.length) {
        const encontrados = new Set(rows.map((row) => Number(row.id)));
        const invalidos = ids.filter((id) => !encontrados.has(id));
        const erro = new Error(`Grupo(s) do WhatsApp inválido(s): ${invalidos.join(', ')}`);
        erro.status = 400;
        throw erro;
      }

      grupos = rows;
    }

    if (grupos.length === 0) {
      const erro = new Error('Nenhum grupo do WhatsApp cadastrado para envio.');
      erro.status = 400;
      throw erro;
    }

    await connection.beginTransaction();
    transacaoIniciada = true;

    const [usuarios] = await connection.execute(
      'SELECT nome FROM usuarios WHERE id = ? LIMIT 1',
      [req.usuario.id]
    );
    const nomeUsuario = usuarios[0]?.nome || 'Administrador';

    await connection.execute(
      'UPDATE usuarios SET maquina_padrao_mensagens = ? WHERE id = ?',
      [maquinaDestino, req.usuario.id]
    );

    const tarefasFila = grupos.map((grupo) => ({
      usuarioSolicitanteId: req.usuario.id,
      usuarioSolicitanteNome: nomeUsuario,
      maquinaDestino,
      mensagem,
      payload: JSON.stringify({
        grupo_whatsapp_id: grupo.id,
        nome_grupo_whatsapp: grupo.nome_grupo,
        nome_grupo_whatsapp_busca: normalizarNomeGrupoParaBusca(grupo.nome_grupo),
        origem: 'painel_admin_mensagens',
      }),
    }));

    const idsFila = await inserirMensagensGrupoNaFila(connection, tarefasFila);

    await connection.commit();
    transacaoIniciada = false;

    res.status(201).json({
      mensagem: `${grupos.length} tarefa(s) de mensagem para grupo(s) do WhatsApp adicionada(s) à fila da máquina ${maquinaDestino}.`,
      total: grupos.length,
      ids: idsFila,
      solicitacoes: idsFila.map((id) => ({ id, status: 'pendente' })),
      maquinaDestino,
      grupos: grupos.map((grupo) => ({
        id: grupo.id,
        nomeGrupo: grupo.nome_grupo,
        nomeGrupoBusca: normalizarNomeGrupoParaBusca(grupo.nome_grupo),
      })),
    });
  } catch (error) {
    if (transacaoIniciada && connection) {
      await connection.rollback();
    }
    next(error);
  } finally {
    if (connection) connection.release();
  }
}

async function limparTarefasAntigas(req, res, next) {
  try {
    const [limpezaFinalizadas] = await db.execute(`
      DELETE FROM fila_automacao
      WHERE status IN ('concluido', 'erro', 'expirado', 'cancelado')
        AND data_solicitacao < DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);

    const [expiradas] = await db.execute(`
      UPDATE fila_automacao
      SET status = 'expirado',
          erro = COALESCE(erro, 'Tarefa expirada manualmente por ficar pendente por mais de 7 dias.')
      WHERE status = 'pendente'
        AND data_solicitacao < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    const [locksLiberados] = await db.execute(`
      UPDATE fila_automacao
      SET status = 'pendente',
          lock_owner = NULL,
          lock_adquirido_em = NULL,
          iniciado_em = NULL,
          erro = COALESCE(erro, 'Lock liberado manualmente por inatividade superior a 30 minutos.')
      WHERE status = 'executando'
        AND lock_adquirido_em < DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    `);

    res.json({
      mensagem: 'Limpeza de tarefas antigas executada com sucesso.',
      removidas: limpezaFinalizadas.affectedRows || 0,
      expiradas: expiradas.affectedRows || 0,
      locksLiberados: locksLiberados.affectedRows || 0,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listarGrupos,
  criarGrupo,
  atualizarGrupo,
  removerGrupo,
  obterPreferencias,
  salvarPreferencias,
  enviarMensagem,
  limparTarefasAntigas,
};
