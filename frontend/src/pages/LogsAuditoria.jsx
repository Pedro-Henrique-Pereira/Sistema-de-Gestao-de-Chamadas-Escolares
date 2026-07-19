import { useEffect, useMemo, useState } from "react";
import { CalendarClock, FilterX, Search, ShieldCheck } from "lucide-react";
import { buscarLogsAuditoria, buscarOpcoesAuditoria } from "../services/auditoriaService";
import { registrarErroCliente } from "../utils/clientLogger";
import "../styles/LogsAuditoria.css";

const FILTROS_INICIAIS = {
  busca: "",
  acao: "",
  perfil: "",
  resultado: "",
  entidade: "",
  dataInicio: "",
  dataFim: "",
};

const LIMPEZA_INICIAL = {
  ultima_execucao_em: null,
  ultima_quantidade_removida: 0,
  proxima_execucao_em: null,
};

function formatarRotulo(valor) {
  return String(valor || "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/(^|\s)\p{L}/gu, (letra) => letra.toUpperCase());
}

const CORRECOES_TEXTO_LEGADO = [
  ["\u00c3\u00a1", "á"], ["\u00c3\u00a0", "à"], ["\u00c3\u00a2", "â"],
  ["\u00c3\u00a3", "ã"], ["\u00c3\u00a9", "é"], ["\u00c3\u00aa", "ê"],
  ["\u00c3\u00ad", "í"], ["\u00c3\u00b3", "ó"], ["\u00c3\u00b4", "ô"],
  ["\u00c3\u00b5", "õ"], ["\u00c3\u00ba", "ú"], ["\u00c3\u00a7", "ç"],
  ["\u00c3\u0081", "Á"], ["\u00c3\u0089", "É"], ["\u00c3\u008d", "Í"],
  ["\u00c3\u0093", "Ó"], ["\u00c3\u009a", "Ú"], ["\u00c3\u0087", "Ç"],
];

function corrigirTextoLegado(valor) {
  return CORRECOES_TEXTO_LEGADO.reduce(
    (texto, [origem, destino]) => texto.replaceAll(origem, destino),
    String(valor || "")
  );
}

function formatarDataHora(valor) {
  if (!valor) return "Não informada";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "Não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

function AvisoLimpeza({ ultimaLimpeza }) {
  const limpeza = ultimaLimpeza || LIMPEZA_INICIAL;
  const executada = Boolean(limpeza.ultima_execucao_em);
  return (
    <div className="audit-cleanup-banner" role="status">
      <span className="audit-cleanup-icon" aria-hidden="true"><CalendarClock size={22} /></span>
      <div>
        <strong>Retenção e limpeza automática</strong>
        <p>
          {executada
            ? `Última limpeza realizada em ${formatarDataHora(limpeza.ultima_execucao_em)}. Foram removidos ${Number(limpeza.ultima_quantidade_removida || 0).toLocaleString("pt-BR")} registros antigos.`
            : "Nenhuma limpeza automática foi executada até o momento. O backend iniciará a primeira execução assim que a rotina persistente estiver vencida."}
        </p>
      </div>
    </div>
  );
}

export default function LogsAuditoria() {
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [filtrosAplicados, setFiltrosAplicados] = useState(FILTROS_INICIAIS);
  const [pagina, setPagina] = useState(1);
  const [logs, setLogs] = useState([]);
  const [paginacao, setPaginacao] = useState({ paginaAtual: 1, totalPaginas: 1, totalRegistros: 0 });
  const [ultimaLimpeza, setUltimaLimpeza] = useState(LIMPEZA_INICIAL);
  const [opcoes, setOpcoes] = useState({ acoes: [], entidades: [], perfis: [], resultados: ["sucesso", "falha"] });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const parametros = useMemo(() => ({
    ...filtrosAplicados,
    page: pagina,
    limit: 25,
  }), [filtrosAplicados, pagina]);

  useEffect(() => {
    let ativo = true;
    buscarOpcoesAuditoria()
      .then((dados) => ativo && setOpcoes(dados))
      .catch((error) => registrarErroCliente("auditoria.carregarOpcoes", error));
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro("");

    buscarLogsAuditoria(parametros)
      .then((dados) => {
        if (!ativo) return;
        setLogs(Array.isArray(dados.logs) ? dados.logs : []);
        setPaginacao(dados.paginacao || { paginaAtual: 1, totalPaginas: 1, totalRegistros: 0 });
        setUltimaLimpeza(dados.ultimaLimpeza || LIMPEZA_INICIAL);
      })
      .catch((error) => {
        if (!ativo) return;
        setErro(error.message || "Não foi possível carregar os logs de auditoria.");
        registrarErroCliente("auditoria.carregarLogs", error);
      })
      .finally(() => ativo && setCarregando(false));

    return () => { ativo = false; };
  }, [parametros]);

  function atualizarFiltro(event) {
    const { name, value } = event.target;
    setFiltros((atuais) => ({ ...atuais, [name]: value }));
  }

  function aplicarFiltros(event) {
    event.preventDefault();
    setPagina(1);
    setFiltrosAplicados(filtros);
  }

  function limparFiltros() {
    setFiltros(FILTROS_INICIAIS);
    setFiltrosAplicados(FILTROS_INICIAIS);
    setPagina(1);
  }

  return (
    <section className="audit-page" aria-labelledby="audit-title">
      <AvisoLimpeza ultimaLimpeza={ultimaLimpeza} />

      <header className="audit-heading">
        <div>
          <span className="audit-eyebrow"><ShieldCheck size={15} /> Integridade administrativa</span>
          <h2 id="audit-title">Logs de Auditoria</h2>
          <p>Consulte alterações registradas exclusivamente pelo servidor. Os eventos são imutáveis nesta interface.</p>
        </div>
        <div className="audit-total" aria-label={`${paginacao.totalRegistros} eventos encontrados`}>
          <strong>{Number(paginacao.totalRegistros || 0).toLocaleString("pt-BR")}</strong>
          <span>eventos encontrados</span>
        </div>
      </header>

      <form className="audit-filters" onSubmit={aplicarFiltros}>
        <label className="audit-search-field">
          <span>Responsável</span>
          <div><Search size={17} aria-hidden="true" /><input name="busca" value={filtros.busca} onChange={atualizarFiltro} placeholder="Buscar por nome" maxLength={100} /></div>
        </label>

        <label><span>Ação</span><select name="acao" value={filtros.acao} onChange={atualizarFiltro}><option value="">Todas</option>{opcoes.acoes.map((item) => <option key={item} value={item}>{formatarRotulo(item)}</option>)}</select></label>
        <label><span>Perfil</span><select name="perfil" value={filtros.perfil} onChange={atualizarFiltro}><option value="">Todos</option>{opcoes.perfis.map((item) => <option key={item} value={item}>{formatarRotulo(item)}</option>)}</select></label>
        <label><span>Resultado</span><select name="resultado" value={filtros.resultado} onChange={atualizarFiltro}><option value="">Todos</option>{opcoes.resultados.map((item) => <option key={item} value={item}>{formatarRotulo(item)}</option>)}</select></label>
        <label><span>Entidade</span><select name="entidade" value={filtros.entidade} onChange={atualizarFiltro}><option value="">Todas</option>{opcoes.entidades.map((item) => <option key={item} value={item}>{formatarRotulo(item)}</option>)}</select></label>
        <label><span>Data inicial</span><input type="date" name="dataInicio" value={filtros.dataInicio} onChange={atualizarFiltro} /></label>
        <label><span>Data final</span><input type="date" name="dataFim" value={filtros.dataFim} onChange={atualizarFiltro} min={filtros.dataInicio || undefined} /></label>

        <div className="audit-filter-actions">
          <button className="audit-apply" type="submit">Aplicar filtros</button>
          <button className="audit-clear" type="button" onClick={limparFiltros}><FilterX size={17} /> Limpar</button>
        </div>
      </form>

      {erro && <div className="audit-error" role="alert"><strong>Falha ao carregar a auditoria.</strong><span>{erro}</span><button type="button" onClick={() => setFiltrosAplicados({ ...filtrosAplicados })}>Tentar novamente</button></div>}

      {!erro && carregando && <div className="audit-loading" role="status"><span /><p>Consultando eventos protegidos no servidor...</p></div>}

      {!erro && !carregando && logs.length === 0 && <div className="audit-empty"><ShieldCheck size={32} /><h3>Nenhum evento encontrado</h3><p>Ajuste os filtros ou aguarde o registro de uma nova operação relevante.</p></div>}

      {!erro && !carregando && logs.length > 0 && (
        <div className="audit-table-shell">
          <table className="audit-table">
            <thead><tr><th>Data e hora</th><th>Responsável</th><th>Ação</th><th>Entidade</th><th>Resultado</th><th>IP</th></tr></thead>
            <tbody>{logs.map((log) => (
              <tr key={log.id}>
                <td data-label="Data e hora"><time>{formatarDataHora(log.criado_em)}</time></td>
                <td data-label="Responsável"><strong>{corrigirTextoLegado(log.usuario_nome)}</strong><small>{formatarRotulo(log.usuario_perfil)}</small></td>
                <td data-label="Ação"><span className="audit-action-name">{formatarRotulo(log.acao_tipo)}</span><p>{corrigirTextoLegado(log.descricao)}</p></td>
                <td data-label="Entidade"><strong>{formatarRotulo(log.entidade_tipo)}</strong>{log.entidade_id && <small>ID {log.entidade_id}</small>}</td>
                <td data-label="Resultado"><span className={`audit-result ${log.resultado}`}>{formatarRotulo(log.resultado)}</span></td>
                <td data-label="IP"><code>{log.ip_origem || "Não disponível"}</code></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {!erro && !carregando && paginacao.totalPaginas > 1 && (
        <nav className="audit-pagination" aria-label="Paginação dos logs">
          <button type="button" disabled={pagina <= 1} onClick={() => setPagina((atual) => Math.max(atual - 1, 1))}>Anterior</button>
          <span>Página <strong>{paginacao.paginaAtual}</strong> de {paginacao.totalPaginas}</span>
          <button type="button" disabled={pagina >= paginacao.totalPaginas} onClick={() => setPagina((atual) => Math.min(atual + 1, paginacao.totalPaginas))}>Próxima</button>
        </nav>
      )}
    </section>
  );
}
