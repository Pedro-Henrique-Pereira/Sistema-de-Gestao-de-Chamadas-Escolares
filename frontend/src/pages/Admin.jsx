import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { LogOut, Pencil } from "lucide-react";
import { apiFetch } from "../services/api";
import { buscarConfiguracaoEscola, salvarConfiguracaoEscola } from "../services/configuracoesEscolaService";
import RelatoriosAvancados from "./RelatoriosAvancados";
import MensagensAdmin from "./MensagensAdmin";
import "../styles/Admin.css";

export default function Administrador() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [telaAtiva, setTelaAtiva] = useState("painel");

  const [usuarioLogado, setUsuarioLogado] = useState(null);

  const [abaRegistros, setAbaRegistros] = useState("alunos");
  const [pesquisaAluno, setPesquisaAluno] = useState("");
  const [pesquisaAlunoDebounced, setPesquisaAlunoDebounced] = useState("");
  const [turmasAbertas, setTurmasAbertas] = useState({});
  const [alunosAbertos, setAlunosAbertos] = useState({});
  const [alunoDestacadoId, setAlunoDestacadoId] = useState(null);
  const primeiraBuscaAplicadaRef = useRef(false);
  const linhaAlunoRefs = useRef({});

  const [modalAluno, setModalAluno] = useState(null);
  const [modalTurma, setModalTurma] = useState(false);
  const [modalEquipe, setModalEquipe] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);
  const [avisoMoverAluno, setAvisoMoverAluno] = useState(null);

  const [carregandoRegistros, setCarregandoRegistros] = useState(false);
  const [erroRegistros, setErroRegistros] = useState("");
  const [metricasDia, setMetricasDia] = useState({
    alunosCadastrados: 0,
    presentes: 0,
    ausentes: 0,
    justificados: 0,
    atrasos: 0,
  });
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [mensagemConfig, setMensagemConfig] = useState("");
  const [horarioLimiteAtraso, setHorarioLimiteAtraso] = useState("07:45");
  const [tempoMaximoJustificativasMeses, setTempoMaximoJustificativasMeses] = useState(1);

  async function carregarRegistros() {
    setCarregandoRegistros(true);
    setErroRegistros("");

    try {
      const data = await apiFetch("/api/registros");
      setTurmas(data.turmas || []);
      setAlunos(data.alunos || []);
      setEquipe(data.equipe || []);
    } catch (error) {
      setErroRegistros(error.message || "Erro ao carregar registros.");
    } finally {
      setCarregandoRegistros(false);
    }
  }


  async function carregarMetricasPainel() {
    try {
      const data = await apiFetch("/api/admin/painel");
      setMetricasDia({
        alunosCadastrados: Number(data.alunosCadastrados || 0),
        presentes: Number(data.presentes || 0),
        ausentes: Number(data.ausentes || 0),
        justificados: Number(data.justificados || 0),
        atrasos: Number(data.atrasos || 0),
      });
    } catch (error) {
      console.error("Erro ao carregar métricas do painel:", error);
    }
  }

  async function carregarConfiguracaoEscola() {
    try {
      const data = await buscarConfiguracaoEscola();
      setHorarioLimiteAtraso(String(data.horarioLimiteAtraso || data.horario_limite_atraso || "07:45").slice(0, 5));
      setTempoMaximoJustificativasMeses(Number(data.tempoMaximoJustificativasMeses || data.tempo_maximo_justificativas_meses || 1));
    } catch (error) {
      console.error("Erro ao carregar configuração da escola:", error);
    }
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
    } catch (error) {
      setMensagemConfig(error.message || "Erro ao salvar tempo máximo das justificativas.");
    } finally {
      setSalvandoConfig(false);
    }
  }

  useEffect(() => {
    async function iniciarPagina() {
      try {
        const data = await apiFetch("/api/auth/me");
        setUsuarioLogado(data.usuario);
        await Promise.all([carregarRegistros(), carregarMetricasPainel(), carregarConfiguracaoEscola()]);
      } catch (error) {
        window.location.href = "/login";
      }
    }

    iniciarPagina();
  }, []);

  async function sair() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch (error) {
      console.error("Erro ao sair:", error);
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

const alunosFiltrados = useMemo(() => {
  const digitosBusca = apenasDigitosBusca(pesquisaAlunoDebounced);

  if (!pesquisaAlunoAtiva) return alunos;

  return alunos
    .map((aluno, indice) => ({
      aluno,
      indice,
      pontuacao: pontuarPesquisaAluno(aluno, termoPesquisaAluno, digitosBusca),
    }))
    .filter((item) => item.pontuacao > 0)
    .sort((a, b) => b.pontuacao - a.pontuacao || a.indice - b.indice)
    .map((item) => item.aluno);
}, [alunos, termoPesquisaAluno, pesquisaAlunoDebounced]);

const alunosPorTurma = useMemo(() => {
  const grupos = turmas.map((turma) => ({
    ...turma,
    alunos: alunosFiltrados.filter((aluno) => aluno.turma === turma.nome),
  }));

  if (!pesquisaAlunoAtiva) return grupos;

  return grupos.filter((turma) => turma.alunos.length > 0);
}, [turmas, alunosFiltrados, pesquisaAlunoAtiva]);

const alunosSemTurma = useMemo(
  () => alunosFiltrados.filter((aluno) => !aluno.turma),
  [alunosFiltrados]
);


useEffect(() => {
  const timer = window.setTimeout(() => {
    setPesquisaAlunoDebounced(pesquisaAluno);
  }, 300);

  return () => window.clearTimeout(timer);
}, [pesquisaAluno]);

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

const calcularPercentual = (valor) =>
  totalMetricasDia > 0 ? Math.round((Number(valor || 0) / totalMetricasDia) * 100) : 0;

const porcentagemPresenca = calcularPercentual(metricasDia.presentes);
const porcentagemAusencia = calcularPercentual(metricasDia.ausentes);
const porcentagemJustificada = calcularPercentual(metricasDia.justificados);
const porcentagemAtraso = calcularPercentual(metricasDia.atrasos);

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

    setAlunos(data.alunos || []);
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

    setAlunos(data.alunos || []);
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

    setAlunos(data.alunos || []);
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

    setAlunos(data.alunos || []);
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

    await carregarRegistros();
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
    await carregarRegistros();
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
    setAlunos(data.alunos || []);
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

    setEquipe(data.equipe || []);
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

    setEquipe(data.equipe || []);
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

    setEquipe(data.equipe || []);
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

    const formData = new FormData(event.currentTarget);

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

      setUsuarioLogado(data.usuario);
      setMensagemConfig(data.mensagem || "Configurações atualizadas com sucesso.");
      event.currentTarget.reset();
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
            onClick={() => {
              setTelaAtiva("painel");
              fecharSidebarMobile();
            }}
          >
            Painel Principal
          </button>

          <button
            className={telaAtiva === "registros" ? "active" : ""}
            onClick={() => {
              setTelaAtiva("registros");
              fecharSidebarMobile();
            }}
          >
            Gestão de Registros
          </button>

          <button
            className={telaAtiva === "relatorios" ? "active" : ""}
            onClick={() => {
              setTelaAtiva("relatorios");
              fecharSidebarMobile();
            }}
          >
            Relatórios Avançados
          </button>

          <button
            className={telaAtiva === "mensagens" ? "active" : ""}
            onClick={() => {
              setTelaAtiva("mensagens");
              fecharSidebarMobile();
            }}
          >
            Mensagens
          </button>


          <button
            className={telaAtiva === "configuracoes" ? "active" : ""}
            onClick={() => {
              setTelaAtiva("configuracoes");
              fecharSidebarMobile();
            }}
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
          >
            ☰
          </button>

          <div>
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

            <div className="admin-cards-grid">
              <article className="admin-card">
                <span>Alunos cadastrados</span>
                <strong>{metricasDia.alunosCadastrados}</strong>
              </article>

              <article className="admin-card">
                <span>Presenças</span>
                <strong>{metricasDia.presentes}</strong>
              </article>

              <article className="admin-card">
                <span>Ausências</span>
                <strong>{metricasDia.ausentes}</strong>
              </article>

              <article className="admin-card">
                <span>Justificados</span>
                <strong>{metricasDia.justificados}</strong>
              </article>

              <article className="admin-card">
                <span>Atraso</span>
                <strong>{metricasDia.atrasos}</strong>
              </article>
            </div>



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
              <h3>Distribuição dos indicadores diários</h3>

              <div className="chart-bars">
                <div>
                  <div
                    className="bar green"
                    style={{ height: `${porcentagemPresenca * 2.5}px` }}
                  >
                    {porcentagemPresenca}%
                  </div>
                  <span>Presenças</span>
                </div>

                <div>
                  <div
                    className="bar red"
                    style={{ height: `${porcentagemAusencia * 2.5}px` }}
                  >
                    {porcentagemAusencia}%
                  </div>
                  <span>Ausências</span>
                </div>

                <div>
                  <div
                    className="bar blue"
                    style={{ height: `${porcentagemJustificada * 2.5}px` }}
                  >
                    {porcentagemJustificada}%
                  </div>
                  <span>Justificados</span>
                </div>

                <div>
                  <div
                    className="bar yellow"
                    style={{ height: `${porcentagemAtraso * 2.5}px` }}
                  >
                    {porcentagemAtraso}%
                  </div>
                  <span>Atraso</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {telaAtiva === "registros" && (
          <section className="admin-section">
            <div className="admin-title-box">
              <h2>Gestão de Registros</h2>
              <p>Gerencie cadastros de alunos, turmas, responsáveis e equipe escolar com segurança.</p>
            </div>

            {erroRegistros && <p className="admin-error-message">{erroRegistros}</p>}

            {carregandoRegistros && <p>Carregando registros institucionais...</p>}

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
              <div className="admin-panel">
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
              </div>
            )}

            {abaRegistros === "turmas" && (
              <div className="admin-panel">
                <div className="admin-panel-header">
                  <h3>Gestão de turmas</h3>

                  <button
                    className="admin-primary-btn"
                    type="button"
                    onClick={() => setModalTurma({ tipo: "cadastrar", turma: null })}
                  >
                    + Nova turma
                  </button>
                </div>

                <div className="admin-accordion-list">
                  {turmas.length === 0 && <div className="empty-state">Nenhum registro encontrado</div>}
                  {turmas.map((turma) => {
                    const alunosDaTurma = alunos.filter(
                      (aluno) => aluno.turma === turma.nome
                    );

                    return (
                      <div className="admin-accordion" key={turma.id}>
                        <button
                          className="admin-accordion-header"
                          type="button"
                          onClick={() => toggleTurma(`gestao-${turma.nome}`)}
                        >
                          <strong>{turma.nome}</strong>

                          <span className="admin-accordion-actions">
                            <button
                              className="admin-primary-btn"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setModalTurma({ tipo: "editar", turma });
                              }}
                              title="Editar turma"
                            >
                              <Pencil size={15} /> Editar
                            </button>

                            <button
                              className="admin-danger-btn"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setConfirmacao({
                                  tipo: "removerTurma",
                                  id: turma.id,
                                  mensagem:
                                    "Tem certeza que deseja remover esta turma? Os alunos não serão excluídos, apenas ficarão sem turma.",
                                });
                              }}
                            >
                              Remover registro
                            </button>

                            <span>
                              {turmasAbertas[`gestao-${turma.nome}`] ? "−" : "+"}
                            </span>
                          </span>
                        </button>

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
              <div className="admin-panel">
                <div className="admin-panel-header">
                  <h3>Equipe escolar</h3>

                  <button
                    className="admin-primary-btn"
                    type="button"
                    onClick={() => setModalEquipe({ tipo: "cadastrar", pessoa: null })}
                  >
                    + Nova conta
                  </button>
                </div>

                {categoriasEquipe.map((categoria) => {
                  const pessoas = equipe.filter(
                    (pessoa) => pessoa.cargo === categoria.cargo
                  );

                  return (
                    <div className="admin-panel" key={categoria.cargo}>
                      <div className="admin-panel-header">
                        <h3>{categoria.titulo}</h3>
                      </div>

                      <div className="admin-table-wrapper">
                        <table>
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
                                <td>{pessoa.nome}</td>
                                <td>{pessoa.cargo}</td>
                                <td>
                                  <span
                                    className={`admin-status ${
                                      pessoa.status === "Ativo" ? "ativo" : "inativo"
                                    }`}
                                  >
                                    {pessoa.status}
                                  </span>
                                </td>
                                <td>{pessoa.email}</td>
                                <td>
                                  <button
                                    className="admin-primary-btn"
                                    type="button"
                                    onClick={() =>
                                      setModalEquipe({
                                        tipo: "editar",
                                        pessoa,
                                      })
                                    }
                                  >
                                    Editar dados
                                  </button>

                                  <button
                                    className="admin-danger-btn"
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
                                    Remover registro
                                  </button>
                                </td>
                              </tr>
                            ))}

                            {pessoas.length === 0 && (
                              <tr>
                                <td colSpan="5">Nenhum registro encontrado.</td>
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
          <RelatoriosAvancados turmas={turmas} alunos={alunos} />
        )}

        {telaAtiva === "mensagens" && (
          <MensagensAdmin />
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
                  required
                />

                <input
                  name="email"
                  type="email"
                  placeholder="E-mail"
                  defaultValue={modalEquipe.pessoa?.email || ""}
                  required
                />

                <input
                  name="senha"
                  type="password"
                  placeholder={modalEquipe.tipo === "editar" ? "Nova senha (opcional)" : "Senha"}
                  defaultValue=""
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
              <h2>Configurações da conta administrativa</h2>
              <p>Atualize os dados cadastrais da conta administrativa em uso.</p>
            </div>

            <form className="admin-config-form" onSubmit={handleSalvarConfiguracoes}>
              <label>
                Nome completo
                <input
                  type="text"
                  name="nome"
                  placeholder="Informe seu nome completo"
                  defaultValue={usuarioLogado?.nome || "Administrador"}
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
                  required
                />
              </label>

              <label>
                Alteração de senha
                <input
                  type="password"
                  name="senha"
                  placeholder="Nova senha, se desejar alterar"
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