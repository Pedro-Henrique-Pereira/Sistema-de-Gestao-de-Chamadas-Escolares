const ExcelJS = require("exceljs");
const db = require("../database/connection");
const { colunaExiste, garantirColunasAtraso } = require("../utils/atrasoUtils");
const { safeLogError } = require("../utils/errorHandler");
const { dataBrasiliaISO } = require("../utils/brasiliaTime");

const LIMITE_PADRAO = 10;
const LIMITE_MAXIMO = 100;
const LIMITE_BUSCA_ALUNOS = 20;
const MESES_MAXIMOS_EXPORTACAO = 3;
const MENSAGEM_PERIODO_MAXIMO = "O período máximo permitido para consulta é de 3 meses.";
const PERIODOS_RELATORIO = {
  "1m": 1,
  "3m": 3,
};

function formatarDataSQL(data) {
  return data.toISOString().slice(0, 10);
}

function resolverPeriodoRelatorio(valor) {
  const meses = PERIODOS_RELATORIO[String(valor || "1m")] || PERIODOS_RELATORIO["1m"];
  const fim = new Date(`${dataBrasiliaISO()}T00:00:00.000Z`);
  fim.setUTCDate(fim.getUTCDate() + 1);

  const inicio = new Date(fim);
  inicio.setUTCMonth(inicio.getUTCMonth() - meses);

  return {
    inicio: formatarDataSQL(inicio),
    fim: formatarDataSQL(fim),
    periodo: `${meses}m`,
  };
}

function inteiroPositivo(valor, padrao = LIMITE_PADRAO, maximo = LIMITE_MAXIMO) {
  if (valor === undefined || valor === null || valor === "") return padrao;

  const texto = String(valor).trim();
  if (!/^\d+$/.test(texto)) return padrao;

  const numero = parseInt(texto, 10);
  if (!Number.isSafeInteger(numero) || numero <= 0) return padrao;

  return Math.min(numero, maximo);
}

function limiteOffsetSeguro(page, limit) {
  const pageSeguro = inteiroPositivo(page, 1, 100000);
  const limitSeguro = inteiroPositivo(limit);
  const offsetSeguro = (pageSeguro - 1) * limitSeguro;

  return {
    page: pageSeguro,
    limit: limitSeguro,
    offset: Number.isSafeInteger(offsetSeguro) && offsetSeguro >= 0 ? offsetSeguro : 0,
  };
}

function valorValido(valor) {
  return valor !== undefined && valor !== null && valor !== "" && valor !== "todos" && valor !== "null" && valor !== "undefined";
}

function idSeguro(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function dataUTC(dataISO) {
  const [ano, mes, dia] = String(dataISO).split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function adicionarMeses(data, meses) {
  const ano = data.getUTCFullYear();
  const mes = data.getUTCMonth();
  const dia = data.getUTCDate();
  const mesAlvoAbsoluto = mes + meses;
  const anoAlvo = ano + Math.floor(mesAlvoAbsoluto / 12);
  const mesAlvo = ((mesAlvoAbsoluto % 12) + 12) % 12;
  const ultimoDiaMesAlvo = new Date(Date.UTC(anoAlvo, mesAlvo + 1, 0)).getUTCDate();

  return new Date(Date.UTC(anoAlvo, mesAlvo, Math.min(dia, ultimoDiaMesAlvo)));
}

function erroValidacao(mensagem) {
  const erro = new Error(mensagem);
  erro.status = 400;
  return erro;
}

function validarPeriodoExportacao(filtros = {}) {
  if (valorValido(filtros.data)) return;

  if (!valorValido(filtros.dataInicial) && !valorValido(filtros.dataFinal)) {
    throw erroValidacao("Informe uma data ou um intervalo de até 3 meses.");
  }

  if (!valorValido(filtros.dataInicial) || !valorValido(filtros.dataFinal)) {
    throw erroValidacao("Informe data inicial e data final para consultar por período.");
  }

  if (String(filtros.dataInicial) > String(filtros.dataFinal)) {
    throw erroValidacao("Data inicial nao pode ser posterior a data final.");
  }

  const inicio = dataUTC(filtros.dataInicial);
  const fim = dataUTC(filtros.dataFinal);
  const limite = adicionarMeses(inicio, MESES_MAXIMOS_EXPORTACAO);

  if (fim > limite) {
    throw erroValidacao(MENSAGEM_PERIODO_MAXIMO);
  }
}

function validarDependenciaAlunoTurma(filtros = {}) {
  if (idSeguro(filtros.alunoId) && !idSeguro(filtros.turmaId)) {
    throw erroValidacao("Selecione uma turma antes de filtrar por aluno.");
  }
}

function textoBuscaSeguro(valor, limite = 80) {
  return String(valor || "").trim().slice(0, limite);
}

function escaparLike(valor) {
  return String(valor).replace(/[!%_]/g, (caractere) => `!${caractere}`);
}

function montarWhereFiltros(filtros = {}) {
  const where = [];
  const params = [];

  if (valorValido(filtros.data)) {
    where.push("rfa.data_chamada = ?");
    params.push(String(filtros.data));
  } else {
    if (valorValido(filtros.dataInicial)) {
      where.push("rfa.data_chamada >= ?");
      params.push(String(filtros.dataInicial));
    }

    if (valorValido(filtros.dataFinal)) {
      where.push("rfa.data_chamada <= ?");
      params.push(String(filtros.dataFinal));
    }
  }

  const turmaId = idSeguro(filtros.turmaId);
  if (turmaId) {
    where.push("rfa.turma_id = ?");
    params.push(turmaId);
  }

  const alunoId = idSeguro(filtros.alunoId);
  if (alunoId) {
    where.push("rfa.aluno_id = ?");
    params.push(alunoId);
  }

  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

function statusPresenteSql(alias = "rfa") {
  return `LOWER(COALESCE(${alias}.status, '')) IN ('presente', 'atrasado')`;
}

function statusAusenteSql(alias = "rfa") {
  return `LOWER(COALESCE(${alias}.status, '')) IN ('ausente', 'falta', 'faltou', 'justificado')`;
}

function statusJustificadoSql(alias = "rfa") {
  return `LOWER(COALESCE(${alias}.status, '')) = 'justificado'`;
}

function statusAtrasadoSql(alias = "rfa") {
  return `(${alias}.atrasado = TRUE OR LOWER(COALESCE(${alias}.status, '')) = 'atrasado')`;
}

function logErroRelatorio(contexto, error) {
  safeLogError(`relatoriosController.${contexto}`, error);
}

let cacheColunasFrequencia = null;
let relatoriosPreparados = false;

async function obterColunasFrequencia() {
  if (cacheColunasFrequencia) return cacheColunasFrequencia;

  const [rows] = await db.execute(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'registros_frequencia_alunos'
  `);

  const colunas = new Set(rows.map((row) => row.COLUMN_NAME));
  cacheColunasFrequencia = {
    temHorarioRegistroAtraso: colunas.has('horario_registro_atraso'),
    temAtrasoRegistradoEm: colunas.has('atraso_registrado_em'),
  };

  return cacheColunasFrequencia;
}

async function prepararRelatorios() {
  if (relatoriosPreparados) return;

  // Os painéis de relatório NÃO podem cair por causa de colunas opcionais usadas apenas
  // na exportação detalhada. A estrutura principal exigida é a tabela detalhada.
  const temTabelaDetalhada = await colunaExiste(db, "registros_frequencia_alunos", "id");

  if (!temTabelaDetalhada) {
    const erro = new Error("Banco desatualizado: tabela registros_frequencia_alunos não encontrada.");
    erro.status = 500;
    throw erro;
  }

  relatoriosPreparados = true;
}

async function listarTurmasFiltro(req, res, next) {
  try {
    const [turmas] = await db.execute(`
      SELECT id, nome
      FROM turmas
      ORDER BY nome ASC
    `);

    res.json({ turmas });
  } catch (error) {
    logErroRelatorio("listarTurmasFiltro", error);
    next(error);
  }
}

async function buscarAlunosFiltro(req, res, next) {
  try {
    const termo = textoBuscaSeguro(req.query.busca);
    const turmaId = idSeguro(req.query.turmaId || req.query.turma_id);

    if (!turmaId) {
      return res.status(400).json({ erro: "Selecione uma turma para pesquisar alunos." });
    }

    if (termo.length < 2) {
      return res.json({ alunos: [] });
    }

    const termoLike = escaparLike(termo);
    const where = ["a.turma_id = ?", "a.nome LIKE ? ESCAPE '!'"];
    const params = [turmaId, `%${termoLike}%`];

    params.push(termo, `${termoLike}%`, LIMITE_BUSCA_ALUNOS);

    const [alunos] = await db.query(`
      SELECT
        a.id,
        a.nome,
        a.turma_id,
        t.nome AS turma,
        t.nome AS turma_nome
      FROM alunos a
      LEFT JOIN turmas t ON t.id = a.turma_id
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE
          WHEN a.nome = ? THEN 0
          WHEN a.nome LIKE ? ESCAPE '!' THEN 1
          ELSE 2
        END,
        a.nome ASC,
        a.id ASC
      LIMIT ?
    `, params);

    res.json({ alunos });
  } catch (error) {
    logErroRelatorio("buscarAlunosFiltro", error);
    next(error);
  }
}

function montarCampoHorarioChegada(colunas) {
  const candidatos = [];

  if (colunas.temHorarioRegistroAtraso) candidatos.push("rfa.horario_registro_atraso");
  if (colunas.temAtrasoRegistradoEm) candidatos.push("TIME(rfa.atraso_registrado_em)");

  candidatos.push("TIME(rfa.criado_em)");

  return `COALESCE(${candidatos.join(", ")})`;
}

async function geralAno(req, res, next) {
  try {
    await prepararRelatorios();
    const periodo = resolverPeriodoRelatorio(req.query.periodo);

    const [rows] = await db.execute(`
      SELECT
        COALESCE(SUM(CASE WHEN ${statusPresenteSql("rfa")} THEN 1 ELSE 0 END), 0) AS presentes,
        COALESCE(SUM(CASE WHEN ${statusAusenteSql("rfa")} THEN 1 ELSE 0 END), 0) AS ausentes,
        COALESCE(SUM(CASE WHEN ${statusJustificadoSql("rfa")} THEN 1 ELSE 0 END), 0) AS justificados,
        COALESCE(SUM(CASE WHEN ${statusAtrasadoSql("rfa")} THEN 1 ELSE 0 END), 0) AS atrasos,
        COUNT(DISTINCT rfa.registro_chamada_id) AS chamadas
      FROM registros_frequencia_alunos rfa
      WHERE rfa.data_chamada >= ?
        AND rfa.data_chamada < ?
    `, [periodo.inicio, periodo.fim]);

    res.json({
      ...(rows[0] || {
      presentes: 0,
      ausentes: 0,
      justificados: 0,
      atrasos: 0,
      chamadas: 0,
      }),
      periodo: periodo.periodo,
      dataInicial: periodo.inicio,
      dataFinal: periodo.fim,
    });
  } catch (error) {
    logErroRelatorio("geralAno", error);
    next(error);
  }
}

async function resumoAnual(req, res, next) {
  try {
    await prepararRelatorios();

    const { page, limit, offset } = limiteOffsetSeguro(req.query.page, req.query.limit);
    const periodo = resolverPeriodoRelatorio(req.query.periodo);

    const [[countRows], [itens]] = await Promise.all([
      db.execute(`
        SELECT COUNT(DISTINCT rfa.registro_chamada_id) AS total
        FROM registros_frequencia_alunos rfa
        WHERE rfa.data_chamada >= ?
          AND rfa.data_chamada < ?
      `, [periodo.inicio, periodo.fim]),
      db.query(`
        SELECT
          rcc.id,
          rcc.data_chamada,
          rcc.turma_nome,
          COALESCE(SUM(CASE WHEN ${statusPresenteSql("rfa")} THEN 1 ELSE 0 END), 0) AS total_presentes,
          COALESCE(SUM(CASE WHEN ${statusAusenteSql("rfa")} THEN 1 ELSE 0 END), 0) AS total_ausentes,
          COALESCE(SUM(CASE WHEN ${statusJustificadoSql("rfa")} THEN 1 ELSE 0 END), 0) AS total_justificados,
          COALESCE(SUM(CASE WHEN ${statusAtrasadoSql("rfa")} THEN 1 ELSE 0 END), 0) AS total_atrasos
        FROM registros_chamadas_confirmadas rcc
        INNER JOIN registros_frequencia_alunos rfa
          ON rfa.registro_chamada_id = rcc.id
        WHERE rfa.data_chamada >= ?
          AND rfa.data_chamada < ?
        GROUP BY rcc.id, rcc.data_chamada, rcc.turma_nome
        ORDER BY rcc.data_chamada DESC, rcc.id DESC
        LIMIT ? OFFSET ?
      `, [periodo.inicio, periodo.fim, limit, offset]),
    ]);

    const total = Number(countRows[0]?.total || 0);

    res.json({
      itens,
      total,
      page,
      limit,
      periodo: periodo.periodo,
      dataInicial: periodo.inicio,
      dataFinal: periodo.fim,
      totalPaginas: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    logErroRelatorio("resumoAnual", error);
    next(error);
  }
}

async function resumoMensal(req, res, next) {
  try {
    await prepararRelatorios();

    const periodo = resolverPeriodoRelatorio(req.query.periodo);

    const [itens] = await db.execute(`
      SELECT
        MIN(rcc.id) AS id,
        DATE_FORMAT(rfa.data_chamada, '%Y-%m-%d') AS data_chamada,
        rfa.turma_id,
        rfa.turma_nome,
        rfa.materia,
        COALESCE(SUM(CASE WHEN ${statusPresenteSql("rfa")} THEN 1 ELSE 0 END), 0) AS total_presentes,
        COALESCE(SUM(CASE WHEN ${statusAusenteSql("rfa")} THEN 1 ELSE 0 END), 0) AS total_ausentes,
        COALESCE(SUM(CASE WHEN ${statusJustificadoSql("rfa")} THEN 1 ELSE 0 END), 0) AS total_justificados,
        COALESCE(SUM(CASE WHEN ${statusAtrasadoSql("rfa")} THEN 1 ELSE 0 END), 0) AS total_atrasos
      FROM registros_frequencia_alunos rfa
      LEFT JOIN registros_chamadas_confirmadas rcc
        ON rcc.id = rfa.registro_chamada_id
      WHERE rfa.data_chamada >= ?
        AND rfa.data_chamada < ?
      GROUP BY rfa.data_chamada, rfa.turma_id, rfa.turma_nome, rfa.materia
      ORDER BY rfa.data_chamada DESC, rfa.turma_nome ASC, rfa.materia ASC
    `, [periodo.inicio, periodo.fim]);

    res.json({
      itens,
      periodo: periodo.periodo,
      dataInicial: periodo.inicio,
      dataFinal: periodo.fim,
    });
  } catch (error) {
    logErroRelatorio("resumoMensal", error);
    next(error);
  }
}

async function historicoJustificativas(req, res, next) {
  try {
    const { page, limit, offset } = limiteOffsetSeguro(req.query.page, req.query.limit);

    const [[countRows], [alunosRows]] = await Promise.all([
      db.execute(`
        SELECT COUNT(DISTINCT jf.aluno_id) AS total
        FROM justificativas_frequencia jf
      `),
      db.query(`
        SELECT
          jf.aluno_id,
          a.nome AS aluno_nome,
          t.nome AS turma_nome
        FROM justificativas_frequencia jf
        INNER JOIN alunos a ON a.id = jf.aluno_id
        LEFT JOIN turmas t ON t.id = a.turma_id
        GROUP BY jf.aluno_id, a.nome, t.nome
        ORDER BY a.nome ASC
        LIMIT ? OFFSET ?
      `, [limit, offset]),
    ]);

    const idsAlunos = alunosRows.map((item) => item.aluno_id);

    if (idsAlunos.length === 0) {
      return res.json({
        itens: [],
        total: 0,
        page,
        limit,
        totalPaginas: 1,
      });
    }

    const placeholders = idsAlunos.map(() => "?").join(",");

    const [justificativas] = await db.execute(`
      SELECT
        jf.aluno_id,
        rfa.data_chamada,
        jf.motivo
      FROM justificativas_frequencia jf
      INNER JOIN registros_frequencia_alunos rfa ON rfa.id = jf.frequencia_aluno_id
      WHERE jf.aluno_id IN (${placeholders})
      ORDER BY rfa.data_chamada DESC, jf.id DESC
    `, idsAlunos);

    const porAluno = new Map();

    alunosRows.forEach((aluno) => {
      porAluno.set(aluno.aluno_id, {
        aluno_id: aluno.aluno_id,
        aluno_nome: aluno.aluno_nome,
        turma_nome: aluno.turma_nome,
        justificativas: [],
      });
    });

    justificativas.forEach((item) => {
      porAluno.get(item.aluno_id)?.justificativas.push({
        data_chamada: item.data_chamada,
        motivo: item.motivo,
      });
    });

    const total = Number(countRows[0]?.total || 0);

    res.json({
      itens: Array.from(porAluno.values()),
      total,
      page,
      limit,
      totalPaginas: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    logErroRelatorio("historicoJustificativas", error);
    next(error);
  }
}

function formatarTempoAtraso(segundos = 0) {
  const totalMinutos = Math.max(Math.floor(Number(segundos || 0) / 60), 0);

  if (totalMinutos <= 0) return "Sem atraso";

  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;

  if (horas > 0 && minutos > 0) return `${horas}h ${minutos}min`;
  if (horas > 0) return `${horas}h`;
  return `${minutos}min`;
}

async function exportar(req, res, next) {
  try {
    await prepararRelatorios();
    validarPeriodoExportacao(req.body);
    validarDependenciaAlunoTurma(req.body);

    // Corrige ReferenceError: campoHorarioChegada is not defined.
    // O campo pode ou não existir dependendo das migrações aplicadas, então ele
    // é montado dinamicamente com fallback seguro para rfa.criado_em.
    const colunasFrequencia = await obterColunasFrequencia();
    const campoHorarioChegada = montarCampoHorarioChegada(colunasFrequencia);

    const { sql, params } = montarWhereFiltros(req.body);

    const [rows] = await db.execute(`
      SELECT
        rfa.data_chamada,
        rfa.aluno_nome,
        rfa.turma_nome,
        rfa.materia,
        CASE
          WHEN ${statusAtrasadoSql("rfa")} THEN 'presente'
          ELSE rfa.status
        END AS status,
        ${statusAtrasadoSql("rfa")} AS atrasado,
        COALESCE(jf.motivo, '') AS justificativa,
        COALESCE(rcc.horario_chamada, '00:00:00') AS horario_base_chamada,
        ${campoHorarioChegada} AS horario_chegada_aluno,
        CASE
          WHEN ${statusAtrasadoSql("rfa")} THEN GREATEST(
            TIME_TO_SEC(
              TIMEDIFF(
                ${campoHorarioChegada},
                COALESCE(rcc.horario_chamada, '00:00:00')
              )
            ),
            0
          )
          ELSE 0
        END AS segundos_atraso
      FROM registros_frequencia_alunos rfa
      LEFT JOIN registros_chamadas_confirmadas rcc
        ON rcc.id = rfa.registro_chamada_id
      LEFT JOIN justificativas_frequencia jf
        ON jf.frequencia_aluno_id = rfa.id
      ${sql}
      ORDER BY rfa.data_chamada DESC, rfa.turma_nome ASC, rfa.aluno_nome ASC
    `, params);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Sistema de Chamadas";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Frequência");

    sheet.columns = [
      { header: "Data", key: "data_chamada", width: 14 },
      { header: "Aluno", key: "aluno_nome", width: 32 },
      { header: "Turma", key: "turma_nome", width: 14 },
      { header: "Matéria", key: "materia", width: 24 },
      { header: "Status", key: "status", width: 16 },
      { header: "Atrasado", key: "atrasado", width: 12 },
      { header: "Tempo de Atraso", key: "tempo_atraso", width: 20 },
      { header: "Justificativa", key: "justificativa", width: 50 },
    ];

    sheet.getRow(1).font = { bold: true };

    rows.forEach((row) => {
      sheet.addRow({
        ...row,
        data_chamada: row.data_chamada,
        atrasado: row.atrasado ? "Sim" : "Não",
        tempo_atraso: formatarTempoAtraso(row.segundos_atraso),
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="relatorio-frequencia-${dataBrasiliaISO()}.xlsx"`
    );
    res.setHeader("Content-Length", buffer.length);

    res.end(buffer);
  } catch (error) {
    logErroRelatorio("exportar", error);
    next(error);
  }
}

module.exports = {
  listarTurmasFiltro,
  buscarAlunosFiltro,
  geralAno,
  resumoAnual,
  resumoMensal,
  historicoJustificativas,
  exportar,
};
