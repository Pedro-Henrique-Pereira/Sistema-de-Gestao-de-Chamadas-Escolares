import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getUsuarioLogado, logout as logoutService } from "../services/authService";
import {
  criarControleValidacao,
  iniciarValidacao,
  invalidarValidacoes,
  validacaoContinuaAtual,
} from "../utils/authValidation";
import { limparDadosPrivados } from "../utils/privateDataCache";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const validacaoAtualRef = useRef(criarControleValidacao());

  const validarSessao = useCallback(async () => {
    const validacaoId = iniciarValidacao(validacaoAtualRef.current);
    setCarregando(true);
    setErro(null);

    try {
      const data = await getUsuarioLogado();
      if (!validacaoContinuaAtual(validacaoAtualRef.current, validacaoId)) return;
      setUsuario(data?.usuario || null);
    } catch (error) {
      if (!validacaoContinuaAtual(validacaoAtualRef.current, validacaoId)) return;
      setUsuario(null);
      if (error?.status !== 401) setErro(error);
    } finally {
      if (validacaoContinuaAtual(validacaoAtualRef.current, validacaoId)) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    limparDadosPrivados();
    validarSessao();
  }, [validarSessao]);

  useEffect(() => {
    function tratarSessaoInvalida() {
      invalidarValidacoes(validacaoAtualRef.current);
      limparDadosPrivados();
      setUsuario(null);
      setErro(null);
      setCarregando(false);
    }

    window.addEventListener("auth:unauthorized", tratarSessaoInvalida);
    return () => window.removeEventListener("auth:unauthorized", tratarSessaoInvalida);
  }, []);

  const definirUsuarioAutenticado = useCallback((novoUsuario) => {
    invalidarValidacoes(validacaoAtualRef.current);
    limparDadosPrivados();
    setUsuario(novoUsuario || null);
    setErro(null);
    setCarregando(false);
  }, []);

  const sair = useCallback(async () => {
    invalidarValidacoes(validacaoAtualRef.current);
    try {
      await logoutService();
    } finally {
      limparDadosPrivados();
      setUsuario(null);
      setErro(null);
      setCarregando(false);
    }
  }, []);

  const value = useMemo(() => ({
    usuario,
    carregando,
    erro,
    validarSessao,
    definirUsuarioAutenticado,
    sair,
  }), [usuario, carregando, erro, validarSessao, definirUsuarioAutenticado, sair]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return context;
}
