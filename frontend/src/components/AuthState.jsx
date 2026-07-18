import "../styles/AuthState.css";

export default function AuthState({ tipo = "carregando", onRetry }) {
  const carregando = tipo === "carregando";

  return (
    <main className="auth-state" aria-live="polite" aria-busy={carregando}>
      <section className="auth-state-card" role="status">
        <div className="auth-state-mark" aria-hidden="true">SC</div>
        <h1>{carregando ? "Validando sua sessão" : "Não foi possível validar sua sessão"}</h1>
        <p>
          {carregando
            ? "Aguarde um instante para acessar sua área."
            : "Sua sessão não foi apagada. Verifique a conexão e tente novamente."}
        </p>
        {!carregando && onRetry && (
          <button type="button" onClick={onRetry}>Tentar novamente</button>
        )}
      </section>
    </main>
  );
}
