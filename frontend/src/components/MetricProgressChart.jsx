function limitarPercentual(valor) {
  const percentual = Number(valor);

  if (!Number.isFinite(percentual)) return 0;

  return Math.min(Math.max(percentual, 0), 100);
}

export default function MetricProgressChart({ itens = [], ariaLabel }) {
  return (
    <div className="metric-progress-chart" role="list" aria-label={ariaLabel}>
      {itens.map((item) => {
        const percentual = limitarPercentual(item.valor);

        return (
          <div className="metric-progress-row" role="listitem" key={item.id}>
            <div className="metric-progress-heading">
              <span>{item.rotulo}</span>
              <strong>{percentual.toFixed(item.casasDecimais ?? 0)}%</strong>
            </div>

            <div
              className="metric-progress-track"
              role="progressbar"
              aria-label={`${item.rotulo}: ${percentual}%`}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={percentual}
            >
              <span
                className={`metric-progress-fill ${item.tom}`}
                style={{ width: `${percentual}%` }}
              />
            </div>

            {item.detalhe && <small>{item.detalhe}</small>}
          </div>
        );
      })}
    </div>
  );
}
