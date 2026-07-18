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

  return (
    <section className="dashboard-classes-card">
      <header>
        <div>
          <h2>Turmas do Dia</h2>
          <p>Mesmos totais e status para administra&ccedil;&atilde;o e pedagogia.</p>
        </div>
        <strong>{lista.length}</strong>
      </header>

      {lista.length === 0 ? (
        <div className="dashboard-classes-empty">Nenhuma turma cadastrada.</div>
      ) : (
        <div className="dashboard-classes-list">
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
