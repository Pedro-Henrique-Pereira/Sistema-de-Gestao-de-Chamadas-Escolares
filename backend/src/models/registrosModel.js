const db = require('../database/connection');

function normalizarCargoParaTipo(cargo) {
  const valor = String(cargo || '').toLowerCase();
  if (valor.includes('admin')) return 'administracao';
  if (valor.includes('pedag')) return 'pedagoga';
  if (valor.includes('prof')) return 'professor';
  return valor;
}

function normalizarTipoParaCargo(tipo) {
  if (tipo === 'administracao') return 'Administrador';
  if (tipo === 'pedagoga') return 'Pedagoga';
  if (tipo === 'professor') return 'Professor';
  return tipo;
}

async function listarTurmas() {
  const [rows] = await db.execute('SELECT id, nome, criada_em FROM turmas ORDER BY nome ASC');
  return rows;
}

async function criarTurma(nome) {
  const [result] = await db.execute('INSERT INTO turmas (nome) VALUES (?)', [nome]);
  const [rows] = await db.execute('SELECT id, nome, criada_em FROM turmas WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function atualizarTurma(id, nome) {
  const [result] = await db.execute(
    'UPDATE turmas SET nome = ? WHERE id = ?',
    [nome, id]
  );

  if (result.affectedRows === 0) {
    const erro = new Error('Turma não encontrada.');
    erro.status = 404;
    throw erro;
  }

  const [rows] = await db.execute('SELECT id, nome, criada_em FROM turmas WHERE id = ?', [id]);
  return rows[0];
}


async function removerTurma(id) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [turmas] = await connection.execute(
      'SELECT id FROM turmas WHERE id = ? LIMIT 1',
      [id]
    );

    if (!turmas[0]) {
      const erro = new Error('Turma não encontrada.');
      erro.status = 404;
      throw erro;
    }

    await connection.execute('UPDATE alunos SET turma_id = NULL WHERE turma_id = ?', [id]);
    await connection.execute('DELETE FROM turmas WHERE id = ?', [id]);

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function buscarTurmaPorNome(nome) {
  const [rows] = await db.execute('SELECT id, nome FROM turmas WHERE nome = ? LIMIT 1', [nome]);
  return rows[0] || null;
}

async function listarAlunos() {
  const [rows] = await db.execute(`
    SELECT
      a.id, a.nome, a.idade, a.turma_id, t.nome AS turma,
      r.id AS responsavel_id, r.nome AS responsavel_nome,
      r.parentesco AS responsavel_parentesco, r.contato AS responsavel_contato
    FROM alunos a
    LEFT JOIN turmas t ON t.id = a.turma_id
    LEFT JOIN responsaveis r ON r.aluno_id = a.id
    ORDER BY t.nome IS NULL, t.nome ASC, a.nome ASC
  `);

  const mapa = new Map();
  rows.forEach((row) => {
    if (!mapa.has(row.id)) {
      mapa.set(row.id, {
        id: row.id,
        nome: row.nome,
        idade: row.idade,
        turma_id: row.turma_id,
        turma: row.turma || '',
        responsaveis: [],
      });
    }

    if (row.responsavel_id) {
      mapa.get(row.id).responsaveis.push({
        id: row.responsavel_id,
        nome: row.responsavel_nome,
        parentesco: row.responsavel_parentesco,
        contato: row.responsavel_contato,
      });
    }
  });

  return Array.from(mapa.values());
}

async function criarAluno(dados) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    let turmaId = dados.turma_id || null;
    if (!turmaId && dados.turma) {
      const [turmas] = await connection.execute('SELECT id FROM turmas WHERE nome = ? LIMIT 1', [dados.turma]);
      turmaId = turmas[0]?.id || null;
    }

    const [result] = await connection.execute(
      'INSERT INTO alunos (nome, idade, turma_id) VALUES (?, ?, ?)',
      [dados.nome, dados.idade, turmaId]
    );

    const responsavel = dados.responsaveis?.[0] || {};
    if (responsavel.nome && responsavel.contato) {
      await connection.execute(
        'INSERT INTO responsaveis (aluno_id, nome, parentesco, contato) VALUES (?, ?, ?, ?)',
        [result.insertId, responsavel.nome, responsavel.parentesco || 'Responsável', responsavel.contato]
      );
    }

    await connection.commit();
    return result.insertId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function atualizarAluno(id, dados) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [alunosAtuais] = await connection.execute(
      'SELECT id, nome, idade, turma_id FROM alunos WHERE id = ? LIMIT 1',
      [id]
    );

    const alunoAtual = alunosAtuais[0];
    if (!alunoAtual) {
      const erro = new Error('Aluno não encontrado.');
      erro.status = 404;
      throw erro;
    }

    const turmaFoiEnviada = Boolean(dados.__turmaEnviada)
      || Object.prototype.hasOwnProperty.call(dados, 'turma_id')
      || Object.prototype.hasOwnProperty.call(dados, 'turma');

    let turmaId = alunoAtual.turma_id;
    if (turmaFoiEnviada) {
      turmaId = dados.turma_id || null;
      if (!turmaId && dados.turma) {
        const [turmas] = await connection.execute('SELECT id FROM turmas WHERE nome = ? LIMIT 1', [dados.turma]);
        turmaId = turmas[0]?.id || null;
      }
    }

    await connection.execute('UPDATE alunos SET nome = ?, idade = ?, turma_id = ? WHERE id = ?', [
      dados.nome ?? alunoAtual.nome,
      dados.idade ?? alunoAtual.idade,
      turmaId,
      id,
    ]);

    if (Array.isArray(dados.responsaveis) && dados.responsaveis.length === 0) {
      await connection.execute('DELETE FROM responsaveis WHERE aluno_id = ?', [id]);
    }

    const responsavel = dados.responsaveis?.[0] || {};
    if (responsavel.nome && responsavel.contato) {
      const [existentes] = await connection.execute('SELECT id FROM responsaveis WHERE aluno_id = ? LIMIT 1', [id]);
      if (existentes[0]) {
        await connection.execute(
          'UPDATE responsaveis SET nome = ?, parentesco = ?, contato = ? WHERE id = ?',
          [responsavel.nome, responsavel.parentesco || 'Responsável', responsavel.contato, existentes[0].id]
        );
      } else {
        await connection.execute(
          'INSERT INTO responsaveis (aluno_id, nome, parentesco, contato) VALUES (?, ?, ?, ?)',
          [id, responsavel.nome, responsavel.parentesco || 'Responsável', responsavel.contato]
        );
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function atualizarTurmaAluno(id, turmaNome) {
  let turmaId = null;
  if (turmaNome) {
    const turma = await buscarTurmaPorNome(turmaNome);
    turmaId = turma?.id || null;
  }
  await db.execute('UPDATE alunos SET turma_id = ? WHERE id = ?', [turmaId, id]);
}

async function removerAluno(id) {
  await db.execute('DELETE FROM alunos WHERE id = ?', [id]);
}

async function listarEquipe() {
  const [rows] = await db.execute(`
    SELECT id, nome, email, tipo, ativo, criado_em
    FROM usuarios
    ORDER BY tipo ASC, nome ASC
  `);

  return rows.map((usuario) => ({
    id: usuario.id,
    nome: usuario.nome,
    idade: '',
    cargo: normalizarTipoParaCargo(usuario.tipo),
    email: usuario.email,
    senha: '',
    status: usuario.ativo ? 'Ativo' : 'Inativo',
  }));
}

async function criarEquipe({ nome, email, senhaHash, cargo }) {
  const tipo = normalizarCargoParaTipo(cargo);
  const [result] = await db.execute(
    'INSERT INTO usuarios (nome, email, senha_hash, tipo, ativo) VALUES (?, ?, ?, ?, TRUE)',
    [nome, email, senhaHash, tipo]
  );
  return result.insertId;
}

async function atualizarEquipe(id, { nome, email, senhaHash, cargo, status }) {
  const tipo = normalizarCargoParaTipo(cargo);
  const ativo = status !== 'Inativo';

  if (senhaHash) {
    await db.execute(
      'UPDATE usuarios SET nome = ?, email = ?, senha_hash = ?, tipo = ?, ativo = ? WHERE id = ?',
      [nome, email, senhaHash, tipo, ativo, id]
    );
    return;
  }

  await db.execute('UPDATE usuarios SET nome = ?, email = ?, tipo = ?, ativo = ? WHERE id = ?', [
    nome,
    email,
    tipo,
    ativo,
    id,
  ]);
}

async function removerEquipe(id) {
  await db.execute('DELETE FROM usuarios WHERE id = ?', [id]);
}

module.exports = {
  listarTurmas,
  criarTurma,
  atualizarTurma,
  removerTurma,
  listarAlunos,
  criarAluno,
  atualizarAluno,
  atualizarTurmaAluno,
  removerAluno,
  listarEquipe,
  criarEquipe,
  atualizarEquipe,
  removerEquipe,
};
