import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../styles/AlunosAtrasadosCard.css";
import { dataBrasiliaISO, minutosAtuaisBrasilia } from "../utils/brasiliaTime";
import {
  ATRASOS_SYNC_INTERVAL_MS,
  criarChaveCacheAtrasos,
  deveSincronizarAtrasos,
} from "../utils/atrasosSync";
import {
  lerCachePrivado,
  salvarCachePrivado,
} from "../utils/privateDataCache";

function hojeLocalISO() {
  return dataBrasiliaISO();
}

function normalizarHorario(valor) {
  if (!valor) return "";
  const texto = String(valor).trim();
  const match = texto.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function minutosDoHorario(valor) {
  const horario = normalizarHorario(valor);
  if (!horario) return null;

  const [horas, minutos] = horario.split(":").map(Number);
  if (!Number.isFinite(horas) || !Number.isFinite(minutos)) return null;

  return horas * 60 + minutos;
}

function passouDoHorarioLimite(horarioLimite) {
  const limite = minutosDoHorario(horarioLimite);
  if (limite === null) return true;

  return minutosAtuaisBrasilia() >= limite;
}

function formatarTempo(minutos) {
  const total = Math.max(0, Number(minutos || 0));

  if (total < 60) {
    return `${total} ${total === 1 ? "minuto" : "minutos"}`;
  }

  const horas = Math.floor(total / 60);
  const resto = total % 60;
  const textoHoras = `${horas} ${horas === 1 ? "hora" : "horas"}`;

  return resto > 0 ? `${textoHoras} e ${resto} ${resto === 1 ? "minuto" : "minutos"}` : textoHoras;
}

function calcularTempoAtraso(aluno) {
  const minutosInformados = aluno.minutosAtraso ?? aluno.minutos_atraso;
  if (
    minutosInformados !== null &&
    minutosInformados !== undefined &&
    minutosInformados !== "" &&
    Number.isFinite(Number(minutosInformados))
  ) {
    return formatarTempo(Number(minutosInformados));
  }

  const horarioChamada = minutosDoHorario(aluno.horarioChamada || aluno.horario_chamada);
  const horarioRegistro = minutosDoHorario(
    aluno.horarioRegistroAtraso ||
      aluno.horario_registro_atraso ||
      aluno.atrasoRegistradoEm ||
      aluno.atraso_registrado_em
  );

  if (horarioChamada === null || horarioRegistro === null) return "Tempo não informado";

  return formatarTempo(horarioRegistro - horarioChamada);
}

function normalizarAlunoAtrasado(aluno) {
  return {
    id: aluno.id || `${aluno.alunoId || aluno.aluno_id}-${aluno.nome}`,
    nome: aluno.nome || aluno.aluno_nome || "Aluno não identificado",
    turma: aluno.turma || aluno.turma_nome || "Turma não informada",
    horarioChamada: normalizarHorario(aluno.horarioChamada || aluno.horario_chamada),
    horarioRegistro: normalizarHorario(
      aluno.horarioRegistroAtraso ||
        aluno.horario_registro_atraso ||
        aluno.atrasoRegistradoEm ||
        aluno.atraso_registrado_em
    ),
    tempoAtraso: calcularTempoAtraso(aluno),
  };
}

function lerCache(cacheKey) {
  const cache = lerCachePrivado(cacheKey);
  if (!cache || cache.data !== hojeLocalISO() || !Array.isArray(cache.alunos)) return null;
  return cache.alunos;
}

function salvarCache(cacheKey, alunos) {
  salvarCachePrivado(cacheKey, {
    data: hojeLocalISO(),
    geradoEm: new Date().toISOString(),
    alunos,
  });
}

export default function AlunosAtrasadosCard({
  alunos = [],
  carregarAlunosAtrasados,
  cacheNamespace = "geral",
  horarioLimiteAtraso = "07:45",
  onVoltar,
}) {
  const cacheKey = criarChaveCacheAtrasos(hojeLocalISO(), cacheNamespace);
  const [alunosBase, setAlunosBase] = useState(() => lerCache(cacheKey) || alunos || []);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const carregandoRef = useRef(false);
  const carregarAlunosRef = useRef(carregarAlunosAtrasados);

  const podeGerarLista = passouDoHorarioLimite(horarioLimiteAtraso);

  useEffect(() => {
    carregarAlunosRef.current = carregarAlunosAtrasados;
  }, [carregarAlunosAtrasados]);

  const carregarLista = useCallback(async ({ silencioso = false } = {}) => {
    const carregar = carregarAlunosRef.current;
    if (!deveSincronizarAtrasos({
      podeGerarLista,
      carregando: carregandoRef.current,
      temCarregador: typeof carregar === "function",
    })) return;

    carregandoRef.current = true;
    if (!silencioso) setCarregando(true);
    if (!silencioso) setErro("");

    try {
      const resultado = await carregar();
      const lista = Array.isArray(resultado) ? resultado : [];
      setAlunosBase(lista);
      salvarCache(cacheKey, lista);
      setErro("");
    } catch (error) {
      if (!silencioso) {
        setErro(error.message || "Não foi possível sincronizar a lista de alunos atrasados.");
      }
    } finally {
      carregandoRef.current = false;
      if (!silencioso) setCarregando(false);
    }
  }, [cacheKey, podeGerarLista]);

  useEffect(() => {
    const cache = lerCache(cacheKey);
    if (cache) setAlunosBase(cache);

    if (Array.isArray(alunos) && alunos.length > 0) {
      setAlunosBase(alunos);
      salvarCache(cacheKey, alunos);
    }

    if (!podeGerarLista) return undefined;

    carregarLista({ silencioso: Boolean(cache || alunos.length) });

    const sincronizarSeVisivel = () => {
      if (deveSincronizarAtrasos({
        podeGerarLista,
        carregando: carregandoRef.current,
        temCarregador: typeof carregarAlunosRef.current === "function",
        documentoVisivel: document.visibilityState === "visible",
      })) {
        carregarLista({ silencioso: true });
      }
    };

    const intervalo = window.setInterval(
      sincronizarSeVisivel,
      ATRASOS_SYNC_INTERVAL_MS
    );
    window.addEventListener("focus", sincronizarSeVisivel);

    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener("focus", sincronizarSeVisivel);
    };
  }, [cacheKey, carregarLista, podeGerarLista]);

  useEffect(() => {
    if (!Array.isArray(alunos) || alunos.length === 0) return;
    setAlunosBase(alunos);
    salvarCache(cacheKey, alunos);
  }, [alunos, cacheKey]);

  const alunosAtrasados = useMemo(() => {
    return (Array.isArray(alunosBase) ? alunosBase : [])
      .filter((aluno) => aluno?.atrasado === true || aluno?.atrasado === 1 || aluno?.status === "atrasado" || aluno?.horarioRegistroAtraso)
      .map(normalizarAlunoAtrasado);
  }, [alunosBase]);

  return (
    <section className="late-students-page" aria-labelledby="late-students-title">
      {typeof onVoltar === "function" && (
        <div className="late-students-toolbar">
          <button className="late-students-back" type="button" onClick={onVoltar}>
            Voltar ao Painel Principal
          </button>
        </div>
      )}

      <div className="late-students-card">
        <div className="late-students-header">
          <div>
            <span className="late-students-eyebrow">Painel integrado de monitoramento</span>
            <h2 id="late-students-title">Alunos Atrasados</h2>
          </div>
          <div className="late-students-header-actions">
            <button
              type="button"
              onClick={() => carregarLista()}
              disabled={carregando || !podeGerarLista}
            >
              Atualizar
            </button>
            <strong>{alunosAtrasados.length}</strong>
          </div>
        </div>

        {!podeGerarLista ? (
          <div className="late-students-empty">
            A lista será liberada após o horário máximo de chegada: {normalizarHorario(horarioLimiteAtraso) || horarioLimiteAtraso}.
          </div>
        ) : carregando ? (
          <div className="late-students-empty">Gerando lista diária...</div>
        ) : erro ? (
          <div className="late-students-empty late-students-error">{erro}</div>
        ) : alunosAtrasados.length === 0 ? (
          <div className="late-students-empty">Nenhum aluno atrasado registrado para hoje.</div>
        ) : (
          <div className="late-students-table-wrapper">
            <table className="late-students-table">
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Turma</th>
                  <th>Horário da chamada</th>
                  <th>Chegada</th>
                  <th>Tempo de atraso</th>
                </tr>
              </thead>
              <tbody>
                {alunosAtrasados.map((aluno) => (
                  <tr key={aluno.id}>
                    <td data-label="Aluno">{aluno.nome}</td>
                    <td data-label="Turma">{aluno.turma}</td>
                    <td data-label="Horário da chamada">{aluno.horarioChamada || "--:--"}</td>
                    <td data-label="Chegada">{aluno.horarioRegistro || "--:--"}</td>
                    <td data-label="Tempo de atraso"><span className="late-students-badge">{aluno.tempoAtraso}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
