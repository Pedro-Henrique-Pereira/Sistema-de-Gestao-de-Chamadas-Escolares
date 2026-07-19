import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import MetricProgressChart from "../components/MetricProgressChart";
import { apiDownload, apiFetch } from "../services/api";
import { dataBrasiliaISO } from "../utils/brasiliaTime";
import {
  lerCachePrivado,
  salvarCachePrivado,
} from "../utils/privateDataCache";
import { registrarErroCliente } from "../utils/clientLogger";

const filtrosIniciais = {
  data: dataBrasiliaISO(),
  dataInicial: "",
  dataFinal: "",
  turmaId: "",
  alunoId: "",
};

const RELATORIOS_CACHE_PREFIX = "relatorios_agregados";
const RELATORIOS_ULTIMO_PERIODO_KEY = `${RELATORIOS_CACHE_PREFIX}:ultimo_periodo`;
const MESES_MAXIMOS_EXPORTACAO = 3;
const MENSAGEM_PERIODO_MAXIMO = "O período máximo permitido para consulta é de 3 meses.";
const PERIODOS_GRAFICO = [
  { valor: "1m", label: "1 mês" },
  { valor: "3m", label: "3 meses" },
];

function criarMetricasVazias() {
  return {
    presentes: 0,
    ausentes: 0,
    justificados: 0,
    atrasos: 0,
  };
}

function chaveCacheRelatorios(periodo) {
  return `${RELATORIOS_CACHE_PREFIX}:${periodo}:${dataBrasiliaISO()}`;
}

function lerCacheRelatorios(periodo) {
  const cache = lerCachePrivado(chaveCacheRelatorios(periodo));
  if (!cache || !cache.metricas || !Array.isArray(cache.resumo)) return null;
  return cache;
}

function salvarCacheRelatorios(periodo, metricas, resumo) {
  salvarCachePrivado(RELATORIOS_ULTIMO_PERIODO_KEY, periodo);
  salvarCachePrivado(chaveCacheRelatorios(periodo), {
    geradoEm: new Date().toISOString(),
    periodo,
    metricas,
    resumo,
  });
}

function lerUltimoPeriodoRelatorio() {
  const periodo = lerCachePrivado(RELATORIOS_ULTIMO_PERIODO_KEY);
  return PERIODOS_GRAFICO.some((item) => item.valor === periodo) ? periodo : "1m";
}

function normalizarDataMySQL(data) {
  if (!data) return "";

  if (typeof data === "string") {
    const apenasData = data.includes("T") ? data.split("T")[0] : data;
    return /^\d{4}-\d{2}-\d{2}$/.test(apenasData) ? apenasData : "";
  }

  if (data instanceof Date && !Number.isNaN(data.getTime())) {
    return data.toISOString().slice(0, 10);
  }

  return "";
}

function formatarData(data) {
  const dataNormalizada = normalizarDataMySQL(data);
  if (!dataNormalizada) return "-";

  const [ano, mes, dia] = dataNormalizada.split("-");
  return `${dia}/${mes}/${ano}`;
}

function obterChaveMes(data) {
  const dataNormalizada = normalizarDataMySQL(data);
  return dataNormalizada ? dataNormalizada.slice(0, 7) : "sem-data";
}

function nomeMes(chaveMes) {
  if (chaveMes === "sem-data") return "Sem data";

  const [ano, mes] = chaveMes.split("-");
  const dataUTC = new Date(Date.UTC(Number(ano), Number(mes) - 1, 1));

  return dataUTC.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function numero(valor) {
  return Number(valor || 0);
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

function validarPeriodoExportacao(filtros) {
  if (filtros.data) return "";

  if (!filtros.dataInicial && !filtros.dataFinal) {
    return "Informe uma data ou um intervalo de até 3 meses.";
  }

  if (!filtros.dataInicial || !filtros.dataFinal) {
    return "Informe data inicial e data final para consultar por período.";
  }

  if (filtros.dataInicial > filtros.dataFinal) {
    return "Data inicial nao pode ser posterior a data final.";
  }

  const inicio = dataUTC(filtros.dataInicial);
  const fim = dataUTC(filtros.dataFinal);
  const limite = adicionarMeses(inicio, MESES_MAXIMOS_EXPORTACAO);

  return fim > limite ? MENSAGEM_PERIODO_MAXIMO : "";
}


export default function RelatoriosAvancados() {
  const [aba, setAba] = useState("resumo");
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [periodoGrafico, setPeriodoGrafico] = useState(lerUltimoPeriodoRelatorio);
  const [periodoGerado, setPeriodoGerado] = useState("");
  const [metricas, setMetricas] = useState(criarMetricasVazias);
  const [turmas, setTurmas] = useState([]);
  const [termoBuscaAluno, setTermoBuscaAluno] = useState("");
  const [alunosEncontrados, setAlunosEncontrados] = useState([]);
  const [alunoSelecionado, setAlunoSelecionado] = useState(null);
  const [buscaAlunoRealizada, setBuscaAlunoRealizada] = useState(false);
  const [carregandoTurmas, setCarregandoTurmas] = useState(false);
  const [buscandoAluno, setBuscandoAluno] = useState(false);

  const [resumo, setResumo] = useState([]);
  const [mesesAbertos, setMesesAbertos] = useState({});
  const [diasAbertos, setDiasAbertos] = useState({});

  const [justificativas, setJustificativas] = useState([]);
  const [paginaJustificativas, setPaginaJustificativas] = useState(1);
  const [totalPaginasJustificativas, setTotalPaginasJustificativas] = useState(1);
  const [justificativasCarregadas, setJustificativasCarregadas] = useState(false);

  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState("");

  const resumoMensal = useMemo(() => {
    const mapaMeses = resumo.reduce((meses, item) => {
      const dataNormalizada = normalizarDataMySQL(item.data_chamada);
      const mesKey = obterChaveMes(item.data_chamada);
      const diaKey = dataNormalizada || "sem-data";
      const turmaKey = `${diaKey}-${item.turma_id || item.turma_nome || item.id}`;

      if (!meses[mesKey]) {
        meses[mesKey] = {
          chave: mesKey,
          titulo: nomeMes(mesKey),
          totalPresentes: 0,
          totalAusentes: 0,
          totalJustificados: 0,
          totalAtrasos: 0,
          dias: {},
        };
      }

      if (!meses[mesKey].dias[diaKey]) {
        meses[mesKey].dias[diaKey] = {
          chave: diaKey,
          dataFormatada: formatarData(diaKey),
          totalPresentes: 0,
          totalAusentes: 0,
          totalJustificados: 0,
          totalAtrasos: 0,
          turmas: {},
        };
      }

      const presentes = numero(item.total_presentes);
      const ausentes = numero(item.total_ausentes);
      const justificados = numero(item.total_justificados);
      const atrasos = numero(item.total_atrasos);

      meses[mesKey].totalPresentes += presentes;
      meses[mesKey].totalAusentes += ausentes;
      meses[mesKey].totalJustificados += justificados;
      meses[mesKey].totalAtrasos += atrasos;

      meses[mesKey].dias[diaKey].totalPresentes += presentes;
      meses[mesKey].dias[diaKey].totalAusentes += ausentes;
      meses[mesKey].dias[diaKey].totalJustificados += justificados;
      meses[mesKey].dias[diaKey].totalAtrasos += atrasos;

      meses[mesKey].dias[diaKey].turmas[turmaKey] = {
        id: item.id || turmaKey,
        turma_nome: item.turma_nome || "Sem turma",
        materia: item.materia || "",
        total_presentes: presentes,
        total_ausentes: ausentes,
        total_justificados: justificados,
        total_atrasos: atrasos,
      };

      return meses;
    }, {});

    return Object.values(mapaMeses)
      .sort((a, b) => b.chave.localeCompare(a.chave))
      .map((mes) => ({
        ...mes,
        dias: Object.values(mes.dias)
          .sort((a, b) => b.chave.localeCompare(a.chave))
          .map((dia) => ({
            ...dia,
            turmas: Object.values(dia.turmas).sort((a, b) =>
              String(a.turma_nome).localeCompare(String(b.turma_nome), "pt-BR")
            ),
          })),
      }));
  }, [resumo]);

  // Regra de negócio: atrasos são subcategoria de presentes e justificativas
  // são subcategoria de ausentes. O total geral não deve somar subcategorias.
  const totalMetricas = metricas.presentes + metricas.ausentes;

  const percentuais = {
    presencas: totalMetricas ? ((metricas.presentes / totalMetricas) * 100).toFixed(1) : "0.0",
    faltas: totalMetricas ? ((metricas.ausentes / totalMetricas) * 100).toFixed(1) : "0.0",
    justificadas: metricas.ausentes ? ((metricas.justificados / metricas.ausentes) * 100).toFixed(1) : "0.0",
    atrasos: metricas.presentes ? ((metricas.atrasos / metricas.presentes) * 100).toFixed(1) : "0.0",
  };

  const periodoGeradoLabel = PERIODOS_GRAFICO.find((periodo) => periodo.valor === periodoGerado)?.label || "";

  function limparAlunoSelecionado() {
    setAlunoSelecionado(null);
    setAlunosEncontrados([]);
    setBuscaAlunoRealizada(false);
    setTermoBuscaAluno("");
    setFiltros((atual) => ({ ...atual, alunoId: "" }));
  }

  function alterarBuscaAluno(valor) {
    setTermoBuscaAluno(valor);
    setMensagem("");

    if (!alunoSelecionado && !filtros.alunoId) return;

    setAlunoSelecionado(null);
    setAlunosEncontrados([]);
    setBuscaAlunoRealizada(false);
    setFiltros((atual) => ({ ...atual, alunoId: "" }));
  }

  function limparFiltros() {
    setFiltros(filtrosIniciais);
    setAlunoSelecionado(null);
    setAlunosEncontrados([]);
    setBuscaAlunoRealizada(false);
    setTermoBuscaAluno("");
    setMesesAbertos({});
    setDiasAbertos({});
    setPaginaJustificativas(1);
  }

  function alterarFiltro(campo, valor) {
    setMensagem("");

    setFiltros((atual) => {
      const proximos = { ...atual, [campo]: valor };

      if (campo === "data" && valor) {
        proximos.dataInicial = "";
        proximos.dataFinal = "";
      }

      if ((campo === "dataInicial" || campo === "dataFinal") && valor) {
        proximos.data = "";
      }

      if (campo === "turmaId") {
        proximos.alunoId = "";
      }

      return proximos;
    });

    if (campo === "turmaId") {
      setAlunoSelecionado(null);
      setAlunosEncontrados([]);
      setBuscaAlunoRealizada(false);
      setTermoBuscaAluno("");
    }

    setMesesAbertos({});
    setDiasAbertos({});
    setPaginaJustificativas(1);
  }

  async function carregarMetricasPeriodo(periodo) {
    const data = await apiFetch("/api/relatorios/geral-ano", {
      params: { periodo },
    });
    const proximasMetricas = {
      presentes: numero(data.presentes),
      ausentes: numero(data.ausentes),
      justificados: numero(data.justificados),
      atrasos: numero(data.atrasos),
    };
    setMetricas(proximasMetricas);
    return proximasMetricas;
  }

  async function carregarResumoPeriodo(periodo) {
    const data = await apiFetch("/api/relatorios/resumo-mensal", {
      params: { periodo },
    });
    const proximoResumo = data.itens || [];
    setResumo(proximoResumo);
    return proximoResumo;
  }

  async function carregarTurmasRelatorio() {
    setCarregandoTurmas(true);

    try {
      const data = await apiFetch("/api/relatorios/filtros/turmas");
      setTurmas(data.turmas || []);
    } catch (error) {
      registrarErroCliente("relatorios.carregarTurmas", error);
      setMensagem("Não foi possível carregar as turmas dos relatórios.");
    } finally {
      setCarregandoTurmas(false);
    }
  }

  async function buscarAlunosRelatorio() {
    const termo = String(termoBuscaAluno || "").trim();

    if (!filtros.turmaId) {
      setMensagem("Selecione uma turma para pesquisar alunos.");
      setAlunosEncontrados([]);
      setAlunoSelecionado(null);
      setBuscaAlunoRealizada(false);
      setFiltros((atual) => ({ ...atual, alunoId: "" }));
      return;
    }

    if (termo.length < 2) {
      setMensagem("Informe pelo menos 2 caracteres para pesquisar aluno.");
      setAlunosEncontrados([]);
      setAlunoSelecionado(null);
      setBuscaAlunoRealizada(false);
      setFiltros((atual) => ({ ...atual, alunoId: "" }));
      return;
    }

    setBuscandoAluno(true);
    setMensagem("");

    try {
      const data = await apiFetch("/api/relatorios/filtros/alunos", {
        method: "POST",
        body: JSON.stringify({
          busca: termo,
          turmaId: filtros.turmaId,
        }),
      });
      const alunos = data.alunos || [];

      setAlunosEncontrados(alunos);
      setBuscaAlunoRealizada(true);

      if (alunos.length === 1) {
        selecionarAluno(alunos[0]);
        return;
      }

      setAlunoSelecionado(null);
      setFiltros((atual) => ({ ...atual, alunoId: "" }));
    } catch (error) {
      registrarErroCliente("relatorios.pesquisarAluno", error);
      setMensagem("Não foi possível pesquisar alunos no momento.");
    } finally {
      setBuscandoAluno(false);
    }
  }

  function selecionarAluno(aluno) {
    setAlunoSelecionado(aluno);
    setTermoBuscaAluno(aluno.nome || "");
    setAlunosEncontrados([]);
    setBuscaAlunoRealizada(false);
    setFiltros((atual) => ({ ...atual, alunoId: String(aluno.id) }));
  }

  function alternarMes(chaveMes) {
    setMesesAbertos((atual) => ({
      ...atual,
      [chaveMes]: !atual[chaveMes],
    }));
  }

  function alternarDia(chaveDia) {
    setDiasAbertos((atual) => ({
      ...atual,
      [chaveDia]: !atual[chaveDia],
    }));
  }

  async function carregarJustificativas(pagina = paginaJustificativas) {
    const params = new URLSearchParams({
      page: String(pagina),
      limit: "10",
    });

    const data = await apiFetch(`/api/relatorios/justificativas?${params}`);
    setJustificativas(data.itens || []);
    setTotalPaginasJustificativas(numero(data.totalPaginas) || 1);
    setJustificativasCarregadas(true);
  }

  function aplicarCacheRelatorios(cache) {
    setMetricas(cache.metricas);
    setResumo(cache.resumo);
    setPeriodoGerado(cache.periodo || periodoGrafico);
  }

  async function gerarGrafico() {
    setCarregando(true);
    setMensagem("");

    try {
      const cache = lerCacheRelatorios(periodoGrafico);
      if (cache) {
        aplicarCacheRelatorios(cache);
        return;
      }

      const [metricasPeriodo, resumoPeriodo] = await Promise.all([
        carregarMetricasPeriodo(periodoGrafico),
        carregarResumoPeriodo(periodoGrafico),
      ]);
      salvarCacheRelatorios(periodoGrafico, metricasPeriodo, resumoPeriodo);
      setPeriodoGerado(periodoGrafico);
    } catch (error) {
      registrarErroCliente("relatorios.carregarResumo", error);
      setMensagem("Não foi possível carregar o relatório no momento.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    const cache = lerCacheRelatorios(periodoGrafico);
    if (cache) aplicarCacheRelatorios(cache);
  }, []);

  useEffect(() => {
    carregarTurmasRelatorio();
  }, []);

  useEffect(() => {
    if (aba !== "justificativas" || justificativasCarregadas) return;

    carregarJustificativas(1).catch((error) => {
      registrarErroCliente("relatorios.carregarJustificativas", error);
      setMensagem("NÃ£o foi possÃ­vel carregar o histÃ³rico de justificativas.");
    });
  }, [aba, justificativasCarregadas]);

  async function exportarExcel() {
    if (filtros.alunoId && !filtros.turmaId) {
      setMensagem("Selecione uma turma antes de filtrar por aluno.");
      return;
    }

    const erroPeriodo = validarPeriodoExportacao(filtros);

    if (erroPeriodo) {
      setMensagem(erroPeriodo);
      return;
    }

    setCarregando(true);
    setMensagem("");

    try {
      const blob = await apiDownload("/api/relatorios/exportar", {
        method: "POST",
        body: JSON.stringify(filtros),
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `relatorio-frequencia-${dataBrasiliaISO()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      registrarErroCliente("relatorios.exportar", error);
      setMensagem(error.message || "Não foi possível carregar o relatório no momento.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-title-box">
        <h2>Relatórios Avançados</h2>
        <p>Análise anual, filtros combinados, exportação Excel e histórico de justificativas.</p>
      </div>

      {mensagem && <p className="admin-error-message">{mensagem}</p>}

      <div className="admin-tabs">
        <button type="button" className={aba === "resumo" ? "active" : ""} onClick={() => setAba("resumo")}>
          Resumo mensal
        </button>
        <button type="button" className={aba === "justificativas" ? "active" : ""} onClick={() => setAba("justificativas")}>
          Histórico de justificativas
        </button>
      </div>

      {aba === "resumo" && (
        <>
          <div className="filter-panel">
            <label>
              Data específica
              <input
                type="date"
                value={filtros.data}
                onChange={(event) => alterarFiltro("data", event.target.value)}
              />
            </label>

            <label>
              Data inicial
              <input
                type="date"
                value={filtros.dataInicial}
                onChange={(event) => alterarFiltro("dataInicial", event.target.value)}
              />
            </label>

            <label>
              Data final
              <input
                type="date"
                value={filtros.dataFinal}
                onChange={(event) => alterarFiltro("dataFinal", event.target.value)}
              />
            </label>

            <label>
              Turma
              <select value={filtros.turmaId} onChange={(event) => alterarFiltro("turmaId", event.target.value)}>
                <option value="">Todas</option>
                {turmas.map((turma) => (
                  <option key={turma.id} value={turma.id}>
                    {turma.nome}
                  </option>
                ))}
              </select>
              {carregandoTurmas && <small>Carregando turmas...</small>}
            </label>

            <div className="admin-report-student-filter">
              <label htmlFor="busca-aluno-relatorio">Aluno</label>
              <div className="admin-report-search-row">
                <input
                  id="busca-aluno-relatorio"
                  type="search"
                  value={filtros.turmaId ? termoBuscaAluno : ""}
                  placeholder={filtros.turmaId ? "Pesquisar aluno" : "Selecione uma turma"}
                  disabled={!filtros.turmaId}
                  readOnly={!filtros.turmaId}
                  onChange={(event) => alterarBuscaAluno(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      buscarAlunosRelatorio();
                    }
                  }}
                />
                <button
                  className="admin-icon-btn"
                  type="button"
                  title={filtros.turmaId ? "Pesquisar aluno" : "Selecione uma turma para pesquisar alunos"}
                  aria-label={filtros.turmaId ? "Pesquisar aluno" : "Selecione uma turma para pesquisar alunos"}
                  onClick={buscarAlunosRelatorio}
                  disabled={!filtros.turmaId || buscandoAluno}
                >
                  <Search size={16} />
                </button>
                {filtros.turmaId && (alunoSelecionado || filtros.alunoId) && (
                  <button
                    className="admin-icon-btn secondary"
                    type="button"
                    title="Limpar aluno"
                    aria-label="Limpar aluno"
                    onClick={limparAlunoSelecionado}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {!filtros.turmaId && <small>Selecione uma turma para pesquisar alunos.</small>}

              {filtros.turmaId && buscandoAluno && <small>Pesquisando...</small>}

              {filtros.turmaId && alunoSelecionado && (
                <small className="admin-report-selected-message">Aluno selecionado</small>
              )}

              {filtros.turmaId && buscaAlunoRealizada && alunosEncontrados.length === 0 && (
                <small className="admin-report-search-empty">Aluno não encontrado nessa turma</small>
              )}

              {filtros.turmaId && alunosEncontrados.length > 1 && (
                <div className="admin-report-student-results">
                  {alunosEncontrados.map((aluno) => (
                    <button
                      type="button"
                      key={aluno.id}
                      className={Number(filtros.alunoId) === Number(aluno.id) ? "active" : ""}
                      onClick={() => selecionarAluno(aluno)}
                    >
                      <span>{aluno.nome}</span>
                      <small>{aluno.turma_nome || aluno.turma || "Sem turma"}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="admin-report-actions">
              <button className="admin-primary-btn" type="button" onClick={exportarExcel} disabled={carregando}>
                {carregando ? "Processando..." : "Exportar Excel"}
              </button>
              <button className="admin-cancel-btn" type="button" onClick={limparFiltros}>
                Limpar filtros
              </button>
            </div>
          </div>

          <div className="filter-panel">
            <label>
              Periodo dos graficos
              <select value={periodoGrafico} onChange={(event) => setPeriodoGrafico(event.target.value)}>
                {PERIODOS_GRAFICO.map((periodo) => (
                  <option key={periodo.valor} value={periodo.valor}>
                    {periodo.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="admin-report-actions">
              <button className="admin-primary-btn" type="button" onClick={gerarGrafico} disabled={carregando}>
                {carregando ? "Processando..." : "Gerar Grafico"}
              </button>
            </div>
          </div>

          {!periodoGerado && (
            <div className="admin-chart-box">
              <h3>Graficos e metricas</h3>
              <p>Selecione um periodo e clique em Gerar Grafico para carregar os dados.</p>
            </div>
          )}

          {periodoGerado && (
          <>
          <div className="admin-cards-grid">
            <article className="admin-card">
              <span>Presenças totais no ano</span>
              <strong>{metricas.presentes}</strong>
              <small>{percentuais.presencas}% do total</small>
            </article>

            <article className="admin-card">
              <span>Faltas gerais do ano</span>
              <strong>{metricas.ausentes}</strong>
              <small>{percentuais.faltas}% do total</small>
            </article>

            <article className="admin-card">
              <span>Faltas justificadas</span>
              <strong>{metricas.justificados}</strong>
              <small>{percentuais.justificadas}% das faltas · incluídas nas ausências</small>
            </article>

            <article className="admin-card">
              <span>Atrasos registrados</span>
              <strong>{metricas.atrasos}</strong>
              <small>{percentuais.atrasos}% das presenças · incluídos nas presenças</small>
            </article>
          </div>

          <div className="admin-chart-box">
            <h3>Presenças e faltas com suas subcategorias no período</h3>

            <MetricProgressChart
              ariaLabel="Composição dos indicadores no período"
              itens={[
                {
                  id: "presencas",
                  rotulo: "Presenças",
                  valor: percentuais.presencas,
                  tom: "success",
                  casasDecimais: 1,
                  detalhe: `${metricas.presentes} registros`,
                },
                {
                  id: "ausencias",
                  rotulo: "Ausências",
                  valor: percentuais.faltas,
                  tom: "danger",
                  casasDecimais: 1,
                  detalhe: `${metricas.ausentes} registros`,
                },
                {
                  id: "justificados",
                  rotulo: "Justificados nas faltas",
                  valor: percentuais.justificadas,
                  tom: "info",
                  casasDecimais: 1,
                  detalhe: `${metricas.justificados} registros · percentual das ausências`,
                },
                {
                  id: "atrasos",
                  rotulo: "Atrasos nas presenças",
                  valor: percentuais.atrasos,
                  tom: "warning",
                  casasDecimais: 1,
                  detalhe: `${metricas.atrasos} registros · percentual das presenças`,
                },
              ]}
            />
          </div>

          <article className="admin-timeline-box">
            <h3>Resumo mensal de chamadas</h3>
            <p className="admin-muted-text">Clique em um mês para visualizar os dias e depois em um dia para ver as turmas.</p>

            <div className="admin-monthly-accordion">
              {resumoMensal.map((mes) => (
                <div className="admin-month-card" key={mes.chave}>
                  <button
                    type="button"
                    className="admin-month-header"
                    onClick={() => alternarMes(mes.chave)}
                    aria-expanded={Boolean(mesesAbertos[mes.chave])}
                  >
                    <span>
                      <strong>{mes.titulo}</strong>
                      <small>{mes.dias.length} dia(s) com chamada</small>
                    </span>
                    <span className="admin-month-totals">
                      <b>{mes.totalPresentes}</b> presenças · <b>{mes.totalAusentes}</b> faltas · <b>{mes.totalJustificados}</b> justificativas · <b>{mes.totalAtrasos}</b> atrasos
                    </span>
                    <i>{mesesAbertos[mes.chave] ? "−" : "+"}</i>
                  </button>

                  {mesesAbertos[mes.chave] && (
                    <div className="admin-days-list">
                      {mes.dias.map((dia) => (
                        <div className="admin-day-card" key={dia.chave}>
                          <button
                            type="button"
                            className="admin-day-header"
                            onClick={() => alternarDia(`${mes.chave}-${dia.chave}`)}
                            aria-expanded={Boolean(diasAbertos[`${mes.chave}-${dia.chave}`])}
                          >
                            <span>
                              <strong>{dia.dataFormatada}</strong>
                              <small>{dia.turmas.length} turma(s)</small>
                            </span>
                            <span className="admin-day-totals">
                              {dia.totalPresentes} P · {dia.totalAusentes} F · {dia.totalJustificados} J · {dia.totalAtrasos} A
                            </span>
                            <i>{diasAbertos[`${mes.chave}-${dia.chave}`] ? "−" : "+"}</i>
                          </button>

                          {diasAbertos[`${mes.chave}-${dia.chave}`] && (
                            <div className="admin-class-summary-list">
                              {dia.turmas.map((turma) => (
                                <div className="admin-class-summary-card" key={turma.id}>
                                  <div>
                                    <strong>{turma.turma_nome}</strong>
                                    {turma.materia && <small>{turma.materia}</small>}
                                  </div>

                                  <div className="admin-class-summary-numbers">
                                    <span><b>{turma.total_presentes}</b> Presenças</span>
                                    <span><b>{turma.total_ausentes}</b> Faltas</span>
                                    <span><b>{turma.total_justificados}</b> Justificativas</span>
                                    <span><b>{turma.total_atrasos}</b> Atrasos</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {resumoMensal.length === 0 && (
                <p>Nenhuma chamada confirmada encontrada neste ano.</p>
              )}
            </div>
          </article>
          </>
          )}
        </>
      )}

      {aba === "justificativas" && (
        <article className="admin-timeline-box">
          <h3>Histórico de justificativas</h3>

          <div className="admin-justificativas-list">
            {justificativas.map((aluno) => (
              <div className="admin-justificativa-card" key={aluno.aluno_id}>
                <div>
                  <strong>{aluno.aluno_nome}</strong>
                  <small>{aluno.turma_nome || "Sem turma"}</small>
                </div>

                <ul>
                  {(aluno.justificativas || []).map((item) => (
                    <li key={`${aluno.aluno_id}-${item.data_chamada}-${item.motivo}`}>
                      <span>{formatarData(item.data_chamada)}</span>
                      <p>{item.motivo}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {justificativas.length === 0 && (
              <p>Nenhuma justificativa encontrada.</p>
            )}
          </div>

          <div className="admin-pagination">
            <button
              className="admin-cancel-btn"
              type="button"
              disabled={paginaJustificativas <= 1}
              onClick={() => {
                const proxima = paginaJustificativas - 1;
                setPaginaJustificativas(proxima);
                carregarJustificativas(proxima);
              }}
            >
              Anterior
            </button>

            <span>Página {paginaJustificativas} de {totalPaginasJustificativas}</span>

            <button
              className="admin-primary-btn"
              type="button"
              disabled={paginaJustificativas >= totalPaginasJustificativas}
              onClick={() => {
                const proxima = paginaJustificativas + 1;
                setPaginaJustificativas(proxima);
                carregarJustificativas(proxima);
              }}
            >
              Próxima
            </button>
          </div>
        </article>
      )}
    </section>
  );
}
