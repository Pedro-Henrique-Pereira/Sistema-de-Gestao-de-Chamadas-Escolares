import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import "../styles/TurmasDashboardCard.css";

function statusChamada(status) {
  if (status === "finalizada") {
    return { classe: "success", rotulo: "Finalizada" };
  }

  if (status === "aguardando_confirmacao") {
    return { classe: "warning", rotulo: "Aguardando confirma\u00e7\u00e3o" };
  }

  return { classe: "neutral", rotulo: "Pendente" };
}

export default function TurmasDashboardCard({ turmas = [] }) {
  const lista = Array.isArray(turmas) ? turmas : [];
  const [aberto, setAberto] = useState(false);
  const conteudoId = useId();
  const totalAlunos = lista.reduce(
    (total, turma) => total + Number(turma.total_alunos || 0),
    0,
  );

  return (
    <section className={`dashboard-classes-card ${aberto ? "open" : ""}`}>
      <header>
        <button
          className="dashboard-classes-toggle"
          type="button"
          aria-expanded={aberto}
          aria-controls={conteudoId}
          disabled={lista.length === 0}
          onClick={() => setAberto((estadoAtual) => !estadoAtual)}
        >
          <span className="dashboard-classes-heading">
            <span>
              <strong>Turmas do Dia</strong>
              <small>Totais e status compartilhados com a pedagogia</small>
            </span>

            <span
              className="dashboard-classes-summary"
              aria-label={`${lista.length} turmas e ${totalAlunos} alunos`}
            >
              <b>{lista.length} turmas</b>
              <b>{totalAlunos} alunos</b>
            </span>
          </span>

          <ChevronDown className="dashboard-classes-chevron" size={20} aria-hidden="true" />
        </button>
      </header>

      {lista.length === 0 ? (
        <div className="dashboard-classes-empty">Nenhuma turma cadastrada.</div>
      ) : (
        <div className="dashboard-classes-list" id={conteudoId} hidden={!aberto}>
          {lista.map((turma) => {
            const status = statusChamada(turma.status_chamada);

            return (
              <article className="dashboard-class-row" key={turma.id}>
                <div className="dashboard-class-name">
                  <strong>{turma.nome}</strong>
                  <span>{Number(turma.total_alunos || 0)} alunos cadastrados</span>
                </div>

                <div className="dashboard-class-metrics">
                  <span className="present">Presen&ccedil;as: {Number(turma.presentes || 0)}</span>
                  <span className="absent">Faltas: {Number(turma.faltas || 0)}</span>
                  <span className="justified">Justificadas: {Number(turma.justificadas || 0)}</span>
                  <span className="delay">Atrasos: {Number(turma.atrasos || 0)}</span>
                </div>

                <span className={`dashboard-class-status ${status.classe}`}>{status.rotulo}</span>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
