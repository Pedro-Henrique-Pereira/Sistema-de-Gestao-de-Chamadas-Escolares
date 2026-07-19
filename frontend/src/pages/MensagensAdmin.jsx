import { useEffect, useMemo, useRef, useState } from 'react';
import AutomacaoFeedbackModal from '../components/AutomacaoFeedbackModal';
import {
  criarRequestId,
  criarTarefaGrupos,
  listarFilasAutomacao,
  listarMaquinasAutomacao,
  listarTarefasAutomacao,
} from '../services/automacaoService';
import {
  atualizarGrupoWhatsapp,
  criarGrupoWhatsapp,
  listarGruposMensagens,
  obterPreferenciasMensagens,
  removerGrupoWhatsapp,
  salvarPreferenciasMensagens,
} from '../services/mensagensService';

const MAQUINAS = [3, 4, 5];
const FORM_INICIAL = { id: null, nomeGrupo: '' };

function versaoIncompativel(atual, minima) {
  if (!atual || !minima) return false;
  const parse = (value) => String(value).split('.').slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(atual);
  const right = parse(minima);
  return left.some((value, index) => value !== right[index]
    && left.slice(0, index).every((item, previous) => item === right[previous])
    && value < right[index]);
}

export default function MensagensAdmin() {
  const [grupos, setGrupos] = useState([]);
  const [modoDestinatarios, setModoDestinatarios] = useState('todos');
  const [gruposSelecionados, setGruposSelecionados] = useState([]);
  const [mensagem, setMensagem] = useState('');
  const [maquinaDestino, setMaquinaDestino] = useState(3);
  const [formGrupo, setFormGrupo] = useState(FORM_INICIAL);
  const [carregando, setCarregando] = useState(true);
  const [salvandoGrupo, setSalvandoGrupo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [erro, setErro] = useState('');
  const [maquinas, setMaquinas] = useState([]);
  const [filas, setFilas] = useState([]);
  const [tarefasRecentes, setTarefasRecentes] = useState([]);
  const [automacaoModal, setAutomacaoModal] = useState({ aberto: false, ids: [] });
  const requestIdPendente = useRef(null);

  const totalDestinatarios = useMemo(() => {
    if (modoDestinatarios === 'todos') return grupos.length;
    return gruposSelecionados.length;
  }, [grupos.length, gruposSelecionados.length, modoDestinatarios]);

  async function carregarTela() {
    setCarregando(true);
    setErro('');

    try {
      const [dadosGrupos, preferencias, dadosMaquinas, dadosFilas, dadosTarefas] = await Promise.all([
        listarGruposMensagens(),
        obterPreferenciasMensagens(),
        listarMaquinasAutomacao(),
        listarFilasAutomacao(),
        listarTarefasAutomacao({ type: 'group_message', limit: 10 }),
      ]);

      setGrupos(dadosGrupos.grupos || []);
      setMaquinas((dadosMaquinas.machines || []).filter((machine) => MAQUINAS.includes(machine.machineNumber)));
      setFilas((dadosFilas.queues || []).filter((queue) => MAQUINAS.includes(queue.machineNumber)));
      setTarefasRecentes(dadosTarefas.tasks || []);
      const maquinaSalva = Number(preferencias.maquinaPadraoMensagens || 3);
      setMaquinaDestino(MAQUINAS.includes(maquinaSalva) ? maquinaSalva : 3);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar dados de mensagens. Rode a migração SQL de grupos do WhatsApp.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarTela();
  }, []);

  function alternarGrupo(idGrupo) {
    setGruposSelecionados((atuais) =>
      atuais.includes(idGrupo)
        ? atuais.filter((id) => id !== idGrupo)
        : [...atuais, idGrupo]
    );
  }

  function editarGrupo(grupo) {
    setFormGrupo({
      id: grupo.id,
      nomeGrupo: grupo.nomeGrupo,
    });
    setFeedback('');
    setErro('');
  }

  function limparFormGrupo() {
    setFormGrupo(FORM_INICIAL);
  }

  async function handleSalvarGrupo(event) {
    event.preventDefault();
    setSalvandoGrupo(true);
    setFeedback('');
    setErro('');

    try {
      if (formGrupo.id) {
        await atualizarGrupoWhatsapp(formGrupo.id, formGrupo);
        setFeedback('Grupo do WhatsApp atualizado com sucesso.');
      } else {
        await criarGrupoWhatsapp(formGrupo);
        setFeedback('Grupo do WhatsApp cadastrado com sucesso.');
      }
      limparFormGrupo();
      await carregarTela();
    } catch (error) {
      setErro(error.message || 'Erro ao salvar grupo do WhatsApp.');
    } finally {
      setSalvandoGrupo(false);
    }
  }

  async function handleRemoverGrupo(id) {
    setFeedback('');
    setErro('');

    try {
      await removerGrupoWhatsapp(id);
      setGruposSelecionados((atuais) => atuais.filter((grupoId) => grupoId !== id));
      setFeedback('Grupo removido da lista de envios.');
      await carregarTela();
    } catch (error) {
      setErro(error.message || 'Erro ao remover grupo do WhatsApp.');
    }
  }

  async function handleSalvarMaquina(novaMaquina) {
    const maquina = Number(novaMaquina);
    setFeedback('');
    setErro('');

    if (!MAQUINAS.includes(maquina)) {
      setMaquinaDestino(3);
      setErro('Administradores só podem usar as máquinas 3, 4 e 5 para mensagens em grupos.');
      return;
    }

    setMaquinaDestino(maquina);

    try {
      await salvarPreferenciasMensagens(maquina);
      setFeedback(`Máquina ${maquina} salva como padrão para sua conta.`);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar máquina padrão.');
    }
  }

  async function handleEnviar(event) {
    event.preventDefault();
    setEnviando(true);
    setFeedback('');
    setErro('');

    try {
      if (!MAQUINAS.includes(Number(maquinaDestino))) {
        throw new Error('Selecione uma máquina válida para administrador: Máquina 3, 4 ou 5.');
      }

      requestIdPendente.current ||= criarRequestId('groups');
      const resposta = await criarTarefaGrupos({
        requestId: requestIdPendente.current,
        machineId: `machine-${maquinaDestino}`,
        groups: modoDestinatarios === 'todos' ? [] : gruposSelecionados,
        allGroups: modoDestinatarios === 'todos',
        message: mensagem,
      });
      const idFila = Number(resposta.task?.taskId);

      setFeedback(resposta.message || 'Mensagem adicionada à fila com sucesso.');
      setMensagem('');
      if (modoDestinatarios !== 'todos') setGruposSelecionados([]);
      requestIdPendente.current = null;

      if (Number.isInteger(idFila) && idFila > 0) {
        setAutomacaoModal({ aberto: true, ids: [idFila] });
        setTarefasRecentes((current) => [
          resposta.task,
          ...current.filter((task) => task.taskId !== idFila),
        ].slice(0, 10));
      }
    } catch (error) {
      setErro(error.message || 'Erro ao enviar mensagem para a fila.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="admin-section mensagens-admin-section">
      <AutomacaoFeedbackModal
        aberto={automacaoModal.aberto}
        solicitacoes={automacaoModal.ids}
        titulo="Enviando mensagem para grupos"
        timeoutAlertaSegundos={180}
        permitirCancelamento
        onClose={() => setAutomacaoModal({ aberto: false, ids: [] })}
        onCancelado={() => {
          setFeedback('Envio cancelado antes do robô local iniciar.');
          setAutomacaoModal((atual) => ({ ...atual, aberto: true }));
        }}
        onConcluido={({ duracaoSegundos }) => {
          setFeedback(`Automação de mensagens concluída com sucesso em ${Math.floor(duracaoSegundos / 60)}min ${String(duracaoSegundos % 60).padStart(2, '0')}s.`);
        }}
        onErro={() => setErro('A automação encontrou erro em uma ou mais tarefas. Verifique o modal e o computador do robô local.')}
      />
      <div className="admin-title-box">
        <h2>Mensagens</h2>
        <p>Cadastre os nomes dos grupos do WhatsApp e envie mensagens para eles.</p>
      </div>

      {carregando && <p>Carregando grupos do WhatsApp...</p>}
      {erro && <p className="admin-error-message">{erro}</p>}
      {feedback && <p className="admin-success-message">{feedback}</p>}

      <form className="admin-panel mensagens-form" onSubmit={handleSalvarGrupo}>
        <div className="admin-title-box mensagens-subtitle-box">
          <h3>Cadastro de grupos do WhatsApp</h3>
          <p>
            Cadastre o nome visível do grupo. O sistema buscará esse nome no WhatsApp Web para enviar as mensagens. Se o nome do grupo for alterado, atualize aqui para manter o envio funcionando.
          </p>
        </div>

        <div className="mensagens-grid">
          <label>
            Nome exato do grupo no WhatsApp
            <input
              value={formGrupo.nomeGrupo}
              onChange={(event) => setFormGrupo((atual) => ({ ...atual, nomeGrupo: event.target.value }))}
              placeholder="Ex: 1°A - Pais"
              maxLength={150}
              required
            />
          </label>

        </div>

        <div className="mensagens-actions">
          <button className="admin-primary-btn" type="submit" disabled={salvandoGrupo}>
            {salvandoGrupo ? 'Salvando...' : formGrupo.id ? 'Atualizar grupo' : 'Cadastrar grupo'}
          </button>
          {formGrupo.id && (
            <button className="admin-secondary-btn" type="button" onClick={limparFormGrupo}>
              Cancelar edição
            </button>
          )}
        </div>
      </form>

      <div className="admin-panel mensagens-form">
        <div className="admin-title-box mensagens-subtitle-box">
          <h3>Filas por máquina</h3>
          <p>As máquinas processam suas filas de forma independente.</p>
        </div>
        <div className="mensagens-checkbox-grid">
          {filas.map((queue) => (
            <div key={queue.machineId} className="mensagens-checkbox-item mensagens-grupo-card">
              <strong>Máquina {queue.machineNumber} · {queue.state}</strong>
              <small>{queue.queuedTasks} na fila · {queue.processingTasks} em processamento</small>
              <small>Último heartbeat: {queue.lastHeartbeatAt ? new Date(queue.lastHeartbeatAt).toLocaleString('pt-BR') : 'não recebido'}</small>
              {versaoIncompativel(queue.appVersion, queue.minimumVersion) && (
                <small>Atualização necessária: versão mínima {queue.minimumVersion}.</small>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="admin-panel mensagens-form">
        <div className="admin-title-box mensagens-subtitle-box">
          <h3>Grupos cadastrados</h3>
          <p>{grupos.length} grupo(s) ativo(s) disponível(is) para envio.</p>
        </div>

        <div className="mensagens-checkbox-grid">
          {grupos.length === 0 && <p>Nenhum grupo do WhatsApp cadastrado.</p>}
          {grupos.map((grupo) => (
            <div key={grupo.id} className="mensagens-checkbox-item mensagens-grupo-card">
              <strong>{grupo.nomeGrupo}</strong>
              {grupo.nomeGrupoBusca && (
                <small>Nome usado para busca: {grupo.nomeGrupoBusca}</small>
              )}
              <div className="mensagens-card-actions">
                <button className="admin-secondary-btn" type="button" onClick={() => editarGrupo(grupo)}>
                  Editar
                </button>
                <button className="admin-secondary-btn danger" type="button" onClick={() => handleRemoverGrupo(grupo.id)}>
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <form className="admin-panel mensagens-form" onSubmit={handleEnviar}>
        <div className="admin-title-box mensagens-subtitle-box">
          <h3>Enviar mensagem para grupos do WhatsApp</h3>
        </div>

        <div className="mensagens-grid">
          <label>
            Tipo de destinatário
            <select
              value={modoDestinatarios}
              onChange={(event) => setModoDestinatarios(event.target.value)}
            >
              <option value="todos">Todos os grupos do WhatsApp cadastrados</option>
              <option value="especificos">Grupos específicos</option>
            </select>
          </label>

          <label>
            Máquina de disparo
            <select
              value={maquinaDestino}
              onChange={(event) => handleSalvarMaquina(event.target.value)}
            >
              {MAQUINAS.map((maquina) => (
                <option key={maquina} value={maquina}>Máquina {maquina}</option>
              ))}
            </select>
          </label>
        </div>

        {modoDestinatarios === 'especificos' && (
          <div className="mensagens-grupos-box">
            <strong>Selecione os grupos do WhatsApp</strong>
            <div className="mensagens-checkbox-grid">
              {grupos.length === 0 && <p>Nenhum grupo do WhatsApp cadastrado.</p>}
              {grupos.map((grupo) => (
                <label key={grupo.id} className="mensagens-checkbox-item">
                  <input
                    type="checkbox"
                    checked={gruposSelecionados.includes(grupo.id)}
                    onChange={() => alternarGrupo(grupo.id)}
                  />
                  <span>{grupo.nomeGrupo}</span>
                    </label>
              ))}
            </div>
          </div>
        )}

        <label>
          Mensagem personalizada
          <textarea
            value={mensagem}
            onChange={(event) => setMensagem(event.target.value)}
            placeholder="Digite a mensagem que será enviada ao(s) grupo(s) selecionado(s)."
            rows={8}
            maxLength={4000}
            required
          />
        </label>

        <div className="mensagens-resumo-card">
          <span>Resumo do envio</span>
          <strong>{totalDestinatarios} grupo(s) do WhatsApp entrarão na fila da Máquina {maquinaDestino}</strong>
          <small>A preferência de máquina fica salva por conta de administrador.</small>
          {maquinas.find((machine) => machine.machineNumber === Number(maquinaDestino)) && (
            <small>
              Estado: {maquinas.find((machine) => machine.machineNumber === Number(maquinaDestino)).state}
              {' · '}Fila: {maquinas.find((machine) => machine.machineNumber === Number(maquinaDestino)).queueDepth}
            </small>
          )}
        </div>

        <div className="mensagens-actions">
          <button
            className="admin-primary-btn"
            type="submit"
            disabled={enviando || carregando || totalDestinatarios === 0}
          >
            {enviando ? 'Adicionando à fila...' : 'Enviar para fila'}
          </button>

        </div>
      </form>

      <div className="admin-panel mensagens-form">
        <div className="admin-title-box mensagens-subtitle-box">
          <h3>Tarefas recentes</h3>
          <p>O processamento continua mesmo após fechar esta página.</p>
        </div>
        <div className="mensagens-checkbox-grid">
          {tarefasRecentes.length === 0 && <p>Nenhuma tarefa recente.</p>}
          {tarefasRecentes.map((task) => (
            <button
              key={task.taskId}
              className="mensagens-checkbox-item mensagens-grupo-card"
              type="button"
              onClick={() => setAutomacaoModal({ aberto: true, ids: [task.taskId] })}
            >
              <strong>Tarefa #{task.taskId} · Máquina {task.machineNumber}</strong>
              <small>{task.status} · {task.processed}/{task.total} processados · {task.failureCount} falha(s)</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
