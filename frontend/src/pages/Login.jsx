import { useEffect, useState } from "react";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import "../styles/Login.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [usuariosDev, setUsuariosDev] = useState([]);
  const [carregandoDev, setCarregandoDev] = useState(false);

  const API_BASE = import.meta.env.VITE_API_URL || "http://192.168.0.13:3001";
  const loginRapidoDevHabilitado = import.meta.env.DEV || import.meta.env.VITE_DEV_LOGIN === "true";


  useEffect(() => {
    if (!loginRapidoDevHabilitado) return;

    async function carregarUsuariosDev() {
      try {
        const response = await fetch(`${API_BASE}/api/auth/dev-users`, {
          credentials: "include",
        });

        if (!response.ok) return;

        const data = await response.json();
        setUsuariosDev(data.usuarios || []);
      } catch {
        setUsuariosDev([]);
      }
    }

    carregarUsuariosDev();
  }, [API_BASE, loginRapidoDevHabilitado]);

  async function handleLoginRapidoDev(usuarioId) {
    setErro("");
    setCarregandoDev(true);

    try {
      const response = await fetch(`${API_BASE}/api/auth/dev-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ id: usuarioId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.erro || "Login rápido indisponível.");
      }

      redirecionarPorCargo(data.usuario.tipo);
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

    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        email,
        senha,
      }),
    });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.erro ||
            data.message ||
            "E-mail ou senha inválidos."
        );
      }

      const usuario = data.usuario;

      if (!usuario || !usuario.tipo) {
        throw new Error("Resposta inválida do servidor.");
      }

      redirecionarPorCargo(usuario.tipo);

    } catch (error) {
      setErro(error.message || "Erro ao fazer login.");

      setTimeout(() => {
        setErro("");
      }, 4000);

    } finally {
      setCarregando(false);
    }
  }

  function redirecionarPorCargo(tipo) {

    switch (tipo) {

      case "administracao":
        window.location.href = "/admin";
        break;

      case "pedagoga":
        window.location.href = "/pedagoga";
        break;

      case "professor":
        window.location.href = "/professor";
        break;

      default:
        setErro("Tipo de usuário não reconhecido.");
        break;
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
            <small>Ativo apenas com AUTH_DEV_BYPASS=true ou DEV_LOGIN_ENABLED=true no backend.</small>

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