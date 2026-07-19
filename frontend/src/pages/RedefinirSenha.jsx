import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
} from "lucide-react";
import {
  redefinirSenha,
  validarTokenRecuperacao,
} from "../services/authService";
import { senhaAtendeRequisitos } from "../utils/passwordValidation";
import "../styles/AuthRecovery.css";

function capturarTokenDaUrl() {
  return new URLSearchParams(window.location.search).get("token") || "";
}

export default function RedefinirSenha() {
  const navigate = useNavigate();
  const validacaoIniciada = useRef(false);
  const [token] = useState(capturarTokenDaUrl);
  const [estadoToken, setEstadoToken] = useState("validando");
  const [senha, setSenha] = useState("");
  const [confirmacaoSenha, setConfirmacaoSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const urlSemToken = `${window.location.pathname}${window.location.hash || ""}`;
    window.history.replaceState(window.history.state, "", urlSemToken);

    if (validacaoIniciada.current) return;
    validacaoIniciada.current = true;

    async function validar() {
      if (!token) {
        setEstadoToken("invalido");
        return;
      }

      try {
        await validarTokenRecuperacao(token);
        setEstadoToken("valido");
      } catch {
        setEstadoToken("invalido");
      }
    }

    validar();
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setErro("");

    if (!senhaAtendeRequisitos(senha)) {
      setErro("A nova senha deve ter entre 6 e 128 caracteres.");
      return;
    }

    if (senha !== confirmacaoSenha) {
      setErro("As senhas informadas não coincidem.");
      return;
    }

    try {
      setCarregando(true);
      const data = await redefinirSenha(token, senha, confirmacaoSenha);
      navigate("/login", {
        replace: true,
        state: {
          mensagemSucesso:
            data?.mensagem || "Senha alterada com sucesso. Faça login novamente.",
        },
      });
    } catch (error) {
      if (error.status === 400) {
        setEstadoToken("invalido");
      } else if (error.status === 429) {
        setErro("Muitas tentativas. Solicite um novo link de recuperação.");
      } else {
        setErro("Não foi possível redefinir a senha. Solicite um novo link.");
      }
    } finally {
      setCarregando(false);
    }
  }

  if (estadoToken === "validando") {
    return (
      <main className="auth-recovery-page">
        <section className="auth-recovery-card auth-recovery-card--state" aria-live="polite">
          <div className="auth-recovery-spinner" aria-hidden="true" />
          <h1>Validando seu link</h1>
          <p>Aguarde um instante.</p>
        </section>
      </main>
    );
  }

  if (estadoToken === "invalido") {
    return (
      <main className="auth-recovery-page">
        <section className="auth-recovery-card auth-recovery-card--state" aria-labelledby="link-invalido-titulo">
          <div className="auth-recovery-mark auth-recovery-mark--warning" aria-hidden="true">
            <KeyRound size={27} />
          </div>
          <h1 id="link-invalido-titulo">Este link não está mais disponível</h1>
          <p>O link é inválido, expirou ou já foi utilizado. Solicite novas instruções.</p>
          <Link className="auth-recovery-primary" to="/esqueci-minha-senha">
            Solicitar novo link
          </Link>
          <Link className="auth-recovery-back" to="/login">
            <ArrowLeft size={17} aria-hidden="true" />
            Voltar ao login
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-recovery-page">
      <section className="auth-recovery-card" aria-labelledby="redefinir-titulo">
        <div className="auth-recovery-mark" aria-hidden="true">
          <ShieldCheck size={27} />
        </div>

        <header className="auth-recovery-header">
          <p className="auth-recovery-eyebrow">Link verificado</p>
          <h1 id="redefinir-titulo">Crie uma nova senha</h1>
          <p>Depois da alteração, todas as sessões anteriores serão encerradas.</p>
        </header>

        <form className="auth-recovery-form" onSubmit={handleSubmit}>
          {erro && (
            <div className="auth-recovery-alert auth-recovery-alert--error" role="alert">
              {erro}
            </div>
          )}

          <label className="auth-recovery-field" htmlFor="nova-senha">
            <span>Nova senha</span>
            <span className="auth-recovery-input">
              <Lock size={19} aria-hidden="true" />
              <input
                id="nova-senha"
                type={mostrarSenha ? "text" : "password"}
                value={senha}
                onChange={(event) => {
                  setSenha(event.target.value);
                  setErro("");
                }}
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="auth-recovery-toggle"
                onClick={() => setMostrarSenha((valor) => !valor)}
                aria-label={mostrarSenha ? "Ocultar senhas" : "Mostrar senhas"}
              >
                {mostrarSenha ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </span>
          </label>

          <label className="auth-recovery-field" htmlFor="confirmar-nova-senha">
            <span>Confirmar nova senha</span>
            <span className="auth-recovery-input">
              <Lock size={19} aria-hidden="true" />
              <input
                id="confirmar-nova-senha"
                type={mostrarSenha ? "text" : "password"}
                value={confirmacaoSenha}
                onChange={(event) => {
                  setConfirmacaoSenha(event.target.value);
                  setErro("");
                }}
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                required
              />
            </span>
          </label>

          <ul className="auth-recovery-requirements" aria-label="Requisitos da senha">
            <li className={senhaAtendeRequisitos(senha) ? "is-valid" : ""}>
              <Check size={16} aria-hidden="true" />
              Entre 6 e 128 caracteres
            </li>
            <li className={senha && senha === confirmacaoSenha ? "is-valid" : ""}>
              <Check size={16} aria-hidden="true" />
              As duas senhas devem ser iguais
            </li>
          </ul>

          <button className="auth-recovery-primary" type="submit" disabled={carregando}>
            {carregando ? "Alterando senha..." : "Alterar senha"}
          </button>
        </form>
      </section>
    </main>
  );
}
