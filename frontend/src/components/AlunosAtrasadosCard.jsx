import { useCallback, useEffect, useMemo, useState } from "react";
import "../styles/AlunosAtrasadosCard.css";
import { dataBrasiliaISO, minutosAtuaisBrasilia } from "../utils/brasiliaTime";

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
  if (Number.isFinite(Number(aluno.minutosAtraso ?? aluno.minutos_atraso))) {
    return formatarTempo(Number(aluno.minutosAtraso ?? aluno.minutos_atraso));
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
  try {
    const cache = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (!cache || cache.data !== hojeLocalISO() || !Array.isArray(cache.alunos)) return null;
    return cache.alunos;
  } catch {
    return null;
  }
}

function salvarCache(cacheKey, alunos) {
  try {
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({
        data: hojeLocalISO(),
        geradoEm: dataBrasiliaISO(),
        alunos,
      })
    );
  } catch {
    // Falha de armazenamento local não deve quebrar a tela.
  }
}

export default function AlunosAtrasadosCard({
  alunos = [],
  carregarAlunosAtrasados,
  cacheNamespace = "geral",
  horarioLimiteAtraso = "07:45",
  onVoltar,
}) {
  const cacheKey = `alunos_atrasados_${cacheNamespace}_${hojeLocalISO()}`;
  const [alunosBase, setAlunosBase] = useState(() => lerCache(cacheKey) || alunos || []);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  const podeGerarLista = passouDoHorarioLimite(horarioLimiteAtraso);

  const carregarLista = useCallback(async () => {
    const cache = lerCache(cacheKey);
    if (cache) {
      setAlunosBase(cache);
      return;
    }

    if (!podeGerarLista || typeof carregarAlunosAtrasados !== "function") return;

    setCarregando(true);
    setErro("");

    try {
      const resultado = await carregarAlunosAtrasados();
      const lista = Array.isArray(resultado) ? resultado : [];
      setAlunosBase(lista);
      salvarCache(cacheKey, lista);
    } catch (error) {
      setErro(error.message || "Não foi possível carregar a lista de alunos atrasados.");
    } finally {
      setCarregando(false);
    }
  }, [cacheKey, carregarAlunosAtrasados, podeGerarLista]);

  useEffect(() => {
    const cache = lerCache(cacheKey);
    if (cache) {
      setAlunosBase(cache);
      return;
    }

    if (Array.isArray(alunos) && alunos.length > 0) {
      setAlunosBase(alunos);
      salvarCache(cacheKey, alunos);
      return;
    }

    carregarLista();
  }, [alunos, cacheKey, carregarLista]);

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
          <strong>{alunosAtrasados.length}</strong>
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
                    <td>{aluno.nome}</td>
                    <td>{aluno.turma}</td>
                    <td>{aluno.horarioChamada || "--:--"}</td>
                    <td>{aluno.horarioRegistro || "--:--"}</td>
                    <td><span className="late-students-badge">{aluno.tempoAtraso}</span></td>
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
