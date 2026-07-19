const db = require("../database/db");
const { sanitizarDetalhes, sanitizarTexto } = require("../utils/auditoriaSanitizer");

const RESULTADOS_VALIDOS = new Set(["sucesso", "falha"]);

function normalizarInteiro(valor, padrao, minimo, maximo) {
  const texto = String(valor ?? "").trim();
  if (!/^\d+$/.test(texto)) return padrao;
  const numero = Number(texto);
  if (!Number.isSafeInteger(numero)) return padrao;
  return Math.min(Math.max(numero, minimo), maximo);
}

function normalizarIdentificador(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  return sanitizarTexto(valor, 64);
}

function normalizarIp(req) {
  const ip = req.ip || req.socket.remoteAddress || null;
  if (!ip) return null;
  return sanitizarTexto(ip, 45).replace(/^::ffff:/, "");
}

async function buscarAtorSeguro(executor, usuario) {
  const usuarioId = Number(usuario.id);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return { id: null, nome: "Sistema", perfil: "sistema" };
  }

  const [rows] = await executor.execute(
    "SELECT id, nome, tipo FROM usuarios WHERE id = ? LIMIT 1",
    [usuarioId]
  );
  const ator = rows[0];

  if (!ator) return { id: null, nome: "Usuário removido", perfil: "desconhecido" };
  return {
    id: Number(ator.id),
    nome: sanitizarTexto(ator.nome, 100) || "Usuário",
    perfil: sanitizarTexto(ator.tipo, 30) || "desconhecido",
  };
}

async function registrarEvento({
  executor = db,
  usuario,
  acao,
  descricao,
  entidade,
  entidadeId = null,
  resultado = "sucesso",
  ip = null,
  detalhes = null,
}) {
  const ator = await buscarAtorSeguro(executor, usuario);
  const resultadoSeguro = RESULTADOS_VALIDOS.has(resultado) ? resultado : "falha";
  const detalhesSeguros = sanitizarDetalhes(detalhes);

  const [insert] = await executor.execute(
    `INSERT INTO logs_auditoria
      (acao_tipo, descricao, usuario_id, usuario_nome, usuario_perfil,
       entidade_tipo, entidade_id, resultado, ip_origem, detalhes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sanitizarTexto(acao, 80) || "ACAO_NAO_IDENTIFICADA",
      sanitizarTexto(descricao, 500) || "Operação registrada pelo servidor.",
      ator.id,
      ator.nome,
      ator.perfil,
      sanitizarTexto(entidade, 50) || "sistema",
      normalizarIdentificador(entidadeId),
      resultadoSeguro,
      ip ? sanitizarTexto(ip, 45) : null,
      detalhesSeguros === null ? null : JSON.stringify(detalhesSeguros),
    ]
  );

  return { id: Number(insert.insertId), ator };
}

async function listarLogs({
  page = 1,
  limit = 25,
  busca = "",
  acao = "",
  perfil = "",
  resultado = "",
  entidade = "",
  dataInicio = "",
  dataFim = "",
} = {}, executor = db) {
  const pagina = normalizarInteiro(page, 1, 1, 1_000_000);
  const limite = normalizarInteiro(limit, 25, 10, 100);
  const offset = (pagina - 1) * limite;
  const filtros = [];
  const parametros = [];

  if (busca) {
    filtros.push("usuario_nome LIKE ? ESCAPE '!'");
    parametros.push(`%${String(busca).replace(/[!%_]/g, "!$&").slice(0, 100)}%`);
  }
  if (acao) {
    filtros.push("acao_tipo = ?");
    parametros.push(sanitizarTexto(acao, 80));
  }
  if (perfil) {
    filtros.push("usuario_perfil = ?");
    parametros.push(sanitizarTexto(perfil, 30));
  }
  if (resultado && RESULTADOS_VALIDOS.has(resultado)) {
    filtros.push("resultado = ?");
    parametros.push(resultado);
  }
  if (entidade) {
    filtros.push("entidade_tipo = ?");
    parametros.push(sanitizarTexto(entidade, 50));
  }
  if (dataInicio) {
    filtros.push("criado_em >= ?");
    parametros.push(`${dataInicio} 00:00:00`);
  }
  if (dataFim) {
    filtros.push("criado_em < DATE_ADD(?, INTERVAL 1 DAY)");
    parametros.push(`${dataFim} 00:00:00`);
  }

  const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
  const [[totalRow]] = await executor.execute(
    `SELECT COUNT(*) AS total FROM logs_auditoria ${where}`,
    parametros
  );
  const [logs] = await executor.execute(
    `SELECT id, acao_tipo, descricao, usuario_id, usuario_nome, usuario_perfil,
            entidade_tipo, entidade_id, resultado, ip_origem, criado_em
      FROM logs_auditoria
       ${where}
      ORDER BY criado_em DESC, id DESC
      LIMIT ${limite} OFFSET ${offset}`,
    parametros
  );
  const [[limpeza]] = await executor.execute(
    `SELECT ultima_execucao_em, ultima_quantidade_removida, proxima_execucao_em
       FROM auditoria_limpeza_estado WHERE id = 1 LIMIT 1`
  );

  const total = Number(totalRow.total || 0);
  return {
    logs,
    paginacao: {
      paginaAtual: pagina,
      limite,
      totalRegistros: total,
      totalPaginas: Math.max(Math.ceil(total / limite), 1),
    },
    ultimaLimpeza: limpeza || {
      ultima_execucao_em: null,
      ultima_quantidade_removida: 0,
      proxima_execucao_em: null,
    },
  };
}

async function listarOpcoesFiltros(executor = db) {
  const [acoes] = await executor.execute(
    "SELECT DISTINCT acao_tipo AS valor FROM logs_auditoria ORDER BY acao_tipo LIMIT 200"
  );
  const [entidades] = await executor.execute(
    "SELECT DISTINCT entidade_tipo AS valor FROM logs_auditoria ORDER BY entidade_tipo LIMIT 100"
  );
  const [perfis] = await executor.execute(
    "SELECT DISTINCT usuario_perfil AS valor FROM logs_auditoria ORDER BY usuario_perfil LIMIT 20"
  );
  return {
    acoes: acoes.map(({ valor }) => valor),
    entidades: entidades.map(({ valor }) => valor),
    perfis: perfis.map(({ valor }) => valor),
    resultados: ["sucesso", "falha"],
  };
}

module.exports = {
  normalizarInteiro,
  normalizarIp,
  registrarEvento,
  listarLogs,
  listarOpcoesFiltros,
};
