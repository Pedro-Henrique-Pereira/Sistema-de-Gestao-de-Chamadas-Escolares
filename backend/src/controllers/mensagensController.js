const db = require('../database/connection');

function validarMaquina(valor) {
  const maquina = Number(valor);
  if (!Number.isInteger(maquina) || ![3, 4, 5].includes(maquina)) {
    const erro = new Error('Administradores só podem usar as máquinas 3, 4 e 5 para mensagens em grupos.');
    erro.status = 400;
    throw erro;
  }
  return maquina;
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

module.exports = {
  listarGrupos,
  criarGrupo,
  atualizarGrupo,
  removerGrupo,
  obterPreferencias,
  salvarPreferencias,
};
