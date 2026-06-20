import { useEffect, useMemo, useState } from "react";
import { getUsuarioLogado, logout as logoutService } from "../services/authService";
import { dataBrasiliaISO, minutosAtuaisBrasilia } from "../utils/brasiliaTime";
import {
  atualizarChamada,
  criarChamada,
  listarHistoricoChamadas,
  marcarAlunoAtrasado,
  verificarTurmas,
} from "../services/chamadasService";
import { buscarConfiguracaoEscola } from "../services/configuracoesEscolaService";
import { atualizarConfiguracoesUsuario } from "../services/usuariosService";
import "../styles/Professor.css";

const MIN_CARACTERES_BUSCA_DISCIPLINA = 2;

function dataParaBR(data) {
  if (!data) return "";
  return String(data).slice(0, 10).split("-").reverse().join("/");
}

function hojeLocalISO() {
  return dataBrasiliaISO();
}

function normalizarChamada(chamada) {
  return {
    id: chamada.id,
    turmaId: chamada.turma_id,
    turmaNome: chamada.turma_nome,
    disciplina: chamada.materia,
    professorId: chamada.professor_id,
    professorNome: chamada.professor_nome,
    data: String(chamada.data_chamada || "").slice(0, 10),
    horario: chamada.horario_chamada,
    alunos: chamada.alunos || [],
    totalPresentes: chamada.total_presentes || 0,
    totalAusentes: chamada.total_ausentes || 0,
    podeEditar: Boolean(chamada.pode_editar),
    podeMarcarAtraso: Boolean(chamada.pode_marcar_atraso || chamada.atraso_liberado),
  };
}

export default function Professor() {
  const [usuarioLogado, setUsuarioLogado] = useState(null);
  const [turmasDisponiveis, setTurmasDisponiveis] = useState([]);
  const [turmaSelecionada, setTurmaSelecionada] = useState("");
  const [disciplina, setDisciplina] = useState("");
  const [presencas, setPresencas] = useState({});
  const [chamadasRealizadas, setChamadasRealizadas] = useState([]);
  const [chamadaEditandoId, setChamadaEditandoId] = useState(null);
  const [modalConfigAberto, setModalConfigAberto] = useState(false);
  const [configForm, setConfigForm] = useState({ nome: "", email: "", senha: "" });
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [configAtraso, setConfigAtraso] = useState({ horarioLimiteAtraso: "07:45", atrasoLiberado: false, horarioServidor: "" });
  const [historicoAberto, setHistoricoAberto] = useState({});

  async function carregarHistorico() {
    const data = await listarHistoricoChamadas({ data: hojeLocalISO() });
    setChamadasRealizadas((data.chamadas || []).map(normalizarChamada));
  }

  async function carregarTurmas(materiaAtual = disciplina) {
    const data = await verificarTurmas(materiaAtual);
    setTurmasDisponiveis(data.turmas || []);
  }

  async function carregarConfiguracaoAtraso() {
    const data = await buscarConfiguracaoEscola();
    setConfigAtraso({
      horarioLimiteAtraso: String(data.horarioLimiteAtraso || data.horario_limite_atraso || "07:45").slice(0, 5),
      atrasoLiberado: Boolean(data.atraso_liberado),
      horarioServidor: String(data.horario_servidor || "").slice(0, 5),
    });
  }

  useEffect(() => {
    async function iniciar() {
      try {
        const data = await getUsuarioLogado();

        if (data.usuario.tipo !== "professor") {
          window.location.href = "/login";
          return;
        }

        setUsuarioLogado(data.usuario);
        setConfigForm({ nome: data.usuario.nome || "", email: data.usuario.email || "", senha: "" });

        await Promise.all([carregarHistorico(), carregarTurmas(""), carregarConfiguracaoAtraso()]);
      } catch {
        window.location.href = "/login";
      } finally {
        setCarregando(false);
      }
    }

    iniciar();
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const termo = String(disciplina || "").trim();
      if (!chamadaEditandoId && (termo.length === 0 || termo.length >= MIN_CARACTERES_BUSCA_DISCIPLINA)) {
        carregarTurmas(termo).catch(console.error);
      }
    }, 900);

    return () => clearTimeout(timeoutId);
  }, [disciplina, chamadaEditandoId]);

  const turmaAtual = useMemo(() => {
    return turmasDisponiveis.find((turma) => String(turma.id) === turmaSelecionada);
  }, [turmasDisponiveis, turmaSelecionada]);

  const turmaJaTemChamadaHoje = useMemo(() => {
    if (!turmaAtual || chamadaEditandoId) return false;
    const hoje = hojeLocalISO();
    return chamadasRealizadas.some((chamada) => (
      String(chamada.turmaId) === String(turmaAtual.id) && String(chamada.data) === hoje
    ));
  }, [chamadasRealizadas, chamadaEditandoId, turmaAtual]);

  async function selecionarTurma(idTurma) {
    setTurmaSelecionada(idTurma);
    await carregarConfiguracaoAtraso().catch(console.error);

    const turma = turmasDisponiveis.find((item) => String(item.id) === idTurma);

    if (!turma) {
      setPresencas({});
      return;
    }

    const estadoInicial = {};
    (turma.alunos || []).forEach((aluno) => {
      estadoInicial[aluno.id] = "presente";
    });

    setPresencas(estadoInicial);
  }

  function alterarPresenca(alunoId, status) {
    setPresencas((estadoAtual) => ({
      ...estadoAtual,
      [alunoId]: status,
    }));
  }

  function professorPodeEditar(chamada) {
    return Boolean(chamada.podeEditar) || Number(chamada.professorId) === Number(usuarioLogado?.id);
  }

  async function editarChamada(chamada) {
    if (!professorPodeEditar(chamada)) return;

    const turmaEditavel = {
      id: chamada.turmaId,
      nome: chamada.turmaNome,
      alunos: chamada.alunos.map((aluno) => ({
        id: aluno.aluno_id || aluno.alunoId || aluno.id,
        nome: aluno.nome,
        status_presenca: aluno.status_presenca || aluno.status || "ausente",
        atrasado: Boolean(aluno.atrasado),
      })),
    };

    setTurmasDisponiveis((lista) => {
      const existe = lista.some((turma) => Number(turma.id) === Number(turmaEditavel.id));
      return existe ? lista : [turmaEditavel, ...lista];
    });

    setChamadaEditandoId(chamada.id);
    setTurmaSelecionada(String(chamada.turmaId));
    setDisciplina(chamada.disciplina || "");

    const estadoEditado = {};
    chamada.alunos.forEach((aluno) => {
      const id = aluno.aluno_id || aluno.alunoId || aluno.id;
      estadoEditado[id] = aluno.status_presenca || aluno.status || "presente";
    });

    setPresencas(estadoEditado);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function salvarChamada() {
    if (salvando) return;

    if (!turmaAtual) {
      alert("Selecione uma turma antes de salvar a chamada.");
      return;
    }

    if (!disciplina.trim()) {
      alert("Informe a disciplina da chamada.");
      return;
    }

    if (turmaJaTemChamadaHoje) {
      alert("Essa turma já possui chamada registrada hoje. Não é permitido abrir chamada duplicada para a mesma turma no mesmo dia.");
      await Promise.all([carregarHistorico(), carregarTurmas(disciplina)]);
      setTurmaSelecionada("");
      setPresencas({});
      return;
    }

    const payload = {
      turma_id: turmaAtual.id,
      materia: disciplina.trim(),
      alunos: (turmaAtual.alunos || []).map((aluno) => ({
        id: aluno.id,
        nome: aluno.nome,
        status_presenca: presencas[aluno.id] || "ausente",
        atrasado: Boolean(aluno.atrasado),
      })),
    };

    try {
      setSalvando(true);

      if (chamadaEditandoId) {
        await atualizarChamada(chamadaEditandoId, payload);
      } else {
        await criarChamada(payload);
      }

      await Promise.all([carregarHistorico(), carregarTurmas(disciplina)]);

      setTurmaSelecionada("");
      setDisciplina("");
      setPresencas({});
      setChamadaEditandoId(null);

      alert(chamadaEditandoId ? "Chamada editada com sucesso!" : "Chamada salva com sucesso!");
    } catch (error) {
      alert(error.message);
    } finally {
      setSalvando(false);
    }
  }


  async function marcarAtraso(chamada, aluno) {
    const alunoId = aluno.aluno_id || aluno.alunoId || aluno.id;

    try {
      setSalvando(true);
      const configServidor = await buscarConfiguracaoEscola();
      const configAtual = {
        horarioLimiteAtraso: String(configServidor.horarioLimiteAtraso || configServidor.horario_limite_atraso || "07:45").slice(0, 5),
        atrasoLiberado: Boolean(configServidor.atraso_liberado),
        horarioServidor: String(configServidor.horario_servidor || "").slice(0, 5),
      };
      setConfigAtraso(configAtual);

      if (!configAtual.atrasoLiberado) {
        alert(`A marcação de atraso só é permitida até ${configAtual.horarioLimiteAtraso}. Depois desse horário permanece como falta.`);
        return;
      }

      await marcarAlunoAtrasado(chamada.id, alunoId);
      await Promise.all([carregarHistorico(), carregarConfiguracaoAtraso()]);
      alert("Aluno marcado como atrasado com sucesso.");
    } catch (error) {
      alert(error.message);
    } finally {
      setSalvando(false);
    }
  }

  async function logout() {
    try {
      await logoutService();
    } catch (error) {
      console.error("Erro ao sair:", error);
    } finally {
      window.location.href = "/login";
    }
  }

  async function salvarConfiguracoes(event) {
    event.preventDefault();

    try {
      const payload = {
        nome: configForm.nome,
        email: configForm.email,
      };

      if (configForm.senha.trim()) payload.senha = configForm.senha.trim();

      const data = await atualizarConfiguracoesUsuario(payload);
      setUsuarioLogado(data.usuario);
      setConfigForm({ nome: data.usuario.nome || "", email: data.usuario.email || "", senha: "" });
      setModalConfigAberto(false);
      alert("Configurações atualizadas com sucesso!");
    } catch (error) {
      alert(error.message);
    }
  }

  if (carregando) {
    return <main className="professor-page"><div className="empty-state">Carregando...</div></main>;
  }

  return (
    <main className="professor-page">
      <header className="professor-header">
        <section className="professor-user-info">
          <div className="professor-profile-block">
            <div className="professor-avatar">
              {(usuarioLogado?.nome || "P").charAt(0).toUpperCase()}
            </div>

            <div>
              <h1>{usuarioLogado?.nome || "Professor"}</h1>
              <p>{usuarioLogado?.tipo || "Professor"}</p>
            </div>
          </div>

          <div className="professor-actions-block">
            <button
              className="config-button"
              type="button"
              onClick={() => setModalConfigAberto(true)}
              aria-label="Abrir configurações"
            >
              ⚙️
            </button>

            <button className="logout-button" type="button" onClick={logout}>
              ↩ Sair
            </button>
          </div>
        </section>
      </header>

      <section className="professor-content">
        <div className="empty-state atraso-info-card">
          <strong>Horário máximo de chegada: {configAtraso.horarioLimiteAtraso}</strong>
          <span>{configAtraso.atrasoLiberado ? "Atrasos permitidos até o horário limite pelo relógio do servidor." : `Após o horário limite, atrasos viram falta. Servidor: ${configAtraso.horarioServidor || "--:--"}`}</span>
        </div>
        <div className="turma-select-area">
          <label htmlFor="disciplina">Disciplina</label>
          <input
            id="disciplina"
            className="disciplina-input"
            type="text"
            value={disciplina}
            onChange={(event) => setDisciplina(event.target.value)}
            placeholder="Ex: Matemática"
            disabled={Boolean(chamadaEditandoId)}
          />
        </div>

        <div className="turma-select-area">
          <label htmlFor="turma">Turma da chamada</label>

          <select
            id="turma"
            value={turmaSelecionada}
            onChange={(event) => selecionarTurma(event.target.value)}
            disabled={Boolean(chamadaEditandoId)}
          >
            <option value="">Selecione uma turma</option>

            {turmasDisponiveis.length === 0 && <option value="" disabled>Nenhum registro encontrado</option>}
            {turmasDisponiveis.map((turma) => (
              <option key={turma.id} value={turma.id}>
                {turma.nome}
              </option>
            ))}
          </select>
        </div>

        {!turmaAtual && (
          <div className="empty-state">
            <strong>Nenhuma turma selecionada</strong>
            <span>
              Turmas que já tiveram chamada hoje não aparecem na seleção para evitar duplicidade.
            </span>
          </div>
        )}

        {turmaAtual && (
          <>
            <div className="chamada-title">
              <h2>{turmaAtual.nome}</h2>
              <span>{(turmaAtual.alunos || []).length} alunos</span>
            </div>

            {(turmaAtual.alunos || []).length === 0 ? (
              <div className="empty-state">Nenhum registro encontrado</div>
            ) : (
            <ul className="alunos-lista">
              {(turmaAtual.alunos || []).map((aluno) => (
                <li className="aluno-linha" key={aluno.id}>
                  <span className="aluno-nome">{aluno.nome}</span>

                  <div className="presenca-toggle">
                    <button
                      type="button"
                      className={
                        presencas[aluno.id] === "presente"
                          ? "status-button presente ativo"
                          : "status-button presente"
                      }
                      onClick={() => alterarPresenca(aluno.id, "presente")}
                    >
                      Presente
                    </button>

                    <button
                      type="button"
                      className={
                        presencas[aluno.id] === "ausente"
                          ? "status-button ausente ativo"
                          : "status-button ausente"
                      }
                      onClick={() => alterarPresenca(aluno.id, "ausente")}
                    >
                      Ausente
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            )}

            <div className="salvar-area">
              {chamadaEditandoId && (
                <button
                  className="editar-chamada-button"
                  type="button"
                  onClick={() => {
                    setChamadaEditandoId(null);
                    setTurmaSelecionada("");
                    setPresencas({});
                    carregarTurmas(disciplina).catch(console.error);
                  }}
                >
                  Cancelar edição
                </button>
              )}

              <button
                className="salvar-chamada-button"
                type="button"
                onClick={salvarChamada}
                disabled={salvando || turmaJaTemChamadaHoje}
              >
                {salvando ? "Salvando..." : turmaJaTemChamadaHoje ? "Chamada já feita hoje" : chamadaEditandoId ? "Salvar Edição" : "Salvar Chamada"}
              </button>
            </div>
          </>
        )}

        <section className="chamadas-historico">
          <div className="chamada-title">
            <h2>Chamadas realizadas</h2>
            <span>{chamadasRealizadas.length} registros de hoje</span>
          </div>

          <div className="historico-lista">
            {chamadasRealizadas.length === 0 && <div className="empty-state">Nenhum registro encontrado</div>}
            {chamadasRealizadas.map((chamada) => {
              const podeEditar = professorPodeEditar(chamada);

              return (
                <article className="historico-card" key={chamada.id}>
                  <div>
                    <strong>{chamada.turmaNome}</strong>
                    <span>{chamada.disciplina}</span>
                  </div>

                  <div>
                    <small>Data</small>
                    <span>{dataParaBR(chamada.data)}</span>
                  </div>

                  <div>
                    <small>Professor</small>
                    <span>{chamada.professorNome}</span>
                  </div>

                  <div className="historico-actions">
                    <button
                      type="button"
                      className="editar-chamada-button"
                      disabled={!podeEditar}
                      onClick={() => editarChamada(chamada)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="editar-chamada-button"
                      onClick={() => setHistoricoAberto((prev) => ({ ...prev, [chamada.id]: !prev[chamada.id] }))}
                    >
                      {historicoAberto[chamada.id] ? "Recolher" : "Expandir"}
                    </button>
                  </div>

                  {historicoAberto[chamada.id] && (
                    <div className="historico-alunos-atraso">
                      {(chamada.alunos || []).map((aluno) => {
                        const alunoId = aluno.aluno_id || aluno.alunoId || aluno.id;
                        const status = String(aluno.status_presenca || aluno.status || "ausente").toLowerCase();
                        const atrasado = Boolean(aluno.atrasado);
                        const chamadaEhHoje = chamada.data === hojeLocalISO();
                        const podeAtrasar = chamadaEhHoje && (chamada.podeMarcarAtraso || configAtraso.atrasoLiberado) && status === "ausente" && !atrasado;

                        return (
                          <div className="historico-aluno-row" key={`${chamada.id}-${alunoId}`}>
                            <span>{aluno.nome}</span>
                            <small>{atrasado ? "Atrasado" : status === "presente" ? "Presente" : "Ausente"}</small>
                            <button
                              type="button"
                              className="editar-chamada-button"
                              disabled={!podeAtrasar || salvando}
                              onClick={() => marcarAtraso(chamada, aluno)}
                            >
                              Marcar atraso
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </section>

      {modalConfigAberto && (
        <div className="modal-overlay">
          <section className="config-modal">
            <div className="modal-header">
              <h2>Configurações</h2>

              <button
                type="button"
                onClick={() => setModalConfigAberto(false)}
                aria-label="Fechar configurações"
              >
                ✕
              </button>
            </div>

            <form className="config-form" onSubmit={salvarConfiguracoes}>
              <label>
                Nome
                <input
                  type="text"
                  value={configForm.nome}
                  onChange={(event) => setConfigForm((form) => ({ ...form, nome: event.target.value }))}
                />
              </label>

              <label>
                E-mail
                <input
                  type="email"
                  value={configForm.email}
                  onChange={(event) => setConfigForm((form) => ({ ...form, email: event.target.value }))}
                />
              </label>

              <label>
                Nova senha
                <input
                  type="password"
                  value={configForm.senha}
                  onChange={(event) => setConfigForm((form) => ({ ...form, senha: event.target.value }))}
                  placeholder="Digite uma nova senha"
                />
              </label>

              <button type="submit" className="save-config-button">
                Salvar alterações
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
