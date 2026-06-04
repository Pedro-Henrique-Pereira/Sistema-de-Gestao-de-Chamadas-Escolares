import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LogOut, Pencil, Search } from "lucide-react";
import api from "../services/api";
import { pedagogaService } from "../services/pedagogaService";
import AutomacaoFeedbackModal from "../components/AutomacaoFeedbackModal";
import { buscarConfiguracaoEscola } from "../services/configuracoesEscolaService";
import RelatoriosAvancados from "./RelatoriosAvancados";
import "../styles/Admin.css";
import "../styles/Pedagoga.css";

const hojeISO = () => new Date().toISOString().slice(0, 10);

function normalizarStatus(aluno) {
  return String(aluno.status_presenca || aluno.status || "ausente").toLowerCase();
}

function normalizarBuscaResponsavel(valor = "") {
  return String(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function apenasDigitos(valor = "") {
  return String(valor).replace(/\D/g, "");
}

function pontuarBuscaResponsavel(responsavel, termo) {
  const texto = normalizarBuscaResponsavel(termo);
  const digitos = apenasDigitos(termo);

  if (!texto && !digitos) return 0;

  const nomeResponsavel = normalizarBuscaResponsavel(responsavel.nome);
  const contatoResponsavel = normalizarBuscaResponsavel(responsavel.contato);
  const contatoDigitos = apenasDigitos(responsavel.contato);
  const alunos = Array.isArray(responsavel.alunos) ? responsavel.alunos : [];
  const nomesAlunos = alunos.map((aluno) => normalizarBuscaResponsavel(aluno.nome));

  if (digitos.length > 0 && contatoDigitos === digitos) return 100;
  if (nomeResponsavel === texto || nomesAlunos.some((nome) => nome === texto)) return 95;
  if (digitos.length > 0 && contatoDigitos.includes(digitos)) return 90;
  if (nomeResponsavel.startsWith(texto) || nomesAlunos.some((nome) => nome.startsWith(texto))) return 80;
  if (nomeResponsavel.includes(texto) || nomesAlunos.some((nome) => nome.includes(texto))) return 70;
  if (contatoResponsavel.includes(texto)) return 60;

  return 0;
}

function Pedagoga() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activePage, setActivePage] = useState("dashboard");
  const [usuarioLogado, setUsuarioLogado] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [chamadas, setChamadas] = useState([]);
  const [chamadasConfirmadas, setChamadasConfirmadas] = useState([]);
  const [chamadaConfirmadaEditando, setChamadaConfirmadaEditando] = useState(null);
  const [turmasPendentes, setTurmasPendentes] = useState([]);
  const [responsaveis, setResponsaveis] = useState([]);
  const [buscaResponsaveis, setBuscaResponsaveis] = useState("");
  const [buscaResponsaveisDebounced, setBuscaResponsaveisDebounced] = useState("");
  const [justificativas, setJustificativas] = useState({});
  const [chamadasAbertas, setChamadasAbertas] = useState({});
  const [justificativasAbertas, setJustificativasAbertas] = useState({});
  const [turmasResponsaveisAbertas, setTurmasResponsaveisAbertas] = useState({});
  const [responsavelEditando, setResponsavelEditando] = useState(null);
  const [turmaPedagogica, setTurmaPedagogica] = useState("");
  const [chamadaEditando, setChamadaEditando] = useState(null);
  const [alunosPedagogicos, setAlunosPedagogicos] = useState({});
  const [configForm, setConfigForm] = useState({ nome: "", email: "", senha: "" });
  const [loading, setLoading] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [configAtraso, setConfigAtraso] = useState({ horarioLimiteAtraso: "07:45", atrasoLiberado: false, horarioServidor: "" });
  const [relatorioTurmas, setRelatorioTurmas] = useState([]);
  const [relatorioAlunos, setRelatorioAlunos] = useState([]);
  const [mensagemWhatsappTexto, setMensagemWhatsappTexto] = useState("");
  const [mensagemWhatsappModalAberto, setMensagemWhatsappModalAberto] = useState(false);
  const [maquinaPadraoChamadas, setMaquinaPadraoChamadas] = useState("");
  const [maquinasPermitidasChamadas, setMaquinasPermitidasChamadas] = useState([1, 2]);
  const [salvandoMaquinaPadrao, setSalvandoMaquinaPadrao] = useState(false);
  const [automacaoModal, setAutomacaoModal] = useState({ aberto: false, ids: [] });
  const chamadasRefs = useRef({});
  const justificativasRefs = useRef({});
  const responsaveisRefs = useRef({});
  const primeiraBuscaResponsavelAplicadaRef = useRef(false);
  const [responsavelDestacado, setResponsavelDestacado] = useState(null);

  const menuItems = [
    { id: "dashboard", label: "Painel Principal" },
    { id: "chamadas", label: "Chamadas" },
    { id: "responsaveis", label: "Responsáveis" },
    { id: "relatorios", label: "Relatórios" },
    { id: "configuracoes", label: "Configurações" },
  ];

  async function carregarUsuarioLogado() {
    const { data } = await api.get("/api/auth/me");
    const usuario = data?.usuario;

    if (!usuario || !["pedagoga", "administracao"].includes(usuario.tipo)) {
      window.location.href = "/login";
      return;
    }

    setUsuarioLogado(usuario);
    setConfigForm({ nome: usuario.nome || "", email: usuario.email || "", senha: "" });
  }

  async function carregarDashboard() {
    const { data } = await pedagogaService.dashboard();
    setDashboard(data);
  }

  async function carregarChamadas() {
    const [{ data: chamadasData }, { data: confirmadasData }, { data: turmasData }] = await Promise.all([
      pedagogaService.chamadasPendentes(),
      pedagogaService.chamadasConfirmadas(),
      pedagogaService.turmasPendentes(),
    ]);
    setChamadas(chamadasData.chamadas || []);
    setChamadasConfirmadas(confirmadasData.chamadas || []);
    setTurmasPendentes(turmasData.turmas || []);
  }

  async function carregarResponsaveis(busca = buscaResponsaveis) {
    const termo = String(busca || "").trim();
    const { data } = await api.get("/api/pedagoga/responsaveis", {
      params: termo ? { busca: termo } : {},
    });
    const lista = data.responsaveis || [];
    setResponsaveis(lista);
    return lista;
  }

  function localizarResponsavel(event) {
    event.preventDefault();
    setBuscaResponsaveisDebounced(buscaResponsaveis);
    aplicarFocoBuscaResponsaveis(buscaResponsaveis, responsaveis);
  }

  async function carregarConfiguracaoAtraso() {
    const data = await buscarConfiguracaoEscola();
    setConfigAtraso({
      horarioLimiteAtraso: String(data.horarioLimiteAtraso || data.horario_limite_atraso || "07:45").slice(0, 5),
      atrasoLiberado: Boolean(data.atraso_liberado),
      horarioServidor: String(data.horario_servidor || "").slice(0, 5),
    });
  }

  async function carregarMensagemWhatsapp() {
    const { data } = await pedagogaService.obterMensagemWhatsApp();
    setMensagemWhatsappTexto(data.texto || "");
  }

  async function carregarPreferenciasPedagoga() {
    const { data } = await pedagogaService.obterPreferencias();
    const maquinas = Array.isArray(data.maquinasPermitidas) && data.maquinasPermitidas.length
      ? data.maquinasPermitidas.map(Number)
      : [1, 2];
    setMaquinasPermitidasChamadas(maquinas);
    setMaquinaPadraoChamadas(data.maquinaPadraoChamadas ? Number(data.maquinaPadraoChamadas) : "");
  }

  async function salvarMaquinaPadraoChamadas(novaMaquina) {
    const maquina = Number(novaMaquina);
    if (!maquinasPermitidasChamadas.includes(maquina)) return;

    try {
      setSalvandoMaquinaPadrao(true);
      const { data } = await pedagogaService.salvarMaquinaPadraoChamadas(maquina);
      setMaquinaPadraoChamadas(Number(data.maquinaPadraoChamadas || maquina));
      setMensagem(data.mensagem || `Máquina ${maquina} salva para este perfil.`);
    } catch (error) {
      setMensagem(error.message || "Erro ao salvar máquina padrão.");
    } finally {
      setSalvandoMaquinaPadrao(false);
    }
  }

  async function carregarDadosRelatoriosPedagogo() {
    const { data } = await api.get("/api/pedagoga/relatorios/dados");
    setRelatorioTurmas(data.turmas || []);
    setRelatorioAlunos(data.alunos || []);
  }

  async function carregarTudo() {
    try {
      setLoading(true);
      await Promise.all([carregarUsuarioLogado(), carregarDashboard(), carregarChamadas(), carregarResponsaveis(), carregarConfiguracaoAtraso(), carregarDadosRelatoriosPedagogo(), carregarMensagemWhatsapp(), carregarPreferenciasPedagoga()]);
    } catch (error) {
      window.location.href = "/login";
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregarTudo();
  }, []);


  useEffect(() => {
    if (!responsavelDestacado || activePage !== "responsaveis") return;

    const timer = window.setTimeout(() => {
      responsaveisRefs.current[responsavelDestacado]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [responsavelDestacado, responsaveis, activePage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBuscaResponsaveisDebounced(buscaResponsaveis);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [buscaResponsaveis]);

  const buscaResponsaveisAtiva = useMemo(() => {
    const termo = String(buscaResponsaveisDebounced || "").trim();
    return Boolean(normalizarBuscaResponsavel(termo) || apenasDigitos(termo));
  }, [buscaResponsaveisDebounced]);

  const responsaveisFiltrados = useMemo(() => {
    const termo = String(buscaResponsaveisDebounced || "").trim();

    if (!buscaResponsaveisAtiva) return responsaveis;

    return responsaveis
      .map((responsavel, indice) => ({
        responsavel,
        indice,
        pontuacao: pontuarBuscaResponsavel(responsavel, termo),
      }))
      .filter((item) => item.pontuacao > 0)
      .sort((a, b) => b.pontuacao - a.pontuacao || a.indice - b.indice)
      .map((item) => item.responsavel);
  }, [responsaveis, buscaResponsaveisDebounced, buscaResponsaveisAtiva]);

  function aplicarFocoBuscaResponsaveis(termoBusca, listaResponsaveis) {
    const termo = String(termoBusca || "").trim();
    const termoNormalizado = normalizarBuscaResponsavel(termo);
    const digitos = apenasDigitos(termo);

    if (!termoNormalizado && !digitos) {
      setTurmasResponsaveisAbertas({});
      setResponsavelDestacado(null);
      primeiraBuscaResponsavelAplicadaRef.current = false;
      return;
    }

    const resultados = listaResponsaveis
      .map((responsavel, indice) => ({
        responsavel,
        indice,
        pontuacao: pontuarBuscaResponsavel(responsavel, termo),
      }))
      .filter((item) => item.pontuacao > 0)
      .sort((a, b) => b.pontuacao - a.pontuacao || a.indice - b.indice)
      .map((item) => item.responsavel);

    if (!resultados.length) {
      setTurmasResponsaveisAbertas({});
      setResponsavelDestacado(null);
      return;
    }

    const turmasEncontradas = resultados.reduce((acc, responsavel) => {
      acc[responsavel.turma_id || "sem-turma"] = true;
      return acc;
    }, {});

    const primeiro = resultados[0];
    const turmaEncontrada = primeiro.turma_id || "sem-turma";
    const chave = `${turmaEncontrada}-${primeiro.id}`;

    setTurmasResponsaveisAbertas(turmasEncontradas);
    setResponsavelDestacado(chave);

    window.setTimeout(() => {
      responsaveisRefs.current[chave]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, primeiraBuscaResponsavelAplicadaRef.current ? 80 : 160);

    primeiraBuscaResponsavelAplicadaRef.current = true;
  }

  useEffect(() => {
    if (activePage !== "responsaveis") return;
    aplicarFocoBuscaResponsaveis(buscaResponsaveisDebounced, responsaveis);
  }, [activePage, buscaResponsaveisDebounced, responsaveis]);

  const responsaveisPorTurma = useMemo(() => {
    const turmas = new Map();

    responsaveisFiltrados.forEach((responsavel) => {
      const chaveTurma = responsavel.turma_id || "sem-turma";
      const turmaNome = responsavel.turma_nome || "Sem turma vinculada";
      const turma = turmas.get(chaveTurma) || {
        turma_id: chaveTurma,
        turma_nome: turmaNome,
        responsaveis: [],
      };

      turma.responsaveis.push(responsavel);
      turmas.set(chaveTurma, turma);
    });

    return Array.from(turmas.values()).sort((a, b) =>
      String(a.turma_nome).localeCompare(String(b.turma_nome), "pt-BR", { numeric: true })
    );
  }, [responsaveisFiltrados]);

  const turmaSelecionada = useMemo(() => {
    if (chamadaEditando) {
      return {
        id: chamadaEditando.turma_id,
        nome: chamadaEditando.turma_nome,
        materia: chamadaEditando.materia,
        alunos: (chamadaEditando.alunos || []).map((aluno) => ({
          id: aluno.aluno_id || aluno.alunoId || aluno.id,
          nome: aluno.nome,
        })),
      };
    }

    return turmasPendentes.find((turma) => Number(turma.id) === Number(turmaPedagogica));
  }, [turmasPendentes, turmaPedagogica, chamadaEditando]);

  function alternarTurmaResponsaveis(turmaId) {
    setTurmasResponsaveisAbertas((prev) => ({
      ...prev,
      [turmaId]: !prev[turmaId],
    }));
  }

  function trocarPagina(pagina) {
    if (pagina === "chamadas") carregarConfiguracaoAtraso().catch(console.error);
    setActivePage(pagina);
    setSidebarOpen(false);
    setMensagem("");
    if (pagina === "responsaveis") carregarResponsaveis("").catch(console.error);
  }

  async function logout() {
    await api.post("/api/auth/logout");
    window.location.href = "/login";
  }

  function rolarParaElemento(refs, chave) {
    window.setTimeout(() => {
      refs.current[chave]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function alternarChamada(idChamada) {
    setChamadasAbertas((prev) => {
      const jaAberta = Boolean(prev[idChamada]);
      if (!jaAberta) rolarParaElemento(chamadasRefs, idChamada);
      return jaAberta ? {} : { [idChamada]: true };
    });
  }

  function alternarJustificativa(chamadaId, alunoId) {
    const chave = `${chamadaId}-${alunoId}`;
    setJustificativasAbertas((prev) => {
      const jaAberta = Boolean(prev[chave]);
      if (!jaAberta) rolarParaElemento(justificativasRefs, chave);
      return jaAberta ? {} : { [chave]: true };
    });
  }

  function marcarJustificado(chamadaId, aluno, texto) {
    const chave = `${chamadaId}-${aluno.aluno_id || aluno.id}`;
    setJustificativas((prev) => ({ ...prev, [chave]: texto }));
  }

  function getStatusFinal(chamadaId, aluno) {
    const alunoId = aluno.aluno_id || aluno.id;
    const chave = `${chamadaId}-${alunoId}`;
    const status = normalizarStatus(aluno);
    if (aluno.atrasado) return "Atrasado";
    if (status.includes("justific") || justificativas[chave]?.trim()) return "Falta Justificada";
    if (status === "presente") return "Presente";
    return "Ausente";
  }

  function getResumoChamada(chamada) {
    return (chamada.alunos || []).reduce(
      (acc, aluno) => {
        const status = getStatusFinal(chamada.id, aluno);
        if (status === "Presente" || status === "Atrasado") acc.presentes += 1;
        else if (status === "Falta Justificada") acc.justificadas += 1;
        else acc.faltas += 1;
        if (status === "Atrasado") acc.atrasos = (acc.atrasos || 0) + 1;
        acc.total += 1;
        return acc;
      },
      { total: 0, presentes: 0, faltas: 0, justificadas: 0, atrasos: 0 }
    );
  }


  function montarPayloadConfirmacao(chamada) {
    return {
      maquinaDestino: maquinaPadraoChamadas,
      alunos: (chamada.alunos || []).map((aluno) => {
        const alunoId = aluno.aluno_id || aluno.id;
        const chave = `${chamada.id}-${alunoId}`;
        const statusFinal = getStatusFinal(chamada.id, aluno);

        return {
          aluno_id: alunoId,
          nome: aluno.nome,
          status: statusFinal === "Presente" || statusFinal === "Atrasado" ? "presente" : statusFinal === "Falta Justificada" ? "justificado" : "ausente",
          motivo: justificativas[chave] || "",
          atrasado: statusFinal === "Atrasado",
          horario_registro_atraso: statusFinal === "Atrasado" ? (aluno.horario_registro_atraso || aluno.horarioRegistroAtraso || "") : "",
          atraso_registrado_em: statusFinal === "Atrasado" ? (aluno.atraso_registrado_em || aluno.atrasoRegistradoEm || "") : "",
        };
      }),
    };
  }

  function justificarRapido(chamada, aluno) {
    const alunoId = aluno.aluno_id || aluno.id;
    const chave = `${chamada.id}-${alunoId}`;

    setJustificativasAbertas({ [chave]: true });
    rolarParaElemento(justificativasRefs, chave);
    setJustificativas((prev) => ({ ...prev, [chave]: prev[chave] || "" }));
  }

  async function salvarChamada(chamada) {
    try {
      setLoading(true);
      const { data } = await pedagogaService.confirmarChamada(chamada.id, montarPayloadConfirmacao(chamada));
      const automacao = data?.automacao;
      setMensagem(data?.mensagem || "Registro confirmado com sucesso. A chamada já aparece na lista de chamadas confirmadas hoje.");
      if (automacao?.id) {
        setAutomacaoModal({ aberto: true, ids: [automacao.id] });
      }
      setJustificativas({});
      setJustificativasAbertas({});
      await Promise.all([carregarDashboard(), carregarChamadas()]);
    } catch (error) {
      setMensagem(error.message);
    } finally {
      setLoading(false);
    }
  }

  function formatarDuracaoAutomacao(totalSegundos) {
    const segundos = Math.max(0, Number(totalSegundos || 0));
    const minutos = Math.floor(segundos / 60);
    const restoSegundos = segundos % 60;
    if (minutos <= 0) return `${restoSegundos}s`;
    return `${minutos}min ${String(restoSegundos).padStart(2, "0")}s`;
  }

  async function iniciarAutomacaoChamadasSalvasHoje() {
    try {
      setLoading(true);
      const maquinaSelecionada = Number(maquinaPadraoChamadas);
      if (!maquinasPermitidasChamadas.includes(maquinaSelecionada)) {
        setMensagem("Selecione a máquina de destino antes de iniciar a automação.");
        return;
      }

      const { data } = await pedagogaService.solicitarAutomacaoWhatsApp({ maquinaDestino: maquinaSelecionada });
      const idFila = data?.automacao?.id;

      if (!idFila) {
        throw new Error("O backend não retornou o ID da solicitação de automação.");
      }

      setAutomacaoModal({ aberto: true, ids: [idFila] });
    } catch (error) {
      setMensagem(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function salvarMensagemWhatsapp() {
    try {
      setLoading(true);
      const { data } = await pedagogaService.salvarMensagemWhatsApp(mensagemWhatsappTexto);
      setMensagemWhatsappTexto(data.texto || mensagemWhatsappTexto);
      setMensagemWhatsappModalAberto(false);
      setMensagem("Mensagem padrão do WhatsApp salva com sucesso.");
    } catch (error) {
      setMensagem(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function abrirEdicaoChamadaSalva(id) {
    try {
      setLoading(true);
      const { data } = await pedagogaService.detalharChamadaConfirmada(id);
      setChamadaConfirmadaEditando(data.chamada);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setMensagem(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function salvarEdicaoFrequencia(frequencia, novoStatus, motivo = "") {
    try {
      setLoading(true);
      const atrasado = novoStatus === "presente" && Boolean(frequencia.atrasado);

      await pedagogaService.atualizarFrequencia(frequencia.frequencia_id, {
        status: atrasado ? "presente" : novoStatus,
        motivo,
        atrasado,
      });

      const { data } = await pedagogaService.detalharChamadaConfirmada(chamadaConfirmadaEditando.id);
      setChamadaConfirmadaEditando(data.chamada);
      await Promise.all([carregarDashboard(), carregarChamadas()]);
      setMensagem("Frequência atualizada com sucesso.");
    } catch (error) {
      setMensagem(error.message);
    } finally {
      setLoading(false);
    }
  }


  async function marcarAtrasoChamada(chamada, aluno) {
    const alunoId = aluno.aluno_id || aluno.id;

    try {
      setLoading(true);
      const configServidor = await buscarConfiguracaoEscola();
      const configAtual = {
        horarioLimiteAtraso: String(configServidor.horarioLimiteAtraso || configServidor.horario_limite_atraso || "07:45").slice(0, 5),
        atrasoLiberado: Boolean(configServidor.atraso_liberado),
        horarioServidor: String(configServidor.horario_servidor || "").slice(0, 5),
      };
      setConfigAtraso(configAtual);

      if (!configAtual.atrasoLiberado) {
        setMensagem(`Atrasos só podem ser marcados até ${configAtual.horarioLimiteAtraso}. Depois desse horário permanece como falta.`);
        return;
      }
      await pedagogaService.marcarAlunoAtrasado(chamada.id, alunoId);
      setMensagem("Atraso registrado com sucesso.");
      await Promise.all([carregarDashboard(), carregarChamadas(), carregarConfiguracaoAtraso()]);
    } catch (error) {
      setMensagem(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function marcarAtrasoFrequencia(freq) {
    try {
      setLoading(true);
      const configServidor = await buscarConfiguracaoEscola();
      const configAtual = {
        horarioLimiteAtraso: String(configServidor.horarioLimiteAtraso || configServidor.horario_limite_atraso || "07:45").slice(0, 5),
        atrasoLiberado: Boolean(configServidor.atraso_liberado),
        horarioServidor: String(configServidor.horario_servidor || "").slice(0, 5),
      };
      setConfigAtraso(configAtual);

      if (!configAtual.atrasoLiberado) {
        setMensagem(`Atrasos só podem ser marcados até ${configAtual.horarioLimiteAtraso}. Depois desse horário permanece como falta.`);
        return;
      }
    } finally {
      setLoading(false);
    }
    await salvarEdicaoFrequencia({ ...freq, atrasado: true }, "presente");
  }

  function selecionarTurmaPedagogica(idTurma) {
    setChamadaEditando(null);
    setTurmaPedagogica(idTurma);

    const turma = turmasPendentes.find((item) => String(item.id) === String(idTurma));
    const estadoInicial = {};

    (turma?.alunos || []).forEach((aluno) => {
      estadoInicial[aluno.id] = "presente";
    });

    setAlunosPedagogicos(estadoInicial);
  }

  function alterarStatusPedagogico(alunoId, status) {
    setAlunosPedagogicos((prev) => ({ ...prev, [alunoId]: status }));
  }

  function editarChamadaPedagogica(chamada) {
    const estadoEditado = {};

    (chamada.alunos || []).forEach((aluno) => {
      const id = aluno.aluno_id || aluno.alunoId || aluno.id;
      estadoEditado[id] = aluno.atrasado ? "atrasado" : normalizarStatus(aluno) === "presente" ? "presente" : "ausente";
    });

    setChamadaEditando(chamada);
    setTurmaPedagogica(String(chamada.turma_id || ""));
    setAlunosPedagogicos(estadoEditado);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelarEdicaoChamada() {
    setChamadaEditando(null);
    setTurmaPedagogica("");
    setAlunosPedagogicos({});
  }

  async function criarChamadaPedagogica() {
    if (!turmaSelecionada) return setMensagem("Selecione uma turma pendente ou uma chamada para editar.");

    const alunos = (turmaSelecionada.alunos || []).map((aluno) => ({
      id: aluno.id,
      nome: aluno.nome,
      status_presenca: alunosPedagogicos[aluno.id] === "atrasado" ? "presente" : (alunosPedagogicos[aluno.id] || "presente"),
      atrasado: alunosPedagogicos[aluno.id] === "atrasado",
      horario_registro_atraso: alunosPedagogicos[aluno.id] === "atrasado" ? (aluno.horario_registro_atraso || aluno.horarioRegistroAtraso || "") : "",
      atraso_registrado_em: alunosPedagogicos[aluno.id] === "atrasado" ? (aluno.atraso_registrado_em || aluno.atrasoRegistradoEm || "") : "",
    }));

    try {
      setLoading(true);

      if (chamadaEditando) {
        await pedagogaService.atualizarChamadaTemporaria(chamadaEditando.id, {
          turma_id: turmaSelecionada.id,
          materia: chamadaEditando.materia || "Chamada Pedagógica",
          alunos,
        });
      } else {
        await pedagogaService.criarChamadaPedagogica({
          turma_id: turmaSelecionada.id,
          data_chamada: hojeISO(),
          alunos,
        });
      }

      setMensagem(chamadaEditando ? "Chamada atualizada com sucesso." : "Chamada pedagógica registrada com sucesso.");
      setTurmaPedagogica("");
      setChamadaEditando(null);
      setAlunosPedagogicos({});
      await Promise.all([carregarDashboard(), carregarChamadas()]);
    } catch (error) {
      setMensagem(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function salvarResponsavel() {
    try {
      setLoading(true);
      const ids = responsavelEditando.ids?.length ? responsavelEditando.ids : [responsavelEditando.id];
      await Promise.all(ids.map((id) => api.put(`/api/pedagoga/responsaveis/${id}`, {
        nome: responsavelEditando.nome,
        contato: responsavelEditando.contato,
      })));
      setResponsavelEditando(null);
      setMensagem("Dados do responsável atualizados com sucesso.");
      await carregarResponsaveis();
    } catch (error) {
      setMensagem(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function salvarConfiguracoes(event) {
    event.preventDefault();
    try {
      setLoading(true);
      const payload = { nome: configForm.nome, email: configForm.email };
      if (configForm.senha.trim()) payload.senha = configForm.senha;
      const { data } = await api.put("/api/usuarios/configurar", payload);
      setUsuarioLogado(data.usuario);
      setConfigForm({ nome: data.usuario.nome, email: data.usuario.email, senha: "" });
      setMensagem("Perfil atualizado com sucesso.");
    } catch (error) {
      setMensagem(error.message);
    } finally {
      setLoading(false);
    }
  }

  const resumoRelatorios = useMemo(() => {
    return chamadasConfirmadas.reduce(
      (acc, chamada) => {
        acc.chamadas += 1;
        acc.presencas += Number(chamada.total_presentes || 0);
        acc.faltas += Number(chamada.total_ausentes || 0);
        acc.justificadas += Number(chamada.total_justificados || 0);
        return acc;
      },
      { chamadas: 0, presencas: 0, faltas: 0, justificadas: 0 }
    );
  }, [chamadasConfirmadas]);

  return (
    <div className="pedagoga-page">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-logo"><div className="logo-icon">SC</div><span>Sistema de Chamadas</span></div>
        <nav className="sidebar-nav">
          {menuItems.map((item) => (
            <button key={item.id} className={activePage === item.id ? "active" : ""} onClick={() => trocarPagina(item.id)} type="button">
              <strong>{item.label}</strong>
            </button>
          ))}
        </nav>
      </aside>

      {sidebarOpen && <button className="overlay" onClick={() => setSidebarOpen(false)} type="button" />}

      <main className="main-content">
        <header className="topbar">
          <button className="menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} type="button" aria-label="Abrir menu"><span></span><span></span><span></span></button>
          <div className="profile-box">
            <div><strong>{usuarioLogado?.nome || "Pedagoga"}</strong><span>{usuarioLogado?.tipo || "pedagoga"}</span></div>
            <div className="avatar">{usuarioLogado?.nome?.charAt(0)?.toUpperCase() || "P"}</div>
            <button className="logout-button" type="button" onClick={logout} aria-label="Encerrar sessão" title="Encerrar sessão">
              <LogOut size={19} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        </header>

        {mensagem && <div className="feedback-message">{mensagem}</div>}

        {activePage === "dashboard" && (
          <section className="page-section">
            <div className="page-title"><h1>Painel Principal</h1><p>Resumo geral das chamadas de presença do dia.</p></div>
            <div className="cards-grid">
              <div className="summary-card"><span className="card-icon">CH</span><div><h3>{dashboard?.resumo?.chamadasHoje || 0}</h3><p>Chamadas hoje</p></div></div>
              <div className="summary-card"><span className="card-icon">FT</span><div><h3>{dashboard?.resumo?.totalFaltas || 0}</h3><p>Faltas do dia</p></div></div>
              <div className="summary-card"><span className="card-icon">JF</span><div><h3>{dashboard?.resumo?.totalJustificadas || 0}</h3><p>Faltas justificadas</p></div></div>
              <div className="summary-card delay-card"><span className="card-icon">AT</span><div><h3>{dashboard?.resumo?.totalAtrasos || 0}</h3><p>Atrasos do dia</p><small>Horário máximo: {configAtraso.horarioLimiteAtraso}</small></div></div>
            </div>
            <div className="content-card">
              <div className="card-header"><h2>Turmas do Dia</h2><p>Status das chamadas por sala.</p></div>
              <div className="class-list">
                {(dashboard?.turmas || []).map((turma) => (
                  <div className="class-item class-item-rich" key={turma.id}>
                    <div><strong>{turma.nome}</strong><span>{turma.total_alunos} alunos cadastrados</span></div>
                    <div className="attendance-summary">
                      <span className="summary-present">Presenças: {turma.presentes}</span>
                      <span className="summary-absent">Faltas: {turma.faltas}</span>
                      <span className="summary-justified">Justificadas: {turma.justificadas}</span>
                      <span className="summary-delay">Atrasos: {turma.atrasos || 0}</span>
                    </div>
                    <span className={`status ${turma.status_chamada === "finalizada" ? "success" : "warning"}`}>{turma.status_chamada === "finalizada" ? "Finalizada" : "Pendente"}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {activePage === "chamadas" && (
          <section className="page-section">
            <div className="page-title"><h1>Chamadas</h1><p>Confirme chamadas temporárias, gere os registros permanentes e edite chamadas salvas hoje.</p></div>
            <div className="content-card pedagogical-call-card">
              <div className="card-header"><h2>Chamada Pedagógica</h2><p>A matéria será salva automaticamente como “Chamada Pedagógica”.</p></div>
              <div className="filter-grid">
                <div>
                  <label>{chamadaEditando ? "Editando chamada" : "Turma pendente"}</label>
                  <select
                    value={turmaPedagogica}
                    onChange={(e) => selecionarTurmaPedagogica(e.target.value)}
                    disabled={Boolean(chamadaEditando)}
                  >
                    <option value="">Selecione uma turma</option>
                    {turmasPendentes.map((turma) => (
                      <option key={turma.id} value={turma.id}>{turma.nome}</option>
                    ))}
                  </select>
                </div>

                <button className="btn-primary" type="button" onClick={criarChamadaPedagogica} disabled={loading || !turmaSelecionada}>
                  {chamadaEditando ? "Confirmar edição" : "Registrar chamada pedagógica"}
                </button>

                {chamadaEditando && (
                  <button className="btn-secondary" type="button" onClick={cancelarEdicaoChamada}>
                    Cancelar alterações
                  </button>
                )}
              </div>

              {turmaSelecionada && (
                <>
                  <div className="chamada-title pedagoga-call-title">
                    <h2>{turmaSelecionada.nome}</h2>
                    <span>{(turmaSelecionada.alunos || []).length} alunos</span>
                  </div>

                  <ul className="alunos-lista pedagogical-students">
                    {(turmaSelecionada.alunos || []).map((aluno) => (
                      <li className="aluno-linha" key={aluno.id}>
                        <span className="aluno-nome">{aluno.nome}</span>

                        <div className="presenca-toggle">
                          <button
                            type="button"
                            className={
                              alunosPedagogicos[aluno.id] === "presente"
                                ? "status-button presente ativo"
                                : "status-button presente"
                            }
                            onClick={() => alterarStatusPedagogico(aluno.id, "presente")}
                          >
                            Presente
                          </button>

                          <button
                            type="button"
                            className={
                              alunosPedagogicos[aluno.id] === "ausente"
                                ? "status-button ausente ativo"
                                : "status-button ausente"
                            }
                            onClick={() => alterarStatusPedagogico(aluno.id, "ausente")}
                          >
                            Ausente
                          </button>

                          {chamadaEditando && (
                            <button
                              type="button"
                              className={
                                alunosPedagogicos[aluno.id] === "atrasado"
                                  ? "status-button presente ativo"
                                  : "status-button presente"
                              }
                              onClick={() => alterarStatusPedagogico(aluno.id, "atrasado")}
                            >
                              Atrasado
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="content-card">
              {(chamadas || []).length === 0 ? <div className="empty-state">Nenhum registro encontrado</div> : <div className="attendance-accordion-list">
                {chamadas.map((chamada) => {
                  const aberta = chamadasAbertas[chamada.id] || false;
                  const resumo = getResumoChamada(chamada);
                  return <div className={`attendance-accordion ${aberta ? "open" : ""}`} key={chamada.id} ref={(elemento) => { chamadasRefs.current[chamada.id] = elemento; }}>
                    <button type="button" className="attendance-toggle" onClick={() => alternarChamada(chamada.id)}>
                      <div className="attendance-toggle-info"><strong>{chamada.turma_nome}</strong><span>{chamada.data_chamada} • {chamada.professor_nome} • {chamada.materia}</span></div>
                      <div className="attendance-summary"><span>Total: {resumo.total}</span><span className="summary-present">Presentes: {resumo.presentes}</span><span className="summary-absent">Faltas: {resumo.faltas}</span><span className="summary-justified">Justificadas: {resumo.justificadas}</span></div>
                      <div className="accordion-actions">
                        <button
                          type="button"
                          className="btn-primary edit-attendance-button"
                          disabled={loading}
                          onClick={(event) => {
                            event.stopPropagation();
                            salvarChamada(chamada);
                          }}
                        >
                          Salvar & Iniciar Automação
                        </button>
                        <button
                          type="button"
                          className="btn-secondary edit-attendance-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            editarChamadaPedagogica(chamada);
                          }}
                        >
                          Revisar
                        </button>
                        <span className="accordion-arrow">{aberta ? "Recolher" : "Expandir"}</span>
                      </div>
                    </button>
                    <div className="attendance-body"><div className="student-list improved">{(chamada.alunos || []).map((aluno) => {
                      const alunoId = aluno.aluno_id || aluno.id;
                      const chave = `${chamada.id}-${alunoId}`;
                      const statusFinal = getStatusFinal(chamada.id, aluno);
                      return <div className={`student-row improved ${statusFinal === "Presente" || statusFinal === "Atrasado" ? "student-present" : statusFinal === "Falta Justificada" ? "student-justified" : "student-absent"}`} key={chave} ref={(elemento) => { justificativasRefs.current[chave] = elemento; }}>
                        <div className="student-main-info"><div><strong>{aluno.nome}</strong><small>ID aluno: {alunoId}</small></div><span className={`status-badge ${statusFinal === "Presente" || statusFinal === "Atrasado" ? "present" : statusFinal === "Falta Justificada" ? "justified" : "absent"}`}>{statusFinal}</span></div>
                        {(statusFinal === "Ausente" || justificativasAbertas[chave]) && <div className="justify-area" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
                          {statusFinal === "Ausente" && <button className="btn-primary justify-toggle" type="button" onClick={(event) => { event.stopPropagation(); justificarRapido(chamada, aluno); }}>Registrar justificativa</button>}
                          {statusFinal === "Ausente" && <button className="btn-secondary justify-toggle" type="button" disabled={!configAtraso.atrasoLiberado || loading} title={!configAtraso.atrasoLiberado ? `Depois de ${configAtraso.horarioLimiteAtraso}, atraso vira falta.` : ""} onClick={(event) => { event.stopPropagation(); marcarAtrasoChamada(chamada, aluno); }}>Registrar atraso</button>}
                          <button className="btn-secondary justify-toggle" type="button" onClick={(event) => { event.stopPropagation(); alternarJustificativa(chamada.id, alunoId); }}>{justificativasAbertas[chave] ? "Ocultar justificativa" : "Informar motivo"}</button>
                          {justificativasAbertas[chave] && <div className="justify-box improved"><label>Justificativa temporária</label><textarea placeholder="Descreva o motivo da ausência..." value={justificativas[chave] || ""} onChange={(e) => marcarJustificado(chamada.id, aluno, e.target.value)} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} /></div>}
                        </div>}
                      </div>;
                    })}</div></div>
                  </div>;
                })}
              </div>}
            </div>

            <div className="content-card machine-preference-card">
              <div className="card-header">
                <div>
                  <h2>Máquina da automação</h2>
                  <p>Escolha a máquina local que processará as mensagens deste perfil.</p>
                </div>
                <select
                  value={maquinaPadraoChamadas}
                  disabled={salvandoMaquinaPadrao || loading}
                  onChange={(event) => salvarMaquinaPadraoChamadas(event.target.value)}
                >
                  <option value="">Selecione uma máquina</option>
                  {maquinasPermitidasChamadas.map((maquina) => (
                    <option key={maquina} value={maquina}>Máquina {maquina}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="content-card">
              <div className="card-header saved-calls-header">
                <div className="saved-calls-title">
                  <h2>Chamadas confirmadas hoje</h2>
                  <p>Registros permanentes consolidados no banco de dados.</p>
                </div>
                <div className="automation-actions">
                  <button
                    className="automation-edit-button"
                    type="button"
                    onClick={() => setMensagemWhatsappModalAberto(true)}
                    title="Editar mensagem enviada aos responsáveis"
                    aria-label="Editar mensagem enviada aos responsáveis"
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    className="automation-button"
                    type="button"
                    onClick={iniciarAutomacaoChamadasSalvasHoje}
                    disabled={loading}
                    title="Registra uma solicitação pendente para o RPA Python processar"
                  >
                    Executar automação
                  </button>
                </div>
              </div>
              {(chamadasConfirmadas || []).length === 0 ? <div className="empty-state">Nenhum registro encontrado</div> : <div className="class-list">
                {chamadasConfirmadas.map((chamada) => (
                  <div className="class-item class-item-rich" key={chamada.id}>
                    <div><strong>{chamada.turma_nome}</strong><span>{chamada.data_chamada} • {chamada.professor_nome} • {chamada.materia}</span></div>
                    <div className="attendance-summary">
                      <span className="summary-present">Presentes: {chamada.total_presentes}</span>
                      <span className="summary-absent">Faltas: {chamada.total_ausentes}</span>
                      <span className="summary-justified">Justificadas: {chamada.total_justificados}</span><span className="summary-present">Atrasos: {chamada.total_atrasos || 0}</span>
                    </div>
                    <button className="btn-secondary" type="button" onClick={() => abrirEdicaoChamadaSalva(chamada.id)}>Revisar chamada confirmada</button>
                  </div>
                ))}
              </div>}
            </div>


            {mensagemWhatsappModalAberto && (
              <div className="modal-backdrop">
                <div className="content-card edit-form modal-card whatsapp-message-modal">
                  <div className="card-header">
                    <h2>Mensagem do WhatsApp</h2>
                    <p>Use as tags dinâmicas <strong>{"{nome_responsavel}"}</strong>, <strong>{"{nome_aluno}"}</strong> e <strong>{"{data}"}</strong>. O robô local substituirá esses campos antes do envio.</p>
                  </div>
                  <textarea
                    className="whatsapp-message-textarea"
                    value={mensagemWhatsappTexto}
                    onChange={(e) => setMensagemWhatsappTexto(e.target.value)}
                    maxLength={1000}
                    rows={8}
                  />
                  <small>{mensagemWhatsappTexto.length}/1000 caracteres</small>
                  <div className="action-row">
                    <button className="btn-primary" type="button" onClick={salvarMensagemWhatsapp} disabled={loading || !mensagemWhatsappTexto.trim()}>Salvar mensagem</button>
                    <button className="btn-secondary" type="button" onClick={() => setMensagemWhatsappModalAberto(false)}>Cancelar</button>
                  </div>
                </div>
              </div>
            )}

            {chamadaConfirmadaEditando && (
              <div className="content-card">
                <div className="card-header"><h2>Revisão da chamada confirmada: {chamadaConfirmadaEditando.turma_nome}</h2><p>Atualize somente registros confirmados do dia atual.</p></div>
                <div className="student-list improved">
                  {(chamadaConfirmadaEditando.alunos || []).map((freq) => (
                    <div className={`student-row improved ${freq.status === "presente" ? "student-present" : freq.status === "justificado" ? "student-justified" : "student-absent"}`} key={freq.frequencia_id}>
                      <div className="student-main-info">
                        <div><strong>{freq.aluno_nome}</strong><small>ID aluno: {freq.aluno_id}</small></div>
                        <span className={`status-badge ${freq.status === "presente" ? "present" : freq.status === "justificado" ? "justified" : "absent"}`}>{freq.atrasado ? "atrasado" : freq.status}</span>
                      </div>
                      <div className="presenca-toggle">
                        <button type="button" className={freq.status === "presente" && !freq.atrasado ? "status-button presente ativo" : "status-button presente"} onClick={() => salvarEdicaoFrequencia({ ...freq, atrasado: false }, "presente")}>Presente</button>
                        <button type="button" className={freq.status === "ausente" ? "status-button ausente ativo" : "status-button ausente"} onClick={() => salvarEdicaoFrequencia({ ...freq, atrasado: false }, "ausente")}>Ausente</button>
                        <button type="button" className={freq.status === "justificado" ? "status-button justificado ativo" : "status-button justificado"} onClick={() => salvarEdicaoFrequencia({ ...freq, atrasado: false }, "justificado", freq.motivo || "Justificado em triagem pedagógica")}>Justificado</button>
                        <button type="button" className={freq.atrasado ? "status-button presente ativo" : "status-button presente"} disabled={!configAtraso.atrasoLiberado || loading} title={!configAtraso.atrasoLiberado ? `Depois de ${configAtraso.horarioLimiteAtraso}, atraso vira falta.` : ""} onClick={() => marcarAtrasoFrequencia(freq)}>Atrasado</button>
                      </div>
                      {freq.status === "justificado" && <div className="justify-box improved"><label>Motivo salvo</label><textarea value={freq.motivo || ""} onChange={(e) => setChamadaConfirmadaEditando((prev) => ({ ...prev, alunos: prev.alunos.map((item) => item.frequencia_id === freq.frequencia_id ? { ...item, motivo: e.target.value } : item) }))} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} /><div className="justify-actions"><button className="btn-primary justify-save" type="button" disabled={loading || !String(freq.motivo || "").trim()} onClick={(event) => { event.stopPropagation(); salvarEdicaoFrequencia(freq, "justificado", freq.motivo || ""); }}>Confirmar justificativa</button></div></div>}
                    </div>
                  ))}
                </div>
                <button className="btn-secondary" type="button" onClick={() => setChamadaConfirmadaEditando(null)}>Encerrar revisão</button>
              </div>
            )}

          </section>
        )}

        {activePage === "responsaveis" && (
          <section className="page-section responsaveis-page">
            <div className="page-title">
              <h1>Responsáveis</h1>
              <p>Contatos organizados por turma dos alunos, com busca por responsável, estudante ou telefone.</p>
            </div>

            <form className="content-card responsaveis-search-card" onSubmit={localizarResponsavel}>
              <label htmlFor="busca-responsaveis">Busca avançada</label>
              <div className="responsaveis-search-input">
                <Search size={18} aria-hidden="true" />
                <input
                  id="busca-responsaveis"
                  type="search"
                  placeholder="Digite nome do responsável, aluno ou telefone e pressione Enter"
                  value={buscaResponsaveis}
                  onChange={(event) => {
                    setBuscaResponsaveis(event.target.value);
                    setResponsavelDestacado(null);
                  }}
                />
                <button className="btn-primary" type="submit" disabled={loading}>
                  Buscar
                </button>
              </div>
              <small>{responsaveisFiltrados.length} vínculo(s) encontrado(s). A busca abre somente as turmas com resultado.</small>
            </form>

            {responsaveisPorTurma.length === 0 && (
              <div className="content-card empty-state">Nenhum responsável encontrado para os filtros informados.</div>
            )}

            <div className="responsaveis-turmas-list">
              {responsaveisPorTurma.map((turma) => (
                <div className="content-card responsaveis-turma-card" key={turma.turma_id}>
                  <button
                    className={`responsaveis-turma-header ${turmasResponsaveisAbertas[turma.turma_id] ? "aberta" : ""}`}
                    type="button"
                    onClick={() => alternarTurmaResponsaveis(turma.turma_id)}
                    aria-expanded={Boolean(turmasResponsaveisAbertas[turma.turma_id])}
                    aria-controls={`responsaveis-turma-${turma.turma_id}`}
                  >
                    <div>
                      <h2>{turma.turma_nome}</h2>
                      <p>{turma.responsaveis.length} responsável(is) vinculado(s)</p>
                    </div>
                    <ChevronDown className="responsaveis-turma-icone" size={22} aria-hidden="true" />
                  </button>

                  {turmasResponsaveisAbertas[turma.turma_id] && (
                  <div className="table-card responsaveis-table-wrapper" id={`responsaveis-turma-${turma.turma_id}`}>
                    <table>
                      <thead>
                        <tr>
                          <th>Responsável</th>
                          <th>Contato</th>
                          <th>Aluno vinculado nesta turma</th>
                          <th>Parentesco</th>
                          <th>Operações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {turma.responsaveis.map((resp) => {
                          const chaveResponsavel = `${turma.turma_id}-${resp.id}`;

                          return (
                          <tr
                            key={chaveResponsavel}
                            ref={(elemento) => {
                              if (elemento) responsaveisRefs.current[chaveResponsavel] = elemento;
                            }}
                            className={buscaResponsaveisAtiva || responsavelDestacado === chaveResponsavel ? "responsavel-destacado" : ""}
                          >
                            <td>{resp.nome}</td>
                            <td>{resp.contato}</td>
                            <td>{resp.alunos.map((a) => a.nome).join(", ")}</td>
                            <td>{resp.parentesco || "Não informado"}</td>
                            <td>
                              <button className="btn-secondary" type="button" onClick={() => setResponsavelEditando(resp)}>
                                Atualizar dados
                              </button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>
              ))}
            </div>

            {responsavelEditando && <div className="modal-backdrop"><div className="content-card edit-form modal-card"><h2>Atualizar responsável</h2><label>Nome</label><input value={responsavelEditando.nome} onChange={(e) => setResponsavelEditando({ ...responsavelEditando, nome: e.target.value })} /><label>Contato</label><input value={responsavelEditando.contato} onChange={(e) => setResponsavelEditando({ ...responsavelEditando, contato: e.target.value })} /><small>Alunos: {responsavelEditando.alunos.map((a) => `${a.nome}${a.turma ? ` (${a.turma})` : ""}`).join(", ")}</small><div className="action-row"><button className="btn-primary" type="button" onClick={salvarResponsavel} disabled={loading}>Confirmar atualização</button><button className="btn-secondary" type="button" onClick={() => setResponsavelEditando(null)}>Cancelar</button></div></div></div>}
          </section>
        )}

        {activePage === "relatorios" && (
          <section className="page-section pedagoga-reports-page">
            <div className="page-title"><h1>Relatórios do Pedagogo</h1><p>Relatório avançado com os mesmos filtros da área administrativa.</p></div>
            <div className="cards-grid report-daily-summary"><div className="summary-card"><span className="card-icon">CR</span><div><h3>{resumoRelatorios.chamadas}</h3><p>Chamadas registradas hoje</p></div></div><div className="summary-card"><span className="card-icon">PR</span><div><h3>{resumoRelatorios.presencas}</h3><p>Presenças hoje</p></div></div><div className="summary-card"><span className="card-icon">FT</span><div><h3>{resumoRelatorios.faltas}</h3><p>Faltas hoje</p></div></div><div className="summary-card delay-card"><span className="card-icon">AT</span><div><h3>{dashboard?.resumo?.totalAtrasos || 0}</h3><p>Atrasos hoje</p></div></div></div>
            <RelatoriosAvancados turmas={relatorioTurmas} alunos={relatorioAlunos} />
          </section>
        )}

        {activePage === "configuracoes" && (
          <section className="page-section"><div className="page-title"><h1>Configurações</h1><p>Atualize seus dados de perfil.</p></div><form className="content-card profile-form" onSubmit={salvarConfiguracoes}><label>Nome completo</label><input value={configForm.nome} onChange={(e) => setConfigForm({ ...configForm, nome: e.target.value })} /><label>E-mail</label><input type="email" value={configForm.email} onChange={(e) => setConfigForm({ ...configForm, email: e.target.value })} /><label>Nova senha</label><input type="password" placeholder="Deixe em branco para manter" value={configForm.senha} onChange={(e) => setConfigForm({ ...configForm, senha: e.target.value })} /><button className="btn-primary" type="submit" disabled={loading}>Atualizar perfil</button></form></section>
        )}

        <AutomacaoFeedbackModal
          aberto={automacaoModal.aberto}
          solicitacoes={automacaoModal.ids}
          titulo="Automação de faltas"
          timeoutAlertaSegundos={600}
          onClose={() => setAutomacaoModal({ aberto: false, ids: [] })}
          onCancelado={() => setMensagem("Envio cancelado antes do robô local iniciar.")}
          onConcluido={({ duracaoSegundos }) => setMensagem(`Automação concluída com sucesso em ${formatarDuracaoAutomacao(duracaoSegundos)}.`)}
          onErro={() => setMensagem("A automação encontrou erro. Verifique o computador do robô local.")}
        />
      </main>
    </div>
  );
}

export default Pedagoga;
