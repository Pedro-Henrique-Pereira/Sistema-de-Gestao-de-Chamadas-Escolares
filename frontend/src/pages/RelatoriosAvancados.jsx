import { useEffect, useMemo, useState } from "react";
import { apiDownload, apiFetch } from "../services/api";

const filtrosIniciais = {
  data: "",
  dataInicial: "",
  dataFinal: "",
  turmaId: "",
  alunoId: "",
};

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


export default function RelatoriosAvancados({ turmas = [], alunos = [] }) {
  const [aba, setAba] = useState("resumo");
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [metricas, setMetricas] = useState({
    presentes: 0,
    ausentes: 0,
    justificados: 0,
    atrasos: 0,
  });

  const [resumo, setResumo] = useState([]);
  const [mesesAbertos, setMesesAbertos] = useState({});
  const [diasAbertos, setDiasAbertos] = useState({});

  const [justificativas, setJustificativas] = useState([]);
  const [paginaJustificativas, setPaginaJustificativas] = useState(1);
  const [totalPaginasJustificativas, setTotalPaginasJustificativas] = useState(1);

  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState("");

  const alunosDoFiltro = useMemo(() => {
    if (!filtros.turmaId) return alunos;
    return alunos.filter((aluno) => Number(aluno.turma_id || aluno.turmaId) === Number(filtros.turmaId));
  }, [alunos, filtros.turmaId]);

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

  const maiorMetrica = Math.max(metricas.presentes, metricas.ausentes, metricas.justificados, metricas.atrasos, 1);

  function limparFiltros() {
    setFiltros(filtrosIniciais);
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

    setMesesAbertos({});
    setDiasAbertos({});
    setPaginaJustificativas(1);
  }

  async function carregarMetricasAno() {
    const data = await apiFetch("/api/relatorios/geral-ano");
    setMetricas({
      presentes: numero(data.presentes),
      ausentes: numero(data.ausentes),
      justificados: numero(data.justificados),
      atrasos: numero(data.atrasos),
    });
  }

  async function carregarResumoMensal() {
    const data = await apiFetch("/api/relatorios/resumo-mensal");
    setResumo(data.itens || []);
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
  }

  async function carregarDadosIniciais() {
    setCarregando(true);
    setMensagem("");

    try {
      await Promise.all([
        carregarMetricasAno(),
        carregarResumoMensal(),
        carregarJustificativas(1),
      ]);
    } catch (error) {
      console.error("Erro ao carregar relatórios avançados:", error);
      setMensagem("Não foi possível carregar o relatório no momento.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarDadosIniciais();
  }, []);

  async function exportarExcel() {
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
      link.download = `relatorio-frequencia-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Erro ao exportar relatório:", error);
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
                disabled={Boolean(filtros.data)}
                onChange={(event) => alterarFiltro("dataInicial", event.target.value)}
              />
            </label>

            <label>
              Data final
              <input
                type="date"
                value={filtros.dataFinal}
                disabled={Boolean(filtros.data)}
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
            </label>

            <label>
              Aluno
              <select value={filtros.alunoId} onChange={(event) => alterarFiltro("alunoId", event.target.value)}>
                <option value="">Todos</option>
                {alunosDoFiltro.map((aluno) => (
                  <option key={aluno.id} value={aluno.id}>
                    {aluno.nome}
                  </option>
                ))}
              </select>
            </label>

            <div className="admin-report-actions">
              <button className="admin-primary-btn" type="button" onClick={exportarExcel} disabled={carregando}>
                {carregando ? "Processando..." : "Exportar Excel"}
              </button>
              <button className="admin-cancel-btn" type="button" onClick={limparFiltros}>
                Limpar filtros
              </button>
            </div>
          </div>

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
              <small>{percentuais.justificadas}% do total</small>
            </article>

            <article className="admin-card">
              <span>Atrasos registrados</span>
              <strong>{metricas.atrasos}</strong>
              <small>{percentuais.atrasos}% do total</small>
            </article>
          </div>

          <div className="admin-chart-box">
            <h3>Presenças, faltas, justificativas e atrasos no ano</h3>

            <div className="admin-chart annual-chart">
              <div className="bar-presenca" style={{ height: `${Math.max((metricas.presentes / maiorMetrica) * 100, 12)}%` }}>
                <span>Presenças</span>
                <strong>{percentuais.presencas}%</strong>
              </div>

              <div className="bar-falta" style={{ height: `${Math.max((metricas.ausentes / maiorMetrica) * 100, 12)}%` }}>
                <span>Ausências</span>
                <strong>{percentuais.faltas}%</strong>
              </div>

              <div className="bar-justificada" style={{ height: `${Math.max((metricas.justificados / maiorMetrica) * 100, 12)}%` }}>
                <span>Justificados</span>
                <strong>{percentuais.justificadas}%</strong>
              </div>

              <div className="bar-atraso" style={{ height: `${Math.max((metricas.atrasos / maiorMetrica) * 100, 12)}%` }}>
                <span>Atraso</span>
                <strong>{percentuais.atrasos}%</strong>
              </div>
            </div>
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
