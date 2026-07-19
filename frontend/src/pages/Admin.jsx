import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "../services/api";
import { buscarConfiguracaoEscola, salvarConfiguracaoEscola } from "../services/configuracoesEscolaService";
import RelatoriosAvancados from "./RelatoriosAvancados";
import MensagensAdmin from "./MensagensAdmin";
import LogsAuditoria from "./LogsAuditoria";
import AlunosAtrasadosCard from "../components/AlunosAtrasadosCard";
import MetricProgressChart from "../components/MetricProgressChart";
import TurmasDashboardCard from "../components/TurmasDashboardCard";
import { useAuth } from "../context/AuthContext";
import { ATRASOS_CACHE_NAMESPACE } from "../utils/atrasosSync";
import { registrarErroCliente } from "../utils/clientLogger";
import "../styles/Admin.css";

const MIN_CARACTERES_BUSCA_ALUNOS = 2;

function normalizarDashboard(data = {}, alunosAtrasadosAtuais = []) {
  const resumo = data.resumo || {};

  return {
    data: data.data || "",
    alunosCadastrados: Number(resumo.alunosCadastrados ?? data.alunosCadastrados ?? 0),
    chamadasHoje: Number(resumo.chamadasHoje || 0),
    chamadasPendentes: Number(resumo.chamadasPendentes || 0),
    presentes: Number(resumo.totalPresentes ?? data.presentes ?? 0),
    ausentes: Number(resumo.totalFaltas ?? data.ausentes ?? 0),
    justificados: Number(resumo.totalJustificadas ?? data.justificados ?? 0),
    atrasos: Number(resumo.totalAtrasos ?? data.atrasos ?? 0),
    taxaFrequencia: Number(resumo.taxaFrequencia || 0),
    turmas: Array.isArray(data.turmas) ? data.turmas : [],
    alunosAtrasados: Array.isArray(data.alunosAtrasados)
      ? data.alunosAtrasados
      : alunosAtrasadosAtuais,
  };
}

export default function Administrador() {
  const { usuario, sair: encerrarSessao } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [telaAtiva, setTelaAtiva] = useState("painel");
  const [abaPainel, setAbaPainel] = useState("geral");

  const [usuarioLogado, setUsuarioLogado] = useState(null);

  const [abaRegistros, setAbaRegistros] = useState("alunos");
  const [pesquisaAluno, setPesquisaAluno] = useState("");
  const [pesquisaAlunoDebounced, setPesquisaAlunoDebounced] = useState("");
  const [paginaAlunos, setPaginaAlunos] = useState(1);
  const [metaAlunos, setMetaAlunos] = useState({
    totalRegistros: 0,
    totalPagina: 0,
    turmasPagina: 0,
    paginaAtual: 1,
    totalPaginas: 1,
    limite: 50,
    paginacaoPorTurma: false,
  });
  const [turmasAbertas, setTurmasAbertas] = useState({});
  const [alunosAbertos, setAlunosAbertos] = useState({});
  const [alunoDestacadoId, setAlunoDestacadoId] = useState(null);
  const primeiraBuscaAplicadaRef = useRef(false);
  const linhaAlunoRefs = useRef({});
  const registrosPanelRef = useRef(null);
  const paginaSolicitadaRef = useRef(null);
  const cacheRef = useRef({
    dashboardCarregado: false,
    configAtrasoCarregada: false,
    mensagemWhatsappCarregada: false,
    preferenciasCarregadas: false,
    chamadasCarregadas: false,
    responsaveisCarregados: false,
    relatoriosCarregados: false,
    filtrosCarregados: false,
    registrosCarregados: false,
    paginasAlunos: {},
  });
  const requisicoesEmAndamentoRef = useRef({
    painel: false,
    registros: false,
    relatorios: false,
    configuracoes: false,
  });

  const [modalAluno, setModalAluno] = useState(null);
  const [modalTurma, setModalTurma] = useState(false);
  const [modalEquipe, setModalEquipe] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);
  const [avisoMoverAluno, setAvisoMoverAluno] = useState(null);

  const [carregandoRegistros, setCarregandoRegistros] = useState(false);
  const [erroRegistros, setErroRegistros] = useState("");
  const [metricasDia, setMetricasDia] = useState({
    data: "",
    alunosCadastrados: 0,
    chamadasHoje: 0,
    chamadasPendentes: 0,
    presentes: 0,
    ausentes: 0,
    justificados: 0,
    atrasos: 0,
    taxaFrequencia: 0,
    turmas: [],
    alunosAtrasados: [],
  });
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [mensagemConfig, setMensagemConfig] = useState("");
  const [horarioLimiteAtraso, setHorarioLimiteAtraso] = useState("07:45");
  const [tempoMaximoJustificativasMeses, setTempoMaximoJustificativasMeses] = useState(1);
  const [bloqueioEdicaoAposHorario, setBloqueioEdicaoAposHorario] = useState(true);
  const [bloqueioEdicaoSalvo, setBloqueioEdicaoSalvo] = useState(true);
  const [salvandoBloqueioEdicao, setSalvandoBloqueioEdicao] = useState(false);
  const [feedbackBloqueioEdicao, setFeedbackBloqueioEdicao] = useState({ tipo: "", mensagem: "" });

  function montarChaveCacheAlunos(page = paginaAlunos, busca = pesquisaAlunoDebounced) {
    return `alunos:${page}:${String(busca || "").trim().toLowerCase()}`;
  }

  async function carregarAlunosPaginados({ page = paginaAlunos, busca = pesquisaAlunoDebounced, forcarAtualizacao = false } = {}) {
    const chaveCache = montarChaveCacheAlunos(page, busca);
    const cacheAlunos = cacheRef.current.paginasAlunos || {};

    if (!forcarAtualizacao && cacheAlunos[chaveCache]) {
      setAlunos(cacheAlunos[chaveCache].alunos || []);
      const metaCache = cacheAlunos[chaveCache].meta || {
        totalRegistros: 0,
        totalPagina: 0,
        turmasPagina: 0,
        paginaAtual: page,
        totalPaginas: 1,
        limite: 50,
        paginacaoPorTurma: false,
      };
      setMetaAlunos(metaCache);
      sinalizarPaginaCarregada(metaCache.paginaAtual);
      return cacheAlunos[chaveCache];
    }

    setCarregandoRegistros(true);
    setErroRegistros("");

    try {
      const data = await apiFetch("/api/registros/alunos/pesquisar", {
        method: "POST",
        body: JSON.stringify({ page, limit: 50, busca, preservarTurmas: true }),
      });
      const alunosPagina = data.alunos || data.dados || [];
      const meta = {
        totalRegistros: Number(data.totalRegistros || alunosPagina.length || 0),
        totalPagina: Number(data.totalPagina ?? alunosPagina.length),
        turmasPagina: Number(data.turmasPagina || 0),
        paginaAtual: Number(data.paginaAtual || page),
        totalPaginas: Number(data.totalPaginas || 1),
        limite: Number(data.limite || 50),
        paginacaoPorTurma: Boolean(data.paginacaoPorTurma),
      };

      setAlunos(alunosPagina);
      setMetaAlunos(meta);
      sinalizarPaginaCarregada(meta.paginaAtual);
      cacheRef.current.paginasAlunos = {
        ...(cacheRef.current.paginasAlunos || {}),
        [chaveCache]: { alunos: alunosPagina, meta },
      };
      return { alunos: alunosPagina, meta };
    } catch (error) {
      setErroRegistros(error.message || "Erro ao carregar alunos.");
      return null;
    } finally {
      setCarregandoRegistros(false);
    }
  }

  function sinalizarPaginaCarregada(paginaCarregada) {
    if (paginaSolicitadaRef.current !== paginaCarregada) return;

    paginaSolicitadaRef.current = null;
    window.setTimeout(() => {
      registrosPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  async function carregarRegistrosCompletos({ forcarAtualizacao = false } = {}) {
    setCarregandoRegistros(true);
    setErroRegistros("");

    try {
      const [turmasData, equipeData] = await Promise.all([
        apiFetch("/api/registros/turmas"),
        apiFetch("/api/registros/equipe"),
      ]);

      setTurmas(turmasData.turmas || []);
      setEquipe(equipeData.equipe || []);
      await carregarAlunosPaginados({ page: paginaAlunos, busca: pesquisaAlunoDebounced, forcarAtualizacao });
    } catch (error) {
      setErroRegistros(error.message || "Erro ao carregar registros.");
    } finally {
      setCarregandoRegistros(false);
    }
  }


  async function carregarMetricasPainel() {
    try {
      const data = await apiFetch("/api/admin/painel");
      setMetricasDia((metricasAtuais) => normalizarDashboard(
        data,
        metricasAtuais.alunosAtrasados || []
      ));
    } catch (error) {
      registrarErroCliente("admin.carregarMetricas", error);
    }
  }

  async function carregarAlunosAtrasadosPainel() {
    const data = await apiFetch("/api/admin/painel", {
      params: { incluirAlunosAtrasados: 1 },
    });

    const lista = Array.isArray(data.alunosAtrasados) ? data.alunosAtrasados : [];

    setMetricasDia(normalizarDashboard({ ...data, alunosAtrasados: lista }));

    return lista;
  }

  async function carregarConfiguracaoEscola() {
    try {
      const data = await buscarConfiguracaoEscola();
      setHorarioLimiteAtraso(String(data.horarioLimiteAtraso || data.horario_limite_atraso || "07:45").slice(0, 5));
      setTempoMaximoJustificativasMeses(Number(data.tempoMaximoJustificativasMeses || data.tempo_maximo_justificativas_meses || 1));
      const bloqueioAtivado = data.bloquearEdicaoChamadasAposHorario
        ?? data.bloquear_edicao_chamadas_apos_horario
        ?? true;
      setBloqueioEdicaoAposHorario(Boolean(bloqueioAtivado));
      setBloqueioEdicaoSalvo(Boolean(bloqueioAtivado));
    } catch (error) {
      registrarErroCliente("admin.carregarConfiguracao", error);
    }
  }

  async function carregarTelaSobDemanda(tela, opcoes = {}) {
    const forcarAtualizacao = Boolean(opcoes.forcarAtualizacao);
    const cache = cacheRef.current;

    if (!forcarAtualizacao && requisicoesEmAndamentoRef.current[tela]) return;

    try {
      requisicoesEmAndamentoRef.current[tela] = true;

      if (tela === "painel") {
        const tarefas = [];
        if (forcarAtualizacao || !cache.dashboardCarregado) tarefas.push(carregarMetricasPainel());
        if (forcarAtualizacao || !cache.configAtrasoCarregada) tarefas.push(carregarConfiguracaoEscola());

        if (tarefas.length) await Promise.all(tarefas);

        cache.dashboardCarregado = true;
        cache.configAtrasoCarregada = true;
        return;
      }

      if (tela === "registros") {
        if (forcarAtualizacao || !cache.registrosCarregados || !cache.filtrosCarregados) {
          await carregarRegistrosCompletos({ forcarAtualizacao });
          cache.registrosCarregados = true;
          cache.filtrosCarregados = true;
        }
        return;
      }

      if (tela === "relatorios") {
        cache.relatoriosCarregados = true;
        return;
      }

      if (tela === "configuracoes") {
        if (forcarAtualizacao || !cache.configAtrasoCarregada) {
          await carregarConfiguracaoEscola();
          cache.configAtrasoCarregada = true;
        }
      }
    } catch (error) {
      registrarErroCliente("admin.carregarTela", error);
    } finally {
      requisicoesEmAndamentoRef.current[tela] = false;
    }
  }

  function trocarTela(tela) {
    setTelaAtiva(tela);
    fecharSidebarMobile();
    carregarTelaSobDemanda(tela).catch((error) => registrarErroCliente("admin.carregarSobDemanda", error));
  }

  async function handleSalvarHorarioLimite(event) {
    event.preventDefault();
    setSalvandoConfig(true);
    setMensagemConfig("");

    try {
      const data = await salvarConfiguracaoEscola({
        horario_limite_atraso: horarioLimiteAtraso,
        tempo_maximo_justificativas_meses: tempoMaximoJustificativasMeses,
      });
      setHorarioLimiteAtraso(String(data.horarioLimiteAtraso || horarioLimiteAtraso).slice(0, 5));
      setTempoMaximoJustificativasMeses(Number(data.tempoMaximoJustificativasMeses || tempoMaximoJustificativasMeses));
      setMensagemConfig("Configurações da escola salvas com sucesso.");
      cacheRef.current.configAtrasoCarregada = true;
    } catch (error) {
      setMensagemConfig(error.message || "Erro ao salvar horário máximo de chegada.");
    } finally {
      setSalvandoConfig(false);
    }
  }


  async function handleSalvarRetencaoJustificativas(event) {
    event.preventDefault();
    setSalvandoConfig(true);
    setMensagemConfig("");

    try {
      const data = await salvarConfiguracaoEscola({
        horario_limite_atraso: horarioLimiteAtraso,
        tempo_maximo_justificativas_meses: tempoMaximoJustificativasMeses,
      });
      setTempoMaximoJustificativasMeses(Number(data.tempoMaximoJustificativasMeses || tempoMaximoJustificativasMeses));
      setMensagemConfig("Tempo máximo de armazenamento das justificativas salvo com sucesso.");
      cacheRef.current.configAtrasoCarregada = true;
    } catch (error) {
      setMensagemConfig(error.message || "Erro ao salvar tempo máximo das justificativas.");
    } finally {
      setSalvandoConfig(false);
    }
  }

  async function handleSalvarBloqueioEdicao(event) {
    event.preventDefault();
    if (salvandoBloqueioEdicao) return;

    setSalvandoBloqueioEdicao(true);
    setFeedbackBloqueioEdicao({ tipo: "", mensagem: "" });

    try {
      const data = await salvarConfiguracaoEscola({
        bloquear_edicao_chamadas_apos_horario: bloqueioEdicaoAposHorario,
      });
      const valorPersistido = data.bloquearEdicaoChamadasAposHorario
        ?? data.bloquear_edicao_chamadas_apos_horario
        ?? true;
      setBloqueioEdicaoAposHorario(Boolean(valorPersistido));
      setBloqueioEdicaoSalvo(Boolean(valorPersistido));
      setFeedbackBloqueioEdicao({
        tipo: "sucesso",
        mensagem: `Bloqueio ${valorPersistido ? "ativado" : "desativado"} com sucesso.`,
      });
      cacheRef.current.configAtrasoCarregada = true;
    } catch (error) {
      setBloqueioEdicaoAposHorario(bloqueioEdicaoSalvo);
      setFeedbackBloqueioEdicao({
        tipo: "erro",
        mensagem: error.message || "Não foi possível salvar a configuração de bloqueio.",
      });
    } finally {
      setSalvandoBloqueioEdicao(false);
    }
  }

  useEffect(() => {
    async function iniciarPagina() {
      try {
        setUsuarioLogado(usuario);
        await Promise.all([carregarMetricasPainel(), carregarConfiguracaoEscola()]);
        cacheRef.current.dashboardCarregado = true;
        cacheRef.current.configAtrasoCarregada = true;
      } catch (error) {
        setMensagemConfig(error.message || "Não foi possível carregar todos os dados iniciais.");
      }
    }

    iniciarPagina();
  }, []);

  async function sair() {
    try {
      await encerrarSessao();
    } catch {
      // O contexto remove o estado local mesmo se o servidor já tiver encerrado a sessão.
    }
  }


const [turmas, setTurmas] = useState([]);

const [alunos, setAlunos] = useState([]);

const [equipe, setEquipe] = useState([]);

const normalizarBusca = (valor = "") =>
  String(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const apenasDigitosBusca = (valor = "") => String(valor).replace(/\D/g, "");

const pontuarPesquisaAluno = (aluno, termoNormalizado, digitosBusca) => {
  if (!termoNormalizado && !digitosBusca) return 1;

  const nomeAluno = normalizarBusca(aluno.nome);
  const turmaAluno = normalizarBusca(aluno.turma);
  const responsaveis = aluno.responsaveis || [];
  const nomesResponsaveis = responsaveis.map((responsavel) => normalizarBusca(responsavel.nome));
  const contatosResponsaveis = responsaveis.flatMap((responsavel) => [
    normalizarBusca(responsavel.contato),
    normalizarBusca(responsavel.telefone),
  ]);
  const contatosDigitos = responsaveis.flatMap((responsavel) => [
    apenasDigitosBusca(responsavel.contato),
    apenasDigitosBusca(responsavel.telefone),
  ]);

  if (digitosBusca && contatosDigitos.some((contato) => contato === digitosBusca)) return 100;
  if (nomeAluno === termoNormalizado || nomesResponsaveis.some((nome) => nome === termoNormalizado)) return 95;
  if (digitosBusca && contatosDigitos.some((contato) => contato.includes(digitosBusca))) return 90;
  if (nomeAluno.startsWith(termoNormalizado) || nomesResponsaveis.some((nome) => nome.startsWith(termoNormalizado))) return 80;
  if (nomeAluno.includes(termoNormalizado) || nomesResponsaveis.some((nome) => nome.includes(termoNormalizado))) return 70;
  if (contatosResponsaveis.some((contato) => contato.includes(termoNormalizado))) return 60;
  if (turmaAluno.includes(termoNormalizado)) return 40;

  return 0;
};

const termoPesquisaAluno = useMemo(
  () => normalizarBusca(pesquisaAlunoDebounced),
  [pesquisaAlunoDebounced]
);

const pesquisaAlunoAtiva = useMemo(
  () => Boolean(termoPesquisaAluno || apenasDigitosBusca(pesquisaAlunoDebounced)),
  [termoPesquisaAluno, pesquisaAlunoDebounced]
);

const alunosFiltrados = useMemo(() => alunos, [alunos]);

const alunosPorTurma = useMemo(() => {
  return turmas
    .map((turma) => ({
      ...turma,
      alunos: alunosFiltrados.filter((aluno) => aluno.turma === turma.nome),
    }))
    .filter((turma) => turma.alunos.length > 0);
}, [turmas, alunosFiltrados]);

const alunosSemTurma = useMemo(
  () => alunosFiltrados.filter((aluno) => !aluno.turma),
  [alunosFiltrados]
);


useEffect(() => {
  const timer = window.setTimeout(() => {
    const termo = String(pesquisaAluno || "").trim();
    setPaginaAlunos(1);
    setPesquisaAlunoDebounced(termo.length >= MIN_CARACTERES_BUSCA_ALUNOS ? pesquisaAluno : "");
  }, 900);

  return () => window.clearTimeout(timer);
}, [pesquisaAluno]);

useEffect(() => {
  if (telaAtiva !== "registros" || abaRegistros !== "alunos") return;
  carregarAlunosPaginados({ page: paginaAlunos, busca: pesquisaAlunoDebounced })
    .catch((error) => registrarErroCliente("admin.carregarAlunos", error));
}, [telaAtiva, abaRegistros, paginaAlunos, pesquisaAlunoDebounced]);

useEffect(() => {
  if (abaRegistros !== "alunos") return;

  if (!pesquisaAlunoAtiva) {
    setTurmasAbertas({});
    setAlunoDestacadoId(null);
    primeiraBuscaAplicadaRef.current = false;
    return;
  }

  const proximasTurmasAbertas = {};

  if (alunosSemTurma.length > 0) {
    proximasTurmasAbertas["sem-turma"] = true;
  }

  alunosPorTurma.forEach((turma) => {
    if (turma.alunos.length > 0) {
      proximasTurmasAbertas[turma.nome] = true;
    }
  });

  setTurmasAbertas(proximasTurmasAbertas);

  const primeiroResultado = alunosFiltrados[0];
  if (!primeiroResultado) {
    setAlunoDestacadoId(null);
    return;
  }

  setAlunoDestacadoId(primeiroResultado.id);

  window.setTimeout(() => {
    linhaAlunoRefs.current[primeiroResultado.id]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, primeiraBuscaAplicadaRef.current ? 80 : 160);

  primeiraBuscaAplicadaRef.current = true;
}, [abaRegistros, pesquisaAlunoAtiva, alunosFiltrados, alunosPorTurma, alunosSemTurma]);

const totalMetricasDia =
  metricasDia.presentes + metricasDia.ausentes;

const calcularPercentual = (valor, total) =>
  total > 0 ? Math.round((Number(valor || 0) / total) * 100) : 0;

const porcentagemPresenca = calcularPercentual(metricasDia.presentes, totalMetricasDia);
const porcentagemAusencia = calcularPercentual(metricasDia.ausentes, totalMetricasDia);
const porcentagemJustificada = calcularPercentual(metricasDia.justificados, metricasDia.ausentes);
const porcentagemAtraso = calcularPercentual(metricasDia.atrasos, metricasDia.presentes);

const categoriasEquipe = [
  {
    titulo: "Administradores(as)",
    cargo: "Administrador",
  },
  {
    titulo: "Pedagogos(as)",
    cargo: "Pedagoga",
  },
  {
    titulo: "Professores(ras)",
    cargo: "Professor",
  },
];


function toggleTurma(nomeTurma) {
  setTurmasAbertas((prev) => ({
    ...prev,
    [nomeTurma]: !prev[nomeTurma],
  }));
}

function toggleAluno(idAluno) {
  setAlunosAbertos((prev) => ({
    ...prev,
    [idAluno]: !prev[idAluno],
  }));
}

function trocarPaginaAlunos(paginaDestino) {
  const paginaSegura = Math.min(
    Math.max(Number(paginaDestino) || 1, 1),
    Math.max(metaAlunos.totalPaginas, 1)
  );

  if (carregandoRegistros || paginaSegura === metaAlunos.paginaAtual) return;

  paginaSolicitadaRef.current = paginaSegura;
  setTurmasAbertas({});
  setAlunosAbertos({});
  setAlunoDestacadoId(null);
  setPaginaAlunos(paginaSegura);
}


async function handleCadastrarAluno(event) {
  event.preventDefault();
  setErroRegistros("");

  const formData = new FormData(event.currentTarget);

  const novoAluno = {
    nome: formData.get("nome"),
    idade: Number(formData.get("idade")),
    turma: formData.get("turma"),
    responsaveis: [
      {
        nome: formData.get("responsavel"),
        contato: formData.get("contato"),
        parentesco: formData.get("parentesco") || "Responsável",
      },
    ],
  };

  try {
    const data = await apiFetch("/api/registros/alunos", {
      method: "POST",
      body: JSON.stringify(novoAluno),
    });

    cacheRef.current.paginasAlunos = {};
    await carregarAlunosPaginados({ page: paginaAlunos, busca: pesquisaAlunoDebounced, forcarAtualizacao: true });
    setModalAluno(null);
  } catch (error) {
    setErroRegistros(error.message || "Erro ao cadastrar aluno.");
  }
}

async function handleEditarAluno(event) {
  event.preventDefault();
  setErroRegistros("");

  const formData = new FormData(event.currentTarget);

  const alunoEditado = {
    nome: formData.get("nome"),
    idade: Number(formData.get("idade")),
    turma: formData.get("turma"),
    responsaveis: [
      {
        nome: formData.get("responsavel"),
        contato: formData.get("contato"),
        parentesco: formData.get("parentesco") || "Responsável",
      },
    ],
  };

  try {
    const data = await apiFetch(`/api/registros/alunos/${modalAluno.aluno.id}`, {
      method: "PUT",
      body: JSON.stringify(alunoEditado),
    });

    cacheRef.current.paginasAlunos = {};
    await carregarAlunosPaginados({ page: paginaAlunos, busca: pesquisaAlunoDebounced, forcarAtualizacao: true });
    setModalAluno(null);
  } catch (error) {
    setErroRegistros(error.message || "Erro ao editar aluno.");
  }
}

async function handleRemoverAluno(idAluno) {
  setErroRegistros("");

  try {
    const data = await apiFetch(`/api/registros/alunos/${idAluno}`, {
      method: "DELETE",
    });

    cacheRef.current.paginasAlunos = {};
    await carregarAlunosPaginados({ page: paginaAlunos, busca: pesquisaAlunoDebounced, forcarAtualizacao: true });
    setConfirmacao(null);
  } catch (error) {
    setErroRegistros(error.message || "Erro ao remover aluno.");
  }
}

function handleAlterarTurmaAluno(idAluno, novaTurma) {
  const alunoAtual = alunos.find((aluno) => aluno.id === idAluno);

  if (alunoAtual?.turma && alunoAtual.turma !== novaTurma) {
    setAvisoMoverAluno({
      idAluno,
      novaTurma,
      turmaAtual: alunoAtual.turma,
    });
    return;
  }

  salvarTurmaAluno(idAluno, novaTurma);
}

async function salvarTurmaAluno(idAluno, novaTurma) {
  setErroRegistros("");

  try {
    const data = await apiFetch(`/api/registros/alunos/${idAluno}/turma`, {
      method: "PATCH",
      body: JSON.stringify({ turma: novaTurma }),
    });

    cacheRef.current.paginasAlunos = {};
    await carregarAlunosPaginados({ page: paginaAlunos, busca: pesquisaAlunoDebounced, forcarAtualizacao: true });
  } catch (error) {
    setErroRegistros(error.message || "Erro ao alterar turma do aluno.");
  }
}

async function confirmarMoverAluno() {
  await salvarTurmaAluno(avisoMoverAluno.idAluno, avisoMoverAluno.novaTurma);
  setAvisoMoverAluno(null);
}

async function handleCriarTurma(event) {
  event.preventDefault();
  setErroRegistros("");

  const formData = new FormData(event.currentTarget);
  const nomeTurma = formData.get("nomeTurma");
  const alunosSelecionados = formData.getAll("alunos").map(Number);

  try {
    const dataTurma = await apiFetch("/api/registros/turmas", {
      method: "POST",
      body: JSON.stringify({ nome: nomeTurma }),
    });

    setTurmas((prev) => [...prev, dataTurma.turma]);

    for (const alunoId of alunosSelecionados) {
      await apiFetch(`/api/registros/alunos/${alunoId}/turma`, {
        method: "PATCH",
        body: JSON.stringify({ turma: nomeTurma }),
      });
    }

    cacheRef.current.paginasAlunos = {};
    await carregarRegistrosCompletos({ forcarAtualizacao: true });
    cacheRef.current.registrosCarregados = true;
    cacheRef.current.filtrosCarregados = true;
    setModalTurma(false);
  } catch (error) {
    setErroRegistros(error.message || "Erro ao criar turma.");
  }
}

async function handleEditarTurma(event) {
  event.preventDefault();
  setErroRegistros("");

  const formData = new FormData(event.currentTarget);
  const nomeTurma = formData.get("nomeTurma");
  try {
    const data = await apiFetch(`/api/registros/turmas/${modalTurma.turma.id}`, {
      method: "PUT",
      body: JSON.stringify({ nome: nomeTurma }),
    });

    setTurmas(data.turmas || []);
    cacheRef.current.paginasAlunos = {};
    await carregarRegistrosCompletos({ forcarAtualizacao: true });
    cacheRef.current.registrosCarregados = true;
    cacheRef.current.filtrosCarregados = true;
    setModalTurma(false);
  } catch (error) {
    setErroRegistros(error.message || "Erro ao editar turma.");
  }
}

async function handleRemoverTurma(idTurma) {
  setErroRegistros("");

  try {
    const data = await apiFetch(`/api/registros/turmas/${idTurma}`, {
      method: "DELETE",
    });

    setTurmas(data.turmas || []);
    cacheRef.current.paginasAlunos = {};
    await carregarAlunosPaginados({ page: paginaAlunos, busca: pesquisaAlunoDebounced, forcarAtualizacao: true });
    setConfirmacao(null);
  } catch (error) {
    setErroRegistros(error.message || "Erro ao remover turma.");
  }
}

async function handleCriarContaEquipe(event) {
  event.preventDefault();
  setErroRegistros("");

  const formData = new FormData(event.currentTarget);

  const novaConta = {
    nome: formData.get("nome"),
    email: formData.get("email"),
    senha: formData.get("senha"),
    cargo: formData.get("cargo"),
  };

  try {
    const data = await apiFetch("/api/registros/equipe", {
      method: "POST",
      body: JSON.stringify(novaConta),
    });

    if (data.pessoa) setEquipe((prev) => [...prev, data.pessoa]);
    setModalEquipe(null);
  } catch (error) {
    setErroRegistros(error.message || "Erro ao criar conta.");
  }
}

async function handleEditarEquipe(event) {
  event.preventDefault();
  setErroRegistros("");

  const formData = new FormData(event.currentTarget);

  const pessoaEditada = {
    nome: formData.get("nome"),
    email: formData.get("email"),
    senha: formData.get("senha"),
    cargo: formData.get("cargo"),
    status: formData.get("status"),
  };

  try {
    const data = await apiFetch(`/api/registros/equipe/${modalEquipe.pessoa.id}`, {
      method: "PUT",
      body: JSON.stringify(pessoaEditada),
    });

    if (data.pessoa) {
      setEquipe((prev) => prev.map((pessoa) => (
        Number(pessoa.id) === Number(data.pessoa.id) ? data.pessoa : pessoa
      )));
    }
    setModalEquipe(null);
  } catch (error) {
    setErroRegistros(error.message || "Erro ao editar conta.");
  }
}

async function handleRemoverEquipe(idPessoa) {
  setErroRegistros("");

  try {
    const data = await apiFetch(`/api/registros/equipe/${idPessoa}`, {
      method: "DELETE",
    });

    const idRemovido = Number(data.id || idPessoa);
    setEquipe((prev) => prev.filter((pessoa) => Number(pessoa.id) !== idRemovido));
    setConfirmacao(null);
  } catch (error) {
    setErroRegistros(error.message || "Erro ao remover conta.");
  }
}

  function fecharSidebarMobile() {
    setSidebarOpen(false);
  }


  async function handleSalvarConfiguracoes(event) {
    event.preventDefault();
    setSalvandoConfig(true);
    setMensagemConfig("");

    const formulario = event.currentTarget;
    const formData = new FormData(formulario);

    const dadosAdmin = {
      nome: formData.get("nome"),
      email: formData.get("email"),
      senha: formData.get("senha"),
    };

    try {
      const data = await apiFetch("/api/usuarios/configurar", {
        method: "PUT",
        body: JSON.stringify(dadosAdmin),
      });

      if (data.sessaoEncerrada) {
        alert("Senha atualizada. Entre novamente para continuar.");
        await encerrarSessao();
        return;
      }

      setUsuarioLogado(data.usuario);
      setMensagemConfig(data.mensagem || "Configurações atualizadas com sucesso.");
      formulario.reset();
    } catch (error) {
      setMensagemConfig(error.message || "Erro ao atualizar configurações.");
    } finally {
      setSalvandoConfig(false);
    }
  }

  return (
    <main className="admin-page">
      <aside className={`admin-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="admin-sidebar-header">
          <div>
            <span className="admin-logo">SC</span>
            <h2>SISTEMA DE CHAMADAS</h2>
          </div>

        </div>

        <nav className="admin-menu">
          <button
            className={telaAtiva === "painel" ? "active" : ""}
            onClick={() => trocarTela("painel")}
          >
            Painel Principal
          </button>


          <button
            className={telaAtiva === "registros" ? "active" : ""}
            onClick={() => trocarTela("registros")}
          >
            Gestão de Registros
          </button>

          <button
            className={telaAtiva === "relatorios" ? "active" : ""}
            onClick={() => trocarTela("relatorios")}
          >
            Relatórios Avançados
          </button>

          <button
            className={telaAtiva === "mensagens" ? "active" : ""}
            onClick={() => trocarTela("mensagens")}
          >
            Mensagens
          </button>


          <button
            className={telaAtiva === "auditoria" ? "active" : ""}
            onClick={() => trocarTela("auditoria")}
          >
            Logs de Auditoria
          </button>

          <button
            className={telaAtiva === "configuracoes" ? "active" : ""}
            onClick={() => trocarTela("configuracoes")}
          >
            Configurações
          </button>
        </nav>
      </aside>

      {sidebarOpen && (
        <button
          className="admin-overlay"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      )}

      <section className="admin-content">
        <header className="admin-topbar">
          <button
            className="admin-menu-toggle"
            onClick={() => setSidebarOpen(true)}
            type="button"
            aria-label="Abrir menu de navegação"
          >
            ☰
          </button>

          <div className="admin-topbar-title">
            <p>Sistema de Gestão Escolar</p>
            <h1>Ambiente Administrativo</h1>
          </div>

          <div className="admin-profile">
            <div className="admin-avatar">
              {usuarioLogado?.nome?.charAt(0)?.toUpperCase() || "A"}
            </div>

            <div>
              <strong>{usuarioLogado?.nome || "Administrador"}</strong>
              <small>{usuarioLogado?.email || "admin@email.com"}</small>
            </div>

            <button
              className="admin-logout-icon-btn"
              type="button"
              onClick={sair}
              aria-label="Sair do sistema"
              title="Sair do sistema"
            >
              <LogOut size={20} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        </header>

        {telaAtiva === "painel" && (
          <section className="admin-section">
            <div className="admin-title-box">
              <h2>Painel Principal</h2>
              <p>Indicadores institucionais consolidados do dia atual.</p>
            </div>

            <div className="dashboard-tab-toggle" role="tablist" aria-label="Alternar visão do painel administrativo">
              <button
                type="button"
                role="tab"
                aria-selected={abaPainel === "geral"}
                className={abaPainel === "geral" ? "active" : ""}
                onClick={() => setAbaPainel("geral")}
              >
                Visão Geral
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={abaPainel === "atrasos"}
                className={abaPainel === "atrasos" ? "active" : ""}
                onClick={() => setAbaPainel("atrasos")}
              >
                Painel de Atrasos
              </button>
            </div>

            {abaPainel === "geral" ? (
              <>
                <div className="admin-cards-grid">
                  <article className="admin-card">
                    <span>Alunos cadastrados</span>
                    <strong>{metricasDia.alunosCadastrados}</strong>
                  </article>

                  <article className="admin-card admin-card-mobile-secondary">
                    <span>Chamadas hoje</span>
                    <strong>{metricasDia.chamadasHoje}</strong>
                  </article>

                  <article className="admin-card admin-card-mobile-secondary">
                    <span>Chamadas pendentes</span>
                    <strong>{metricasDia.chamadasPendentes}</strong>
                  </article>

                  <article className="admin-card">
                    <span>Presenças</span>
                    <strong>{metricasDia.presentes}</strong>
                  </article>

                  <article className="admin-card">
                    <span>Ausências</span>
                    <strong>{metricasDia.ausentes}</strong>
                  </article>

                  <article className="admin-card admin-card-mobile-secondary">
                    <span>Justificados</span>
                    <strong>{metricasDia.justificados}</strong>
                    <small>Incluídos nas ausências</small>
                  </article>

                  <article className="admin-card">
                    <span>Atraso</span>
                    <strong>{metricasDia.atrasos}</strong>
                    <small>Incluídos nas presenças</small>
                  </article>

                  <article className="admin-card admin-card-mobile-secondary">
                    <span>Taxa de frequência</span>
                    <strong>{metricasDia.taxaFrequencia}%</strong>
                  </article>
                </div>

                <TurmasDashboardCard turmas={metricasDia.turmas} />

                <form className="chart-card atraso-config-card" onSubmit={handleSalvarHorarioLimite}>
                  <h3>Horário Máximo de Chegada</h3>
                  <p>Defina o horário máximo para chegada do aluno. Após esse limite, o registro permanece como ausência.</p>

                  <label className="admin-time-config">
                    Horário máximo de chegada
                    <input
                      type="time"
                      value={horarioLimiteAtraso}
                      onChange={(event) => setHorarioLimiteAtraso(event.target.value)}
                      required
                    />
                  </label>

                  <label className="admin-time-config">
                    Tempo máximo de justificativas
                    <select
                      value={tempoMaximoJustificativasMeses}
                      onChange={(event) => setTempoMaximoJustificativasMeses(Number(event.target.value))}
                      required
                    >
                      <option value={1}>1 mês</option>
                      <option value={2}>2 meses</option>
                      <option value={3}>3 meses</option>
                    </select>
                  </label>

                  <button className="admin-primary-btn" type="submit" disabled={salvandoConfig}>
                    {salvandoConfig ? "Processando..." : "Atualizar horário"}
                  </button>

                  {mensagemConfig && <p className="admin-config-message">{mensagemConfig}</p>}
                </form>

                <div className="chart-card">
                  <h3>Indicadores e composição diária</h3>

                  <MetricProgressChart
                    ariaLabel="Composição dos indicadores diários"
                    itens={[
                      { id: "presencas", rotulo: "Presenças", valor: porcentagemPresenca, tom: "success" },
                      { id: "ausencias", rotulo: "Ausências", valor: porcentagemAusencia, tom: "danger" },
                      {
                        id: "justificados",
                        rotulo: "Justificados",
                        valor: porcentagemJustificada,
                        tom: "info",
                        detalhe: "Percentual dentro das ausências",
                      },
                      {
                        id: "atrasos",
                        rotulo: "Atrasos",
                        valor: porcentagemAtraso,
                        tom: "warning",
                        detalhe: "Percentual dentro das presenças",
                      },
                    ]}
                  />
                </div>
              </>
            ) : (
              <AlunosAtrasadosCard
                alunos={metricasDia.alunosAtrasados}
                carregarAlunosAtrasados={carregarAlunosAtrasadosPainel}
                cacheNamespace={ATRASOS_CACHE_NAMESPACE}
                horarioLimiteAtraso={horarioLimiteAtraso}
              />
            )}
          </section>
        )}

        {telaAtiva === "registros" && (
          <section className="admin-section">
            <div className="admin-title-box">
              <h2>Gestão de Registros</h2>
              <p>Gerencie cadastros de alunos, turmas, responsáveis e equipe escolar com segurança.</p>
            </div>

            {erroRegistros && <p className="admin-error-message">{erroRegistros}</p>}

            {carregandoRegistros && <div className="admin-loading-state">Carregando registros institucionais...</div>}

            <div className="admin-tabs">
              <button
                className={abaRegistros === "alunos" ? "active" : ""}
                onClick={() => setAbaRegistros("alunos")}
                type="button"
              >
                Alunos e responsáveis
              </button>

              <button
                className={abaRegistros === "turmas" ? "active" : ""}
                onClick={() => setAbaRegistros("turmas")}
                type="button"
              >
                Gestão de turmas
              </button>

              <button
                className={abaRegistros === "equipe" ? "active" : ""}
                onClick={() => setAbaRegistros("equipe")}
                type="button"
              >
                Equipe escolar
              </button>
            </div>

            {abaRegistros === "alunos" && (
              <div className="admin-panel" ref={registrosPanelRef}>
                <div className="admin-panel-header">
                  <h3>Alunos e responsáveis</h3>

                  <button
                    className="admin-primary-btn"
                    type="button"
                    onClick={() => setModalAluno({ tipo: "cadastrar", aluno: null })}
                  >
                    + Novo aluno
                  </button>
                </div>

                <div className="filter-panel">
                  <label>
                    Pesquisar aluno, responsável ou contato
                    <input
                      type="text"
                      placeholder="Digite aluno, responsável ou telefone"
                      value={pesquisaAluno}
                      onChange={(event) => setPesquisaAluno(event.target.value)}
                    />
                  </label>
                </div>

                <div className="admin-accordion-list">
                  {alunosFiltrados.length === 0 && <div className="empty-state">Nenhum registro encontrado</div>}
                  {alunosSemTurma.length > 0 && (
                    <div className="admin-accordion">
                      <button
                        className="admin-accordion-header"
                        type="button"
                        onClick={() => toggleTurma("sem-turma")}
                      >
                        <strong>Alunos sem turma vinculada</strong>
                        <span>{turmasAbertas["sem-turma"] ? "−" : "+"}</span>
                      </button>

                      {turmasAbertas["sem-turma"] && (
                        <div className="admin-accordion-content">
                          <div className="admin-table-wrapper">
                            <table>
                              <thead>
                                <tr>
                                  <th>Aluno</th>
                                      <th>Turma</th>
                                  <th>Responsável</th>
                                  <th>Contato do responsável</th>
                                  <th>Ações</th>
                                </tr>
                              </thead>

                              <tbody>
                                {alunosSemTurma.map((aluno) => (
                                  <Fragment key={aluno.id}>
                                    <tr
                                      ref={(elemento) => {
                                        if (elemento) linhaAlunoRefs.current[aluno.id] = elemento;
                                      }}
                                      className={pesquisaAlunoAtiva || alunoDestacadoId === aluno.id ? "admin-registro-destacado" : ""}
                                      onClick={() => toggleAluno(aluno.id)}
                                    >
                                      <td>{aluno.nome}</td>
                                      <td>{aluno.idade}</td>
                                      <td>
                                        <select
                                          value={aluno.turma}
                                          onClick={(event) => event.stopPropagation()}
                                          onChange={(event) =>
                                            handleAlterarTurmaAluno(
                                              aluno.id,
                                              event.target.value
                                            )
                                          }
                                        >
                                          <option value="">
                                            Alunos sem turma vinculada
                                          </option>

                                          {turmas.map((turma) => (
                                            <option key={turma.id} value={turma.nome}>
                                              {turma.nome}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                      <td>{aluno.responsaveis?.[0]?.nome}</td>
                                      <td>{aluno.responsaveis?.[0]?.contato}</td>
                                      <td>
                                        <button
                                          className="admin-primary-btn"
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setModalAluno({
                                              tipo: "editar",
                                              aluno,
                                            });
                                          }}
                                        >
                                          Editar dados
                                        </button>

                                        <button
                                          className="admin-danger-btn"
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setConfirmacao({
                                              tipo: "removerAluno",
                                              id: aluno.id,
                                              mensagem:
                                                "Tem certeza que deseja remover este aluno?",
                                            });
                                          }}
                                        >
                                          Remover registro
                                        </button>
                                      </td>
                                    </tr>

                                    {alunosAbertos[aluno.id] && (
                                      <tr>
                                        <td colSpan="6">
                                          <strong>Detalhes do responsável:</strong>

                                          {aluno.responsaveis.map((responsavel) => (
                                            <p key={responsavel.contato}>
                                              {responsavel.nome} —{" "}
                                              {responsavel.parentesco} —{" "}
                                              {responsavel.contato}
                                            </p>
                                          ))}
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {alunosPorTurma.map((turma) => (
                    <div className="admin-accordion" key={turma.id}>
                      <button
                        className="admin-accordion-header"
                        type="button"
                        onClick={() => toggleTurma(turma.nome)}
                      >
                        <strong>{turma.nome}</strong>
                        <span>{turmasAbertas[turma.nome] ? "−" : "+"}</span>
                      </button>

                      {turmasAbertas[turma.nome] && (
                        <div className="admin-accordion-content">
                          <div className="admin-table-wrapper">
                            <table>
                              <thead>
                                <tr>
                                  <th>Aluno</th>
                                      <th>Turma</th>
                                  <th>Responsável</th>
                                  <th>Contato do responsável</th>
                                  <th>Ações</th>
                                </tr>
                              </thead>

                              <tbody>
                                {turma.alunos.length === 0 && (
                                  <tr>
                                    <td colSpan="6">Nenhum aluno nesta turma.</td>
                                  </tr>
                                )}

                                {turma.alunos.map((aluno) => (
                                  <Fragment key={aluno.id}>
                                    <tr
                                      ref={(elemento) => {
                                        if (elemento) linhaAlunoRefs.current[aluno.id] = elemento;
                                      }}
                                      className={pesquisaAlunoAtiva || alunoDestacadoId === aluno.id ? "admin-registro-destacado" : ""}
                                      onClick={() => toggleAluno(aluno.id)}
                                    >
                                      <td>{aluno.nome}</td>
                                      <td>{aluno.idade}</td>
                                      <td>
                                        <select
                                          value={aluno.turma}
                                          onClick={(event) => event.stopPropagation()}
                                          onChange={(event) =>
                                            handleAlterarTurmaAluno(
                                              aluno.id,
                                              event.target.value
                                            )
                                          }
                                        >
                                          <option value="">
                                            Alunos sem turma vinculada
                                          </option>

                                          {turmas.map((turmaItem) => (
                                            <option
                                              key={turmaItem.id}
                                              value={turmaItem.nome}
                                            >
                                              {turmaItem.nome}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                      <td>{aluno.responsaveis?.[0]?.nome}</td>
                                      <td>{aluno.responsaveis?.[0]?.contato}</td>
                                      <td>
                                        <button
                                          className="admin-primary-btn"
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setModalAluno({
                                              tipo: "editar",
                                              aluno,
                                            });
                                          }}
                                        >
                                          Editar dados
                                        </button>

                                        <button
                                          className="admin-danger-btn"
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setConfirmacao({
                                              tipo: "removerAluno",
                                              id: aluno.id,
                                              mensagem:
                                                "Tem certeza que deseja remover este aluno?",
                                            });
                                          }}
                                        >
                                          Remover registro
                                        </button>
                                      </td>
                                    </tr>

                                    {alunosAbertos[aluno.id] && (
                                      <tr>
                                        <td colSpan="6">
                                          <strong>Detalhes do responsável:</strong>

                                          {aluno.responsaveis.map((responsavel) => (
                                            <p key={responsavel.contato}>
                                              {responsavel.nome} —{" "}
                                              {responsavel.parentesco} —{" "}
                                              {responsavel.contato}
                                            </p>
                                          ))}
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="admin-pagination" aria-label="Paginação de alunos">
                  <button
                    className="admin-secondary-btn admin-pagination-previous"
                    type="button"
                    disabled={carregandoRegistros || metaAlunos.paginaAtual <= 1}
                    onClick={() => trocarPaginaAlunos(metaAlunos.paginaAtual - 1)}
                  >
                    ← Anterior
                  </button>
                  <div className="admin-pagination-status" role="status" aria-live="polite">
                    <strong>
                      {carregandoRegistros
                        ? "Carregando página…"
                        : `Página ${metaAlunos.paginaAtual} de ${metaAlunos.totalPaginas}`}
                    </strong>
                    <span>
                      Exibindo {metaAlunos.totalPagina} de {metaAlunos.totalRegistros} aluno(s)
                    </span>
                    {metaAlunos.paginacaoPorTurma && (
                      <small>
                        {metaAlunos.turmasPagina} grupo(s) completo(s) nesta página
                      </small>
                    )}
                  </div>
                  <button
                    className="admin-primary-btn admin-pagination-next"
                    type="button"
                    disabled={carregandoRegistros || metaAlunos.paginaAtual >= metaAlunos.totalPaginas}
                    onClick={() => trocarPaginaAlunos(metaAlunos.paginaAtual + 1)}
                  >
                    Próxima →
                  </button>
                </div>
              </div>
            )}

            {abaRegistros === "turmas" && (
              <div className="admin-panel admin-turmas-panel">
                <div className="admin-panel-header">
                  <h3>Gestão de turmas</h3>

                  <button
                    className="admin-primary-btn admin-create-btn"
                    type="button"
                    onClick={() => setModalTurma({ tipo: "cadastrar", turma: null })}
                  >
                    <Plus size={17} aria-hidden="true" /> Nova turma
                  </button>
                </div>

                <div className="admin-accordion-list">
                  {turmas.length === 0 && <div className="empty-state">Nenhum registro encontrado</div>}
                  {turmas.map((turma) => {
                    const alunosDaTurma = alunos.filter(
                      (aluno) => aluno.turma === turma.nome
                    );

                    return (
                      <div className="admin-accordion admin-turma-card" key={turma.id}>
                        <div className="admin-turma-row">
                        <button
                          className="admin-turma-toggle"
                          type="button"
                          onClick={() => toggleTurma(`gestao-${turma.nome}`)}
                          aria-expanded={Boolean(turmasAbertas[`gestao-${turma.nome}`])}
                        >
                          <span className="admin-turma-identity">
                            <strong>{turma.nome}</strong>
                            <small>Visualizar alunos vinculados</small>
                          </span>
                          <ChevronDown
                            className={turmasAbertas[`gestao-${turma.nome}`] ? "rotated" : ""}
                            size={19}
                            aria-hidden="true"
                          />
                        </button>

                          <div className="admin-accordion-actions">
                            <button
                              className="admin-primary-btn admin-action-btn"
                              type="button"
                              onClick={() => setModalTurma({ tipo: "editar", turma })}
                              title="Editar turma"
                            >
                              <Pencil size={16} aria-hidden="true" /> Editar
                            </button>

                            <button
                              className="admin-danger-btn admin-action-btn"
                              type="button"
                              onClick={() => {
                                setConfirmacao({
                                  tipo: "removerTurma",
                                  id: turma.id,
                                  mensagem:
                                    "Tem certeza que deseja remover esta turma? Os alunos não serão excluídos, apenas ficarão sem turma.",
                                });
                              }}
                            >
                              <Trash2 size={16} aria-hidden="true" /> Remover
                            </button>
                          </div>
                        </div>

                        {turmasAbertas[`gestao-${turma.nome}`] && (
                          <div className="admin-accordion-content">
                            {alunosDaTurma.length === 0 && (
                              <p>Nenhum aluno vinculado a esta turma.</p>
                            )}

                            {alunosDaTurma.map((aluno) => (
                              <div className="admin-call-row" key={aluno.id}>
                                <strong>{aluno.nome}</strong>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {abaRegistros === "equipe" && (
              <div className="admin-panel admin-team-panel">
                <div className="admin-panel-header">
                  <h3>Equipe escolar</h3>

                  <button
                    className="admin-primary-btn admin-create-btn"
                    type="button"
                    onClick={() => setModalEquipe({ tipo: "cadastrar", pessoa: null })}
                  >
                    <Plus size={17} aria-hidden="true" /> Nova conta
                  </button>
                </div>

                {categoriasEquipe.map((categoria) => {
                  const pessoas = equipe.filter(
                    (pessoa) => pessoa.cargo === categoria.cargo
                  );

                  return (
                    <div className="admin-panel admin-team-category" key={categoria.cargo}>
                      <div className="admin-panel-header">
                        <h3>{categoria.titulo}</h3>
                      </div>

                      <div className="admin-table-wrapper admin-team-table-wrapper">
                        <table className="admin-team-table">
                          <thead>
                            <tr>
                              <th>Nome completo</th>
                              <th>Cargo</th>
                              <th>Status</th>
                              <th>E-mail</th>
                              <th>Ações</th>
                            </tr>
                          </thead>

                          <tbody>
                            {pessoas.map((pessoa) => (
                              <tr key={pessoa.id}>
                                <td data-label="Nome completo">{pessoa.nome}</td>
                                <td data-label="Cargo">{pessoa.cargo}</td>
                                <td data-label="Status">
                                  <span
                                    className={`admin-status ${
                                      pessoa.status === "Ativo" ? "ativo" : "inativo"
                                    }`}
                                  >
                                    {pessoa.status}
                                  </span>
                                </td>
                                <td data-label="E-mail" className="admin-team-email">{pessoa.email}</td>
                                <td data-label="Ações" className="admin-team-actions">
                                  <div className="admin-record-actions">
                                  <button
                                    className="admin-primary-btn admin-action-btn"
                                    type="button"
                                    onClick={() =>
                                      setModalEquipe({
                                        tipo: "editar",
                                        pessoa,
                                      })
                                    }
                                  >
                                    <Pencil size={16} aria-hidden="true" /> Editar
                                  </button>

                                  <button
                                    className="admin-danger-btn admin-action-btn"
                                    type="button"
                                    onClick={() =>
                                      setConfirmacao({
                                        tipo: "removerEquipe",
                                        id: pessoa.id,
                                        mensagem:
                                          "Tem certeza que deseja remover esta conta?",
                                      })
                                    }
                                  >
                                    <Trash2 size={16} aria-hidden="true" /> Remover
                                  </button>
                                  </div>
                                </td>
                              </tr>
                            ))}

                            {pessoas.length === 0 && (
                              <tr>
                                <td className="admin-team-empty" colSpan="5">Nenhum registro encontrado.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {telaAtiva === "relatorios" && (
          <RelatoriosAvancados />
        )}

        {telaAtiva === "mensagens" && (
          <MensagensAdmin />
        )}

        {telaAtiva === "auditoria" && (
          <LogsAuditoria />
        )}

        {modalAluno && (
          <div className="admin-modal-overlay">
            <div className="admin-modal">
              <div className="admin-modal-header">
                <h3>
                  {modalAluno.tipo === "editar" ? "Editar dados Aluno" : "Cadastrar novo aluno"}
                </h3>

                <button type="button" onClick={() => setModalAluno(null)}>
                  ✕
                </button>
              </div>

              <form
                className="admin-modal-form"
                onSubmit={
                  modalAluno.tipo === "editar" ? handleEditarAluno : handleCadastrarAluno
                }
              >
                <input
                  name="nome"
                  type="text"
                  placeholder="Nome do aluno"
                  defaultValue={modalAluno.aluno?.nome || ""}
                  required
                />

                <input
                  name="idade"
                  type="number"
                  placeholder="Idade"
                  defaultValue={modalAluno.aluno?.idade || ""}
                  required
                />

                <select name="turma" defaultValue={modalAluno.aluno?.turma || ""}>
                  <option value="">Alunos sem turma vinculada</option>

                  {turmas.map((turma) => (
                    <option key={turma.id} value={turma.nome}>
                      {turma.nome}
                    </option>
                  ))}
                </select>

                <input
                  name="responsavel"
                  type="text"
                  placeholder="Nome completo do responsável"
                  defaultValue={modalAluno.aluno?.responsaveis?.[0]?.nome || ""}
                  required
                />

                <input
                  name="parentesco"
                  type="text"
                  placeholder="Parentesco"
                  defaultValue={modalAluno.aluno?.responsaveis?.[0]?.parentesco || ""}
                />

                <input
                  name="contato"
                  type="text"
                  placeholder="Contato do responsável"
                  defaultValue={modalAluno.aluno?.responsaveis?.[0]?.contato || ""}
                  required
                />

                <div className="admin-modal-actions">
                  <button
                    className="admin-cancel-btn"
                    type="button"
                    onClick={() => setModalAluno(null)}
                  >
                    Cancelar operação
                  </button>

                  <button className="admin-primary-btn" type="submit">
                    Salvar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {modalTurma && (
          <div className="admin-modal-overlay">
            <div className="admin-modal">
              <div className="admin-modal-header">
                <h3>{modalTurma.tipo === "editar" ? "Editar turma" : "Cadastrar nova turma"}</h3>

                <button type="button" onClick={() => setModalTurma(false)}>
                  ✕
                </button>
              </div>

              <form className="admin-modal-form" onSubmit={modalTurma.tipo === "editar" ? handleEditarTurma : handleCriarTurma}>
                <input
                  name="nomeTurma"
                  type="text"
                  placeholder="Identificação da turma"
                  defaultValue={modalTurma.turma?.nome || ""}
                  required
                />


                {modalTurma.tipo !== "editar" && (
                  <>
                    <strong>Vincular alunos à turma</strong>

                    {[...alunos].sort((a, b) => {
                      if (!a.turma && b.turma) return -1;
                      if (a.turma && !b.turma) return 1;
                      return a.nome.localeCompare(b.nome);
                    }).map((aluno) => (
                      <label key={aluno.id}>
                        <input name="alunos" type="checkbox" value={aluno.id} />
                        {aluno.nome} — {aluno.turma || "Sem turma"}
                      </label>
                    ))}
                  </>
                )}

                <div className="admin-modal-actions">
                  <button
                    className="admin-cancel-btn"
                    type="button"
                    onClick={() => setModalTurma(false)}
                  >
                    Cancelar operação
                  </button>

                  <button className="admin-primary-btn" type="submit">
                    {modalTurma.tipo === "editar" ? "Salvar alterações" : "Cadastrar turma"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {modalEquipe && (
          <div className="admin-modal-overlay">
            <div className="admin-modal">
              <div className="admin-modal-header">
                <h3>
                  {modalEquipe.tipo === "editar"
                    ? "Editar dados Conta"
                    : "Criar conta da equipe escolar"}
                </h3>

                <button type="button" onClick={() => setModalEquipe(null)}>
                  ✕
                </button>
              </div>

              <form
                className="admin-modal-form"
                onSubmit={
                  modalEquipe.tipo === "editar"
                    ? handleEditarEquipe
                    : handleCriarContaEquipe
                }
              >
                <input
                  name="nome"
                  type="text"
                  placeholder="Nome completo"
                  defaultValue={modalEquipe.pessoa?.nome || ""}
                  minLength={2}
                  maxLength={100}
                  required
                />

                <input
                  name="email"
                  type="email"
                  placeholder="E-mail"
                  defaultValue={modalEquipe.pessoa?.email || ""}
                  maxLength={100}
                  required
                />

                <input
                  name="senha"
                  type="password"
                  placeholder={modalEquipe.tipo === "editar" ? "Nova senha (opcional)" : "Senha"}
                  defaultValue=""
                  minLength={6}
                  required={modalEquipe.tipo !== "editar"}
                />

                <select
                  name="cargo"
                  defaultValue={modalEquipe.pessoa?.cargo || ""}
                  required
                >
                  <option value="">Selecione a função institucional</option>
                  <option value="Administrador">Administrador</option>
                  <option value="Pedagoga">Pedagoga</option>
                  <option value="Professor">Professor</option>
                </select>

                {modalEquipe.tipo === "editar" && (
                  <select
                    name="status"
                    defaultValue={modalEquipe.pessoa?.status || "Ativo"}
                    required
                  >
                    <option value="Ativo">Ativo</option>
                    <option value="Inativo">Inativo</option>
                  </select>
                )}

                <div className="admin-modal-actions">
                  <button
                    className="admin-cancel-btn"
                    type="button"
                    onClick={() => setModalEquipe(null)}
                  >
                    Cancelar operação
                  </button>

                  <button className="admin-primary-btn" type="submit">
                    Salvar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {confirmacao && (
          <div className="admin-modal-overlay">
            <div className="admin-modal">
              <div className="admin-modal-header">
                <h3>Confirmar remoção de registro</h3>

                <button type="button" onClick={() => setConfirmacao(null)}>
                  ✕
                </button>
              </div>

              <p>{confirmacao.mensagem}</p>

              <div className="admin-modal-actions">
                <button
                  className="admin-cancel-btn"
                  type="button"
                  onClick={() => setConfirmacao(null)}
                >
                  Cancelar operação
                </button>

                <button
                  className="admin-danger-btn"
                  type="button"
                  onClick={() => {
                    if (confirmacao.tipo === "removerAluno") {
                      handleRemoverAluno(confirmacao.id);
                    }

                    if (confirmacao.tipo === "removerEquipe") {
                      handleRemoverEquipe(confirmacao.id);
                    }

                    if (confirmacao.tipo === "removerTurma") {
                      handleRemoverTurma(confirmacao.id);
                    }
                  }}
                >
                  Remover registro
                </button>
              </div>
            </div>
          </div>
        )}

        {avisoMoverAluno && (
          <div className="admin-modal-overlay">
            <div className="admin-modal">
              <div className="admin-modal-header">
                <h3>Confirmar alteração de turma</h3>

                <button type="button" onClick={() => setAvisoMoverAluno(null)}>
                  ✕
                </button>
              </div>

              <p>
                Este aluno já pertence à turma {avisoMoverAluno.turmaAtual}. Deseja
                transferi-lo para {avisoMoverAluno.novaTurma}?
              </p>

              <div className="admin-modal-actions">
                <button
                  className="admin-cancel-btn"
                  type="button"
                  onClick={() => setAvisoMoverAluno(null)}
                >
                  Cancelar operação
                </button>

                <button
                  className="admin-primary-btn"
                  type="button"
                  onClick={confirmarMoverAluno}
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}

        {telaAtiva === "configuracoes" && (
          <section className="admin-section">
            <div className="admin-title-box">
              <h2>Configurações administrativas</h2>
              <p>Gerencie regras institucionais e os dados cadastrais da conta administrativa em uso.</p>
            </div>

            <form className="admin-policy-card" onSubmit={handleSalvarBloqueioEdicao}>
              <div className="admin-policy-copy">
                <span className="admin-policy-eyebrow">Controle pedagógico</span>
                <h3>Bloquear edição de chamadas após o horário máximo de chegada</h3>
                <p>
                  Quando ativado, as pedagogas não poderão editar chamadas nem marcar alunos como atrasados após o horário máximo de chegada. Quando desativado, poderão continuar realizando apenas as alterações já autorizadas para o perfil.
                </p>
              </div>

              <div className="admin-policy-control">
                <span className={`admin-policy-state ${bloqueioEdicaoAposHorario ? "is-active" : "is-inactive"}`}>
                  {bloqueioEdicaoAposHorario ? "Ativado" : "Desativado"}
                </span>
                <button
                  className={`admin-config-switch ${bloqueioEdicaoAposHorario ? "is-on" : ""}`}
                  type="button"
                  role="switch"
                  aria-checked={bloqueioEdicaoAposHorario}
                  aria-label="Bloquear edição de chamadas após o horário máximo de chegada"
                  disabled={salvandoBloqueioEdicao}
                  onClick={() => {
                    setBloqueioEdicaoAposHorario((valorAtual) => !valorAtual);
                    setFeedbackBloqueioEdicao({ tipo: "", mensagem: "" });
                  }}
                >
                  <span aria-hidden="true" />
                </button>
              </div>

              <div className="admin-policy-actions">
                <button
                  className="admin-primary-btn"
                  type="submit"
                  disabled={salvandoBloqueioEdicao || bloqueioEdicaoAposHorario === bloqueioEdicaoSalvo}
                >
                  {salvandoBloqueioEdicao ? "Salvando..." : "Salvar configuração"}
                </button>
                {feedbackBloqueioEdicao.mensagem && (
                  <p
                    className={`admin-policy-feedback ${feedbackBloqueioEdicao.tipo}`}
                    role={feedbackBloqueioEdicao.tipo === "erro" ? "alert" : "status"}
                    aria-live="polite"
                  >
                    {feedbackBloqueioEdicao.mensagem}
                  </p>
                )}
              </div>
            </form>

            <form className="admin-config-form" onSubmit={handleSalvarConfiguracoes}>
              <label>
                Nome completo
                <input
                  type="text"
                  name="nome"
                  placeholder="Informe seu nome completo"
                  defaultValue={usuarioLogado?.nome || "Administrador"}
                  minLength={2}
                  maxLength={100}
                  required
                />
              </label>

              <label>
                E-mail
                <input
                  type="email"
                  name="email"
                  placeholder="Informe seu e-mail institucional"
                  defaultValue={usuarioLogado?.email || "admin@email.com"}
                  maxLength={100}
                  required
                />
              </label>

              <label>
                Alteração de senha
                <input
                  type="password"
                  name="senha"
                  placeholder="Nova senha, se desejar alterar"
                  minLength={6}
                />
              </label>

              {mensagemConfig && <p className="admin-error-message">{mensagemConfig}</p>}

              <button className="admin-primary-btn" type="submit" disabled={salvandoConfig}>
                {salvandoConfig ? "Processando..." : "Atualizar dados da conta"}
              </button>
            </form>
          </section>
        )}
      </section>
    </main>
  );
}
