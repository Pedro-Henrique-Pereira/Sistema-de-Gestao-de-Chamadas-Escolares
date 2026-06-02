const { garantirConfiguracao, horarioParaMinutos } = require("../controllers/configuracoesEscolaController");
const { safeLogError } = require("../utils/errorHandler");

function horarioLiberadoParaAtraso(config) {
  const limite = String(config.horario_limite_atraso || "07:45:00").slice(0, 8);
  const servidor = String(config.horario_servidor || "00:00:00").slice(0, 8);
  return horarioParaMinutos(servidor) <= horarioParaMinutos(limite);
}

async function executarTransacao(pool, operacao) {
  const connection = await pool.getConnection();
  let transacaoIniciada = false;

  try {
    await connection.beginTransaction();
    transacaoIniciada = true;

    const resultado = await operacao(connection);

    await connection.commit();
    transacaoIniciada = false;

    return resultado;
  } catch (error) {
    if (transacaoIniciada) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        safeLogError("chamadaService.executarTransacao.rollback", rollbackError);
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function validarJanelaAtraso(connection) {
  const config = await garantirConfiguracao(connection);

  if (!horarioLiberadoParaAtraso(config)) {
    const erro = new Error(`A marcação de atraso só é permitida até ${String(config.horario_limite_atraso).slice(0, 5)}. Depois desse horário deve permanecer como falta.`);
    erro.status = 403;
    throw erro;
  }

  return config;
}

async function buscarUsuarioAtivo(connection, usuarioId) {
  const [[usuario]] = await connection.execute(
    "SELECT id, nome, tipo FROM usuarios WHERE id = ? AND ativo = TRUE LIMIT 1",
    [Number(usuarioId)]
  );

  return usuario || null;
}

async function buscarTurma(connection, turmaId) {
  const [[turma]] = await connection.execute(
    "SELECT id, nome FROM turmas WHERE id = ? LIMIT 1",
    [Number(turmaId)]
  );

  return turma || null;
}

async function validarAlunosDaTurma(connection, turmaId, alunos = []) {
  const ids = [...new Set(alunos.map((aluno) => Number(aluno.aluno_id || aluno.id)).filter(Boolean))];

  if (ids.length === 0 || ids.length !== alunos.length) {
    const erro = new Error("Lista de alunos inválida ou com IDs duplicados.");
    erro.status = 400;
    throw erro;
  }

  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.execute(
    `SELECT id FROM alunos WHERE turma_id = ? AND id IN (${placeholders})`,
    [Number(turmaId), ...ids]
  );

  if (rows.length !== ids.length) {
    const encontrados = new Set(rows.map((row) => Number(row.id)));
    const invalidos = ids.filter((id) => !encontrados.has(id));
    const erro = new Error(`Há aluno(s) que não pertencem à turma selecionada: ${invalidos.join(", ")}.`);
    erro.status = 400;
    throw erro;
  }
}

module.exports = {
  executarTransacao,
  validarJanelaAtraso,
  buscarUsuarioAtivo,
  buscarTurma,
  validarAlunosDaTurma,
};
