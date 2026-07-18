import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { rotaInicialPorPerfil } from "../utils/authRouting";

function RotaDesconhecida() {
  const { usuario } = useAuth();

  return <Navigate to={rotaInicialPorPerfil(usuario?.tipo)} replace />;
}

export default RotaDesconhecida;
