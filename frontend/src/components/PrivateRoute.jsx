import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { resolverAcessoProtegido } from "../utils/authRouting";
import AuthState from "./AuthState";

function PrivateRoute({ children, cargosPermitidos }) {
  const { usuario, carregando, erro, validarSessao } = useAuth();
  const acesso = resolverAcessoProtegido({ carregando, erro, usuario, cargosPermitidos });

  if (acesso.estado === "carregando") return <AuthState />;
  if (acesso.estado === "erro") return <AuthState tipo="erro" onRetry={validarSessao} />;
  if (acesso.destino) return <Navigate to={acesso.destino} replace />;

  return children;
}

export default PrivateRoute;
