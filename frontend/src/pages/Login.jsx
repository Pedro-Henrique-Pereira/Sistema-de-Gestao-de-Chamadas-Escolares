import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import { API_URL, apiFetch } from "../services/api";
import { login } from "../services/authService";
import { useAuth } from "../context/AuthContext";
import { rotaInicialPorPerfil } from "../utils/authRouting";
import "../styles/Login.css";

export default function Login() {
  const navigate = useNavigate();
  const { definirUsuarioAutenticado } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [usuariosDev, setUsuariosDev] = useState([]);
  const [carregandoDev, setCarregandoDev] = useState(false);


  function hostEhLocalhost(hostname) {
    return ["localhost", "127.0.0.1", "::1"].includes(hostname);
  }

  function apiBaseEhLocalhost(apiBase) {
    try {
      return hostEhLocalhost(new URL(apiBase).hostname);
    } catch {
      return false;
    }
  }

  const frontendEmLocalhost = hostEhLocalhost(window.location.hostname);
  const backendEmLocalhost = apiBaseEhLocalhost(API_URL);
  const loginRapidoDevHabilitado =
    import.meta.env.DEV &&
    frontendEmLocalhost &&
    backendEmLocalhost;

  useEffect(() => {
    if (!loginRapidoDevHabilitado) return;

    async function carregarUsuariosDev() {
      try {
        const data = await apiFetch("/api/auth/dev-users");
        setUsuariosDev(data.usuarios || []);
      } catch {
        setUsuariosDev([]);
      }
    }

    carregarUsuariosDev();
  }, [loginRapidoDevHabilitado]);

  useEffect(() => {
    const mensagemSessao = sessionStorage.getItem("loginMessage");

    if (mensagemSessao) {
      setErro(mensagemSessao);
      sessionStorage.removeItem("loginMessage");
    }
  }, []);

  async function handleLoginRapidoDev(usuarioId) {
    setErro("");
    setCarregandoDev(true);

    try {
      const data = await apiFetch("/api/auth/dev-login", {
        method: "POST",
        body: JSON.stringify({ id: usuarioId }),
      });

      definirUsuarioAutenticado(data.usuario);
      navigate(rotaInicialPorPerfil(data.usuario?.tipo), { replace: true });
    } catch (error) {
      setErro(error.message || "Erro no login rápido de desenvolvimento.");
    } finally {
      setCarregandoDev(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();

    setErro("");

    if (!email.trim() || !senha.trim()) {
      setErro("Preencha o e-mail e a senha.");
      return;
    }

    try {
      setCarregando(true);

      const data = await login(email, senha);

      const usuario = data.usuario;

      if (!usuario || !usuario.tipo) {
        throw new Error("Resposta inválida do servidor.");
      }

      definirUsuarioAutenticado(usuario);
      navigate(rotaInicialPorPerfil(usuario.tipo), { replace: true });

    } catch (error) {
      setErro(error.message || "Erro ao fazer login.");
    } finally {
      setCarregando(false);
    }
  }

  function limparErro() {
    if (erro) {
      setErro("");
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">

        <div className="login-header">
          <div className="login-logo">
            SC
          </div>

          <h1>Sistema de Chamada</h1>

          <p>
            Acesse sua conta para gerenciar chamadas escolares
          </p>
        </div>

        <form
          className="login-form"
          onSubmit={handleLogin}
        >

          {erro && (
            <div className="login-error">
              {erro}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">
              E-mail
            </label>

            <div className="input-wrapper">

              <Mail
                size={20}
                className="input-icon"
              />

              <input
                id="email"
                type="email"
                placeholder="Digite seu e-mail"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  limparErro();
                }}
                autoComplete="email"
              />

            </div>
          </div>

          <div className="form-group">

            <label htmlFor="senha">
              Senha
            </label>

            <div className="input-wrapper">

              <Lock
                size={20}
                className="input-icon"
              />

              <input
                id="senha"
                type={
                  mostrarSenha
                    ? "text"
                    : "password"
                }
                placeholder="Digite sua senha"
                value={senha}
                onChange={(e) => {
                  setSenha(e.target.value);
                  limparErro();
                }}
                autoComplete="current-password"
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() =>
                  setMostrarSenha(!mostrarSenha)
                }
                aria-label={
                  mostrarSenha
                    ? "Ocultar senha"
                    : "Mostrar senha"
                }
              >
                {mostrarSenha ? (
                  <EyeOff size={21} />
                ) : (
                  <Eye size={21} />
                )}
              </button>

            </div>
          </div>

          <button
            className="login-button"
            type="submit"
            disabled={carregando}
          >
            {carregando
              ? "Entrando..."
              : "Entrar"}
          </button>

        </form>

        {loginRapidoDevHabilitado && usuariosDev.length > 0 && (
          <div className="dev-login-panel">
            <strong>Login rápido de desenvolvimento</strong>
            <small>Disponível somente quando frontend e backend forem acessados por localhost.</small>

            <div className="dev-login-list">
              {usuariosDev.map((usuario) => (
                <button
                  key={usuario.id}
                  type="button"
                  onClick={() => handleLoginRapidoDev(usuario.id)}
                  disabled={carregandoDev}
                >
                  {usuario.nome} · {usuario.tipo}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
