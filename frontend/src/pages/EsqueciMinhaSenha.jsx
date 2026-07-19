import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail, Send } from "lucide-react";
import { solicitarRecuperacaoSenha } from "../services/authService";
import "../styles/AuthRecovery.css";

const MENSAGEM_GENERICA =
  "Se existir uma conta cadastrada com esse e-mail, enviaremos as instruções para recuperação da senha. Verifique sua caixa de entrada e também a pasta de spam ou lixo eletrônico.";

export default function EsqueciMinhaSenha() {
  const [email, setEmail] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setErro("");
    setMensagem("");

    const emailNormalizado = email.trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(emailNormalizado) || emailNormalizado.length > 100) {
      setErro("Informe um e-mail válido.");
      return;
    }

    try {
      setCarregando(true);
      const data = await solicitarRecuperacaoSenha(emailNormalizado);
      setMensagem(data?.mensagem || MENSAGEM_GENERICA);
    } catch (error) {
      if (error.status === 429) {
        setErro("Muitas solicitações. Aguarde alguns minutos e tente novamente.");
      } else {
        setErro("Não foi possível processar a solicitação agora. Tente novamente.");
      }
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="auth-recovery-page">
      <section className="auth-recovery-card" aria-labelledby="recuperacao-titulo">
        <div className="auth-recovery-mark" aria-hidden="true">
          <Mail size={27} />
        </div>

        <header className="auth-recovery-header">
          <p className="auth-recovery-eyebrow">Acesso seguro</p>
          <h1 id="recuperacao-titulo">Recupere sua conta</h1>
          <p>
            Informe o e-mail cadastrado. Se a conta existir, enviaremos um link
            temporário para você criar uma nova senha.
          </p>
        </header>

        <form className="auth-recovery-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-recovery-status" aria-live="polite">
            {erro && <div className="auth-recovery-alert auth-recovery-alert--error" role="alert">{erro}</div>}
            {mensagem && (
              <div className="auth-recovery-alert auth-recovery-alert--success" role="status">
                {mensagem}
              </div>
            )}
          </div>

          {!mensagem && (
            <>
              <label className="auth-recovery-field" htmlFor="email-recuperacao">
                <span>E-mail</span>
                <span className="auth-recovery-input">
                  <Mail size={19} aria-hidden="true" />
                  <input
                    id="email-recuperacao"
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setErro("");
                    }}
                    placeholder="seuemail@escola.com"
                    autoComplete="email"
                    maxLength={100}
                    required
                  />
                </span>
              </label>

              <button className="auth-recovery-primary" type="submit" disabled={carregando}>
                <Send size={18} aria-hidden="true" />
                {carregando ? "Enviando instruções..." : "Enviar instruções"}
              </button>
            </>
          )}
        </form>

        <Link className="auth-recovery-back" to="/login">
          <ArrowLeft size={17} aria-hidden="true" />
          Voltar ao login
        </Link>
      </section>
    </main>
  );
}
