import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getUsuarioLogado } from "../services/authService";

function PrivateRoute({ children, cargosPermitidos }) {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    async function verificarLogin() {
      try {
        const data = await getUsuarioLogado();

        if (cargosPermitidos && !cargosPermitidos.includes(data.usuario.tipo)) {
          setUsuario(false);
          return;
        }

        setUsuario(data.usuario);
      } catch {
        setUsuario(false);
      } finally {
        setCarregando(false);
      }
    }

    verificarLogin();
  }, [cargosPermitidos]);

  if (carregando) {
    return <p>Carregando...</p>;
  }

  if (!usuario) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default PrivateRoute;